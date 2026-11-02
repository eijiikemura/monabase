// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export const highlightSql = (code: string, isDark: boolean) => {
    let inString = false;
    let inComment = false;
    let result = '';
    let token = '';
    
    // PostgreSQL (PL/pgSQL) keyword definitions.
    const keywords = new Set([
      'SELECT','INSERT','UPDATE','DELETE','FROM','WHERE','AND','OR','CREATE','REPLACE',
      'PROCEDURE','FUNCTION','RETURNS','LANGUAGE','PLPGSQL','DECLARE','BEGIN','END','IF',
      'ELSIF','ELSE','THEN','LOOP','WHILE','FOR','IN','OUT','INOUT','RETURN','EXCEPTION','WHEN',
      'COMMIT','ROLLBACK','VARCHAR','INTEGER','NUMERIC','DATE','TIMESTAMP','BOOLEAN','TRUE',
      'FALSE','NULL','TABLE','INDEX','CONSTRAINT','PRIMARY','KEY','FOREIGN','REFERENCES',
      'ON','DEFAULT','NOT','RAISE','NOTICE','RECORD','TEXT','REAL','DOUBLE','PRECISION',
      'SERIAL','BIGSERIAL','UUID','JSON','JSONB','ARRAY','STRICT','PERFORM','EXECUTE','USING','INTO'
    ]);
    
    const colors = {
      keyword: isDark ? '#569cd6' : '#0000ff', 
      string: isDark ? '#ce9178' : '#a31515',  
      comment: isDark ? '#6a9955' : '#008000', 
      number: isDark ? '#b5cea8' : '#098658'   
    };
  
    const flushToken = () => {
      if (token) {
        if (keywords.has(token.toUpperCase())) {
          result += `<span style="color: ${colors.keyword}; font-weight: bold;">${token}</span>`;
        } else if (!isNaN(Number(token)) && token.trim() !== '') {
          result += `<span style="color: ${colors.number};">${token}</span>`;
        } else {
          result += token;
        }
        token = '';
      }
    };
  
    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      
      if (inComment) {
        if (char === '<') result += '&lt;';
        else if (char === '>') result += '&gt;';
        else if (char === '&') result += '&amp;';
        else result += char;
        continue;
      }
      
      if (inString) {
        if (char === '<') result += '&lt;';
        else if (char === '>') result += '&gt;';
        else if (char === '&') result += '&amp;';
        else result += char;
        if (char === "'") inString = false;
        continue;
      }
      
      if (char === '-' && code[i+1] === '-') {
        flushToken();
        inComment = true;
        result += `<span style="color: ${colors.comment};">--`;
        i++;
        continue;
      }
      
      if (char === "'") {
        flushToken();
        inString = true;
        result += `<span style="color: ${colors.string};">&#39;`;
        continue;
      }
      
      if (/[a-zA-Z0-9_$#.]/.test(char)) { 
        token += char;
      } else {
        flushToken();
        if (char === '<') result += '&lt;';
        else if (char === '>') result += '&gt;';
        else if (char === '&') result += '&amp;';
        else result += char;
      }
    }
    flushToken();
    
    if (inComment || inString) result += '</span>';
    
    return result;
  };