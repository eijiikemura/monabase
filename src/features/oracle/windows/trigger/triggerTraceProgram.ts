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
  traceTargetDml: 'INSERT' | 'UPDATE' | 'DELETE';
  traceInputData: Record<string, string>;
  structureDefs: ColumnDefinition[];
  checkWhere: string;
  formatSqlValue: (column: ColumnDefinition, value: unknown) => string | number;
  wizAliasOld: string;
  newAliasRaw: string;
}

// Generate the temporary trace program and preserve its source-line mapping.
export function buildTriggerTraceProgram({ wizBody, wizSchema, wizTargetObject, wizForEachRow, traceTargetDml, traceInputData, structureDefs, checkWhere, formatSqlValue, wizAliasOld, newAliasRaw }: TriggerTraceContext) {
  const vNew = 'v_n';
  const vOld = 'v_o';

  const oldAliasRaw = wizAliasOld.replace(/"/g, '').trim() || 'OLD';
  const updatedColumns = structureDefs.filter(col => {
    const input = traceInputData[col.COLUMN_NAME];
    return input !== undefined && input !== null && input !== '';
  }).map(col => col.COLUMN_NAME);
  const modifiedBody = rewriteTriggerTraceReferences(wizBody, 'oracle', {
    newAlias: newAliasRaw, oldAlias: oldAliasRaw, dml: traceTargetDml, updatedColumns
  });

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

  const varTypes: Record<string, string> = {};
  declareLines.forEach(l => {
     const varMatch = l.trim().match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)/);
     if (varMatch) {
         const vName = varMatch[1].toUpperCase();
         if (!['BEGIN','DECLARE','TYPE','CURSOR','PRAGMA','--'].includes(vName)) {
             varTypes[vName] = varMatch[2].toUpperCase();
         }
     }
  });

  const lastEndIndex = findTraceBlockEnd(beginLines);
  if (lastEndIndex !== -1) beginLines[lastEndIndex] = removeTraceBlockEndName(beginLines[lastEndIndex]);

  const where = checkWhere;
  const isForEachRowDml = wizForEachRow && (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE');
  const indent = isForEachRowDml ? '  ' : '';
  const tblObj = qualifiedObjectName({ schema: wizSchema, objectName: wizTargetObject });

  // Simulate the selected body only. Issuing the triggering DML would fire live triggers again.
  // In particular, AFTER bodies do not see a simulated post-DML table state.

  let currentPLine = 1;
  let sqlText = `CREATE OR REPLACE PROCEDURE ${wizSchema ? `${quoteIdentifier(wizSchema)}.` : ''}__placeholder__\nAS\n`;
  currentPLine += 2;
  sqlText += `  ${vNew} ${tblObj}%ROWTYPE;\n`;
  currentPLine++;
  sqlText += `  ${vOld} ${tblObj}%ROWTYPE;\n`;
  currentPLine++;
  
  if (isForEachRowDml) {
    sqlText += `  CURSOR c_target IS SELECT ROWID AS rid FROM ${tblObj} WHERE ${where};\n`;
    currentPLine++;
  }

  const mapP2T: number[] = new Array(5000).fill(0);
  const mapT2P: number[] = new Array(5000).fill(0);

  if (declareLines.some(l => l.trim() !== '')) {
    sqlText += `  -- ▼ Trigger variable declarations ▼\n`;
    currentPLine++;
    declareLines.forEach((l, i) => {
        const tLine = declStart + 2 + i;
        mapP2T[currentPLine] = tLine;
        mapT2P[tLine] = currentPLine;
        sqlText += `${l}\n`;
        currentPLine++;
    });
  }
  
  sqlText += `BEGIN\n`; 
  currentPLine++;

  if (isForEachRowDml) {
    const loopStr = `  FOR r_target IN c_target LOOP\n${indent}  BEGIN\n${indent}    SELECT * INTO ${vOld}\n${indent}    FROM ${tblObj} WHERE ROWID = r_target.rid;\n${indent}  EXCEPTION WHEN OTHERS THEN NULL;\n  ${indent}END;\n`;
    sqlText += loopStr;
    currentPLine += loopStr.split('\n').length - 1;
    if (traceTargetDml === 'UPDATE') {
      sqlText += `${indent}  ${vNew} := ${vOld};\n`; 
      currentPLine++;
    }
  } else {
    if (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') {
      const blockStr = `  BEGIN\n    SELECT * INTO ${vOld}\n    FROM ${tblObj} WHERE ${where} AND ROWNUM = 1;\n  EXCEPTION WHEN OTHERS THEN NULL;\n  END;\n`;
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
        sqlText += `${indent}  ${vNew}.${quoteIdentifier(col.COLUMN_NAME)} := ${formatSqlValue(col, val)};\n`;
        currentPLine++;
      }
    });
  }

  sqlText += `\n${indent}  -- ▼ Trigger body ▼\n`;
  currentPLine += 2;

  sqlText += `${indent}  BEGIN\n`; 
  currentPLine++;
  sqlText += `${indent}    BEGIN\n`; 
  currentPLine++;
  
  structureDefs.forEach(col => {
      sqlText += `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] v_n.${escapeSqlString(col.COLUMN_NAME.toUpperCase())} = ' || v_n.${quoteIdentifier(col.COLUMN_NAME)});\n`;
      sqlText += `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] v_o.${escapeSqlString(col.COLUMN_NAME.toUpperCase())} = ' || v_o.${quoteIdentifier(col.COLUMN_NAME)});\n`;
      currentPLine += 2;
  });

  declareLines.forEach(l => {
     const varMatch = l.trim().match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)/);
     if (varMatch) {
         const vName = varMatch[1].toUpperCase();
         if (!['BEGIN','DECLARE','TYPE','CURSOR','PRAGMA','--'].includes(vName)) {
             if (varTypes[vName] === 'BOOLEAN') {
                 sqlText += `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${vName} = ' || CASE WHEN ${varMatch[1]} THEN 'TRUE' WHEN NOT ${varMatch[1]} THEN 'FALSE' ELSE 'NULL' END);\n`;
             } else {
                 sqlText += `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${vName} = ' || ${varMatch[1]});\n`;
             }
             currentPLine++;
         }
     }
  });

  let loopCounter = 0;
  const traceLoopIds: string[] = [];
  let inSubDeclaration = false;
  let isNewStatement = true;
  let pendingVarTrace: { formatKey: string, rawVarName: string } | null = null;
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

      let outLine = `${indent}      ${l}`;
      
      if (upperTrimmed.startsWith('END LOOP')) {
        const loopId = traceLoopIds.pop();
        if (loopId) outLine += `\n${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE LOOP_END] ${loopId}');`;
      }

      const isControlKeyword = upperTrimmed.startsWith('EXCEPTION') ||
                             upperTrimmed.startsWith('END') || 
                             upperTrimmed.startsWith('WHEN') ||
                             upperTrimmed.startsWith('DECLARE') ||
                             upperTrimmed.startsWith('BEGIN');

      if (upperTrimmed.startsWith('RETURN')) {
         outLine = `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE LINE] ${pLine}');\n${indent}      GOTO trace_end; -- ${l}`;
      } else if (trimmed.length > 0 && !trimmed.startsWith('--') && !isControlKeyword && !inSubDeclaration && isNewStatement) {
         outLine = `${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE LINE] ${pLine}');\n${outLine}`;
      }
      
      const forLoopMatch = trimmed.match(/FOR\s+([a-zA-Z0-9_]+)\s+IN\s+/i);
      if (forLoopMatch) {
          pendingCursorRecord = forLoopMatch[1];
      }

      if (upperTrimmed.endsWith('LOOP') && !upperTrimmed.startsWith('END LOOP')) {
        loopCounter++;
        traceLoopIds.push(`L${loopCounter}`);
        outLine += `\n${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE LOOP_START] L${loopCounter}');`;
        if (pendingCursorRecord) {
            outLine += `\n${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${pendingCursorRecord.toUpperCase()} = ' || ${pendingCursorRecord});`;
            pendingCursorRecord = null;
        }
      }

      if (isNewStatement) {
          const assignMatch = trimmed.match(/^([a-zA-Z0-9_]+(?:(?:\([^)]+\))|(?:\.[a-zA-Z0-9_]+))*)\s*(?::=|=)/);
          if (assignMatch && !inSubDeclaration && !upperTrimmed.startsWith('IF') && !upperTrimmed.startsWith('ELSIF') && !upperTrimmed.startsWith('WHILE') && !upperTrimmed.startsWith('FOR')) {
            const rawVarName = assignMatch[1].trim();
            const formatKey = rawVarName.replace(/"/g, '').toUpperCase();
            pendingVarTrace = { formatKey, rawVarName };
          }

          const intoMatch = trimmed.match(/\bINTO\s+([a-zA-Z0-9_."]+)/i);
          if (intoMatch && !inSubDeclaration && !upperTrimmed.startsWith('INSERT')) {
             const rawVarName = intoMatch[1].trim();
             const formatKey = rawVarName.replace(/"/g, '').toUpperCase();
             pendingVarTrace = { formatKey, rawVarName };
          }
      }

      if (trimmed.endsWith(';') || upperTrimmed.endsWith('BEGIN') || upperTrimmed.endsWith('THEN') || upperTrimmed.endsWith('ELSE') || upperTrimmed.endsWith('LOOP') || upperTrimmed.endsWith('EXCEPTION')) {
        isNewStatement = true;
        if (pendingVarTrace) {
           if (varTypes[pendingVarTrace.formatKey] === 'BOOLEAN') {
               outLine += `\n${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${pendingVarTrace.formatKey} = ' || CASE WHEN ${pendingVarTrace.rawVarName} THEN 'TRUE' WHEN NOT ${pendingVarTrace.rawVarName} THEN 'FALSE' ELSE 'NULL' END);`;
           } else {
               outLine += `\n${indent}      DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${pendingVarTrace.formatKey} = ' || ${pendingVarTrace.rawVarName});`;
           }
           pendingVarTrace = null;
        }
      } else if (trimmed.length > 0 && !trimmed.startsWith('--')) {
        isNewStatement = false;
      }

      sqlText += `${outLine}\n`;
      currentPLine += outLine.split('\n').length;

      if (i === lastEndIndex) {
          sqlText += `${indent}    <<trace_end>> NULL;\n`;
          currentPLine++;
          sqlText += `${indent}  END;\n`; 
          currentPLine++;
      }
  });

  if (lastEndIndex === -1) {
      sqlText += `${indent}    <<trace_end>> NULL;\n`;
      currentPLine++;
      sqlText += `${indent}    END;\n`; 
      currentPLine++;
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

  sqlText += `\nEND;`; 


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
