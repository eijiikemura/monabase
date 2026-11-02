// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Default date and datetime formats shared across the application.
const DEFAULT_DATETIME_FORMAT = 'YYYY/MM/DD HH:mm:ss';
const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD';
const DEFAULT_COMPACT_DATE_FORMAT = 'YYYYMMDD';

const DEFAULT_DATETIME_FORMAT_EN = 'MM/DD/YYYY HH:mm:ss';
const DEFAULT_DATE_FORMAT_EN = 'MM/DD/YYYY';

// Convert to PostgreSQL to_char / to_timestamp format.
function getPostgresDateFormat(inputFormat) {
  let pgFmt = inputFormat || DEFAULT_DATETIME_FORMAT; 
  
  if (pgFmt.includes('MMM')) {
    pgFmt = pgFmt.replace(/MMM/g, 'Mon'); // PostgreSQL uses Mon
  } else {
    pgFmt = pgFmt.replace(/MM/g, 'MM');
  }
  
  pgFmt = pgFmt
    .replace(/YYYY/g, 'YYYY').replace(/YY/g, 'YY').replace(/DD/g, 'DD')
    .replace(/HH/g, 'HH24').replace(/mm/g, 'MI').replace(/ss/g, 'SS');
    
  return pgFmt;
}

function getPostgresFormatForValue(inputFormat, val) {
  let pgFormat = getPostgresDateFormat(inputFormat);
  if (val && !String(val).includes(':') && pgFormat.includes('HH24')) {
    pgFormat = pgFormat.replace(/[\sT"']*HH24.*$/i, '');
  }
  return pgFormat;
}

// Format a JavaScript Date using the configured format string.
function formatDateToOutput(dateObj, formatStr) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return dateObj;
  
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const yy = String(yyyy).slice(-2);
  const m = dateObj.getMonth() + 1;
  const mm = pad(m);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mmm = monthNames[m - 1];
  const dd = pad(dateObj.getDate());
  const hh = pad(dateObj.getHours());
  const min = pad(dateObj.getMinutes());
  const ss = pad(dateObj.getSeconds());

  return formatStr.replace(/YYYY|YY|MMM|MM|DD|HH|mm|ss/g, match => {
    switch(match) {
      case 'YYYY': return yyyy;
      case 'YY': return yy;
      case 'MMM': return mmm;
      case 'MM': return mm;
      case 'DD': return dd;
      case 'HH': return hh;
      case 'mm': return min;
      case 'ss': return ss;
      default: return match;
    }
  });
}

module.exports = { 
  DEFAULT_DATETIME_FORMAT,
  DEFAULT_DATE_FORMAT,
  DEFAULT_COMPACT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT_EN,
  DEFAULT_DATE_FORMAT_EN,
  getPostgresDateFormat,
  getPostgresFormatForValue,
  formatDateToOutput
};