// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Deliberately uncommon constructs exercise the real instrumentation, not handwritten TRACE output.
function tracePrograms(database, table) {
  if (database === 'oracle') return [
    { name: 'Sparse associative arrays with FIRST/NEXT and deleted elements', expected: '13:2', declarations: `  TYPE numbers IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
  values_by_id numbers;
  k PLS_INTEGER;
  total PLS_INTEGER := 0;`, body: `  values_by_id(2) := 4;
  values_by_id(5) := 100;
  values_by_id(9) := 9;
  values_by_id.DELETE(5);
  k := values_by_id.FIRST;
  WHILE k IS NOT NULL LOOP
    total := total + values_by_id(k);
    k := values_by_id.NEXT(k);
  END LOOP;
  RETURN total || ':' || values_by_id.COUNT;`, variable: ['TOTAL', '13'] },
    { name: 'FORALL INDICES OF with SAVE EXCEPTIONS and SQL%BULK_EXCEPTIONS', expected: '2:1', declarations: `  TYPE numbers IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
  ids numbers;
  bulk_error EXCEPTION;
  PRAGMA EXCEPTION_INIT(bulk_error, -24381);
  inserted PLS_INTEGER := 0;
  failures PLS_INTEGER := 0;`, body: `  ids(2) := 1;
  ids(7) := 1;
  ids(11) := 2;
  BEGIN
    FORALL k IN INDICES OF ids SAVE EXCEPTIONS
      INSERT INTO ${table} (id, amount) VALUES (ids(k), 10);
  EXCEPTION
    WHEN bulk_error THEN
      failures := SQL%BULK_EXCEPTIONS.COUNT;
  END;
  SELECT COUNT(*) INTO inserted FROM ${table};
  RETURN inserted || ':' || failures;`, variable: ['FAILURES', '1'] },
    { name: 'Parameterized cursor with BULK COLLECT LIMIT and collection iteration', expected: '30', declarations: `  CURSOR source_rows(p_min PLS_INTEGER) IS SELECT n FROM (SELECT 10 AS n FROM DUAL UNION ALL SELECT 20 FROM DUAL) WHERE n >= p_min ORDER BY n;
  TYPE batch_type IS TABLE OF PLS_INTEGER;
  batch batch_type;
  total PLS_INTEGER := 0;`, body: `  OPEN source_rows(10);
  LOOP
    FETCH source_rows BULK COLLECT INTO batch LIMIT 1;
    EXIT WHEN batch.COUNT = 0;
    FOR k IN 1..batch.COUNT LOOP
      total := total + batch(k);
    END LOOP;
  END LOOP;
  CLOSE source_rows;
  RETURN TO_CHAR(total);`, variable: ['TOTAL', '30'], outsideLoop: '  CLOSE source_rows;' },
    { name: 'Local recursive subprogram with named notation and default arguments', expected: '120', declarations: `  result PLS_INTEGER := 0;
  FUNCTION factorial(n PLS_INTEGER, accumulator PLS_INTEGER DEFAULT 1) RETURN PLS_INTEGER IS
  BEGIN
    IF n <= 1 THEN
      RETURN accumulator;
    END IF;
    RETURN factorial(n => n - 1, accumulator => accumulator * n);
  END factorial;`, body: `  result := factorial(n => 5);
  RETURN TO_CHAR(result);`, variable: ['RESULT', '120'] },
    { name: 'Dynamic DML RETURNING, row diagnostics and alternative-quoted text', expected: '42:1', declarations: `  returned NUMBER := 0;
  affected PLS_INTEGER := 0;
  message VARCHAR2(100) := q'[literal RETURN; -- __placeholder__]';`, body: `  EXECUTE IMMEDIATE 'INSERT INTO ${table} (id, amount) VALUES (:1, :2) RETURNING amount INTO :3'
    USING 7, 42 RETURNING INTO returned;
  affected := SQL%ROWCOUNT;
  DBMS_OUTPUT.PUT_LINE(message);
  RETURN returned || ':' || affected;`, variable: ['AFFECTED', '1'], output: 'literal RETURN; -- __placeholder__' },
    { name: 'Mapped user exception, nested handlers and early return with rolled-back DML', expected: '77', declarations: `  expected_error EXCEPTION;
  PRAGMA EXCEPTION_INIT(expected_error, -20017);
  result PLS_INTEGER := 0;`, body: `  INSERT INTO ${table} (id, amount) VALUES (9, 99);
  BEGIN
    RAISE_APPLICATION_ERROR(-20017, 'Expected niche exception');
  EXCEPTION
    WHEN expected_error THEN
      result := 77;
      RETURN TO_CHAR(result);
  END;
  result := -999;
  RETURN TO_CHAR(result);`, variable: ['RESULT', '77'], unreachable: '  result := -999;' },
    { name: 'Anchored ROWTYPE/TYPE records and whole-record SELECT INTO', expected: '13', declarations: `  row_value ${table}%ROWTYPE;
  result ${table}.amount%TYPE := 0;`, body: `  SELECT 5, 8 INTO row_value FROM DUAL;
  result := row_value.id + row_value.amount;
  RETURN TO_CHAR(result);`, variable: ['RESULT', '13'] },
    { name: 'Labeled nested loops with CONTINUE WHEN, EXIT and searched CASE', expected: '9', declarations: `  total PLS_INTEGER := 0;
  j PLS_INTEGER := 0;`, body: `  <<outer_loop>>
  FOR k IN REVERSE 1..5 LOOP
    CONTINUE outer_loop WHEN MOD(k, 2) = 0 OR k = 3;
    j := 0;
    LOOP
      j := j + 1;
      EXIT WHEN j = 2;
      total := total + k;
    END LOOP;
  END LOOP outer_loop;
  CASE
    WHEN total = 6 THEN total := total + 3;
    ELSE total := -999;
  END CASE;
  RETURN TO_CHAR(total);`, variable: ['TOTAL', '6'], outsideLoop: '  CASE' },
    { name: 'XML scalar extraction, nested table MULTISET and high-precision decimal text', expected: '9007199254740993.123456789:2', declarations: `  TYPE number_list IS TABLE OF NUMBER;
  left_values number_list := number_list(1, 2, 2);
  right_values number_list := number_list(2, 3);
  intersection number_list;
  exact_value NUMBER := 9007199254740993.123456789;
  item_count PLS_INTEGER := 0;`, body: `  intersection := left_values MULTISET INTERSECT ALL right_values;
  SELECT XMLCAST(XMLQUERY('/root/value/text()' PASSING XMLTYPE('<root><value>2</value></root>') RETURNING CONTENT) AS NUMBER) INTO item_count FROM DUAL;
  RETURN TO_CHAR(exact_value, 'FM99999999999999999999D999999999', 'NLS_NUMERIC_CHARACTERS=''.,''') || ':' || item_count;`, variable: ['ITEM_COUNT', '2'] }
  ];
  return [
    { name: 'FOREACH SLICE over a multidimensional array with nondefault lower bounds', expected: '10:0', declarations: `  matrix integer[] := '[0:1][2:3]={{1,2},{3,4}}'::integer[];
  piece integer[];
  total integer := 0;
  lower_bound integer := 0;`, body: `  lower_bound := array_lower(matrix, 1);
  FOREACH piece SLICE 1 IN ARRAY matrix LOOP
    total := total + piece[array_lower(piece, 1)] + piece[array_upper(piece, 1)];
  END LOOP;
  RETURN total::text || ':' || lower_bound::text;`, variable: ['LOWER_BOUND', '0'] },
    { name: 'Labeled reverse loop with BY, CONTINUE WHEN and nested EXIT', expected: '9', declarations: `  total integer := 0;
  j integer := 0;`, body: `  <<outer_loop>>
  FOR k IN REVERSE 5..1 BY 2 LOOP
    CONTINUE outer_loop WHEN k = 3;
    j := 0;
    LOOP
      j := j + 1;
      EXIT WHEN j = 2;
      total := total + k;
    END LOOP;
  END LOOP outer_loop;
  total := total + 3;
  RETURN total::text;`, variable: ['TOTAL', '9'], outsideLoop: '  total := total + 3;' },
    { name: 'Dynamic EXECUTE FORMAT with USING/INTO STRICT and GET DIAGNOSTICS', expected: '42:1', declarations: `  returned integer := 0;
  affected bigint := 0;`, body: `  EXECUTE format('INSERT INTO %s (id, amount) VALUES ($1, $2) RETURNING amount', '${table}')
    INTO STRICT returned USING 7, 42;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN returned::text || ':' || affected::text;`, variable: ['AFFECTED', '1'] },
    { name: 'Custom SQLSTATE, GET STACKED DIAGNOSTICS and exception subtransaction rollback', expected: 'P2017:0', declarations: `  state text := '';
  affected integer := -1;`, body: `  BEGIN
    INSERT INTO ${table} (id, amount) VALUES (9, 99);
    RAISE EXCEPTION USING ERRCODE = 'P2017', MESSAGE = 'Expected niche exception';
  EXCEPTION
    WHEN SQLSTATE 'P2017' THEN
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
  END;
  SELECT COUNT(*) INTO affected FROM ${table};
  RETURN state || ':' || affected::text;`, variable: ['STATE', 'P2017'] },
    { name: 'Bound scroll cursor, MOVE/FETCH and FOUND semantics', expected: '20:true', declarations: `  source_rows SCROLL CURSOR FOR SELECT n FROM (VALUES (10), (20), (30)) AS x(n) ORDER BY n;
  fetched integer := 0;
  found_row boolean := false;`, body: `  OPEN source_rows;
  MOVE LAST FROM source_rows;
  FETCH PRIOR FROM source_rows INTO fetched;
  found_row := FOUND;
  CLOSE source_rows;
  RETURN fetched::text || ':' || found_row::text;`, variable: ['FOUND_ROW', 't'] },
    { name: 'Dollar-quoted control words, nested declarations and early return', expected: '7', declarations: `  result integer := 0;
  message text := $literal$RETURN; -- __placeholder__$literal$;`, body: `  DECLARE
    local_value integer := 7;
  BEGIN
    result := local_value;
  END;
  RAISE NOTICE '%', message;
  RETURN result::text;
  result := -999;`, variable: ['RESULT', '7'], output: 'RETURN; -- __placeholder__', unreachable: '  result := -999;' },
    { name: 'INTO STRICT cardinality exceptions and FOUND after a zero-row query', expected: 'strict:false', declarations: `  result integer := 0;
  outcome text := '';
  found_row boolean := true;`, body: `  BEGIN
    SELECT n INTO STRICT result FROM (VALUES (1), (2)) AS x(n);
  EXCEPTION
    WHEN too_many_rows THEN
      outcome := 'strict';
  END;
  SELECT 1 INTO result WHERE false;
  found_row := FOUND;
  RETURN outcome || ':' || found_row::text;`, variable: ['OUTCOME', 'strict'] },
    { name: 'Dynamic query FOR record loop with JSONB path operations', expected: '5', declarations: `  row_data record;
  document jsonb := '{"items":[{"n":2},{"n":3}]}'::jsonb;
  total integer := 0;`, body: `  FOR row_data IN EXECUTE 'SELECT (value->>''n'')::integer AS n FROM jsonb_array_elements($1->''items'')' USING document LOOP
    total := total + row_data.n;
  END LOOP;
  RETURN total::text;`, variable: ['TOTAL', '5'] },
    { name: 'Exact NUMERIC arithmetic with aggregate FILTER and ordered-set percentile', expected: '9007199254740993.123456789:3', declarations: `  exact_value numeric := 9007199254740993.123456789;
  filtered_count integer := 0;
  middle_value integer := 0;`, body: `  SELECT count(*) FILTER (WHERE n > 1), percentile_disc(0.5) WITHIN GROUP (ORDER BY n)
    INTO filtered_count, middle_value FROM (VALUES (1), (2), (3), (4), (5)) AS x(n);
  RETURN exact_value::text || ':' || middle_value::text;`, variable: ['MIDDLE_VALUE', '3'] }
  ];
}

module.exports = { tracePrograms };
