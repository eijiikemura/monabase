// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { getPackageRoutine, packageInvocation, renamePackageProgram } = require('./packageProgram');
const { renameTraceProcedure } = require('../services/traceProgram');
const { t } = require('../i18n');
const oracledb = require('oracledb');
const { TraceDatabase } = require('./traceDb');
const { getOracleDateFormat, DEFAULT_DATETIME_FORMAT } = require('./oracleFormatHelper');



async function executeTrace(connection, params) {
  
  let needClose = false;
  if (!connection || typeof connection.execute !== 'function') {
    for (const key of Object.keys(global)) {
      if (global[key] && typeof global[key].execute === 'function') {
        connection = global[key];
        break;
      }
    }
    if (!connection) {
      try {
        connection = await oracledb.getConnection();
        needClose = true;
      } catch (e) {
        console.warn("[TraceExecutor] Failed to get fallback connection:", e.message);
      }
    }
    if (!connection) {
      throw new Error(t("no_database_connection_is_available_check_the_main_process_connection_state"));
    }
  }

  const { schema, objectName, objectType, sourceText, args, argTypes, argDirections, subProgram, isSubProgramFunction, inputDateFormat, skipParse } = params;

  let safeObjName = objectName.toUpperCase();
  if (safeObjName.length > 20) { safeObjName = safeObjName.substring(0, 20); }

  let seq = 1;
  let tempObjName = '';
  let debugLog = [];
  let generatedSourceCode = ''; 
  let targetCompileDate = '';

  try {
    while (true) {
      tempObjName = `MONA_${safeObjName}_${seq}`;
      const checkRes = await connection.execute(
        `SELECT COUNT(*) AS cnt FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :obj`,
        { owner: schema, obj: tempObjName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (checkRes.rows[0].CNT === 0) break;
      seq++;
    }

    debugLog.push(t("trace_creating_debug_program", { value0: tempObjName }));
    
    try {
      const oracleFormat = getOracleDateFormat(inputDateFormat || DEFAULT_DATETIME_FORMAT);

      const ddlRes = await connection.execute(
        `SELECT TO_CHAR(MAX(LAST_DDL_TIME), '${oracleFormat}') AS DDL_TIME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :obj AND OBJECT_TYPE LIKE :type`,
        { owner: schema, obj: objectName, type: objectType.split(' ')[0] + '%' },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (ddlRes.rows && ddlRes.rows.length > 0) {
        targetCompileDate = ddlRes.rows[0].DDL_TIME || '';
      }
    } catch(e) {}

    let isPackage = objectType.startsWith('PACKAGE');
    const packageParameters = isPackage ? await getPackageRoutine(connection, params) : null;
    let specDdl = '';

    if (skipParse) {
        generatedSourceCode = renameTraceProcedure(sourceText, tempObjName, 'oracle');
    } else {
        let cleanSource = '';
        if (isPackage) {
          const specRes = await connection.execute(
            `SELECT DBMS_METADATA.GET_DDL('PACKAGE_SPEC', :obj, :owner) AS DDL FROM DUAL`,
            { owner: schema, obj: objectName },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          const bodyRes = await connection.execute(
            `SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY', :obj, :owner) AS DDL FROM DUAL`,
            { owner: schema, obj: objectName },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          
          specDdl = (specRes.rows && specRes.rows.length > 0) ? specRes.rows[0].DDL || '' : '';
          let bodyDdl = (bodyRes.rows && bodyRes.rows.length > 0) ? bodyRes.rows[0].DDL || '' : '';
          
          if (sourceText.replace(/\/\s*$/, '').trim() !== bodyDdl.replace(/\/\s*$/, '').trim()) throw new Error(t('package_trace_compile_first'));
          specDdl = specDdl.replace(/(?:^|\r?\n)[ \t]*\/[ \t]*\s*$/, '').trim().replace(/EDITIONABLE |NONEDITIONABLE /gi, '');
          bodyDdl = bodyDdl.replace(/(?:^|\r?\n)[ \t]*\/[ \t]*\s*$/, '').trim().replace(/EDITIONABLE |NONEDITIONABLE /gi, '');
          
          if (!bodyDdl || !specDdl) {
            throw new Error(t("the_specification_or_body_could_not_be_loaded_compile_it_first"));
          }

          specDdl = renamePackageProgram(specDdl, objectName, tempObjName, schema);
          cleanSource = renamePackageProgram(bodyDdl, objectName, tempObjName, schema);
        } else {
          cleanSource = sourceText.replace(/(?:^|\r?\n)[ \t]*\/[ \t]*\s*$/, '').trim();
          const regex = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+(EDITIONABLE\\s+)?(FUNCTION|PROCEDURE)\\s+("?${schema}"?\\.)?"?${objectName}"?`, 'i');
          cleanSource = cleanSource.replace(regex, `CREATE OR REPLACE $2 "${schema}"."${tempObjName}"`);
          // Omit only the final END identifier, regardless of its original name.
          // Preserve strings, comments, nested blocks, and control-statement endings.
          const tokens = [...cleanSource.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|\bq'\[[\s\S]*?\]'|\bq'\{[\s\S]*?\}'|\bq'\([\s\S]*?\)'|\bq'<[\s\S]*?>'|'(?:[^']|'')*'|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$#]*|[^\s]/giu)]
            .filter(token => !/^(--|\/\*)/.test(token[0]));
          const closing = tokens.slice(-3);
          if (closing.length === 3 && /^END$/i.test(closing[0][0]) && closing[2][0] === ';') {
            const name = closing[1][0];
            const isIdentifier = /^(?:"(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$#]*)$/u.test(name);
            if (isIdentifier && !/^(IF|LOOP|CASE)$/i.test(name)) {
              const endKeyword = closing[0].index + closing[0][0].length;
              const gap = cleanSource.slice(endKeyword, closing[1].index).replace(/\s+$/, '');
              cleanSource = cleanSource.slice(0, endKeyword) + gap + cleanSource.slice(closing[1].index + name.length);
            }
          }
        }

        let parsedCursors = {};
        const curRegex = /CURSOR\s+([a-zA-Z0-9_]+)[^;]*?IS\s+SELECT\s+([\s\S]*?)\s+FROM\s+([a-zA-Z0-9_."]+)/gi;
        let curMatch;
        while ((curMatch = curRegex.exec(cleanSource)) !== null) {
          let cName = curMatch[1].toUpperCase();
          let colsStr = curMatch[2];
          let tableNameStr = curMatch[3];

          if (colsStr.trim() === '*') {
            let tParts = tableNameStr.split('.');
            let tSchema = tParts.length > 1 ? tParts[0].replace(/"/g, '') : schema;
            let tName = tParts.length > 1 ? tParts[1].replace(/"/g, '') : tableNameStr.replace(/"/g, '');
            try {
              const colRes = await connection.execute(
                `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = UPPER(:1) AND TABLE_NAME = UPPER(:2) ORDER BY COLUMN_ID`,
                [tSchema, tName],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
              );
              if (colRes.rows && colRes.rows.length > 0) {
                parsedCursors[cName] = colRes.rows.map(r => r.COLUMN_NAME);
              }
            } catch(e) {}
          } else {
            let cols = colsStr.split(',').map(c => {
              let parts = c.trim().split(/\s+/);
              let last = parts[parts.length - 1]; 
              return last.split('.').pop().replace(/"/g, ''); 
            });
            parsedCursors[cName] = cols;
          }
        }

        let lines = cleanSource.split('\n');
        let inDeclaration = false;
        let inSubDeclaration = false; 
        let inLocalSubprogram = false; 
        let inExecutableBody = false; 
        let executableDepth = 0; 
        let declaredVars = [];
        let modifiedLines = [];
        let loopCounter = 0;
        const traceLoopIds = [];
        let isNewStatement = true;
        // Store multiple variables in an array.
        let pendingVarTraces = [];
        let pendingCursorRecord = null; 
        let inSkipBlock = false; 
        let hasInjectedStart = false;

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          if (line === undefined || line === null) continue;
          let trimmed = line.trim();
          let upperTrimmed = trimmed.toUpperCase();

          if (!inDeclaration && /\b(IS|AS)$/i.test(trimmed) && !/^(CREATE|TYPE|CURSOR)\b/i.test(upperTrimmed)) {
            inDeclaration = true;
            modifiedLines.push(line);
            continue;
          }

          if (inDeclaration && !inExecutableBody && !inLocalSubprogram && trimmed.length > 0 && !trimmed.startsWith('--')) {
            let noCommentTrimmed = trimmed.split('--')[0].trim();
            
            if (noCommentTrimmed.length > 0) {
              if (/^(TYPE|CURSOR)\s+/i.test(noCommentTrimmed)) {
                inSkipBlock = true;
              }

              if (!inSkipBlock && !/^PRAGMA\s+/i.test(noCommentTrimmed)) {
                let varMatch = noCommentTrimmed.match(/^([a-zA-Z0-9_]+)\s+([^;:=]+)(?:\s*:=\s*(.+))?;/i);
                if (varMatch) {
                  let vName = varMatch[1].trim();
                  let vType = varMatch[2].trim().toUpperCase();
                  
                  if (vType !== 'EXCEPTION' && !['BEGIN', 'END', 'EXCEPTION', 'RETURN', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ORDER', 'GROUP', 'FROM', 'WHERE'].includes(vName.toUpperCase())) {
                    let initValStr = varMatch[3] ? varMatch[3].trim() : "";
                    let isScalar = /^(VARCHAR2|VARCHAR|NUMBER|DATE|CHAR|BOOLEAN|INTEGER|FLOAT|PLS_INTEGER|BINARY_INTEGER|TIMESTAMP|NVARCHAR2|CLOB)$/i.test(vType.split('(')[0]) || vType.includes('%TYPE');
                    
                    let recordFields = [];
                    if (vType.endsWith('%ROWTYPE')) {
                       let tNameFull = vType.replace('%ROWTYPE', '').trim();
                       let tSchema = schema;
                       let tName = tNameFull;
                       if (tNameFull.includes('.')) {
                          let parts = tNameFull.split('.');
                          tSchema = parts[0].replace(/"/g, '');
                          tName = parts[1].replace(/"/g, '');
                       }
                       try {
                         const colRes = await connection.execute(
                           `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = UPPER(:1) AND TABLE_NAME = UPPER(:2) ORDER BY COLUMN_ID`,
                           [tSchema, tName],
                           { outFormat: oracledb.OUT_FORMAT_OBJECT }
                         );
                         if (colRes.rows) recordFields = colRes.rows.map(r => r.COLUMN_NAME);
                       } catch(e) {}
                    }
                    declaredVars.push({ name: vName, isScalar: isScalar, initText: initValStr, vType: vType, recordFields: recordFields });
                  }
                }
              }

              if (inSkipBlock && noCommentTrimmed.endsWith(';')) {
                inSkipBlock = false;
              }
            }
          }

          if (inDeclaration && !inLocalSubprogram && /^(FUNCTION|PROCEDURE)\s+[a-zA-Z0-9_]+/i.test(upperTrimmed)) {
            inLocalSubprogram = true;
          }

          let isBegin = /^BEGIN\b/i.test(upperTrimmed);
          let isEnd = /^END\b/i.test(upperTrimmed) && !/^END\s+(IF|LOOP|CASE)\b/i.test(upperTrimmed);

          if (isBegin) {
            executableDepth++;
            inExecutableBody = true;
            inSubDeclaration = false;
          }

          if (isBegin && executableDepth === 1 && !inLocalSubprogram) {
            inDeclaration = false;
            modifiedLines.push(line);
            
            if (!hasInjectedStart && !isPackage) {
                modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE START] Program: ${tempObjName} started.');`);
                
                declaredVars.forEach(v => {
                  if (v.isScalar) {
                    modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${v.name.toUpperCase()} = ' || ${v.name});`);
                  } else {
                    if (v.recordFields && v.recordFields.length > 0) {
                       v.recordFields.forEach(col => {
                         modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${v.name.toUpperCase()}.${col.toUpperCase()} = ' || ${v.name}.${col});`);
                       });
                    } else {
                      let displayVal = v.initText ? v.initText.replace(/'/g, "''") : "(Collection: " + v.vType + ")";
                      modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${v.name.toUpperCase()} = ${displayVal}');`);
                    }
                  }
                });
                hasInjectedStart = true;
            }
            continue;
          }

          if (inExecutableBody && trimmed.length > 0 && !trimmed.startsWith('--')) {
            let originalLineNum = i + 1;

            if (upperTrimmed === 'DECLARE' || upperTrimmed.startsWith('DECLARE ')) {
                inSubDeclaration = true;
            } else if (upperTrimmed === 'BEGIN' || upperTrimmed.startsWith('BEGIN ')) {
                inSubDeclaration = false;
            }


            if (upperTrimmed === 'EXCEPTION') { modifiedLines.push(line); isNewStatement = false; continue; }
            const closingLoop = upperTrimmed.startsWith('END LOOP') ? traceLoopIds.pop() : null;

            let isControlKeyword = upperTrimmed.startsWith('EXCEPTION') || 
                                   upperTrimmed.startsWith('END') || 
                                   upperTrimmed.startsWith('WHEN') ||
                                   upperTrimmed.startsWith('DECLARE') ||
                                   upperTrimmed.startsWith('BEGIN');

            if (isNewStatement && !isControlKeyword && !inSubDeclaration && !isBegin && !isEnd) {
                modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE LINE] ${originalLineNum}');`);
            }
            
            let forLoopMatch = trimmed.match(/FOR\s+([a-zA-Z0-9_]+)\s+IN\s+(?:\(|[a-zA-Z0-9_]+)/i);
            if (forLoopMatch) {
                let recName = forLoopMatch[1];
                let curNameMatch = trimmed.match(/IN\s+([a-zA-Z0-9_]+)/i);
                if (curNameMatch && parsedCursors[curNameMatch[1].toUpperCase()]) {
                   pendingCursorRecord = { recName: recName, cols: parsedCursors[curNameMatch[1].toUpperCase()] };
                } else {
                   let implicitMatch = trimmed.match(/FOR\s+[a-zA-Z0-9_]+\s+IN\s+\(\s*SELECT\s+([\s\S]*?)\s+FROM\s+([a-zA-Z0-9_."]+)/i);
                   if (implicitMatch) {
                       let colsStr = implicitMatch[1];
                       let tableNameStr = implicitMatch[2];
                       if (colsStr.trim() === '*') {
                           let tParts = tableNameStr.split('.');
                           let tSchema = tParts.length > 1 ? tParts[0].replace(/"/g, '') : schema;
                           let tName = tParts.length > 1 ? tParts[1].replace(/"/g, '') : tableNameStr.replace(/"/g, '');
                           try {
                               const colRes = await connection.execute(
                                   `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = UPPER(:1) AND TABLE_NAME = UPPER(:2) ORDER BY COLUMN_ID`,
                                   [tSchema, tName],
                                   { outFormat: oracledb.OUT_FORMAT_OBJECT }
                               );
                               if (colRes.rows && colRes.rows.length > 0) {
                                   pendingCursorRecord = { recName: recName, cols: colRes.rows.map(r => r.COLUMN_NAME) };
                               }
                           } catch(e) {}
                       } else {
                           let cols = colsStr.split(',').map(c => {
                               let parts = c.trim().split(/\s+/);
                               let last = parts[parts.length - 1]; 
                               return last.split('.').pop().replace(/"/g, ''); 
                           });
                           pendingCursorRecord = { recName: recName, cols: cols };
                       }
                   }
                }
            }

            modifiedLines.push(line);
            if (closingLoop) modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE LOOP_END] ${closingLoop}');`);
            
            if (upperTrimmed.endsWith('LOOP') && !upperTrimmed.startsWith('END LOOP')) {
              loopCounter++;
              traceLoopIds.push(`L${loopCounter}`);
              modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE LOOP_START] L${loopCounter}');`);
              if (pendingCursorRecord) {
                  let curCols = pendingCursorRecord.cols;
                  if (curCols) {
                      curCols.forEach(col => { 
                          modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${pendingCursorRecord.recName.toUpperCase()}.${col.toUpperCase()} = ' || ${pendingCursorRecord.recName}.${col});`); 
                      });
                  }
                  pendingCursorRecord = null;
              }
            }
            
            if (isNewStatement && !inSubDeclaration && !isBegin && !isEnd) {
              let assignMatch = trimmed.match(/^([a-zA-Z0-9_]+(?:(?:\([^)]+\))|(?:\.[a-zA-Z0-9_."]+))*)\s*:=/);
              if (assignMatch) {
                let rawVarName = assignMatch[1].trim();
                let formatKey = rawVarName.replace(/\(([^)]+)\)/g, "(' || $1 || ')").replace(/"/g, '').toUpperCase();
                pendingVarTraces.push({ formatKey, rawVarName });
              }
            }

            if (!upperTrimmed.startsWith('INSERT ') && !inSubDeclaration && !isBegin && !isEnd) {
              // Match multiple comma-separated variable names.
              let intoMatch = trimmed.match(/\bINTO\s+([a-zA-Z0-9_.,\s"()]+?)(?=\s+FROM|\s+USING|\s+RETURNING|\s+LIMIT|\s+;|;|$)/i);
              if (intoMatch) {
                 let varsStr = intoMatch[1];
                 let vars = varsStr.split(',').map(v => v.trim()).filter(v => v.length > 0);
                 vars.forEach(rawVarName => {
                     let formatKey = rawVarName.replace(/"/g, '').toUpperCase();
                     pendingVarTraces.push({ formatKey, rawVarName });
                 });
              }
            }

            if (trimmed.endsWith(';') || upperTrimmed.endsWith('BEGIN') || upperTrimmed.endsWith('THEN') || upperTrimmed.endsWith('ELSE') || upperTrimmed.endsWith('LOOP') || upperTrimmed.endsWith('EXCEPTION')) {
              isNewStatement = true;
              // Output all collected variables to the trace.
              if (pendingVarTraces.length > 0 && !inSubDeclaration) {
                pendingVarTraces.forEach(trace => {
                    let vNameBase = trace.rawVarName.split('.')[0].split('(')[0].toUpperCase();
                    let varInfo = declaredVars.find(v => v.name.toUpperCase() === vNameBase);
                    let isWholeRecordOrCollection = !trace.rawVarName.includes('.') && !trace.rawVarName.includes('(');
                    
                    if (varInfo && !varInfo.isScalar && isWholeRecordOrCollection) {
                       if (varInfo.recordFields && varInfo.recordFields.length > 0) {
                         varInfo.recordFields.forEach(col => { modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${trace.formatKey}.${col.toUpperCase()} = ' || ${trace.rawVarName}.${col});`); });
                       } else {
                         modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${trace.formatKey} = (Collection: ${varInfo.vType} updated)');`);
                       }
                    } else {
                       modifiedLines.push(`  DBMS_OUTPUT.PUT_LINE('[TRACE VAR] ${trace.formatKey} = ' || ${trace.rawVarName});`);
                    }
                });
                pendingVarTraces = [];
              } else {
                pendingVarTraces = [];
              }
            } else {
              isNewStatement = false;
            }
          } else {
            if (!isBegin) modifiedLines.push(line);
          }

          if (isEnd) {
            executableDepth--;
            if (executableDepth <= 0) {
                inExecutableBody = false;
                executableDepth = 0;
                if (inLocalSubprogram) {
                    inLocalSubprogram = false; 
                }
            }
          }
        }
        generatedSourceCode = modifiedLines.join('\n');
        
        generatedSourceCode = generatedSourceCode.replace(/'(?:[^']|'')*'/g, (match) => {
            return match.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "' || CHR(58) || '$1");
        });
    }
    
    try {
      if (isPackage) {
        await connection.execute(specDdl);
        const specErrRes = await connection.execute(
          `SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :obj AND TYPE = 'PACKAGE' AND ATTRIBUTE = 'ERROR' ORDER BY SEQUENCE`,
          { owner: schema, obj: tempObjName }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (specErrRes.rows && specErrRes.rows.length > 0) {
          const errorDetails = specErrRes.rows.map(r => `Line ${r.LINE}, Col ${r.POSITION}: ${r.TEXT}`).join('\n');
          throw new Error(t("the_package_specification_contains_syntax_errors") + errorDetails);
        }
      }
      
      await connection.execute(generatedSourceCode);
      
      const bodyTypeStr = isPackage ? 'PACKAGE BODY' : (objectType === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE');
      const errRes = await connection.execute(
        `SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :obj AND TYPE = :type AND ATTRIBUTE = 'ERROR' ORDER BY SEQUENCE`,
        { owner: schema, obj: tempObjName, type: bodyTypeStr }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      if (errRes.rows && errRes.rows.length > 0) {
        const errorDetails = errRes.rows.map(r => `Line ${r.LINE}, Col ${r.POSITION}: ${r.TEXT}`).join('\n');
        throw new Error(t("the_program_contains_syntax_errors") + errorDetails);
      }
    } catch (compileError) {
      throw new Error(compileError.message);
    }

    debugLog.push(t("trace_compilation_succeeded_executing"));
    await connection.execute(`BEGIN DBMS_OUTPUT.DISABLE; DBMS_OUTPUT.ENABLE(NULL); END;`);

    let oracleFormat = getOracleDateFormat(inputDateFormat);

    const bindVars = {}, argumentNames = {};
    const quoteName = value => `"${value.replaceAll('"', '""')}"`;
    let argListSqlArray = [];
    
    if (args && Object.keys(args).length > 0) {
      const argNames = Object.keys(args);
      for (const name of argNames) {
        if (name.startsWith('__') && !Object.hasOwn(argTypes || {}, name)) {
            continue;
        }

        const key = `mb_arg_${Object.keys(argumentNames).length}`; argumentNames[key] = name;
        const formal = quoteName(name);
        let val = args[name];
        const type = argTypes ? argTypes[name] : '';
        const dirStr = argDirections ? argDirections[name] : 'IN'; 
        
        let bindDir = oracledb.BIND_IN;
        if (dirStr === 'OUT') bindDir = oracledb.BIND_OUT;
        else if (dirStr === 'IN/OUT') bindDir = oracledb.BIND_INOUT;

        if (bindDir === oracledb.BIND_OUT || bindDir === oracledb.BIND_INOUT) {
          let outType = oracledb.STRING;
          if (type && (type.includes('DATE') || type.includes('TIMESTAMP'))) outType = oracledb.DATE;
          
          let bindObj = { dir: bindDir, type: outType };
          if (outType === oracledb.STRING) bindObj.maxSize = 4000;
          
          if (bindDir === oracledb.BIND_INOUT) {
             if (outType === oracledb.DATE && val !== null && val !== undefined && val !== '') {
                let jsDateStr = String(val).replace(/\//g, '-').replace(' ', 'T');
                if (jsDateStr.length === 10) jsDateStr += 'T00:00:00';
                bindObj.val = new Date(jsDateStr);
             } else {
                bindObj.val = val;
             }
          }
          
          bindVars[key] = bindObj;
          argListSqlArray.push(`${formal} => :${key}`);
        } else {
          if (type && (type.includes('DATE') || type.includes('TIMESTAMP'))) {
            if (val === null || val === undefined || val === '') {
              argListSqlArray.push(`${formal} => NULL`);
            } else {
              argListSqlArray.push(`${formal} => TO_DATE(:${key}, '${oracleFormat}')`);
              bindVars[key] = { val: String(val).trim(), dir: oracledb.BIND_IN };
            }
          } else {
            argListSqlArray.push(`${formal} => :${key}`);
            bindVars[key] = { val: val, dir: oracledb.BIND_IN };
          }
        }
      }
    }
    const argListSql = argListSqlArray.join(', ');

    let callSql;
    if (isPackage) {
      if (isSubProgramFunction) {
        callSql = `:ret := ${quoteName(schema)}.${quoteName(tempObjName)}.${quoteName(subProgram)}(${argListSql});`;
        bindVars.ret = { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 };
      } else {
        callSql = `${quoteName(schema)}.${quoteName(tempObjName)}.${quoteName(subProgram)}(${argListSql});`;
      }
    } else {
      callSql = objectType === 'FUNCTION' ? `:ret := ${quoteName(schema)}.${quoteName(tempObjName)}(${argListSql});` : `${quoteName(schema)}.${quoteName(tempObjName)}(${argListSql});`;
      if (objectType === 'FUNCTION') bindVars.ret = { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 };
    }

    if (packageParameters) callSql = packageInvocation(`${quoteName(schema)}.${quoteName(tempObjName)}.${quoteName(subProgram)}`, Boolean(isSubProgramFunction), Object.keys(args || {}).filter(name => !name.startsWith('__') || Object.hasOwn(argTypes || {}, name)), argListSqlArray, packageParameters);

    const callRes = await connection.execute(`
BEGIN
  ${callSql}
  -- ▼ Automatically roll back after tracing ▼
  ROLLBACK;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
`, bindVars);

    const outRes = await connection.execute(
      `BEGIN DBMS_OUTPUT.GET_LINES(:lines, :numlines); END;`,
      { lines: { type: oracledb.STRING, dir: oracledb.BIND_OUT, maxArraySize: 1000 }, numlines: { type: oracledb.NUMBER, dir: oracledb.BIND_INOUT, val: 1000 } }
    );

    const traces = outRes.outBinds.lines || [];
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
          const keyName = varMatch[1].replace(/"/g, '').toUpperCase().trim();
          tempVars[keyName] = varMatch[2];
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
    await db.saveTraceInfo(traceDate, JSON.stringify(args), targetCompileDate, subProgram,
      { text: triggerSnapshot ? args.__WIZ_BODY__ : sourceText,
        instrumented: Boolean(skipParse) && !triggerSnapshot, lineMap,
        mappingUnverified: triggerSnapshot && !lineMap });
    db.close();
    debugLog.push(t("trace_saved_to_the_database"));

    let returnValues = [];
    if (objectType === 'FUNCTION' || (isPackage && isSubProgramFunction)) {
      returnValues.push({ name: 'RETURN_VALUE', value: (callRes.outBinds && callRes.outBinds.ret !== undefined && callRes.outBinds.ret !== null) ? callRes.outBinds.ret : '' });
    }

    if (bindVars) {
      Object.keys(bindVars).forEach(key => {
        if (key !== 'ret' && bindVars[key].dir !== oracledb.BIND_IN) {
          let outVal = callRes.outBinds ? callRes.outBinds[key] : undefined;
          if (outVal instanceof Date) {
             const pad = (n) => String(n).padStart(2, '0');
             outVal = `${outVal.getFullYear()}/${pad(outVal.getMonth()+1)}/${pad(outVal.getDate())} ${pad(outVal.getHours())}:${pad(outVal.getMinutes())}:${pad(outVal.getSeconds())}`;
          }
          returnValues.push({ name: argumentNames[key] || key.toUpperCase(), value: outVal !== undefined && outVal !== null ? outVal : '' });
        }
      });
    }

    if (isPackage) {
      await connection.execute(`DROP PACKAGE "${schema}"."${tempObjName}"`);
    } else {
      await connection.execute(`DROP ${objectType} "${schema}"."${tempObjName}"`);
    }
    debugLog.push(t("trace_deleted_debug_program", { value0: tempObjName }));

    return { success: true, returnValues, dbmsOutput: debugLog, variablesTrace: traces, traceDate: traceDate, targetCompileDate: targetCompileDate, generatedSource: generatedSourceCode };

  } catch (err) {
    try {
      if (tempObjName) {
        if (objectType.startsWith('PACKAGE')) await connection.execute(`DROP PACKAGE "${schema}"."${tempObjName}"`);
        else await connection.execute(`DROP ${objectType} "${schema}"."${tempObjName}"`);
      }
    } catch (e) {}

    if (needClose && connection) {
      try { await connection.close(); } catch(e) {}
    }

    let errorMsg = err.message;
    if (generatedSourceCode) {
       errorMsg += `\n__GENERATED_SOURCE__\n${generatedSourceCode}`;
    }
    throw new Error(errorMsg);
  }
}

module.exports = { executeTrace };
