// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ArgInfo } from '@/features/stored/storedCommon';
import { findTraceBlockEnd, removeTraceBlockEndName } from '@/features/stored/traceBlockEnd';
import { getPostgresFormatForValue } from '@/shared/utils/dateFormatter';
import { tokenizePgSql } from '@/features/postgresql/sqlTokens';

interface Options {
  schema: string; objectType: string; sourceText: string;
  finalArgs: Record<string, string | null>; argumentsList: ArgInfo[]; inputDateFormat: string;
  t: (key: string) => string;
}
interface ReturnStatement { expression: string; endLine: number; }

function analyzeTraceSource(source: string, t: Options['t']) {
  const tokens = tokenizePgSql(source);
  const asIndex = tokens.findIndex((token, index) => /^AS$/i.test(token.text) && tokens[index + 1]?.kind === 'dollar');
  const bodyToken = tokens[asIndex + 1];
  const languageIndex = tokens.findIndex(token => token.kind === 'word' && /^LANGUAGE$/i.test(token.text));
  const resultIndex = tokens.findIndex(token => token.kind === 'word' && /^RETURNS$/i.test(token.text));
  if (asIndex < 0 || !bodyToken || (languageIndex >= 0 && !/^plpgsql$/i.test(tokens[languageIndex + 1]?.text)) ||
      (resultIndex >= 0 && /^(TABLE|SETOF)$/i.test(tokens[resultIndex + 1]?.text))) throw new Error(t('trace_unsupported_source'));
  const tag = bodyToken.text.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if (!tag) throw new Error(t('trace_unsupported_source'));
  const start = bodyToken.start + tag.length, end = bodyToken.end - tag.length;
  const inner = source.slice(start, end);
  const bodyTokens = tokenizePgSql(inner);
  const returns = new Map<number, ReturnStatement>();
  const lineAt = (position: number) => source.slice(0, position).split('\n').length - 1;
  for (let index = 0; index < bodyTokens.length; index++) {
    const token = bodyTokens[index];
    if (token.kind !== 'word' || !/^RETURN$/i.test(token.text)) continue;
    if (/^(NEXT|QUERY)$/i.test(bodyTokens[index + 1]?.text)) throw new Error(t('trace_set_returning_unsupported'));
    let finish = index + 1;
    while (finish < bodyTokens.length && bodyTokens[finish].text !== ';') finish++;
    if (finish === bodyTokens.length) throw new Error(t('trace_unsupported_source'));
    const absolute = start + token.start, statementEnd = start + bodyTokens[finish].end;
    const lineStart = source.lastIndexOf('\n', absolute - 1) + 1;
    const nextLine = source.indexOf('\n', statementEnd);
    if (tokenizePgSql(source.slice(lineStart, absolute)).length ||
        tokenizePgSql(source.slice(statementEnd, nextLine < 0 ? end : nextLine)).length) throw new Error(t('trace_unsupported_source'));
    returns.set(lineAt(absolute), { expression: inner.slice(token.end, bodyTokens[finish].start).trim(), endLine: lineAt(statementEnd) });
    index = finish;
  }
  const lines = source.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index];
    lines[index] = source.slice(Math.max(offset, start), Math.max(Math.max(offset, start), Math.min(offset + original.length, end)));
    offset += original.length + 1;
  }
  let delimiter = '$monabase_trace$';
  while (inner.includes(delimiter)) delimiter = delimiter.replace('trace', 'trace_');
  const positionalArguments = bodyTokens.some(token => token.kind === 'word' && /^\$[1-9][0-9]*$/.test(token.text));
  return { lines, returns, delimiter, positionalArguments };
}

export function buildPgTraceProgram({ schema, objectType, sourceText, finalArgs, argumentsList, inputDateFormat, t }: Options): string {
    const outputArguments = argumentsList.filter(argument => argument.IN_OUT !== 'IN').map(argument =>
      `  RAISE NOTICE '[TRACE RETURN] %', json_build_object('name', '${argument.ARGUMENT_NAME.replace(/'/g, "''")}', 'value', ${argument.ARGUMENT_NAME})::text;`);
    const { lines: tLines, returns, delimiter, positionalArguments } = analyzeTraceSource(sourceText, t);
    const outLines: string[] = [`CREATE OR REPLACE PROCEDURE "${schema.replace(/"/g, '""')}"."__placeholder__"()`, 'LANGUAGE plpgsql', `AS ${delimiter}`, 'BEGIN'];

    const inArgs = argumentsList.filter(a => a.IN_OUT !== 'OUT');
    if (argumentsList.some(a => !/^[a-z_][a-z0-9_$]*$/.test(a.ARGUMENT_NAME)) || positionalArguments) {
      throw new Error(t('trace_unsupported_source'));
    }
    const argDecls = argumentsList.map(a => `  ${a.ARGUMENT_NAME} ${a.DATA_TYPE};`);
    
    const argInits = inArgs.map(a => {
      const val = finalArgs[a.ARGUMENT_NAME];
      if (!Object.hasOwn(finalArgs, a.ARGUMENT_NAME)) {
        if (!a.DEFAULT_VALUE) throw new Error(t('routine_default_unavailable'));
        return `  ${a.ARGUMENT_NAME} := (${a.DEFAULT_VALUE});`;
      }
      if (val == null) return `  ${a.ARGUMENT_NAME} := NULL;`;
      if (val === '' && !/^(text|character|varchar|char|bpchar)/i.test(a.DATA_TYPE)) return `  ${a.ARGUMENT_NAME} := NULL;`;
      const literal = `'${val.replace(/'/g, "''")}'`;
      const expression = /^(date|timestamp)/i.test(a.DATA_TYPE)
        ? `TO_TIMESTAMP(${literal}, '${getPostgresFormatForValue(inputDateFormat, val).replace(/'/g, "''")}')` : literal;
      return `  ${a.ARGUMENT_NAME} := CAST(${expression} AS ${a.DATA_TYPE});`;
    });

    const declStart = tLines.findIndex(l => /^\s*DECLARE\b/i.test(l));
    const beginStart = tLines.findIndex(l => /^\s*BEGIN\b/i.test(l));
    if (beginStart === -1 || tLines[beginStart].trim().toUpperCase() !== 'BEGIN') throw new Error(t('trace_unsupported_source'));

    let declareLines: string[] = [];
    if (declStart !== -1 && beginStart > declStart) {
      declareLines = tLines.slice(declStart + 1, beginStart);
    }

    const declaredVars: string[] = [];
    let inMultiLineDef = false;

    declareLines.forEach(l => {
       const trimmed = l.trim();
       if (trimmed.length === 0 || trimmed.startsWith('--')) return;

       if (inMultiLineDef) {
           if (trimmed.endsWith(';')) inMultiLineDef = false;
           return;
       }

       const varMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_[\]]+)/);
       if (varMatch) {
           const vName = varMatch[1].toUpperCase();
           const vType = varMatch[2].toUpperCase();
           const reserved = ['BEGIN','DECLARE','TYPE','CURSOR','PRAGMA','SELECT','FROM','WHERE','AND','OR','ORDER','GROUP','HAVING','JOIN','INSERT','UPDATE','DELETE'];
           
           if (!reserved.includes(vName) && vType !== 'RECORD' && vType !== 'CURSOR') {
               declaredVars.push(varMatch[1]);
           }
       }
       
       if (!trimmed.endsWith(';')) {
           inMultiLineDef = true;
       }
    });

    let hasInsertedDecl = false;
    let hasInsertedInit = false;
    let loopCounter = 0;
    const traceLoopIds: string[] = [];

    const lastEndIndex = findTraceBlockEnd(tLines);
    if (lastEndIndex !== -1) tLines[lastEndIndex] = removeTraceBlockEndName(tLines[lastEndIndex]);

    let isNewStatement = true;
    let inSubDeclaration = false;
    let pendingVarTraces: { formatKey: string, rawVarName: string }[] = [];
    let statementBuffer = "";
    let pendingCursorRecord: string | null = null;

    for (let i = 0; i < tLines.length; i++) {
        const line = tLines[i];
        const trimmed = line.trim();
        const originalLineNum = i + 1; 

        const commentIdx = trimmed.indexOf('--');
        let cleanTrimmed = trimmed;
        if (commentIdx !== -1) {
            const quotesBefore = (trimmed.substring(0, commentIdx).match(/'/g) || []).length;
            if (quotesBefore % 2 === 0) {
                cleanTrimmed = trimmed.substring(0, commentIdx).trim();
            }
        }
        const upperCleanTrimmed = cleanTrimmed.toUpperCase();

        if (upperCleanTrimmed === 'DECLARE' || upperCleanTrimmed.startsWith('DECLARE ')) {
            inSubDeclaration = true;
        } else if (upperCleanTrimmed === 'BEGIN' || upperCleanTrimmed.startsWith('BEGIN ')) {
            inSubDeclaration = false;
        }

        if (!hasInsertedDecl && upperCleanTrimmed === 'DECLARE') {
            outLines.push(`<<trace_block>>`);
            outLines.push(line);
            outLines.push(`  -- ▼ Trace argument declarations ▼`);
            outLines.push(...argDecls);
            hasInsertedDecl = true;
            continue;
        }

        if (!hasInsertedInit && upperCleanTrimmed === 'BEGIN') {
            if (!hasInsertedDecl) {
                outLines.push(`<<trace_block>>`);
                if (argDecls.length > 0) {
                    outLines.push(`DECLARE`);
                    outLines.push(`  -- ▼ Trace argument declarations ▼`);
                    outLines.push(...argDecls);
                }
                hasInsertedDecl = true;
            }
            outLines.push(line);
            if (argInits.length > 0) {
               outLines.push(`  -- ▼ Initialize arguments ▼`);
               outLines.push(...argInits);
            }

            outLines.push(`  -- ▼ Output initial variable state ▼`);
            inArgs.forEach(a => {
                outLines.push(`  RAISE NOTICE '[TRACE VAR] ${a.ARGUMENT_NAME.toUpperCase()} = %', ${a.ARGUMENT_NAME};`);
            });
            declaredVars.forEach(vName => {
                if (!inArgs.some(a => a.ARGUMENT_NAME.toUpperCase() === vName.toUpperCase())) {
                    outLines.push(`  RAISE NOTICE '[TRACE VAR] ${vName.toUpperCase()} = %', ${vName};`);
                }
            });

            hasInsertedInit = true;
            continue;
        }

        if (hasInsertedInit) {
            if (i === lastEndIndex) {
                outLines.push(...outputArguments);
                outLines.push(line);
                outLines.push(`  -- ▼ Roll back after leaving the trace block ▼`);
                outLines.push(`  ROLLBACK;`);
                outLines.push(`END;`);
                continue;
            }

            if (i > lastEndIndex) {
                outLines.push(line);
                continue;
            }


            const closingLoop = upperCleanTrimmed.startsWith('END LOOP') ? traceLoopIds.pop() : null;

            const isControlKeyword = upperCleanTrimmed.startsWith('EXCEPTION') ||
                                   upperCleanTrimmed.startsWith('END') || 
                                   upperCleanTrimmed.startsWith('WHEN') ||
                                   upperCleanTrimmed.startsWith('DECLARE') ||
                                   upperCleanTrimmed.startsWith('BEGIN');

            if (/^RETURN\b/.test(upperCleanTrimmed)) {
                outLines.push(`  RAISE NOTICE '[TRACE LINE] ${originalLineNum}';`);
                const statement = returns.get(i);
                if (!statement) throw new Error(t('trace_unsupported_source'));
                const returnExpression = statement.expression;
                if (objectType === 'FUNCTION' && returnExpression) {
                    const wrapped = /[\n\r]|--/.test(returnExpression) ? `\n${returnExpression}\n` : returnExpression;
                    outLines.push(`  RAISE NOTICE '[TRACE RETURN] %', json_build_object('name', 'RETURN', 'value', (${wrapped}))::text;`);
                } else outLines.push(...outputArguments);
                outLines.push('  EXIT trace_block;');
                i = statement.endLine;
                continue;
            } else if (cleanTrimmed.length > 0 && !isControlKeyword && !inSubDeclaration && isNewStatement) {
                outLines.push(`  RAISE NOTICE '[TRACE LINE] ${originalLineNum}';`);
            }

            const forLoopMatch = cleanTrimmed.match(/FOR\s+([a-zA-Z0-9_]+)\s+IN\s+/i);
            if (forLoopMatch) {
                pendingCursorRecord = forLoopMatch[1];
            }

            outLines.push(line);
            if (closingLoop) outLines.push(`  RAISE NOTICE '[TRACE LOOP_END] ${closingLoop}';`);

            if (upperCleanTrimmed.endsWith('LOOP') && !upperCleanTrimmed.startsWith('END LOOP')) {
                loopCounter++;
                traceLoopIds.push(`L${loopCounter}`);
                outLines.push(`  RAISE NOTICE '[TRACE LOOP_START] L${loopCounter}';`);
                if (pendingCursorRecord) {
                    outLines.push(`  RAISE NOTICE '[TRACE VAR] ${pendingCursorRecord.toUpperCase()} = %', ${pendingCursorRecord};`);
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
                 
                 const allVars: string[] = [];
                 inArgs.forEach(a => allVars.push(a.ARGUMENT_NAME));
                 declaredVars.forEach(vName => {
                     if (!allVars.includes(vName)) allVars.push(vName);
                 });

                 const stmtUpper = statementBuffer.toUpperCase();
                 
                 if (statementBuffer.trim().length > 0 && !stmtUpper.includes('RAISE NOTICE')) {
                     allVars.forEach(vName => {
                         const regex = new RegExp(`\\b${vName}\\b`, 'i');
                         if (regex.test(statementBuffer)) {
                             const formatKey = vName.toUpperCase();
                             pendingVarTraces.push({ formatKey, rawVarName: vName });
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
                     outLines.push(`  RAISE NOTICE '[TRACE VAR] ${trace.formatKey} = %', ${trace.rawVarName};`);
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

        } else {
            outLines.push(line);
        }
    }

    outLines.push(delimiter + ';');
    return outLines.join('\n');
}
