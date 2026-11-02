// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { temporalParts } from '@/shared/utils/temporalValues';

export const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD';
export const DEFAULT_DATETIME_FORMAT = 'YYYY/MM/DD HH:mm:ss';
export const DEFAULT_COMPACT_DATE_FORMAT = 'YYYYMMDD';

/** Convert a UI date format such as DD-MMM-YY to Oracle TO_DATE format, such as DD-MON-YY. */
export const getOracleDateFormat = (inputFormat: string): string => {
  let oracleFmt = inputFormat || DEFAULT_DATETIME_FORMAT;
  if (oracleFmt.includes('MMM')) oracleFmt = oracleFmt.replace('MMM', 'MON');
  else oracleFmt = oracleFmt.replace('MM', 'MM');
  oracleFmt = oracleFmt.replace('YYYY', 'YYYY').replace('YY', 'YY').replace('DD', 'DD')
    .replace('HH', 'HH24').replace('mm', 'MI').replace('ss', 'SS');
  return oracleFmt;
};

/** Remove time format tokens safely when the Oracle value contains no time separator. */
export const getOracleFormatForValue = (inputFormat: string, val: string): string => {
  let oracleFormat = getOracleDateFormat(inputFormat);
  if (val && !val.includes(':') && oracleFormat.includes('HH24')) {
    oracleFormat = oracleFormat.replace(/[\sT"']*HH24.*$/i, '');
  }
  return oracleFormat;
};

/** Convert a UI date format to PostgreSQL TO_DATE / TO_TIMESTAMP format. */
export const getPostgresDateFormat = (inputFormat: string): string => {
  let pgFmt = inputFormat || DEFAULT_DATETIME_FORMAT;
  if (pgFmt.includes('MMM')) pgFmt = pgFmt.replace('MMM', 'Mon');
  else pgFmt = pgFmt.replace('MM', 'MM');
  
  pgFmt = pgFmt.replace('YYYY', 'YYYY').replace('YY', 'YY').replace('DD', 'DD')
    .replace('HH', 'HH24').replace('mm', 'MI').replace('ss', 'SS');
  return pgFmt;
};

/** Remove time format tokens safely when the PostgreSQL value contains no time separator. */
export const getPostgresFormatForValue = (inputFormat: string, val: string): string => {
  let pgFormat = getPostgresDateFormat(inputFormat);
  if (val && !val.includes(':') && pgFormat.includes('HH24')) {
    pgFormat = pgFormat.replace(/[\sT"']*HH24.*$/i, '');
  }
  return pgFormat;
};

/** Format a Date using the specified format string. */
export const formatDateString = (dateObj: Date, formatStr: string): string => {
  if (isNaN(dateObj.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(dateObj.getFullYear());
  const yy = yyyy.slice(-2);
  const MM = pad(dateObj.getMonth() + 1);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MMM = monthNames[dateObj.getMonth()];
  const dd = pad(dateObj.getDate());
  const hh = pad(dateObj.getHours());
  const mm = pad(dateObj.getMinutes());
  const ss = pad(dateObj.getSeconds());

  let result = formatStr;
  if (result.includes('MMM')) result = result.replace('MMM', MMM);
  else result = result.replace('MM', MM);

  if (result.includes('YYYY')) result = result.replace('YYYY', yyyy);
  else if (result.includes('YY')) result = result.replace('YY', yy);

  result = result.replace('DD', dd);
  if (result.includes('HH')) result = result.replace('HH', hh).replace('mm', mm).replace('ss', ss);

  return result;
};

export interface DbDateFormatOptions {
  // Keep extra fractional seconds and zone details unless a display needs the exact selected format.
  preserveDetails?: boolean;
}

/** Format date values retrieved from the database without modifying the source value. */
export const formatDbDate = (val: unknown, dateFormat: string, options: DbDateFormatOptions = {}): string => {
  try {
    if (val === null || val === undefined || val === '') return '';
    if (!dateFormat) return String(val);

    // Handle drivers that provide JavaScript Date values.
    if (val instanceof Date) {
      return formatDateString(val, dateFormat);
    }
    
    // Format canonical database text without losing fractional seconds or changing its zone.
    const parts = temporalParts(val);
    if (parts) {
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const tokens: Record<string, string> = { YYYY: parts.year, YY: parts.year.slice(-2),
        MMM: months[Number(parts.month) - 1] ?? parts.month, MM: parts.month, DD: parts.day,
        HH: parts.hour ?? '00', mm: parts.minute ?? '00', ss: (parts.second ?? '00') + (options.preserveDetails !== false && /[1-9]/.test(parts.fraction) ? parts.fraction : '') };
      const format = parts.hour ? dateFormat : dateFormat.replace(/[ T]*HH.*$/, '');
      return format.replace(/YYYY|MMM|YY|MM|DD|HH|mm|ss/g, token => tokens[token]) +
        (options.preserveDetails !== false && parts.offset && format.includes('HH') ? ` ${parts.offset}` : '');
    }
    // Legacy and user-formatted strings remain supported.
    if (typeof val === 'string') {
      // Parse ISO or hyphen-separated datetime strings.
      const cleanVal = val.replace('T', ' ').replace(/\.000Z$/, '');
      const d = new Date(cleanVal.replace(/-/g, '/'));
      if (!isNaN(d.getTime())) {
        return formatDateString(d, dateFormat);
      }
    }
    
    return String(val);
  } catch {
    return String(val);
  }
};

/** Detect and format date strings in logs such as DBMS_OUTPUT. */
export const formatDbmsOutputLog = (logLine: string, outFormat: string): string => {
  const dateRegex = /\b(\d{2}-[A-Za-z]{3}-\d{2,4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{2})\b/gi;
  
  if (logLine && typeof logLine === 'string' && dateRegex.test(logLine)) {
    return logLine.replace(dateRegex, (match) => {
      const d = new Date(match.replace(/-/g, '/'));
      if (!isNaN(d.getTime())) {
        return formatDateString(d, outFormat || DEFAULT_DATETIME_FORMAT);
      }
      return match;
    });
  }
  return logLine;
};