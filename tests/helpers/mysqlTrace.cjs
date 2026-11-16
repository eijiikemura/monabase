// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
function loopSource(schema,name,kind='FUNCTION',fixed=false){
 const q=value=>'`'+value+'`';
 return `CREATE ${kind} ${q(schema)}.${q(name)}(${kind==='PROCEDURE'?'IN ':''}p_count INT${kind==='PROCEDURE'?', OUT p_result INT':''})\n${kind==='FUNCTION'?'RETURNS INT\nDETERMINISTIC\n':''}BEGIN
  DECLARE v_i INT DEFAULT 1;
  DECLARE v_total DECIMAL(30,2) DEFAULT 0;
  DECLARE v_amount DECIMAL(30,2) DEFAULT 0;
  WHILE v_i <= p_count DO
    SET v_amount = v_i * 10;
    IF v_i = 3 THEN
      SET v_total = v_total ${fixed?'+':'-'} v_amount;
    ELSE
      SET v_total = v_total + v_amount;
    END IF;
    SET v_i = v_i + 1;
  END WHILE;
  ${kind==='FUNCTION'?'RETURN v_total;':'SET p_result = v_total;'}
END`;
}
function triggerLoopBody(fixed=false){
 return `BEGIN
 DECLARE v_i INT DEFAULT 1;
 DECLARE v_total DECIMAL(30,2) DEFAULT 0;
 DECLARE v_amount DECIMAL(30,2) DEFAULT 0;
 WHILE v_i <= NEW.n DO
  SET v_amount = v_i * 10;
  IF v_i = 3 THEN
   SET v_total = v_total ${fixed?'+':'-'} v_amount;
  ELSE
   SET v_total = v_total + v_amount;
  END IF;
  SET v_i = v_i + 1;
 END WHILE;
 SET NEW.total = v_total;
END`;
}
module.exports={loopSource,triggerLoopBody};
