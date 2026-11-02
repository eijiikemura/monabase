// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { renameTraceProcedure } = require('../services/traceProgram');
const { t } = require('../i18n');
const { TraceDatabase } = require('./traceDb');



async function executeTracePg(connection, params) {
  
  const { schema, objectName, objectType, sourceText, args, skipParse } = params;

  const quotedSchema = schema.replace(/"/g, '""');
  let safeObjName = objectName.replace(/[^a-zA-Z0-9_]/g, '_');
  if (safeObjName.length > 20) { safeObjName = safeObjName.substring(0, 20); }

  let seq = 1;
  let tempObjName = '';
  while (true) {
    tempObjName = `mona_${safeObjName}_${seq}`.toLowerCase();
    
    const checkRes = await connection.execute(
      `SELECT COUNT(*) AS cnt FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid WHERE pg_namespace.nspname = :schema AND pg_proc.proname = :proname`,
      { schema, proname: tempObjName }
    );
    
    if (parseInt(checkRes.rows[0].cnt) === 0) break;
    seq++;
  }

  let debugLog = [t("trace_creating_debug_program", { value0: tempObjName })];
  
  let generatedSourceCode = '';
  let targetCompileDate = '';

  if (skipParse) {
    generatedSourceCode = renameTraceProcedure(sourceText, tempObjName, 'postgresql');
  } else {
    let cleanSource = sourceText.trim();
    
    const funcRegex = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+(FUNCTION|PROCEDURE)\\s+("?${schema}"?\\.)?"?${objectName}"?\\s*\\(`, 'i');
    cleanSource = cleanSource.replace(funcRegex, `CREATE OR REPLACE $1 "${quotedSchema}"."${tempObjName}"(`);
    
    let lines = cleanSource.split('\n');
    let inBegin = false;
    let inDeclaration = false;
    let inSubDeclaration = false; 
    let modifiedLines = [];
    let loopCounter = 0;
    const traceLoopIds = [];
    let isNewStatement = true;
    let pendingCursorRecord = null; 
    
    let declaredVars = [];
    let inMultiLineDef = false;

    // Buffer multiline SQL as a single string.
    let pendingVarTraces = [];
    let statementBuffer = "";

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line === undefined || line === null) continue;
      let trimmed = line.trim();
      let upperTrimmed = trimmed.toUpperCase();

      if (inBegin && upperTrimmed.startsWith('END') && !upperTrimmed.startsWith('END IF') && !upperTrimmed.startsWith('END LOOP') && !upperTrimmed.startsWith('END CASE')) {
        inBegin = false;
        inDeclaration = false;
        inSubDeclaration = false; 
        modifiedLines.push(line);
        isNewStatement = true;
        continue;
      }

      if (!inBegin && upperTrimmed.startsWith('DECLARE')) {
        inDeclaration = true;
        modifiedLines.push(line);
        continue;
      }

      if (inDeclaration && !inBegin && trimmed.length > 0 && !trimmed.startsWith('--')) {
        if (!inMultiLineDef) {
            let varMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_[\]]+)/);
            if (varMatch) {
              // Collect variables while preserving their original case.
              let vName = varMatch[1];
              let vType = varMatch[2].toUpperCase();
              const reserved = ['BEGIN','DECLARE','TYPE','CURSOR','PRAGMA','SELECT','FROM','WHERE','AND','OR','ORDER','GROUP','HAVING','JOIN','INSERT','UPDATE','DELETE'];
              
              if (!reserved.includes(vName.toUpperCase()) && vType !== 'RECORD' && vType !== 'CURSOR') {
                  if (!declaredVars.includes(vName)) {
                      declaredVars.push(vName);
                  }
              }
            }
        }
        
        if (!trimmed.endsWith(';')) {
            inMultiLineDef = true;
        } else {
            inMultiLineDef = false;
        }
      }

      if (!inBegin && upperTrimmed.startsWith('BEGIN')) {
        inBegin = true;
        inDeclaration = false;
        modifiedLines.push(line);
        modifiedLines.push(`  RAISE NOTICE '[TRACE START] Program: ${tempObjName} started.';`);
        
        if (args && Object.keys(args).length > 0) {
          Object.keys(args).forEach(argName => {
            modifiedLines.push(`  RAISE NOTICE '[TRACE VAR] ${argName.toUpperCase()} = %', ${argName};`);
          });
        }

        declaredVars.forEach(vName => {
           if (!args || !Object.keys(args).some(k => k.toUpperCase() === vName.toUpperCase())) {
               modifiedLines.push(`  RAISE NOTICE '[TRACE VAR] ${vName.toUpperCase()} = %', ${vName};`);
           }
        });

        continue;
      }

      if (inBegin && trimmed.length > 0 && !trimmed.startsWith('--')) {
        let originalLineNum = i + 1;
        
        let commentIdx = trimmed.indexOf('--');
        let cleanTrimmed = trimmed;
        if (commentIdx !== -1) {
            let quotesBefore = (trimmed.substring(0, commentIdx).match(/'/g) || []).length;
            if (quotesBefore % 2 === 0) {
                cleanTrimmed = trimmed.substring(0, commentIdx).trim();
            }
        }
        let upperCleanTrimmed = cleanTrimmed.toUpperCase();

        if (upperCleanTrimmed === 'DECLARE' || upperCleanTrimmed.startsWith('DECLARE ')) {
            inSubDeclaration = true;
        } else if (upperCleanTrimmed === 'BEGIN' || upperCleanTrimmed.startsWith('BEGIN ')) {
            inSubDeclaration = false;
        }
        
        
        if (upperCleanTrimmed.startsWith('EXCEPTION')) { modifiedLines.push(line); isNewStatement = false; continue; }
        const closingLoop = upperCleanTrimmed.startsWith('END LOOP') ? traceLoopIds.pop() : null;

        let isControlKeyword = upperCleanTrimmed.startsWith('EXCEPTION') || 
                               upperCleanTrimmed.startsWith('END') || 
                               upperCleanTrimmed.startsWith('WHEN') ||
                               upperCleanTrimmed.startsWith('DECLARE') ||
                               upperCleanTrimmed.startsWith('BEGIN');

        if (isNewStatement && !isControlKeyword && !inSubDeclaration) {
          modifiedLines.push(`  RAISE NOTICE '[TRACE LINE] ${originalLineNum}';`);
        }
        
        let forLoopMatch = cleanTrimmed.match(/FOR\s+([a-zA-Z0-9_]+)\s+IN\s+/i);
        if (forLoopMatch) {
            pendingCursorRecord = forLoopMatch[1];
        }

        modifiedLines.push(line);
        if (closingLoop) modifiedLines.push(`  RAISE NOTICE '[TRACE LOOP_END] ${closingLoop}';`);
        
        if (upperCleanTrimmed.endsWith('LOOP') && !upperCleanTrimmed.startsWith('END LOOP')) {
          loopCounter++;
          traceLoopIds.push(`L${loopCounter}`);
          modifiedLines.push(`  RAISE NOTICE '[TRACE LOOP_START] L${loopCounter}';`);
          if (pendingCursorRecord) {
              modifiedLines.push(`  RAISE NOTICE '[TRACE VAR] ${pendingCursorRecord.toUpperCase()} = %', ${pendingCursorRecord};`);
              pendingCursorRecord = null;
          }
        }

        // Join multiline code into a single buffer.
        if (cleanTrimmed.length > 0) {
            if (isNewStatement) {
               statementBuffer = cleanTrimmed;
            } else {
               statementBuffer += " " + cleanTrimmed;
            }
        }

        // Check every declared variable against the buffered statement.
        if (cleanTrimmed.endsWith(';') || upperCleanTrimmed.endsWith('BEGIN') || upperCleanTrimmed.endsWith('THEN') || upperCleanTrimmed.endsWith('ELSE') || upperCleanTrimmed.endsWith('LOOP') || upperCleanTrimmed.endsWith('EXCEPTION')) {

          if (!inSubDeclaration && cleanTrimmed.endsWith(';')) {
             
             // 1. Build a list of arguments and declared variables.
             let allVars = [];
             if (args) {
                 Object.keys(args).forEach(k => {
                     if (!k.startsWith('__')) allVars.push(k);
                 });
             }
             declaredVars.forEach(vName => {
                 if (!allVars.includes(vName)) allVars.push(vName);
             });

             // 2. Check whether each declared variable appears in the buffered SQL statement.
             let stmtUpper = statementBuffer.toUpperCase();
             
             // Exclude RAISE NOTICE itself to prevent duplicate output.
             if (statementBuffer.trim().length > 0 && !stmtUpper.includes('RAISE NOTICE')) {
                 allVars.forEach(vName => {
                     // Match word boundaries (\\b) to avoid matching similarly named variables.
                     let regex = new RegExp(`\\b${vName}\\b`, 'i');
                     if (regex.test(statementBuffer)) {
                         let formatKey = vName.toUpperCase();
                         pendingVarTraces.push({ formatKey, rawVarName: vName });
                     }
                 });
             }
          }

          // 3. Insert all matching variable outputs immediately after the statement.
          if (pendingVarTraces.length > 0 && !inSubDeclaration) {
             let uniqueTraces = [];
             pendingVarTraces.forEach(trace => {
                 if (!uniqueTraces.find(u => u.formatKey === trace.formatKey)) {
                     uniqueTraces.push(trace);
                 }
             });

             uniqueTraces.forEach(trace => {
                 modifiedLines.push(`  RAISE NOTICE '[TRACE VAR] ${trace.formatKey} = %', ${trace.rawVarName};`);
             });
             pendingVarTraces = [];
          }

          isNewStatement = true;
          statementBuffer = ""; // Clear the buffer.
        } else {
          if (cleanTrimmed.length > 0) {
             isNewStatement = false;
          }
        }
      } else {
        modifiedLines.push(line);
      }
    }
    generatedSourceCode = modifiedLines.join('\n');
  }

  debugLog.push(t("trace_compilation_succeeded_executing"));

  const actualCreatedType = (skipParse) ? 'PROCEDURE' : objectType;

  try {
    const compileRes = await connection.execute(generatedSourceCode);
    if (!compileRes.success && compileRes.error) {
      throw new Error(compileRes.error);
    }

    let callSql = '';
    let bindValues = {}; 

    const isFrontendGenerated = skipParse;

    if (isFrontendGenerated) {
      callSql = `CALL "${quotedSchema}"."${tempObjName}"();`;
    } else if (args && Object.keys(args).length > 0) {
      const inArgValues = [];
      let bindIdx = 1;
      Object.keys(args).forEach(name => {
        if (name.startsWith('__') || name.includes('.') || name.includes(' ') || name.includes('(')) return; 
        
        let val = args[name];
        if (val === null || val === undefined || val === '') {
           inArgValues.push('NULL');
        } else {
           inArgValues.push(`$${bindIdx}`);
           bindValues[bindIdx] = val; 
           bindIdx++;
        }
      });
      
      if (objectType === 'PROCEDURE') {
        callSql = `CALL "${quotedSchema}"."${tempObjName}"(${inArgValues.join(', ')});`;
      } else {
        callSql = `SELECT * FROM "${quotedSchema}"."${tempObjName}"(${inArgValues.join(', ')});`;
      }
    } else {
      if (objectType === 'PROCEDURE') {
        callSql = `CALL "${quotedSchema}"."${tempObjName}"();`;
      } else {
        callSql = `SELECT * FROM "${quotedSchema}"."${tempObjName}"();`;
      }
    }

    const execRes = await connection.execute(callSql, Object.keys(bindValues).length > 0 ? Object.values(bindValues) : {});
    if (!execRes.success && execRes.error) {
      throw new Error(execRes.error);
    }
    
    const traces = execRes.notices || [];
    debugLog.push(t("trace_execution_complete_saving_to_the_database"));

    TraceDatabase.deleteDatabase(params.traceIdentity || { schema, objectName, objectType, signature: params.signature });
    const db = new TraceDatabase(params.traceIdentity || { schema, objectName, objectType, signature: params.signature });
    await db.init();

    let stepsToSave = [];
    let tempVars = {};
    let currentLoopStack = [];
    let loopIterationCounts = {};

    traces.forEach((line) => {
      if (!line) return;
      
      if (!line.startsWith('[TRACE ')) {
        debugLog.push(line);
        return;
      }

      const loopStartMatch = line.match(/^\[TRACE LOOP_START\]\s+(.*)/);
      if (loopStartMatch) {
        const loopId = loopStartMatch[1];
        // A new iteration replaces the previous frame, including frames bypassed by CONTINUE.
        const existing = currentLoopStack.findIndex(frame => frame.startsWith(loopId + '_iter'));
        if (existing >= 0) currentLoopStack.splice(existing);
        if (!loopIterationCounts[loopId]) loopIterationCounts[loopId] = 0;
        loopIterationCounts[loopId]++;
        currentLoopStack.push(`${loopId}_iter${loopIterationCounts[loopId]}`);
        return;
      }
      const loopEnd = line.match(/^\[TRACE LOOP_END\](?:\s+(L\d+))?$/);
      if (loopEnd) {
        const index = loopEnd[1] ? currentLoopStack.findIndex(frame => frame.startsWith(loopEnd[1] + '_iter')) : currentLoopStack.length - 1;
        if (index >= 0) currentLoopStack.splice(index);
        return;
      }

      const lineMatch = line.match(/^\[TRACE LINE\]\s+(\d+)/);
      if (lineMatch) stepsToSave.push({ lineNum: parseInt(lineMatch[1], 10), variables: { ...tempVars }, loopPath: currentLoopStack.join(' > '), logText: line });

      const varMatch = line.match(/^\[TRACE VAR\]\s+([^=]+?)\s*=\s*(.*)/);
      if (varMatch) {
         let keyName = varMatch[1].replace(/"/g, '').toUpperCase().trim();
         keyName = keyName.replace(/\[([^\]]+)\]/g, '($1)');
         let val = varMatch[2];

         if (!keyName.includes('(') && !keyName.includes('.') && ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('(') && val.endsWith(')')))) {
             Object.keys(tempVars).forEach(k => {
                 if (k.startsWith(`${keyName}(`) || k.startsWith(`${keyName}.`)) delete tempVars[k];
             });

             let content = val.slice(1, -1).trim();
             if (!content) {
                 tempVars[`${keyName}(EMPTY)`] = ''; 
             } else {
                 let items = [];
                 let current = '';
                 let inQuote = false;
                 let inParen = 0;
                 for(let i=0; i<content.length; i++) {
                     const char = content[i];
                     if (char === '"' && (i === 0 || content[i-1] !== '\\')) {
                         inQuote = !inQuote;
                     } else if ((char === '(' || char === '{' || char === '[') && !inQuote) {
                         inParen++;
                         current += char;
                     } else if ((char === ')' || char === '}' || char === ']') && !inQuote) {
                         inParen--;
                         current += char;
                     } else if (char === ',' && !inQuote && inParen === 0) {
                         items.push(current);
                         current = '';
                     } else {
                         current += char;
                     }
                 }
                 items.push(current);
                 
                 items.forEach((item, i) => {
                     let cleanItem = item.trim();
                     if (cleanItem.startsWith('"') && cleanItem.endsWith('"')) {
                         cleanItem = cleanItem.slice(1, -1).replace(/\\"/g, '"');
                     }
                     tempVars[`${keyName}(${i+1})`] = cleanItem;
                 });
             }
         } else {
             tempVars[keyName] = val;
         }
      }
    });

    await db.insertSteps(stepsToSave);
    
    const traceDate = new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const triggerSnapshot = params.traceTarget?.objectType === 'TRIGGER' && skipParse && typeof args?.__WIZ_BODY__ === 'string';
    let lineMap = null;
    if (triggerSnapshot && typeof args.__PROC_MAP__ === 'string') {
      try {
        const parsed = JSON.parse(args.__PROC_MAP__);
        if (parsed && typeof parsed === 'object' && Object.entries(parsed).every(([key, value]) => /^\d+$/.test(key) && Number.isSafeInteger(value) && value >= 0)) {
          const visited = new Set(stepsToSave.map(step => step.lineNum));
          const entries = Object.entries(parsed).filter(([key, value]) => value > 0 && visited.has(Number(key)));
          if (entries.length) lineMap = Object.fromEntries(entries);
        }
      } catch { /* Unverified mapping must not turn a successful execution into a failure. */ }
    }
    await db.saveTraceInfo(traceDate, JSON.stringify(args), targetCompileDate, null,
      { text: triggerSnapshot ? args.__WIZ_BODY__ : typeof params.originalSourceText === 'string' ? params.originalSourceText : sourceText,
        instrumented: Boolean(skipParse) && !triggerSnapshot && typeof params.originalSourceText !== 'string', lineMap,
        mappingUnverified: triggerSnapshot && !lineMap });
    db.close();
    debugLog.push(t("trace_saved_to_the_database"));

    let returnValues = [];
    for (const notice of traces) {
      if (notice.startsWith('[TRACE RETURN] ')) {
        const returned = JSON.parse(notice.slice('[TRACE RETURN] '.length), (key, value, context) => {
          if (typeof value !== 'number' || !context?.source) return value;
          return (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) || String(value) !== context.source)
            ? context.source : value;
        });
        returnValues.push({ name: returned.name, value: returned.value });
      }
    }
    if (execRes.rows && execRes.rows.length > 0) {
      const row = execRes.rows[0];
      Object.keys(row).forEach(k => {
         returnValues.push({ name: k.toUpperCase(), value: row[k] !== null && row[k] !== undefined ? row[k] : '' });
      });
    }

    await connection.execute(`DROP ${actualCreatedType} IF EXISTS "${quotedSchema}"."${tempObjName}"`);
    debugLog.push(t("trace_deleted_debug_program", { value0: tempObjName }));

    return { 
        success: true, 
        returnValues: returnValues, 
        dbmsOutput: debugLog, 
        variablesTrace: traces, 
        traceDate: traceDate, 
        targetCompileDate: targetCompileDate, 
        generatedSource: generatedSourceCode 
    };

  } catch (err) {
    try {
      const actualCreatedType = (skipParse) ? 'PROCEDURE' : objectType;
      await connection.execute(`DROP ${actualCreatedType} IF EXISTS "${quotedSchema}"."${tempObjName}"`);
    } catch (e) {}

    let errorMsg = err.message;
    if (generatedSourceCode) {
       errorMsg += `\n__GENERATED_SOURCE__\n${generatedSourceCode}`;
    }
    throw new Error(errorMsg);
  }
}

module.exports = { executeTracePg };
