<!-- Copyright 2026 eiji ikemura -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Data validation tools

Oracle, PostgreSQL and MySQL share the **Data validation** menu. Processing is local; these tools do not call an AI API. Result values, routine arguments, expectations and reports may be confidential. Files are saved only by an explicit action through the OS file dialog. Nothing is automatically committed to Git or uploaded.

## Mask a copy of query results

1. Execute a SELECT in the SQL window. Click **Data masking** in the result toolbar.
2. Choose a rule for each column. Every column starts **excluded**. Available rules are exclude, keep original, NULL, fixed text, consistent token and fictional email.
3. For related columns in different tables, use the same **secret phrase** and **relationship group**. Identical original values of the same JSON type then produce the same token, regardless of row order. Different groups or phrases deliberately produce different tokens.
4. Generate and inspect the preview, then save **masked-data.json**. The preview shows at most 100 rows; export contains all captured rows. SQL result snapshots saved through the comparison panel can also be loaded as input.

The database is never updated. This is a data-copy/export feature, not an in-place UPDATE or an INSERT generator. Token/email outputs are strings; they are not automatically adapted to database type, length, CHECK constraints or unique indexes. NULL remains NULL, including under a fixed-text rule. The source snapshot is not mutated.

Tokens use HMAC-SHA-256 with a 128-bit output prefix. Fictional email addresses use `example.invalid`. A random phrase is created for the current session; it is never saved in an export. Keep your own private phrase if you need consistent mappings across restarts. Matching groups must have compatible source values: the number `12` and the text `"12"` are different inputs.

This is **pseudonymization**, not a guarantee that a person cannot be identified. Kept columns, NULL patterns, free text, small populations and outside information may still identify people. Review column names and data before sharing; no external transmission or live-database anonymization is performed.

## Compare SQL results

1. Execute the original query and click **Compare SQL results** in the result toolbar.
2. Register the captured result as **Before**. Close the dialog, execute the changed query and capture **After**. Register it as After and compare. Each side can also save or open its own result JSON.
3. With no keys, comparison ignores row order and counts duplicate rows. With one or more key columns, it reports added/deleted rows and changed columns. Duplicate or NULL keys are refused; choose a composite key or compare without keys.
4. Optional numeric equivalence compares ordinary decimal text without converting large integers or fine fractions to JavaScript numbers. It is off by default. Scientific notation remains a strict value. NULL and empty text are always different.
5. Inspect up to 100 differences in the UI or save the full comparison report. Reports contain original before/after values.

Column names must match, including case; column order may differ. Dates are captured from the raw result rather than from formatted grid text. Only **already fetched rows** are captured: this does not prove equality of unfetched pages or entire tables. Result imports are bounded to 8 MiB, 10,000 rows and 512 distinct columns. Incomplete/malformed rows fail explicitly rather than being silently truncated. Unsafe JavaScript integer values are refused; fetch large integers as decimal text. Precision already lost in a driver cannot be reconstructed. Comparison snapshots and the last successful stored execution remain in memory until disconnect, reconnect or application exit.

## Stored-program regression tests

Use a dedicated test database. Run a procedure/function (or an Oracle package subprogram) in its normal window, independently check its results, then open **Stored regression tests** and add the **last successful execution**. Give cases meaningful names. Repeat with boundary inputs, zero and NULL as appropriate. Expectations are not inferred to be correct just because an execution succeeded.

The JSON editor allows changing arguments and expected results, deleting/duplicating cases with distinct IDs, and adding `checks`. Save a suite to JSON and explicitly load/run it again after source changes. No tests run on file import or ordinary startup. Suites must match the connected database product; review the displayed connection and every schema/object before executing. MySQL retains the routine fingerprint: after an intentional definition change, execute the updated routine in its normal window and update only the reviewed case request fingerprint while preserving its independently verified expectations. This prevents silently invoking an unreviewed replacement.

A case compares return/OUT values and each returned row set. Row sets use unordered comparison with duplicate counts. Optional verification SELECTs run on the **main connection**, so they can see pending updates. A procedure with no return/OUT/result set needs at least one check. Timings, transaction flags and console text are not assertions. Cases run sequentially, stop at the first mismatch/error, and mark later cases as not run. Failure reports include actual outputs and failed verification results; the on-screen evidence preview is limited to 8,000 characters. No automatic retries occur. Stop takes effect after the current call/verification request completes; it does not cancel or undo a call already sent to the server.

**Transaction behavior:** these tools never automatically begin, commit, roll back or restore fixtures. Set up a known state before each run; use the normal Commit/Rollback controls afterward. Without an existing transaction, a PostgreSQL procedure may commit through native CALL semantics. A stored program can also commit internally, use autonomous transactions, modify session/package state, or produce external effects. A SELECT that calls a function may have effects too. SQL shape validation prevents ordinary write/DDL statements as checks; it does not prove that user-defined SELECT functions are side-effect free. A test failure is not a rollback. The normal read-only connection guard remains in force and the regression UI disables execution in that mode.

Maximums: 100 cases, 20 checks per case, an 8 MiB suite and the result limits above for each expected row set. Saved files contain arguments and expected data, never the connection password, AI settings or the masking phrase.

Example check (edit the SQL, binds and expected columns to match your test):

```json
{
  "sql": "SELECT status FROM test.orders WHERE order_id = :id",
  "binds": { "id": 1001 },
  "expected": {
    "format": "monabase-result",
    "version": 1,
    "columns": ["status"],
    "rows": [["READY"]]
  }
}
```

Use quoted uppercase identifiers for Oracle where appropriate. Execution reuses the existing dedicated stored IPC, preserving overload signatures, Oracle package subprogram selection, input formats, argument modes and MySQL definition fingerprints.

## Verification

- `node --test tests/quality-tools.test.cjs`: exact comparisons, masking consistency, malformed documents, regression outcomes, stop behavior and privileged assertion SQL guard.
- `npm run check` and `npm run build:renderer`: normal checks and production renderer build.
- `npm run test:ui`: includes `tests/e2e/quality.cjs`, real production UI in English/Japanese for all three DB workspaces with simulated IPC. No live AI is used.
- Oracle/PostgreSQL: `MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:db` includes dedicated-schema quality tests.
- MySQL: `MONABASE_MYSQL_DISPOSABLE=1 npm run test:mysql` includes the same scenarios in the disposable database.

Real-DB tests create only per-run `MBT_` tables/functions/procedures, verify native outputs and observer isolation, deliberately introduce a wrong expectation, explicitly roll back, then remove their own definitions. No existing objects, permissions or server settings are changed by these tests. Tests must fail explicitly if a required DB or routine-creation privilege is unavailable.
