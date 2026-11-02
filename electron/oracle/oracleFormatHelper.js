// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Default date and datetime formats shared across the application.
const DEFAULT_DATETIME_FORMAT = 'YYYY/MM/DD HH:mm:ss';
const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD';
const DEFAULT_COMPACT_DATE_FORMAT = 'YYYYMMDD';

const DEFAULT_DATETIME_FORMAT_EN = 'MM/DD/YYYY HH:mm:ss';
const DEFAULT_DATE_FORMAT_EN = 'MM/DD/YYYY';

function getOracleDateFormat(inputFormat) {
  let oracleFmt = inputFormat || DEFAULT_DATETIME_FORMAT; 
  
  if (oracleFmt.includes('MMM')) {
    oracleFmt = oracleFmt.replace(/MMM/g, 'MON');
  } else {
    oracleFmt = oracleFmt.replace(/MM/g, 'MM');
  }
  
  oracleFmt = oracleFmt
    .replace(/YYYY/g, 'YYYY').replace(/YY/g, 'YY').replace(/DD/g, 'DD')
    .replace(/HH/g, 'HH24').replace(/mm/g, 'MI').replace(/ss/g, 'SS');
    
  return oracleFmt;
}

function getOracleFormatForValue(inputFormat, val) {
  let oracleFormat = getOracleDateFormat(inputFormat);
  if (val && !String(val).includes(':') && oracleFormat.includes('HH24')) {
    oracleFormat = oracleFormat.replace(/[\sT"']*HH24.*$/i, '');
  }
  return oracleFormat;
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
  getOracleDateFormat,
  getOracleFormatForValue,
  formatDateToOutput // Export shared helpers.
};