// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier, qualifiedObjectName, escapeSqlString } from '@/shared/utils/objectIdentity';
import { rewriteTriggerTraceReferences } from '@/features/stored/triggerTraceTokens';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import { findTraceBlockEnd, removeTraceBlockEndName } from '@/features/stored/traceBlockEnd';

interface TriggerTraceContext {
  wizBody: string;
  wizSchema: string;
  wizTargetObject: string;
  wizTiming: string;
  wizForEachRow: boolean;
  traceTargetDml: 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE';
  traceInputData: Record<string, string>;
  structureDefs: ColumnDefinition[];
  checkWhere: string;
  formatSqlValue: (column: ColumnDefinition, value: unknown) => string | number;
}

// Generate the temporary trace program and preserve its source-line mapping.
export function buildTriggerTraceProgram({ wizBody, wizSchema, wizTargetObject, wizForEachRow, traceTargetDml, traceInputData, structureDefs, checkWhere, formatSqlValue }: TriggerTraceContext) {
  const vNew = 'v_n';
  const vOld = 'v_o';

  const modifiedBody = rewriteTriggerTraceReferences(wizBody, 'postgresql', { dml: traceTargetDml });

  const tLines = wizBody.split('\n');
  const mLines = modifiedBody.split('\n');

  const declStart = tLines.findIndex(l => /^\s*DECLARE\b/i.test(l));
  let beginStart = tLines.findIndex(l => /^\s*BEGIN\b/i.test(l));
  if (beginStart === -1) beginStart = 0;

  let declareLines: string[] = [];
  if (declStart !== -1) {
    declareLines = mLines.slice(declStart + 1, beginStart);
  }
  const beginLines = mLines.slice(beginStart + 1);

  const where = checkWhere;
  const isForEachRowDml = wizForEachRow && (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE');
  const indent = isForEachRowDml ? '  ' : '';
  const tblObj = qualifiedObjectName({ schema: wizSchema, objectName: wizTargetObject });

  // Simulate the selected body only. Issuing the triggering DML would fire live triggers again.
  // In particular, AFTER bodies do not see a simulated post-DML table state.

  let bodyTag = '$monabase_trace$';
  while (modifiedBody.includes(bodyTag)) bodyTag = bodyTag.slice(0, -1) + '_$';
  let currentPLine = 1;
  let sqlText = `CREATE OR REPLACE PROCEDURE ${quoteIdentifier(wizSchema)}."__placeholder__"()\nLANGUAGE plpgsql\nAS ${bodyTag}\nDECLARE\n`;
  currentPLine += 4;

  sqlText += `  TG_OP text := '${traceTargetDml}';\n`;
  sqlText += `  TG_TABLE_NAME text := '${escapeSqlString(wizTargetObject)}';\n`;
  sqlText += `  TG_TABLE_SCHEMA text := '${escapeSqlString(wizSchema)}';\n`;
  currentPLine += 3;

  sqlText += `  ${vNew} ${tblObj}%ROWTYPE;\n`;
  currentPLine++;
  sqlText += `  ${vOld} ${tblObj}%ROWTYPE;\n`;
  currentPLine++;

  if (isForEachRowDml) {
    sqlText += `  r_target RECORD;\n`;
    currentPLine++;
  }

  const mapP2T: number[] = new Array(5000).fill(0);
  const mapT2P: number[] = new Array(5000).fill(0);
  const declaredVars: string[] = [];

  if (declareLines.some(l => l.trim() !== '')) {
    sqlText += `  -- ▼ Trigger variable declarations ▼\n`;
    currentPLine++;
    declareLines.forEach((l, i) => {
        const tLine = declStart + 2 + i;
        mapP2T[currentPLine] = tLine;
        mapT2P[tLine] = currentPLine;
        sqlText += `${l}\n`;
        currentPLine++;

        const varMatch = l.trim().match(/^([a-zA-Z0-9_]+)\s+/);
        if (varMatch) {
            const vName = varMatch[1].toUpperCase();
            if (!['BEGIN','DECLARE','TYPE','CURSOR','PRAGMA','--'].includes(vName)) {
                declaredVars.push(varMatch[1]);
            }
        }
    });
  }

  sqlText += `BEGIN\n`;
  currentPLine++;

  if (isForEachRowDml) {
    const loopStr = `  FOR r_target IN SELECT ctid AS rid FROM ${tblObj} WHERE ${where} LOOP\n${indent}  BEGIN\n${indent}    SELECT * INTO ${vOld}\n${indent}    FROM ${tblObj} WHERE ctid = r_target.rid;\n${indent}  EXCEPTION WHEN OTHERS THEN NULL;\n  ${indent}END;\n`;
    sqlText += loopStr;
    currentPLine += loopStr.split('\n').length - 1;
    if (traceTargetDml === 'UPDATE') {
      sqlText += `${indent}  ${vNew} := ${vOld};\n`;
      currentPLine++;
    }
  } else {
    if (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') {
      const blockStr = `  BEGIN\n    SELECT * INTO ${vOld}\n    FROM ${tblObj} WHERE ${where} LIMIT 1;\n  EXCEPTION WHEN OTHERS THEN NULL;\n  END;\n`;
      sqlText += blockStr;
      currentPLine += blockStr.split('\n').length - 1;
      if (traceTargetDml === 'UPDATE') {
        sqlText += `  ${vNew} := ${vOld};\n`;
        currentPLine++;
      }
    }
  }

  if (traceTargetDml === 'INSERT' || traceTargetDml === 'UPDATE') {
    structureDefs.forEach(col => {
      const val = traceInputData[col.COLUMN_NAME];
      if (val !== '' && val !== null && val !== undefined) {
        sqlText += `${indent}  ${vNew}."${col.COLUMN_NAME}" := ${formatSqlValue(col, val)};\n`;
        currentPLine++;
      }
    });
  }

  sqlText += `\n${indent}  -- ▼ Trigger body ▼\n`;
  currentPLine += 2;

  sqlText += `${indent}  <<trace_block>>\n`;
  currentPLine++;
  sqlText += `${indent}  BEGIN\n`;
  currentPLine++;

  structureDefs.forEach(col => {
      sqlText += `${indent}  RAISE NOTICE '[TRACE VAR] v_n.${col.COLUMN_NAME.toUpperCase()} = %', v_n."${col.COLUMN_NAME}";\n`;
      sqlText += `${indent}  RAISE NOTICE '[TRACE VAR] v_o.${col.COLUMN_NAME.toUpperCase()} = %', v_o."${col.COLUMN_NAME}";\n`;
      currentPLine += 2;
  });

  declaredVars.forEach(vName => {
      sqlText += `${indent}  RAISE NOTICE '[TRACE VAR] ${vName.toUpperCase()} = %', ${vName};\n`;
      currentPLine++;
  });

  const lastEndIndex = findTraceBlockEnd(beginLines);
  if (lastEndIndex !== -1) beginLines[lastEndIndex] = removeTraceBlockEndName(beginLines[lastEndIndex]);

  let loopCounter = 0;
  const traceLoopIds: string[] = [];
  let inSubDeclaration = false;
  let isNewStatement = true;
  let pendingVarTraces: { formatKey: string, rawVarName: string }[] = [];
  let statementBuffer = "";
  let pendingCursorRecord: string | null = null;

  beginLines.forEach((l, i) => {
      const trimmed = l.trim();
      const upperTrimmed = trimmed.toUpperCase();
      const tLine = beginStart + 2 + i;

      if (upperTrimmed === 'DECLARE' || upperTrimmed.startsWith('DECLARE ')) {
          inSubDeclaration = true;
      } else if (upperTrimmed === 'BEGIN' || upperTrimmed.startsWith('BEGIN ')) {
          inSubDeclaration = false;
      }

      const pLine = currentPLine;
      mapP2T[pLine] = tLine;
      mapT2P[tLine] = pLine;

      let outLine = `${indent}  ${l}`;

      let cleanTrimmed = trimmed;
      const commentIdx = cleanTrimmed.indexOf('--');
      if (commentIdx !== -1) {
          const quotesBefore = (cleanTrimmed.substring(0, commentIdx).match(/'/g) || []).length;
          if (quotesBefore % 2 === 0) {
              cleanTrimmed = cleanTrimmed.substring(0, commentIdx).trim();
          }
      }
      const upperCleanTrimmed = cleanTrimmed.toUpperCase();

      if (upperCleanTrimmed.startsWith('END LOOP')) {
        const loopId = traceLoopIds.pop();
        if (loopId) outLine += `\n${indent}  RAISE NOTICE '[TRACE LOOP_END] ${loopId}';`;
      }

      const isControlKeyword = upperCleanTrimmed.startsWith('EXCEPTION') ||
                             upperCleanTrimmed.startsWith('END') ||
                             upperCleanTrimmed.startsWith('WHEN') ||
                             upperCleanTrimmed.startsWith('DECLARE') ||
                             upperCleanTrimmed.startsWith('BEGIN');

      if (upperCleanTrimmed.startsWith('RETURN')) {
         outLine = `${indent}  RAISE NOTICE '[TRACE LINE] ${pLine}';\n${indent}  EXIT trace_block; -- ${l}`;
      } else if (cleanTrimmed.length > 0 && !isControlKeyword && !inSubDeclaration && isNewStatement) {
         outLine = `${indent}  RAISE NOTICE '[TRACE LINE] ${pLine}';\n${outLine}`;
      }

      const forLoopMatch = cleanTrimmed.match(/FOR\s+([a-zA-Z0-9_]+)\s+IN\s+/i);
      if (forLoopMatch) {
          pendingCursorRecord = forLoopMatch[1];
      }

      if (upperCleanTrimmed.endsWith('LOOP') && !upperCleanTrimmed.startsWith('END LOOP')) {
        loopCounter++;
        traceLoopIds.push(`L${loopCounter}`);
        outLine += `\n${indent}  RAISE NOTICE '[TRACE LOOP_START] L${loopCounter}';`;
        if (pendingCursorRecord) {
            outLine += `\n${indent}  RAISE NOTICE '[TRACE VAR] ${pendingCursorRecord.toUpperCase()} = %', ${pendingCursorRecord};`;
            pendingCursorRecord = null;
        }
      }

      if (cleanTrimmed.length > 0) {
          if (isNewStatement) {
             statementBuffer = cleanTrimmed;
          } else {
             statementBuffer += " " + cleanTrimmed;
          }
      }

      if (cleanTrimmed.endsWith(';') || upperCleanTrimmed.endsWith('BEGIN') || upperCleanTrimmed.endsWith('THEN') || upperCleanTrimmed.endsWith('ELSE') || upperCleanTrimmed.endsWith('LOOP') || upperCleanTrimmed.endsWith('EXCEPTION')) {
        if (!inSubDeclaration && cleanTrimmed.endsWith(';')) {
           const allVars: string[] = ['v_n', 'v_o'];
           declaredVars.forEach(vName => {
               if (!allVars.includes(vName)) allVars.push(vName);
           });

           const stmtUpper = statementBuffer.toUpperCase();

           if (statementBuffer.trim().length > 0 && !stmtUpper.includes('RAISE NOTICE')) {
               allVars.forEach(vName => {
                   const regex = new RegExp(`\\b${vName}\\b`, 'i');
                   if (regex.test(statementBuffer)) {
                       if (vName === 'v_n' || vName === 'v_o') {
                           const recordRegex = new RegExp(`\\b${vName}\\.?["a-zA-Z0-9_]*`, 'gi');
                           const matches = statementBuffer.match(recordRegex);
                           if (matches) {
                               matches.forEach(m => {
                                   if (m.includes('.')) {
                                      const formatKey = m.replace(/"/g, '').toUpperCase();
                                      pendingVarTraces.push({ formatKey, rawVarName: m });
                                   }
                               });
                           }
                       } else {
                           const formatKey = vName.toUpperCase();
                           pendingVarTraces.push({ formatKey, rawVarName: vName });
                       }
                   }
               });
           }
        }

        if (pendingVarTraces.length > 0 && !inSubDeclaration) {
           const uniqueTraces: { formatKey: string, rawVarName: string }[] = [];
           pendingVarTraces.forEach(trace => {
               if (!uniqueTraces.find(u => u.formatKey === trace.formatKey)) {
                   uniqueTraces.push(trace);
               }
           });

           uniqueTraces.forEach(trace => {
               outLine += `\n${indent}  RAISE NOTICE '[TRACE VAR] ${trace.formatKey} = %', ${trace.rawVarName};`;
           });
           pendingVarTraces = [];
        }

        isNewStatement = true;
        statementBuffer = "";
      } else {
        if (cleanTrimmed.length > 0) {
           isNewStatement = false;
        }
      }

      sqlText += `${outLine}\n`;
      currentPLine += outLine.split('\n').length;
  });

  if (lastEndIndex === -1) {
    sqlText += `${indent}  END;\n`;
    currentPLine++;
  }

  if (isForEachRowDml) {
    sqlText += `  END LOOP;\n`;
    currentPLine++;
  }

  sqlText += `\n  -- ▼ Automatically roll back after tracing ▼\n`;
  sqlText += `  ROLLBACK;\n`;
  currentPLine += 3;

  sqlText += `\nEND;\n${bodyTag};`;


  let currentTLine = beginStart + 1;
  for (let i = 1; i <= currentPLine + 2; i++) {
      if (mapP2T[i] > 0) {
          currentTLine = mapP2T[i];
      } else {
          mapP2T[i] = currentTLine;
      }
  }


  return { sqlText, mapP2T, mapT2P };
}
