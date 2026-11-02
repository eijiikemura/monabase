// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Deterministic implementations validate DB fixtures before paid calls; never sent to the model.
function referenceAnswer(s) {
  const pg=s.db==='postgresql';
  const fee=amount=>`CASE WHEN ${amount} IS NULL THEN NULL WHEN ${amount} >= 200 THEN 0 ELSE 10 END`;
  const update=`UPDATE ${s.target} SET "AMOUNT" = ${pg?'COALESCE':'NVL'}("AMOUNT",0) + ${pg?'COALESCE':'NVL'}(p_delta,0) WHERE "ID"=p_id; ${pg?'GET DIAGNOSTICS p_changed = ROW_COUNT;':'p_changed := SQL%ROWCOUNT;'}`;
  let source;
  if(s.kind==='FUNCTION')source=pg?`CREATE OR REPLACE FUNCTION ${s.qualified}(p_amount numeric) RETURNS numeric LANGUAGE plpgsql AS $$ BEGIN RETURN ${fee('p_amount')}; END; $$;`:`CREATE OR REPLACE FUNCTION ${s.qualified}(p_amount NUMBER) RETURN NUMBER IS BEGIN RETURN ${fee('p_amount')}; END;`;
  if(s.kind==='PROCEDURE')source=pg?`CREATE OR REPLACE PROCEDURE ${s.qualified}(IN p_id integer, IN p_delta numeric, OUT p_changed integer) LANGUAGE plpgsql AS $$ BEGIN ${update} END; $$;`:`CREATE OR REPLACE PROCEDURE ${s.qualified}(p_id IN NUMBER,p_delta IN NUMBER,p_changed OUT NUMBER) IS BEGIN ${update} END;`;
  if(s.kind==='TRIGGER')source=pg?`BEGIN IF TG_OP = 'INSERT' OR NEW."AMOUNT" IS DISTINCT FROM OLD."AMOUNT" THEN NEW."SHIPPING" := ${fee('NEW."AMOUNT"')}; END IF; RETURN NEW; END;`:`BEGIN IF INSERTING OR :NEW."AMOUNT" <> :OLD."AMOUNT" OR (:NEW."AMOUNT" IS NULL AND :OLD."AMOUNT" IS NOT NULL) OR (:NEW."AMOUNT" IS NOT NULL AND :OLD."AMOUNT" IS NULL) THEN :NEW."SHIPPING" := ${fee(':NEW."AMOUNT"')}; END IF; END;`;
  if(s.kind==='PACKAGE')source=`CREATE OR REPLACE PACKAGE ${s.qualified} AS FUNCTION shipping(p_amount IN NUMBER) RETURN NUMBER; FUNCTION shipping(p_amount IN NUMBER,p_priority IN NUMBER) RETURN NUMBER; PROCEDURE adjust(p_id IN NUMBER,p_delta IN NUMBER,p_changed OUT NUMBER); END;`;
  if(s.kind==='PACKAGE BODY')source=`CREATE OR REPLACE PACKAGE BODY ${s.qualified} AS FUNCTION shipping(p_amount IN NUMBER) RETURN NUMBER IS BEGIN RETURN ${fee('p_amount')}; END; FUNCTION shipping(p_amount IN NUMBER,p_priority IN NUMBER) RETURN NUMBER IS BEGIN RETURN shipping(p_amount) + CASE WHEN p_priority = 1 THEN 5 ELSE 0 END; END; PROCEDURE adjust(p_id IN NUMBER,p_delta IN NUMBER,p_changed OUT NUMBER) IS BEGIN ${update} END; END;`;
  return JSON.stringify({status:'success',source,message:'',...(s.kind==='TRIGGER'?{settings:{timing:'BEFORE',events:['INSERT','UPDATE'],forEachRow:true}}:{})});
}
module.exports={referenceAnswer};
