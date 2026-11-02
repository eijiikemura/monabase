// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const oracledb = require('oracledb');
const { scanSql } = require('../services/sqlTokens');
const { t } = require('../i18n');
const quoteName = name => `"${name.replaceAll('"', '""')}"`;
const scalarType = type => /^(NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|PLS_INTEGER|BINARY_INTEGER|VARCHAR2|NVARCHAR2|CHAR|NCHAR|DATE|TIMESTAMP(?: WITH (?:LOCAL )?TIME ZONE)?)$/i.test(type);

async function getPackageRoutine(connection, params) {
  const { schema, objectName, subProgram, subProgramId, args = {}, argTypes = {}, argDirections = {}, argumentModes = {} } = params;
  if (!subProgram || !Number.isInteger(subProgramId)) throw new Error(t('package_reload_required'));
  const binds = { owner: schema, name: objectName, subProgram, id: subProgramId };
  const selected = await connection.execute(`SELECT SUBPROGRAM_ID FROM ALL_PROCEDURES WHERE OWNER = :owner AND OBJECT_NAME = :name AND PROCEDURE_NAME = :subProgram AND SUBPROGRAM_ID = :id`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  if (selected.rows?.length !== 1) throw new Error(t('package_reload_required'));
  const result = await connection.execute(`SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, DEFAULTED, TYPE_OWNER, TYPE_NAME FROM ALL_ARGUMENTS WHERE OWNER = :owner AND PACKAGE_NAME = :name AND OBJECT_NAME = :subProgram AND SUBPROGRAM_ID = :id AND DATA_LEVEL = 0 ORDER BY SEQUENCE`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const rows = result.rows || [];
  if (rows.some(row => !scalarType(row.DATA_TYPE) || row.TYPE_NAME)) throw new Error(t('package_unsupported_argument'));
  const parameters = rows.filter(row => row.POSITION > 0);
  if (Object.keys(argTypes).length !== parameters.length || parameters.some(row => argTypes[row.ARGUMENT_NAME] !== row.DATA_TYPE || argDirections[row.ARGUMENT_NAME] !== row.IN_OUT) || Object.keys(args).some(name => !parameters.some(row => row.ARGUMENT_NAME === name))) throw new Error(t('package_reload_required'));
  let omitted = false;
  for (const row of parameters) {
    if (!Object.hasOwn(args, row.ARGUMENT_NAME)) {
      if (row.IN_OUT !== 'IN' || row.DEFAULTED !== 'Y') throw new Error(t('routine_default_unavailable'));
      omitted = true;
    } else if (argumentModes[row.ARGUMENT_NAME] === 'default') throw new Error(t('package_reload_required'));
  }
  if (omitted) {
    const overloads = await connection.execute('SELECT SUBPROGRAM_ID FROM ALL_PROCEDURES WHERE OWNER = :owner AND OBJECT_NAME = :name AND PROCEDURE_NAME = :subProgram', { owner: schema, name: objectName, subProgram }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (overloads.rows.length !== 1) throw new Error(t('routine_default_ambiguous'));
  }
  if (Boolean(params.isSubProgramFunction) !== rows.some(row => row.POSITION === 0)) throw new Error(t('package_reload_required'));
  return parameters;
}

// Typed local variables let Oracle resolve overloads independently of string bind types.
function packageInvocation(target, isFunction, names, expressions, parameters) {
  const declarations = [], before = [], after = [], actuals = [];
  names.forEach((name, index) => {
    const row = parameters.find(parameter => parameter.ARGUMENT_NAME === name);
    if (!row || !scalarType(row.DATA_TYPE)) throw new Error(t('package_unsupported_argument'));
    const variable = `mb_value_${index}`;
    const type = /^(N?VARCHAR2|N?CHAR)$/i.test(row.DATA_TYPE) ? `${row.DATA_TYPE}(32767)` : row.DATA_TYPE;
    declarations.push(`${variable} ${type};`);
    const expression = expressions[index].slice(expressions[index].indexOf(' => ') + 4);
    if (row.IN_OUT !== 'OUT') before.push(`${variable} := ${expression};`);
    if (row.IN_OUT !== 'IN') after.push(`${expression} := ${variable};`);
    actuals.push(`${quoteName(name)} => ${variable}`);
  });
  return `${declarations.length ? `DECLARE ${declarations.join(' ')}` : ''} BEGIN ${before.join(' ')} ${isFunction ? ':ret := ' : ''}${target}(${actuals.join(', ')}); ${after.join(' ')} END;`;
}

// Rename declaration, END name and qualified self references, preserving literals/comments.
function renamePackageProgram(source, originalName, temporaryName, schema) {
  const tokens = scanSql(source, 'oracle');
  const identifier = token => token && (token.kind === 'word' || (token.kind === 'quoted' && token.text.startsWith('"')));
  const value = token => token.text.startsWith('"') ? token.text.slice(1, -1).replaceAll('""', '"') : token.text.toUpperCase();
  const replacements = [];
  let declaration = -1;
  const packageIndex = tokens.findIndex(token => token.kind === 'word' && /^PACKAGE$/i.test(token.text));
  if (packageIndex >= 0) {
    declaration = packageIndex + 1;
    if (/^BODY$/i.test(tokens[declaration]?.text)) declaration++;
    if (tokens[declaration + 1]?.text === '.') declaration += 2;
  }
  if (!identifier(tokens[declaration]) || value(tokens[declaration]) !== originalName) throw new Error(t('package_reload_required'));
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!identifier(token) || value(token) !== originalName) continue;
    const closing = /^END$/i.test(tokens[index - 1]?.text) && tokens[index + 1]?.text === ';' && index >= tokens.length - 3;
    const selfReference = tokens[index + 1]?.text === '.' && (tokens[index - 1]?.text !== '.' || (schema && identifier(tokens[index - 2]) && value(tokens[index - 2]) === schema));
    if (index === declaration || closing || selfReference) replacements.push(token);
  }
  let result = source;
  for (const token of replacements.reverse()) result = result.slice(0, token.start) + quoteName(temporaryName) + result.slice(token.end);
  return result;
}
module.exports = { getPackageRoutine, packageInvocation, renamePackageProgram };
