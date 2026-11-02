# Testing

MonaBase uses complementary checks. Passing tests cover the scenarios below, not every screen or database version.

| Command | Environment | Coverage |
| --- | --- | --- |
| `npm run check` | Node.js, no database | Lint, TypeScript, and unit/regression tests |
| `npm run test:git` | Git executable, no external remote | Real source commits, history/content/diffs, renames/deletes, retries, synchronization, and path checks |
| `npm run test:db` | Real PostgreSQL and/or Oracle | Application database clients, transactions, precision, objects, stored functions, and reconnect |
| `npm run test:ui` | Electron and a desktop/display server | Production renderer, lazy workspaces, sidebar expansion, pagination, collapse, and reopening |

The database and UI tests are separate from `npm run check` so contributors can run the basic checks without a database or display server. The UI command builds the production renderer first. Workspace scenarios use simulated IPC responses; security and settings scenarios also exercise the production preload. UI scenarios do not connect to a real database. No AI requests are sent.

## Paid AI smoke tests — explicit request only

`npm run check`, `npm test`, `test:ui`, `test:db` and GitHub Actions do **not** run
paid AI tests. `tests/live-ai-guard.test.cjs` runs with the ordinary suite but uses
only fictional credentials and in-process responses.

Run the isolated command only when the maintainer explicitly requests a new real
API test and supplies a temporary key (or explicitly authorizes its reuse for this run):

```sh
npm run test:ai:live -- --allow-paid
```

Enter the key at the stdin prompt; terminal echo is disabled. Do not put it in
command arguments, shell history, `.env`, app settings, fixtures or CI secrets.
The runner reads no personal app/AI configuration, accepts no endpoint override,
uses only `https://api.openai.com/v1/chat/completions` and refuses execution in CI.
A previous approval or an existing credential is not permission for another run.
Revoke the temporary key after the requested session.

The default run sends at most eight serial requests with `gpt-4o-mini`, capped at
512 completion tokens per request, 30 seconds idle and 60 seconds total per request.
It stops on any failure and blocks automatic transport/compatibility retries.
These are request/token bounds, **not a monetary spending cap**; rejected requests,
interrupted calls and manual reruns can still incur charges. Check provider usage
for the actual bill. To avoid repeating successful scenarios during an authorized
investigation, `--from=3` starts at zero-based case 3 (the fourth case); this still
requires `--allow-paid` and another stdin key entry. No retry is run automatically.

The runner invokes the production `ask-ai` handler, Chat Completions/SSE reader,
request budgets and usage-history persistence, with an in-memory settings store,
a test-only output-token cap and a simulated Electron sender. Scenarios cover:

- Oracle and PostgreSQL SQL generation with streaming and the production parser;
- PostgreSQL function generation;
- Oracle and PostgreSQL trigger-body/settings parsing and validation;
- recorded trace interpretation in Japanese, without inventing database access;
- SQL tuning with previous conversation messages;
- data-generation settings merged by the production validator, preserving an
  integer above JavaScript's safe numeric range exactly;
- token counts, chunk/final-answer equality, listener cleanup and CSV usage records.

Only synthetic prompts/source/trace values are sent. Generated SQL is never executed;
there are no DB connections, user files, real trace exports or external Git actions.
Usage CSVs live in an isolated temporary directory removed on success or failure.
Reports contain scenario names and token counts, never the key or full replies.
The deterministic guard tests cover refusal without approval/in CI, bounded stdin,
HTTP failures, malformed responses and the complete mocked eight-request flow.

This is a transport/response-contract smoke test. Prompts are small dedicated
fixtures, not the complete prompts from every screen. It does not establish
full UI operation, code correctness against an actual database, every AI model,
query-builder adoption or package generation. Existing mocked hook/component tests
continue to cover review, approval, stale targets, history and cancellation without
paid API requests. See the official [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
for the response cap and streaming usage fields used here.

## Paid tuning-effect tests — dedicated real databases

Run only for a fresh explicit user request with a temporary key (or an explicit
instruction authorizing that key's reuse for this request). It is independent of
all ordinary tests and CI, including `test:db`:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:ai:effect -- --allow-paid
```

Supply the key on hidden stdin. `tests/live-ai/effect.cjs` refuses CI and requires
both paid and dedicated-DB write opt-ins. It verifies the configured user/schema
and actual DB schema are `test` (`TEST` on Oracle). Use only the authorized dedicated
configuration; no credentials are printed or copied into prompts/reports.

Four scenarios cover missing indexes and non-sargable ID predicates on both
PostgreSQL and Oracle. Each creates an independent random `MBT_` table with 100,005
synthetic rows: 100,000 ordinary values plus NULL, negative, zero, a duplicate target
and a nearby nonmatching number. No sleep, planner-disable switches, cache clearing
or server changes are used. The non-sargable case starts with an ordinary ID index;
the query applies TO_CHAR/CAST to the indexed column.

The production SQL window's `useSqlWindowBottom.handleExportForAI` collects the
real initial execution plan, definitions, indexes and statistics. This context goes
through the production `ask-ai` handler to OpenAI. The model must return a query,
optional index DDL and explanation. A whole JSON code fence is accepted, as in the
existing coding parser. The suite does not accept a free-form SQL script: it checks
the exact reviewed qualified SELECT and only permits an ordinary run-named index
on this run's table and known columns. Other objects, functions, extra statements,
DML, session changes and index creation in the rewrite case are refused.

The test executes the **AI's validated proposal**, not a replacement optimization
silently supplied by the harness. It verifies the complete result multiset remains
identical (including duplicate rows), all 100,005 source rows remain, the initial
plan scans the table, and the final plan uses an index. Five warmed measurements
are compared. A pass requires at least an **80% reduction in actual logical/buffer
reads**; faster elapsed time alone is insufficient. Timing is recorded but is not a
fragile pass/fail threshold.

PostgreSQL uses `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for actual server execution
time and root shared-hit-plus-read blocks. Oracle's displayed plans are estimated
`EXPLAIN PLAN` output; actual logical reads are measured on the same executing
session using `SYS.V_$SESSTAT` and `SYS.V_$STATNAME`. The dedicated user needs their
SELECT privileges (already used by the session tests). Oracle elapsed time includes
application/driver round trips, so do not compare absolute timings between the DBs.
These block counts describe buffer accesses, **not physical disk reads**. See the
[PostgreSQL EXPLAIN reference](https://www.postgresql.org/docs/16/sql-explain.html)
and [Oracle DBMS_XPLAN reference](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_XPLAN.html).

The command makes at most four serial paid requests with `gpt-4o-mini`, capped at
1024 completion tokens each. There are no automatic retries; failures stop the run.
The normal 30-second idle/60-second request budget applies. Manual reruns cost
extra and must remain inside the authorized investigation; report their actual
request count. Model output is nondeterministic and an effective but unsupported
proposal is a failed test, not silently applied. Initial guard/fixture preflights
can use injected deterministic responses without paid calls.

Success reports (proposal, explanation, before/after plans, row counts, median
measurements and usage) go to a unique JSON file under ignored `local/ai-test-reports/`.
No key or personal app configuration is stored. Temporary usage CSVs are removed;
run-owned tables and their indexes are removed on success and failure, followed by
a catalog check for the table's absence. No other objects or privileges are changed.
`tests/ai-effect-guard.test.cjs` verifies permission gates, allowed-SQL boundaries,
fences, reduction criteria, output/request caps and credential-echo rejection with
mock responses as part of the regular free test suite.

This tests two selective lookup problems on small synthetic tables. It is not a
benchmark of production data, joins, sorting, all models or every kind of SQL
optimization. It also does not assert the effectiveness of the code, trigger,
trace-debugging and data-generation assistants; those need separate semantic
fixtures beyond the earlier transport smoke tests.

## Paid trace-diagnosis tests — real loop execution

`test:ai:trace` is another explicit-request-only paid command. It is never part of
`check`, `test`, `test:db`, `test:ui` or CI. It uses the same gates, hidden stdin key,
fixed official OpenAI endpoint and dedicated `test` DB configuration as the tuning
command. A fresh user instruction is required, including authorization to use the
provided temporary key for this investigation.

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:ai:trace -- --allow-paid
```

For each of PostgreSQL and Oracle, `tests/live-ai/trace-effect.cjs` creates a random
run-owned `MBT_..._LOOP` function with five loop iterations. The specification is to
sum `i * 10` for i=1..5. One branch subtracts instead of adding; normal execution
returns 90 instead of 150. The test acquires a real recording through production
`executeTracePg` / `executeTrace`, using the production PostgreSQL wrapper builder
and an isolated production trace store. It checks traced and native results agree,
all five iterations are recorded, and the third iteration's input/output snapshots
actually contain total 30, amount 30, then total 0. These are not handwritten trace
fixtures sent to the model.

The persisted recording goes through the real `get-trace-for-ai` IPC handler and
`useAiTraceDebug` prompt builder. Only object selection and the Electron/React host
are simulated. The AI receives the production reference prompt plus a user request
stating the intended sum and observed final result. The test request asks for
structured diagnosis and appends a numbered rendering of the same source to avoid
line-count ambiguity. It explicitly distinguishes the faulty assignment's source
line from the later step where its result becomes visible. It does **not** send the
expected bad line, iteration, intermediate values, diagnosis or repair as an answer.
The intended/actual final totals are part of the user's issue description.

A pass requires the cause line, third iteration, before/after/expected values,
final totals and a minimal repair, plus real recorded step IDs supporting both
input and output. The immediately preceding IF snapshot is acceptable evidence
when it contains the same inputs as the assignment; a different iteration, missing
step or post-repair value is not. Oracle's implicit FOR variable can be absent
from variable snapshots, so the recorded `L1_iter3` loop path provides the iteration.

The AI's replacement is accepted only if it is exactly the intended one-line
addition, ignoring whitespace/case. No arbitrary generated source/script is run.
The same run-owned function is patched at that exact line, recompiled and called
natively; it must return 150. A second real trace must also return 150 and observe
total 60 in the third iteration. Both the original function and any remaining
run-owned instrumentation are cleaned up, with catalog absence checked. A leftover
instrumentation routine is removed but remains a test failure. Personal trace
folders, existing programs, user data and server settings are not modified.

The default run makes at most two serial `debug_function` requests with
`gpt-4o-mini`, capped at 1024 output tokens each, with no automatic retry. Raw model
answers and their synthetic source/trace are checkpointed **before validation** to
unique ignored `local/ai-test-reports/trace-observation-*.json` files (labelled
received/not-yet-validated). This allows offline investigation of rejected answers;
a checkpoint is not a successful result. Successful reports additionally retain
validated diagnosis and the before/after traces. Keys are not written to either.

`tests/ai-trace-effect-guard.test.cjs` runs with simulated snapshots/responses in the
regular free suite. It rejects guessed diagnoses unsupported by trace, wrong
values/lines, invented step IDs, another iteration's evidence and multi-statement
repairs; it also checks the valid adjacent-IF case and two-request ceiling.

This validates one intentionally small loop defect per database. It does not
establish that every model can diagnose every trace. In the initial investigation,
the model first reported the observation line instead of the cause line; this was
recorded as failure. The user request was then clarified with numbered source and
snapshot timing, and an overly narrow test-side evidence rule was corrected.
Final results should distinguish these attempts and disclose paid rerun counts.
No production app prompt was changed; the extra numbering/structured response
request belongs to this test's explicit user message.

## Paid program-generation semantics — Oracle and PostgreSQL

The isolated `test:ai:programs` command tests generated functions, procedures and
triggers for both databases, plus an Oracle package specification and body. As with
the other paid commands, it requires a fresh explicit user request and that run's
authorized temporary key. It is not included in normal tests, `test:db` or CI.

The workflow deliberately separates paid generation from real-DB execution:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:ai:programs -- --allow-paid
```

Enter the key on hidden stdin. This stage sends at most eight requests, each capped
at 1024 output tokens, and saves the original answers under ignored
`local/ai-test-reports/program-responses-*.json`. It uses the production
`useAiCodingGeneration.getReferencePrompt`, response parsers and review/adoption
callbacks. Actual editor windows/object pickers are not opened; the test supplies
explicit task instructions, names and the fixture's table-column definitions.
The package body receives its matching AI-generated specification. A missing or
rejected specification blocks the body request; this is not a passing test.

Answers are saved before validation. Protocol failures, clarification requests and
wrong object identities are recorded as rejected. There is no automatic repair or
automatic paid retry. Later categories can still be collected; a rejected/blocked
answer makes generation exit nonzero. Within the **same authorized investigation**,
`--resume=local/ai-test-reports/program-responses-....json` reuses successful answers
and retains previous answers in attempt history. `--only=oracle:PACKAGE,oracle:PACKAGE_BODY`
limits a manual retry to selected categories. `--model=gpt-4.1-mini` permits a
controlled model comparison; the default is `gpt-4o-mini`. The additional `--model=gpt-6-luna` option is also allowlisted. These model IDs
are explicit test choices, not a change to the app's model settings. See the official [GPT-4.1 Mini reference](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
for endpoint compatibility. Report actual requests across all manual attempts;
resumed/focused runs do not reset the investigation's spending history.

For GPT-6 Luna, the test-only completion cap is 4096 rather than 1024 because
`max_completion_tokens` includes reasoning as well as visible text. The request
leaves reasoning effort unspecified (the provider's default), does not attach tools,
and preserves the same prompts, response checks and DB expectations. It does not
reuse another model's source when starting a fresh run. No automatic retry is added.
This configuration follows the official [GPT-6 Luna model reference](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Token caps differ, so comparisons should disclose this setting instead of claiming
all inference conditions are identical.

Review all saved source before the database stage. Supply that exact file's SHA-256:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:ai:programs -- --verify=local/ai-test-reports/program-responses-....json --review-sha256=REVIEWED_SHA256
```

Verification makes **no AI request**. It checks the review fingerprint, deterministic
manifest/identities, dedicated DB user/schema, source operation/target restrictions
and the production review/adoption contract again. The fingerprint records that the
caller reviewed this exact file; it is not an automatic SQL security proof. The
additional lexical guards reject other schemas/targets, extra CREATE definitions,
dynamic SQL, privilege/transaction changes and unsupported operations. This is not
a sandbox for arbitrary code. Only source already inspected as safe for the owned
fixture may be reviewed/approved for execution.

Each run creates independent random `MBT_` tables and routines. Trigger installation
uses the production structured save IPC/client. Its generated PostgreSQL helper
function is identified from metadata, verified to be in the dedicated schema with
a new `mb_trg_...` name, and tracked for removal. Only that exact helper is dropped.
Oracle compilation checks USER_ERRORS; warnings/invalid definitions are not treated
as success. The AI source is not silently rewritten to make tests pass.

The planned 64 semantic checks are independent of the AI's implementation:

| Target | Checks per database | Behavior |
| --- | ---: | --- |
| Function | 8 | Shipping for NULL, negative/zero, 199, 199.99, 200, 201 and a large exact input |
| Procedure | 6 | Target-only amount updates, positive/negative/NULL delta, NULL amount, absent/NULL ID and OUT count |
| Trigger | 9 | INSERT boundaries/NULL/negative, preserving an existing exceptional fee on NOTE-only/same-amount updates, amount threshold and NULL transitions |
| Oracle package specification | 2 | Two shipping overload declarations and one adjust procedure |
| Oracle package body | 16 | Both overloads, priority and NULL behavior, plus the same six update/OUT cases |

Procedure checks begin an explicit caller transaction on PostgreSQL and use the
normal uncommitted Oracle call. A second independent connection must still see the
baseline; ROLLBACK must restore all rows. This verifies the generated procedure does
not commit caller work; it does not claim all possible CALL contexts automatically
start a transaction. Trigger preservation uses a row seeded **before** trigger
installation with amount 199/fee 77, rather than imposing an unspecified behavior
for direct manual edits to the SHIPPING column.

A trigger answer missing only the required `message` field remains an overall
format failure. A separately labelled diagnostic may add `message: ""` to the
**envelope only** to run the byte-for-byte original source and settings against
DB semantics. This is never reported as successful application of the raw response
through the app. Nested/placeholder source or other malformed answers are not
repaired. Rejected cases, compilation failures and assertion failures remain
nonpassing; later cases can continue. A package compile failure prevents its
behavioral cases from running and is not an automatic skip/success.

After success or failure, owned routines, package body/specification, tables and
the tracked trigger helper are removed. The schema catalogs must no longer contain
the run's names. A routine never created due to rejected syntax is distinguished
from a failed cleanup operation. Partial table changes are rolled back first.
Reports retain sources, model/usage, per-target status, checks and errors; keys and
connection configuration are never included. Copy the response file before model
comparison if retaining an immutable baseline, and review the new fingerprint.

A free real-DB control is available before any paid requests:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:ai:programs -- --fixtures-only
```

`tests/live-ai/program-fixtures.cjs` supplies known-correct code only for this control
and the ordinary mock guards. It is **never** sent as an AI answer or substituted
for failing AI code. All 64 control checks must pass, including package operations,
so generated-code failures can be distinguished from fixture/environment failures.
`tests/ai-program-effect-guard.test.cjs` exercises production prompt/review/adoption,
identity and operation gates, immutable review, diagnostic-envelope separation and
controlled model/request limits without contacting a provider or DB.

This is one small shipping/update specification per object kind. It does not cover
every signature, SQL type, exception path, compiler version, full Electron workflow,
existing-source modification or every AI model. Preserve negative model outcomes;
passing a different model's later answer does not turn the first answer into a pass.

React regression tests exercise the exported application hooks, including empty view drafts, edits during source loading, stale responses, tab state under double updater evaluation, SQL column metadata changes, and table pagination. The dependency-aware hook harness models effects and updater evaluation; actual Electron UI checks complement this simulation.

Table-data and table-structure fixtures commit their final render before exposing
a flushed snapshot. Otherwise a late metadata response can make state look ready
while `useEventCallback` still points to the previous committed render. A focused
regression completes Oracle metadata during the last fixture settle and immediately
requests a sorted page, verifying no alert, one count/data pair and the exact rows.
The real-DB pagination scenario also requires successful requests and matching
page/size before comparing rows, so retained results cannot masquerade as a new
page. This corrects the test harness; production React event callbacks are unchanged.

The sequence-settings fixture also commits its final render before exposing state.
Regressions for both databases finish an edit during the final settle and verify
that the next save detects a concurrent cache change without issuing DDL. A held
reactivation response confirms that saves during loading are intentionally ignored;
only a save after metadata becomes ready can produce a conflict review. The real-DB
sequence review waits for loading to finish and requires successful metadata after
reactivation, rather than treating a fixed number of event-loop turns as completion.
It asserts a conflict exists before inspecting fields, so failures report the missing
review instead of a null-property TypeError. These changes affect test scheduling,
not the production loading or conflict policy.

The [component coverage map](COMPONENT_TEST_COVERAGE.md) lists every TSX file, its direct component/controller regression tests, and corresponding Electron scenarios. It distinguishes documented scenarios from line/branch coverage; a listed file is not a claim of full coverage. Run `node --test tests/component-*.test.cjs` for focused component checks. The shared `componentHarness` runs actual view functions and callbacks with simulated React hooks, visual libraries and external boundaries; create-table and cross-tab tests also load their actual controllers. Metadata-pane tests assert stale-response rejection and no state writes after unmount. The inventory check keeps the map synchronized with source additions/removals and is not itself a behavior test.

## Niche stored-program trace tests

`tests/integration/trace.test.cjs` is included automatically in `npm run test:db`. To run only this suite:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 node --test --test-concurrency=1 tests/integration/trace.test.cjs
```

Use `MONABASE_TEST_DATABASES=oracle` or `postgresql` to select one database. Local configuration must name the dedicated schema; it is checked before any object is created. Without an explicit schema, the disposable PostgreSQL CI database uses `public`, while Oracle uses the configured user. Connection credentials are read through the existing private configuration/environment mechanism and are never embedded in fixtures.

The suite contains 25 scenarios (12 Oracle, 13 PostgreSQL), plus two parent tests. The programs in `tests/helpers/tracePrograms.cjs` are original small fixtures designed to expose instrumentation mistakes:

| Oracle | PostgreSQL |
| --- | --- |
| Sparse associative arrays with FIRST/NEXT/DELETE | FOREACH SLICE, multidimensional arrays and nondefault lower bounds |
| FORALL INDICES OF, SAVE EXCEPTIONS and SQL%BULK_EXCEPTIONS | Labeled REVERSE/BY loops, CONTINUE WHEN and nested EXIT |
| Parameterized cursor, BULK COLLECT and LIMIT | Dynamic EXECUTE/FORMAT, USING, INTO STRICT and ROW_COUNT |
| Local recursive function, named notation and defaults | Custom SQLSTATE and GET STACKED DIAGNOSTICS |
| Dynamic DML RETURNING and SQL%ROWCOUNT | Bound scroll cursor, MOVE/FETCH and FOUND |
| PRAGMA EXCEPTION_INIT and handled early RETURN | Dollar-quoted control words, nested declarations and early RETURN |
| Anchored %ROWTYPE/%TYPE and whole-record SELECT INTO | STRICT cardinality exceptions and FOUND after zero rows |
| Labeled nested loops and searched CASE | Dynamic record query loop and JSONB operations |
| MULTISET, XML extraction and exact decimal text | Exact NUMERIC, aggregate FILTER and ordered-set percentile |

Both databases additionally exercise IN/OUT procedures, a real trigger compared with its generated simulation, and unhandled exceptions. A PostgreSQL set-returning function is executed natively and then verified to be rejected explicitly by the trace builder before creating a temporary procedure or trace file; this suite does not add support for set-returning traces. Syntax references: [Oracle bulk SQL](https://docs.oracle.com/en/database/oracle/oracle-database/21/lnpls/plsql-optimization-and-tuning.html), [PostgreSQL control structures](https://www.postgresql.org/docs/16/plpgsql-control-structures.html), and [PostgreSQL result diagnostics](https://www.postgresql.org/docs/16/plpgsql-statements.html).

The assertions compare ordinary DB execution against the **production trace executor**, verify literal user output, original source locations, selected saved variable values and unreachable statements, and reopen the **real JSON trace store**. Those persisted steps feed the actual DB-specific simulator hooks for step-by-step playback; loop cases also exercise breakpoint entry and step-out to the known source statement following the loop. Hook rendering is simulated: this is not an Electron/visual trace-debugging test, and it does not inspect every element of every collection.

Native DML functions run in a PL/SQL block on Oracle and an explicitly rolled-back transaction on PostgreSQL; a SELECT alone would not be a valid Oracle DML-function call or a safe PostgreSQL rollback baseline. Trace-side DML must be rolled back, successful temporary programs removed, failed runs must not produce a successful trace file, and a later program must remain usable. Fixtures use randomized `MBT_` names, confirm temporary names were absent before execution and clean up only their own objects. Trace JSON uses an isolated OS temporary directory, removed even after assertions fail; the application's saved traces are untouched. The suite requires no extra administrative permissions beyond the existing dedicated integration environment.

These checks exposed and fixed three regressions: Oracle misreading `LIMIT` as part of an INTO variable, PostgreSQL rejecting `$1` inside dynamic-SQL string literals, and stale loop frames after EXIT/CONTINUE. Loop-completion markers now follow END LOOP and identify the loop, including trigger simulations; repeated starts replace bypassed iteration frames. Five corresponding unit regressions run without a DB in `npm run check`.

Local verification uses Oracle 23.26.3.0.0 and PostgreSQL 16.15. This does not establish compatibility with every Oracle 12+/PostgreSQL version, all PL/SQL/PL/pgSQL features, remote side effects, autonomous transactions, COMMIT inside user programs or live debugger UI behavior. Fixtures deliberately avoid autonomous transactions and explicit user-program commits.

## Real database tests

Use a dedicated test database/user. The suite creates randomly named `MBT_…` tables, views, and functions in the connection's current schema, then drops only objects successfully created by that run. It never searches for or deletes objects from earlier runs. After an interrupted process, remove any abandoned objects manually after checking their names. Normal assertion failures still run cleanup; cleanup failures fail the suite.

Required permissions:

- PostgreSQL: connect to the test database, use and create objects in the current schema, and create PL/pgSQL functions. A database owned by the test user provides these capabilities without superuser privileges.
- Oracle: `CREATE SESSION`, `CREATE TABLE`, `CREATE VIEW`, `CREATE PROCEDURE`, and space quota in the user's tablespace. The private database-link scenarios also require `CREATE DATABASE LINK` and `ALTER DATABASE LINK`. The directory scenarios require `CREATE ANY DIRECTORY` and `DROP ANY DIRECTORY` and must run only in an environment explicitly approved for temporary database-wide MBT_ directory definitions. An administrator must prepare these privileges before running the suite; tests do not grant them. No DBA role is needed. Thin-driver-compatible password authentication is used.

Create a private JSON file such as `local/db-tests.json` (the entire `local/` folder is ignored by Git):

```json
{
  "postgresql": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "your_test_database",
    "user": "your_test_user",
    "password": "replace_locally"
  },
  "oracle": {
    "host": "127.0.0.1",
    "port": 1521,
    "database": "FREEPDB1",
    "user": "your_test_user",
    "password": "replace_locally"
  }
}
```

Run both databases from macOS/Linux:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:db
```

PowerShell:

```powershell
$env:MONABASE_TEST_CONFIG = 'local/db-tests.json'
$env:MONABASE_DB_TEST_ALLOW_WRITE = '1'
npm run test:db
```

Set `MONABASE_TEST_DATABASES=postgresql` or `oracle` to run just one database. Missing settings, unavailable databases, and missing permissions fail the requested suite rather than silently skipping it.

CI can provide individual `MONABASE_PG_HOST`, `MONABASE_PG_PORT`, `MONABASE_PG_DATABASE`, `MONABASE_PG_USER`, `MONABASE_PG_PASSWORD` variables, or equivalent `MONABASE_ORACLE_…` variables. These override JSON values. The suite never reads personal `AGENTS.md` or saved application connections automatically. Do not commit real connection files or paste secrets into commands or test reports.

Each JSON connection can also specify an optional `schema` to assert the expected schema before creating any objects. This checks the current schema; it does not change session settings or create a schema. PostgreSQL names are compared exactly; Oracle assumes an unquoted schema name and compares its uppercase form. For a dedicated `test` account/schema, use `"schema": "test"` in each connection. A mismatch fails setup before any test objects are created.

PostgreSQL and Oracle run database-specific scenarios using the application's real client implementation. Only the Electron `app.isPackaged` flag is substituted to run the client under Node.js and suppress development SQL diagnostics. Drivers, SQL, connections, and transaction behavior are real. Two independent clients check whether changes are visible before/after commit. The scenarios include:

- Exact large integers and decimals, Japanese text, quotes, and named binds.
- Commit, rollback, and continuation after a failed statement while retaining earlier changes.
- Background metadata isolation and the application's Oracle-compatible DDL commit policy.
- Quoted/dotted object names, views, stored function execution, and source retrieval.
- Database-specific script parsing, application read-only mode, reconnect, and delete/rollback.
- Database function source retrieval, a real definition change, two Git revisions, old-source retrieval, and a real Git diff in a disposable repository.
- Query building and record editing with quoted columns, including binary bind parameters. PostgreSQL uses embedded double quotes; Oracle uses spaces because [Oracle does not permit double quotes inside identifiers](https://docs.oracle.com/en/error-help/db/ora-25716/).
- Oracle NUMBER input, output, and IN/OUT values retain exact integer and decimal strings.
- Both databases import parsed CSV through table and sidebar paths with separate `code` and `CODE` columns, reordered exact headers, all-default records and whitespace-only values. Ambiguous headers are rejected before any SQL, and inserted rows remain uncommitted.
- PostgreSQL CSV import preserves row/column alignment, column defaults and all-default records, while inserted rows remain invisible to the observer until commit.
- PostgreSQL metadata methods use actual background connections for column, object, session and lock reads. A mixed-case table name containing apostrophes, dots and double quotes exercises sidebar metadata preparation and importing quoted columns with different missing-field positions. Names are preserved, nonexistent schema names remain distinct, and imports stay uncommitted.
- Overlapping connect/connect and disconnect/connect IPC calls use real database clients; superseded clients close and shared state refers only to the final connected client.
- Read-only main/background queries reject procedural blocks, multiple statements and write functions, including an Oracle autonomous function; PostgreSQL also rejects a data-changing CTE and transaction-setting changes. Subsequent reads see other committed updates, and Oracle table DDL retrieval remains available.

`tests/database-safety.test.cjs` simulates partial pool creation, SSH setup/authentication failures and failed read-only SQL to check cleanup deterministically. It also checks every PostgreSQL connection's read-only default, Oracle SYS rejection and SQL policy behavior. Oracle stale-snapshot tests verify a single read-only retry, persistent error reporting, and no retry/rollback of writable connections. It also simulates a late connection failure, disconnect during connection, slow disconnect, rejected cleanup and unsupported DB types to verify request serialization and state publication. Metadata tests assert bound names, slot release on errors and failure propagation. These simulated failure tests do not require an SSH server. Trace IPC regression tests verify rejection before either trace executor is called.

## Git tests

`tests/git-transport.test.cjs` uses actual Git against disposable loopback HTTP
and HTTPS servers. It rejects redirects for ref discovery and push without any
request reaching the redirected destination, including when URL-scoped and deeper
path-scoped settings enable redirects. It rejects an unknown self-signed CA and
a mismatched certificate hostname even when stored settings disable verification;
providing the test CA through `http.sslCAInfo` permits the valid-host request.
Repository and global configuration bytes remain unchanged by application
operations. Environment isolation, temporary-index forwarding, safe configuration
probe failures, and credential-bearing scoped-key rejection are also checked.
These cases require OpenSSL (or Git for Windows' bundled OpenSSL), run in
`npm run check` and `npm run test:git`, and never contact an external remote.
Local HTTP servers are transport fixtures, not remote hosting services.


Install Git and run `npm run test:git`. These cases also run as part of `npm run check` and the existing CI jobs. Source workflow tests use the production Git IPC handlers with real Git repositories. All remotes are disposable local bare repositories; no external push is performed.

ER workflow tests use the production ER IPC handlers and the same disposable real-Git fixture. They check exclusion of unrelated staged files, unchanged-save retries, literal bracketed filenames, pipe/control characters in messages, actual merge classification, index-lock failures, failed commits after staging a deletion, retry completion, old content after deletion, local-only deletion, and ordering between ER and stored-source writes. Renderer hook tests verify ER-specific retry prompts, preserving a draft after cancelling a commit retry, and refreshing only after successful operations.

`tests/git-pull-errors.test.cjs` also verifies that repository initialization, remote configuration, Push, Pull, conflict-resolution Pull, and merge abort wait for pending writes to the same repository. Renderer hook cases check cancellation success, backend failure, missing responses, and rejected IPC requests in English and Japanese. A failed cancellation must show the error and warn that conflicts may remain; only a successful abort reports restoration. These cases simulate Git/IPC responses; the existing disposable local-repository cases exercise actual merge conflicts and unreachable remotes.

`tests/git-initial-sync.test.cjs` exercises initial setup on `main`, `master`, and a feature branch, rejects a stale branch selection before changing the remote, and retries a failed initial Push without upstream tracking. Actual local remotes verify history rejection followed by Pull/Push recovery, server hook rejection, Pull to a feature branch while the remote default is `main`, and missing tracking refs. Renderer cases cover English/Japanese failure messages, unknown versus verified-zero commit counts, and branch refresh when reopening settings. The settings dialog displays the current local branch and synchronizes the same branch name on `origin`; changing branches is done with Git outside this dialog. Only a confirmed history rejection recommends Pull. Unknown commit counts permit a confirmed normal Push to establish tracking.

Initial-setup cases also preserve unrelated staged files and existing README files, including untracked, ignored, and staged-with-unstaged-edits variants. A new generated README is committed by path only; an existing README results in an empty initial commit, leaving its contents and staging unchanged. Repository-ref query failures stop setup instead of being treated as an empty history. The disposable remote's actual tree is checked so unrelated staged notes cannot enter the initial Push.

`tests/git-atomic-save.test.cjs` injects partial-write, flush, and rename failures into the production atomic writer used by source commits, ER commits, and ordinary ER saves. It checks exact original bytes, unchanged staging/history, temporary-file cleanup, complete retry output, retained prior Git revisions, and failures with missing destinations. Faults are simulated; file operations and Git histories use disposable real files and repositories. These cases run in both `npm run check` and `npm run test:git`.

The tests cover filename collisions (`CALC`, `CALC.sql`, case differences, Unicode, and OS-reserved names), archived source ownership, old revisions after rename, overwrite refusal, repeated deletion, commit failures and retries, concurrent saves, and excluding unrelated staged changes. Existing tests cover overload separation, merge conflicts, unreachable remotes, and workspace boundaries. Renderer tests verify that a failed Git save is reported and retrying Git does not repeat successful DDL.

By default, repositories are created under the OS temporary directory. To run the added source workflow cases in a dedicated local working area:

```sh
MONABASE_GIT_TEST_ROOT=git/MonaBase/.test-runs npm run test:git
```

Each run creates its own nested repository with isolated identity/configuration and disabled working-repository hooks, then removes only that run's directory. Failure tests install hooks only inside their own disposable working repository or bare remote. Tests do not initialize, stage, commit, reset, or alter remotes in the parent database-source repository. Tests with separate fixtures may still use OS temporary directories. Real DB integration also uses the same fixture for its source-to-Git checks.

### Additional real-command workflows and conflict matrix

`git-command-workflows.test.cjs` adds eleven cases through the production Git handlers and actual Git processes:

- Linked worktree commits/history use that worktree's branch and index while preserving staged and unstaged files in the main worktree.
- Detached HEAD allows immutable source reads and reports no current branch; remote setup and Push are refused without repository changes.
- Pull rejects tracked working edits, staged edits and colliding untracked files, preserves their exact content/index/HEAD, and permits a deliberate retry after the fixture is cleaned up. Unrelated untracked notes survive a successful fast-forward.
- Divergent histories reject ordinary Push, merge once through Pull and publish both parent histories with a normal Push.
- Selected-source staging and externally changed HEAD invalidate stale source reviews without replacing work.
- Packed refs, real garbage collection and a stash retain immutable source history; uncommitted drafts remain outside that history and can be restored.
- A shallow clone exposes only its available history, refuses unavailable old content, and gains complete history after an explicit unshallow fetch.
- Twelve concurrent source commits mixed with status refreshes preserve unrelated staging; each stored object has its own expected content/history, no lock remains, and `git fsck --full` succeeds.

`git-conflict-scenarios.test.cjs` adds thirteen cases: both directions of modify/delete conflicts with either side selected, add/add conflicts resolved with ours/theirs/manual text, diff3 conflicts with 3/7/12-character markers, binary-conflict refusal/abort, failed merge-commit retry and unresolved-merge protection. The tests inspect actual conflict stages and file bytes, verify a real two-parent merge commit, and ensure rejected operations leave HEAD/index/status/content intact. Unicode, spaces and bracketed paths are included.

These cases exposed an unresolved-marker bug: manual resolution accepted customized markers and residual diff3 base markers. `gitReview.js` now reads `conflict-marker-size` with `git check-attr`, rejects those markers before changing any file/index entry, and scans candidate lines without building an array containing every source line. References: [Git attributes](https://git-scm.com/docs/gitattributes/2.40.0) and [linked worktrees](https://git-scm.com/docs/git-worktree).

All 24 additions honor `MONABASE_GIT_TEST_ROOT`; the local run uses `git/MonaBase/.test-runs`. They invoke real init/add/commit/branch/merge/clone/fetch/push/pull/stash/worktree/gc/pack-refs/fsck commands in disposable repositories, with local bare remotes and file-only transport. Fixture identities and Git configuration are isolated from personal global settings. Cleanup removes each run's own directory, including its linked worktrees/remotes, even after assertion failure. No GitHub remote, personal repository history or existing data is changed. Separate transport tests cover loopback HTTP/TLS; these 24 cases do not establish real GitHub authentication or native UI behavior. Local verification used Git 2.48.1 on macOS; other platforms are left to CI.

## Automated UI checks

Information-tab refresh/reload actions use an outlined button with a refresh icon
and a text label. The Electron suite checks visible actions for actual icon SVGs,
outlined styling and nonzero rendered borders in routine, package, view, sequence,
type, materialized-view, materialized-view-log, synonym and database-link screens.
Existing loading, stale-result and retry tests remain in place; this presentation
change does not alter metadata requests or refresh behavior. Shared reload actions
visible from the information tab use the same presentation.

Focus regression tests keep Windows recovery, foreground/modal/DevTools guards,
cooldown and listener cleanup covered. Renderer tests additionally assert empty
console output for native events/history and rejected focus reports, successful
later reporting after a rejection, and no startup history request for logging.
The bounded main-process history and recovery bridge remain available internally;
automatic `[MonaBase Focus]` console logging is disabled in both development and
production. These are simulated focus/IPC tests; native Windows focus recovery
still requires a Windows machine to validate.

Workspace routine-tab checks assert compact object names without argument
signatures, while the existing Oracle package-body label stays name-only.
`object-identity.test.cjs` additionally verifies that identically labeled PostgreSQL
overloads keep distinct identities, reopening selects the correct existing tab,
and newly compiled routines use the compact label too. Argument types remain in
the tooltip description; parentheses that belong to an actual quoted object name
are preserved rather than stripped with a text replacement. SQL execution and
argument selection are unchanged.

`tests/e2e/progress.cjs` checks all three real MUI themes with reduced motion
enabled and disabled (six combinations). It renders the actual theme/components
to HTML and runs their CSS animations in Electron with software rendering, matching
the application's graphics policy. Chromium media emulation reproduces the
Windows animation-off preference. Timed computed-style samples must show actual
spinner rotation and linear-bar movement; merely finding an animation name is
insufficient. Determinate values remain unchanged, decorative motion stays reduced,
and the normal-mode circular arc animation remains enabled. The reduced-mode
circle uses a fixed arc with a two-second rotation; indeterminate bars use a
three-second duration. The test switches back to normal mode in the same page.

Before the fix, the global reduced-motion rule forced even loading indicators to
0.01 milliseconds; this test reproduced that duration. Essential busy feedback now
has specific CSS exceptions while other reduced-motion rules remain active.
This is a real browser CSS test with server-rendered MUI markup, not a Windows
native-app test or an IPC/database test. The normal UI command runs it before the
IPC-origin checks and both production-renderer workspace suites. See
[Microsoft's media-emulation guidance](https://learn.microsoft.com/en-us/microsoft-edge/devtools/accessibility/reduced-motion-simulation).

`tests/git-er-history.test.cjs` adds twenty-two cases across Oracle and PostgreSQL ER modes. Real hooks and the actual ER component verify disabled Restore controls during loading/after failure, a loading indicator, successful retry, immediate handler guards before rendering, reversed responses, stale successes/failures, changed diagrams, leaving comparison, unmount and valid empty diagrams. Malformed JSON and invalid node/edge structures cannot become restorable snapshots. The tests retain the working canvas on failure and verify that restoring does not issue save/commit requests.

Four additional cases bring the ER suite to twenty-six cases. Both DB modes reject malformed ordinary files (including object-valued edges, invalid node positions, non-array columns and invalid display values) before metadata queries, preserve the working nodes/edges/name/mode, and permit retry with valid content. Valid empty files still open. The same invalid fixtures also exercise Git history reads. The disposable Git cases additionally save malformed files through the production ER handler, verify ordinary loading reports an error without overwriting the file or changing HEAD, then repair and reopen the file successfully.

Two of those cases create real disposable Git repositories and commit distinct ER diagrams. The production ER IPC handlers retrieve both actual revisions; delayed responses arrive backwards, and only the selected revision may reach the canvas. File bytes and Git HEAD remain unchanged after restore. The response timing is simulated, while Git operations and history contents are real. These cases run in both `npm run check` and `npm run test:git`; they do not connect to a database or external remote. Component checks use a rendering harness, not Electron interactions with the ER canvas.

Run `npm run test:ui` on a desktop. On a headless Linux runner, use `xvfb-run -a npm run test:ui`. Electron uses a temporary user-data directory and generated test connections, without reading personal application settings. The test refuses HTTP requests and AI requests.

Failures return a nonzero exit code. A condition waits for the expected UI state with a deadline rather than relying on fixed screen-rendering delays. The suite covers the sidebar workflow in both database workspaces, opening a table, exactly one count/data query pair per page change, and keeping the export dialog open during parent refresh. The suite also opens Git settings in both workspaces, verifies the read-only current branch, retries a simulated authentication failure while retaining the dialog, and confirms a normal Push with an unknown commit count. Git responses in the UI suite are simulated; the separate Git tests exercise real Git. It does not yet cover all editor dialogs, Git conflict dialogs, AI request workflows, SSH, or trace execution through the UI.

## GitHub Actions

[Integration tests](../.github/workflows/integration.yml) runs on repository pushes and manual dispatch; PR events are not enabled. It starts disposable PostgreSQL 16 and Oracle Free 23 containers in separate jobs, and runs the Electron UI suite under Xvfb. The credentials in this workflow belong only to ephemeral CI containers and are unrelated to personal databases.

The Oracle service configuration follows the [container maintainer's GitHub Actions instructions](https://github.com/gvenzl/oci-oracle-free#github-actions). These checks complement the existing unit, renderer, and package checks. They neither publish applications nor connect to your local databases. Container tests cover those versions only; Oracle 12 and other supported versions still require separate validation.

Oracle setup runs SQLPlus with local SYSDBA authentication inside this run's
service container, switches to `FREEPDB1`, and stops on SQL/OS errors. Application
tests still connect as the ordinary `monabase_test` account. The Linux UI job
downloads/resolves Electron before preparing the helper's root ownership and
`4755` mode; tests retain Chromium sandboxing.

Integration fixtures must use the actual execution schema rather than assume a
local `test` schema. `createSqlWindowHarness` accepts a `schema` option, and every
real SQL-window fixture passes its connected schema. Role dependency assertions
also distinguish initdb's pinned bootstrap role (OID 10), which has no
`pg_shdepend` rows, from the ordinary test role that owns run-created objects.
The suite reads both identities when different. Empty bootstrap dependencies
remain a successful metadata result, not a skipped test. See
[PostgreSQL shared dependencies](https://www.postgresql.org/docs/16/catalog-pg-shdepend.html).

### Windows paths and checkout line endings

History-filename tests exercise native, `path.win32` and `path.posix` semantics,
checking parent-directory confinement and safe names with each path implementation.
Startup tests compare the actual preload path with a platform-native `path.join`,
while application URLs retain URL slash semantics. The desktop contract compiler
fixture canonicalizes native/forward-slash filenames and asserts that the virtual
source was actually loaded before interpreting diagnostics. Both native and Windows
filename spellings must accept the valid program and reject all six invalid calls.

CI policy tests run with both LF and CRLF input and normalize only line endings;
the strict security checks remain unchanged. `.gitattributes` sets LF checkout for
text and binary handling for PNG. `tests/build-portability.test.cjs` verifies this
with a real disposable Git index/checkout and `core.autocrlf=true`, comparing exact
text and image bytes. This complements Windows CI; passing these simulations on
macOS does not establish a successful Windows package build or executable launch.

The package verifier normalizes every ASAR member path with the host path API
before extraction. A real nested ASAR fixture and the locked library's Windows
filesystem implementation reproduce rejection of unnormalized slash paths and
verify successful storage-module and manifest reads after normalization. Required
files, private-data exclusion and fuse checks are not relaxed.
The fixture also awaits `stream/promises.finished` on the stream returned by the
locked ASAR writer. Its package-creation promise can resolve while the last file
write is still pending; reading then can yield zero-filled data on Windows. This
wait observes actual completion rather than adding a fixed sleep.

The plan-navigation UI scenario deliberately uses a 650-pixel-wide window, opens
**More SQL actions**, selects **Parse**, closes the popover with Escape, and
returns to a 2200-pixel window before schema and plan operations. It selects the
visible toolbar rather than an inactive tab's retained DOM. Linux CI supplies a
2560×1440 Xvfb screen to accommodate both layouts independently of font metrics.

The Oracle materialized-view integration fixture waits up to 120 seconds for
source loading, matching the background metadata call budget. The condition also
finishes on an explicit load error, which is asserted as a failure before any
refresh assertions. The Oracle integration parent has a five-minute budget for
cold dictionary/DBMS_METADATA initialization; other fixture waits keep their
existing defaults. Longer waits do not skip errors or change application timeouts.

## Import parsing and SQL history recovery

`tests/import-data.test.cjs` checks CSV/TSV quoting, BOMs, multiline fields, blank versus empty-valued records, literal whitespace, exact-case headers, ambiguous/duplicate mappings, and all four table/sidebar import paths. The Electron suite also submits quoted-empty and whitespace-only values through the actual dialog, checks a headerless whitespace-only record, and verifies malformed quotes keep the dialog open without sending an INSERT.

`tests/sql-history.test.cjs` exercises the production file IPC handlers against temporary files. It checks history ordering/limits/IDs, corrupt and structurally invalid JSON, recovery-copy preservation, explicit clearing, and failed writes/flushes/renames. A failed backup prevents destructive clearing. Renderer tests verify that history IPC errors are reported without retrying database operations. These tests do not modify personal SQL history.

## Dummy-data generation

The current generator suite has **100 hook cases**, including 36 additional normal-path
and boundary cases for both database adapters. These execute production generation
hooks with isolated seeded random streams; regex format cases subclass the actual
RandExp library only to control its random source, without replacing its parser or
mutating global randomness.

| Rule | Added assertions |
| --- | --- |
| Sequence | Complete text prefixes and zero padding; stored prefixed and padded values in both DBs |
| Sequential date | February 28 → leap day → March 1, then 100 stored calendar dates |
| Random text | Alphabetic, numeric, alphanumeric and full-width character sets, lengths and padding; duplicate retries |
| Regex | Real postal/order/fictional-email expansion, full values and uniqueness |
| Choices | Every normal candidate, whitespace/empty candidate handling, numeric/date values, apostrophes and Japanese text |
| Random numbers/dates | Exact interval endpoints/rounding units, date ranges, optional time and duplicate-day retries |
| NULL probability | Below/at the 20% threshold, 0%, existing 100% coverage, and NOT NULL rejection |

Each real-DB suite additionally creates run-owned customer/order tables with primary,
unique, foreign-key and CHECK constraints. The production hook previews ten rows,
then inserts **100 fictional orders across 15 columns**. Reads verify exact IDs,
prefixed/padded codes, regex shapes, amounts, timestamps, valid references/statuses,
NULL and non-NULL notes, quoted text, all character sets and daily dates across a
leap day. The first ten stored values match the preview. An independent observer
sees no orders until commit; the test rolls back instead and verifies zero retained
orders. The committed run-owned parent rows and all tables are removed by the
ordinary fixture cleanup. No existing schema objects, permissions or paid AI service
are used. This tests generator/database behavior, not every UI control or statistical
randomness: a 20% per-row probability is not asserted to produce exactly 20 NULLs.

Four further generator hook cases bring `tests/data-generator.test.cjs` to fifty-two cases. Both databases reject oversized regular-expression results before INSERT with uniqueness enabled or disabled; valid results retain their full content, and duplicate candidates are regenerated before SQL is built. The harness accepts a replaceable RandExp constructor for deterministic candidate sequences.

Each real DB suite also exercises a disposable one-character primary-key column. `A[0-9]` must stop before any INSERT while an earlier uncommitted row remains unchanged and invisible to the observer. A retry with `[AB]` must insert both distinct full values, retaining the earlier row without commit or rollback. These tests use the real regex generator and production hooks.

Nine further generator cases bring `tests/data-generator.test.cjs` to forty-eight cases. Both database hooks reject numeric expressions, nonfinite literals, invalid choices and nonnumeric sequence prefixes before any batch, retain exact valid numeric digits, and select type-appropriate temporal conversions. Timestamp cases cover fractional seconds, offsets, malformed literals and invalid calendar dates. PostgreSQL cases distinguish TIME from POINT/INTERVAL/arrays/custom type identities, generate clock-only values, preserve fixed time fractions/offsets and reject invalid time ranges or choices.

Each DB integration suite adds a typed-value scenario using real column metadata and INSERT execution. Oracle stores exact nine-digit TIMESTAMP/TIMESTAMP WITH TIME ZONE values, compares a local-zone timestamp to the original instant, and retains DATE clock fields. PostgreSQL verifies six-digit timestamps, time/offset values, random TIME/TIMETZ ranges and untouched unsupported columns. Invalid fixed numeric/temporal values and choices send no INSERT and retain an existing pending row invisible to another connection. The normal per-run cleanup rolls back changes and removes the test tables.

The Electron generator scenario additionally exposes a PostgreSQL TIME and POINT column. It checks the Random Time label and HH:mm:ss inputs, a TIME cast in the generated INSERT, and omission of POINT. Other controlled input/timing cases remain hook tests; actual stored precision is verified by the DB integration suite.

Four generator-prompt cases bring `tests/data-generator.test.cjs` to thirty-nine cases. Both database hooks must bind mixed-case and apostrophe/dot-containing names exactly for statistics and foreign-key lookup, quote reference identifiers, and attach each returned column's own sample values. They also assert background metadata reads, main-connection samples and no AI/commit/rollback request.

Each real DB suite adds a generator-prompt scenario with quoted mixed-case tables, apostrophes/dots, and a composite foreign key whose referenced order differs from physical column order. PostgreSQL additionally creates a second table with an identically named FK constraint; exactly two correct column mappings must be returned, with no unrelated references. The real DDL helper, statistics lookup and reference-sample SQL feed the prompt callback. A pending parent row must appear in samples while remaining invisible to an independent observer, with the main transaction still pending. Per-run objects and pending rows follow normal cleanup. The test creates objects only inside the authorized test schema; it does not create another schema or send a request to an AI service.

`tests/data-generator.test.cjs` runs both real generator hooks with deterministic random values and simulated desktop IPC. The first thirteen cases cover exact quoted schema/table/column names, escaped string values, zero/partial/missing/invalid affected-row counts, interruption after a successful batch, stopping before a third batch, exact final-batch counts, retained rules and explicit retry. PostgreSQL cases verify alternating explicit NULL columns, an entirely NULL row, and excluded disabled/unspecified rules. Generation tests also assert that no commit or rollback IPC is sent.

`tests/helpers/dataGenerator.cjs` provides the same hook harness for real DB integration. Each database suite adds one scenario using real metadata and INSERT execution against a disposable mixed-case table with spaces/dots in its name and columns. PostgreSQL also exercises embedded double quotes. Alternating NULL selections must preserve the correct values and explicit NULLs; unspecified columns retain DB defaults. A second phase uses a real PostgreSQL trigger to suppress the second batch, or removes Oracle's second response count after executing it. Both paths must stop before the third batch and retain an unrelated pending insert. An independent connection sees no pending rows, and explicit cleanup rolls them back. Missing Oracle response counts are simulated at the test boundary; no network outage is induced. These scenarios exercise real hooks and databases; the Electron scenario below separately checks the rendered generator.


Twenty-two further hook cases bring the generator suite to thirty-five cases. They cover exact large and fractional sequences, unsafe legacy numbers, precision overflow, exact random decimal steps, invalid counts/ranges/dates/patterns/choices, atomic file validation, legacy/string file compatibility and metadata preservation. Deferred FileReader callbacks verify table changes, edits, newer reads, generation starts and unmount; read errors permit retry. AI callbacks use the same validator without sending a paid request.

Each real DB suite also creates a disposable numeric table and uses the production generator to insert 9007199254740993 and 9007199254740994, a 0.1/0.3 sequence, and exact random decimal values. A simulated settings-file read supplies the large string inputs. Invalid counts and a zero random step must send no SQL and preserve an unrelated pending insert, invisible to an independent observer.

Both Electron scenarios open Data Generator, enter the large starting value through the actual numeric input and reject a fractional row count without SQL. Changing the count to two must produce one INSERT containing both exact consecutive values. These rendered checks use simulated DB responses; file timing and AI response checks use the hook harness, and actual stored numeric values use the real DB suite.

## Export encoding

`tests/file-encoding.test.cjs` calls the production `save-file` IPC handler with the real Shift-JIS codec and disposable files. It verifies rejection of unrepresentable characters and changed mappings before file creation or overwrite, English/Japanese UTF-8 guidance, successful Japanese/CP932/half-width-kana and literal-question-mark exports, and a UTF-8 retry preserving the original text. Binary output is checked byte for byte. These tests do not use personal export files or a database.

`tests/data-export.test.cjs` drives the actual export component's open/export handlers with the hook harness and mocked desktop IPC. It reads the generated XLSX bytes with the real workbook library to check duplicate/empty labels, header toggles, column order, exact numeric strings, and chunked exports. Clipboard TSV is passed back through the production import parser to check embedded tabs, CR/LF, quotes, empty/whitespace values, and missing/null cells. CSV quoting and header fallbacks are checked too. Failed saves or clipboard writes must retain the dialog without success notifications. These checks do not write personal files or use the OS clipboard, a real Excel application, or a database.

`tests/er-metadata-correctness.test.cjs` covers case-distinct ER table/column names, comments and key flags, schema initialization, cross-schema parent identity, bounded external-parent expansion, inaccessible parent metadata, exact custom-table additions, bound schema values, and preserving the previous diagram/name/choices on failed loads and refreshes. These renderer checks execute real hooks with mocked IPC rather than driving the ER canvas in Electron. The real-DB suite checks mixed-case quoted identifiers and ordered composite foreign-key pairs on both databases, plus equal foreign-key names on separate PostgreSQL tables. Cross-schema fixtures are mocked; the local test grant does not authorize creating another schema.

`tests/git-force-push.test.cjs` uses the production Git handler, two disposable working repositories, and a local bare remote. It verifies that an unseen remote commit rejects a forced push without modifying either history or refreshing the tracking ref, that a previously fetched remote commit can be explicitly replaced, that missing tracking/detached HEAD are refused, and that a non-default branch targets the correct ref. No external remote is contacted.

`tests/atomic-save.test.cjs` invokes the real `save-file` handler with a fault-injected atomic writer and disposable files. Partial writes and failures while opening, setting permissions, flushing, closing or renaming preserve the original file, remove temporary data and permit retry. UTF-8, Shift-JIS and binary creation/replacement are checked byte for byte. Directory protection is checked everywhere; POSIX permission and symbolic-link behavior are tested on non-Windows platforms. These are simulated storage errors, not physical disk-full or power-loss tests.

Table/sidebar transfer regression tests cover real columns named `id`, `__row_id`, and `ORACLE_ROWID`, including exact large-integer strings, plus case-distinct PostgreSQL date columns with independent NULL values. They also verify that output formatting does not mutate input rows. The real-DB suite creates quoted ID/date columns in the dedicated schema and runs both export fetchers against uncommitted data on each database. It checks original ID values and column sets, date separation, and that exports leave inserts uncommitted and invisible to a second connection.

`tests/export-snapshot.test.cjs` exercises the production main-process snapshot service, database IPC cleanup, and renderer fetcher. It checks one main-connection query, sender ownership, read-only validation, chunk bounds, completion/close, idle expiry, destroyed senders, connection replacement/disconnection, and interrupted or failed opens. Table/sidebar tests use the same service through `tests/helpers/exportSnapshot.cjs`; view-hook tests check filters, sorting, exact business IDs, and unpaged export SQL. The export component tests also cover stale/zero/missing counts, exact 5,000-row endings, database mutations between chunks, and fetch/cleanup failures without partial saves or success notifications.

On each real database, an additional integration scenario creates 6,000 disposable rows and makes an uncommitted edit on the main connection. After the first transfer, another connection commits a delete, update, and insert. The export must retain all original IDs and values, include the main connection's pending edit, exclude the later changes, and leave that edit uncommitted and invisible to the observer. This validates a single statement's materialized result; it does not establish bounded-memory behavior for very large exports.

`tests/postgres-query-results.test.cjs` executes the real PostgreSQL client with driver-response doubles and the real SQL-window hook with mocked IPC. It checks SHOW, EXPLAIN, INSERT/UPDATE/DELETE RETURNING, numeric metadata and exact numeric strings, zero-row result columns, independent affected counts, result/console selection, history counts, final-statement results and SQL errors. The PostgreSQL real-DB suite also checks these command results, including a WITH ... UPDATE ... RETURNING statement, preserving uncommitted state and invisibility to a second connection. The renderer checks exercise hooks rather than a real Electron SQL-editor window.

Oracle sidebar preparation tests cover bound schema/table names containing quotes, failed column/metadata/key/count requests, preserving previous targets and closed dialogs after failure, invalid counts, genuine empty tables, tables without primary keys, missing columns, and binary-type restrictions. The real Oracle suite creates an owned disposable table whose quoted name contains an apostrophe, a period, and mixed case; it prepares export/import through the production sidebar module, checks primary-key metadata, fetches and inserts exact large IDs, and verifies that the changes remain uncommitted and invisible to another connection.

`tests/grid-row-identity.test.cjs` covers symbol metadata, spread/JSON behavior, collision-free Oracle ROWID aliases, SQL/query-builder results with duplicate/NULL/zero business IDs, and the actual DataGrid row cache. Real table hooks drive selection, duplication, editing, deletion and refresh on both databases with mocked IPC. Existing row-format tests cover exact-case NULL dates, and record-editor tests use explicit renderer identities. The real-DB suite verifies real columns named `id`, `__row_id`, `ORACLE_ROWID` and the initial ROWID alias candidate, distinct grid identities, targeted cell updates, date separation and uncommitted visibility. Electron sidebar tests supply duplicate business IDs and a dynamic physical ROWID alias while retaining their paging/export/import checks.

The row-identity suite also verifies that Oracle metadata completion after unmount does not launch follow-up queries, and that missing column definitions block both initial and explicit searches. The pagination regression fixture supplies real column definitions for this staged loading path.


`tests/view-data.test.cjs` drives both production view hooks with `tests/helpers/viewData.cjs`. It checks duplicate business IDs and separate grid identities, literal ISO-looking text, typed dates with case-distinct NULL columns, immutable source rows, normal and transposed values, and snapshot exports. Pagination and page-size changes must issue exactly one count/data pair, unchanged pagination must do nothing, filters and sorts must escape quoted column names, and late page responses must not replace newer data.

The real-DB suite creates an owned disposable table and view on each database, checks large business IDs and text timestamps, retrieves later pages and changed page sizes, filters/sorts a special column name (an embedded quote on PostgreSQL, a space on Oracle), exports all matching rows, and verifies pending inserts remain uncommitted and invisible to the observer. The hook harness waits for actual DB completion with a deadline. Electron tests also open a view, check literal IDs/text, and move to its second page with exactly one count/data pair. They close the previous table before opening the view; simultaneous multi-tab layout behavior is outside this scenario.


`tests/table-relations-correctness.test.cjs` uses `tests/helpers/relationData.cjs` to exercise both production relationship hooks. It checks ordered column pairs, names matching JavaScript object properties, bound exact identifiers, quoted add/drop SQL, lookup errors, clearing stale choices, and out-of-order target responses. Real-DB scenarios create owned disposable parent/child tables with mixed case, apostrophes and spaces, add a composite foreign key through the actual hook, verify reversed parent-column order and CASCADE, and drop it through the hook. PostgreSQL additionally creates a second child with the same constraint name and verifies that its columns do not enter the first child's relationship.

The view-data suite also tests failed and invalid counts without a follow-up data query, preserving prior rows/counts, failed metadata loading and retry through Execute, refusing exports without metadata, failed data reads, and a genuine empty view. Electron tests inject a count failure, check the visible error and absence of a data query, then retry successfully through Execute. Failure injection uses simulated IPC; the normal metadata, SQL and relationship DDL paths are additionally exercised on both real databases.


`tests/sequence-safety.test.cjs` uses `tests/helpers/sequenceData.cjs` to drive both production sequence settings hooks, including double state-updater evaluation. It covers exact large/zero/negative integers and limits, direction/type-specific defaults, invalid literals before SQL execution, ALTER-only settings saves, failed ALTER without destructive fallback, exact repeated increment operations, separate/cancelled/unsupported restart, blocked writes after metadata failure, and CREATE for new sequences.

On both real databases, the sequence integration scenario creates a disposable sequence with a large starting value and custom upper bound, adds a table default that depends on it (plus PostgreSQL OWNED BY), and verifies unchanged object identity after ALTER. Another connection issues a number after metadata loading; a settings save must continue numbering rather than rewind it. A database-rejected maximum change must preserve the object and dependent default. Explicit restart is then tested separately. Fixtures are removed at the end; PostgreSQL ownership is detached for deterministic cleanup. Oracle 12 restart rejection is simulated rather than tested against an Oracle 12 server.


`tests/sequence-window.test.cjs` adds twenty-three settings/source regression cases for both databases: local edits across activation and failed reads, stale responses, no-op saves, minimal ALTER with unrelated concurrent changes, explicit same-field conflict review, descending/non-unit restart targets, unknown reference values and range validation. An already-applied external value updates the baseline without another ALTER, and clipboard rejection retains source. Oracle 12/unknown-version restart restrictions are simulated. PostgreSQL DDL cases cover all three integer types and quoted owned columns without issuing numbers.

A second real-DB sequence scenario checks pending DML remains uncommitted after no-op Save, conflict review against a second connection, unrelated changes, descending restart, native dependencies and DDL recreation. Oracle uses an unexecuted procedure for direct dependency lookup; PostgreSQL checks the column default and OWNED BY. Metadata/source inspection must leave the first number unconsumed. All fixtures are disposable and cleaned up.

The Electron scenario edits cache settings, detects an injected external conflict, retries metadata/source failures while retaining input/text, displays dependencies and PostgreSQL ownership, and returns to settings without losing edits. IPC failures and external edits are simulated; SQL semantics and transactions are checked separately against the dedicated real databases.


`tests/postgres-type-safety.test.cjs` uses the production parser/planner and `tests/helpers/typeData.cjs` to drive the real type hook with simulated IPC. Fourteen cases cover quoted/semicolon/backslash labels, comments and dollar quoting, numeric modifiers, malformed or multiple statements, additive-only changes, stale definitions, failed metadata/DDL, Git failure after DB success, and RESTRICT deletion. Unchanged saves issue no DDL.

Two PostgreSQL integration scenarios use the actual type hook, real catalog queries and disposable Git repositories. Enum saves retain object identity, dependent table columns and values, a view and a function; additions produce the expected Git revisions. Unsupported removals and dependency-blocked deletion preserve those objects. Composite additions preserve stored composite values, and a statement containing a valid addition followed by an invalid data type must leave neither attribute added. Electron UI checks open a composite type containing a semicolon in its attribute name, display its source and save it unchanged without issuing DDL. UI responses are simulated; the integration scenarios exercise real SQL and Git. Other PostgreSQL type categories and destructive type migrations are outside the supported editor workflow.


`tests/ddl-editors-safety.test.cjs` drives the real PostgreSQL DDL-batch method and both databases' CHECK/index component handlers using `tests/helpers/ddlEditors.cjs`. It checks pre-DDL commit ordering, complete rollback and retry, invalid/read-only/unknown-state refusal, retiring a connection after failed rollback, literal semicolons and quoted identifiers, and a structured trigger save carrying the loaded definition and original target. Driver failures in the basic suite are simulated. The helper waits for pending IPC requests before interacting with the editor.

Real-DB scenarios create CHECK constraints and ordinary/expression indexes through the actual editors and database IPC on both databases, including a literal `a;b` and quoted case-sensitive column names. They verify CHECK enforcement. On PostgreSQL, a successful trigger is followed by a deliberately failed replacement against a missing target: both the original trigger OID/function definition and original execution behavior must remain, and a subsequent corrected save must work. The composite-type scenario additionally runs the real sidebar lookup against enum/composite/table-row fixtures to verify inclusion and exclusion. Electron UI tests open both composite and enum types from the list, display semicolons in their sources and save unchanged without issuing DDL. The Electron tests use simulated IPC; real trigger replacement and rollback are covered by integration tests. The additional trigger UI scenario opens an existing trigger and submits an unchanged structured save; it does not cover every wizard control or real trace execution.


`tests/trigger-preservation.test.cjs` checks distinct generated functions for same-named triggers, body-only edits retaining the actual function identity/security/settings without trigger recreation, unchanged complex/shared saves, shared-body refusal, stale-definition refusal, unsupported languages, simple enable-mode preservation and exact finite numeric literals. Both real trigger hooks and trace-program generators are used with simulated IPC to verify large integers and decimals, and to refuse invalid inputs before a trace request. Catalog flags are tested against misleading words inside trigger identifiers.

Two PostgreSQL integration scenarios exercise the real hooks, IPC and database. Same-named triggers on separate tables must use distinct functions, editing one must leave the other unchanged, and a deliberately shared function must refuse a body edit while preserving behavior. Existing custom handlers retain their identity, SECURITY DEFINER/search_path attributes, trigger OID, UPDATE OF, WHEN and disabled state. Actual UPDATE statements verify the column/WHEN filters and disabled behavior; unsupported setting changes must preserve both definitions. Ambiguous table-less identities are refused.

An additional scenario on each database loads real column metadata through the trace hook, supplies exact integer/decimal input, and captures the generated trace source before trace execution. It asserts the literals' original digits, then asks the database to parse those literals and compares values exactly (allowing Oracle's omitted leading zero). This verifies input generation and database numeric interpretation, not end-to-end trace instrumentation or a live trace UI session. Fixtures are disposable and removed after each run.


`tests/trigger-identity.test.cjs` verifies exact table-scoped tab identities through the real workspace hook, separate real-Git histories/content/rename/deletion, preservation of old unscoped history, trace-file and AI-conversation isolation, and propagation into coding/debug history targets. These cases run in `npm run check` and `npm run test:git`, using disposable repositories and files; AI requests are simulated and no external Git remote is contacted.

The same suite checks executable references against literal NEW/OLD text, doubled and escaped quotes, Oracle q-quotes, PostgreSQL dollar quotes, nested comments, identifier boundaries, custom aliases and Oracle event predicates. It drives both production generators and verifies source-line mapping. An additional case checks that embedded dollar strings cannot terminate the generated PostgreSQL procedure body.

Each real database additionally executes a token-rewritten procedural block that assigns literal trigger-reference text to a record field and inserts it into a disposable table. It verifies the exact stored text and rollback; PostgreSQL explicitly starts the transaction before DO. This tests rewritten SQL semantics, not the complete live trace instrumentation. PostgreSQL's same-name trigger scenario also archives both actual database definitions into independent real-Git histories. The Electron suite opens two same-named triggers from separate tables, verifies separate tabs and table-specific structured saves, then sends a deletion notification for just one table and verifies the other tab remains. Its IPC responses are simulated.


### Trigger body simulation regressions

The trigger identity suite additionally checks that neither production generator emits synthetic triggering DML for BEFORE, AFTER or INSTEAD OF simulations, including PostgreSQL TRUNCATE, while retaining source-line maps and rollback. Oracle predicate cases cover selected/unselected columns, nested argument expressions, comments, multiline input and malformed syntax left for database diagnostics.

Real-DB scenarios compile and call both generated procedures with disposable tables and live triggers. They assert that each simulated body runs once, the live triggers never fire, the source rows remain unchanged and SQL explicitly inside the simulated body is rolled back. Oracle also checks column predicates through the generated procedure and compares rewritten predicates with native trigger evaluation for different UPDATE column sets, including unchanged-value assignments and lowercase arguments. These scenarios exercise the generated procedures directly; they do not cover the full execute-trace IPC or every trigger-language construct. All owned test objects are cleaned up.

The Electron scenario opens the PostgreSQL trigger trace settings and checks that the body-only simulation explanation is visible before execution. Its IPC responses are simulated.


### Table source fidelity and Git history races

`tests/git-source-fidelity.test.cjs` uses production source generation and the Git-tab hook through `tests/helpers/versionControl.cjs`. It covers precise types, quoted names, named constraints, identity/generated clauses, failed/empty metadata, real Git commits before/after constraint refresh, late success/error responses after another revision is selected, and pending list/content requests after changing objects. The Git tests use disposable local repositories without external remotes and are included in both npm run check and npm run test:git.

A PostgreSQL integration scenario creates a disposable table with numeric precision/scale, arrays, an enum and enum array, a domain, temporal precision, identity/generated columns, quoted names, comments, ordered composite primary/unique/CHECK/foreign-key constraints and a separate expression index. It retrieves source through the actual IPC query path, commits it with the Git-tab hook, replaces only that scenario's own table from the generated statements, compares the resulting source and checks defaults/generated values. It then changes a CHECK constraint, refreshes source and verifies two real Git revisions preserve the respective constraints and exact types. Referenced fixture objects remain until cleanup. This tests ordinary table source, not all pg_dump features or an atomic metadata snapshot during concurrent DDL.

The Electron suite additionally opens a PostgreSQL table Source tab and checks numeric/array types and a CHECK constraint, then refreshes after changing simulated metadata and verifies the new constraint remains visible. IPC is simulated for this screen test; the separate database scenario validates the SQL against PostgreSQL.

The source-refresh screen scenario also returns to Data and verifies cached rows reappear without an extra SQL request. Renderer errors remain test failures, including zero-height grid warnings.


### Exception behavior and trace procedure naming

`tests/trace-semantics.test.cjs` adds ten regression cases across both dialects: declaration-only renaming, exact preservation of literal/comment/identifier text and line counts, missing or unexpected declaration rejection, trigger exception and reraise preservation, compilation-boundary checks in both executors, ordinary PostgreSQL function mode despite literal placeholder text, PostgreSQL stored-wrapper exception handling and both ordinary-program instrumenters. Existing closing-name, numeric-return and generated-program tests also run with the shared naming helper.

A shared real-DB integration scenario runs both actual trace executors with generated trigger procedures and disposable tables. It checks nested handled exceptions (99), reraises caught by an outer handler (77), unhandled exceptions failing without a successful trace save, literal __placeholder__ output, rollback of body INSERTs, clean transaction state and removal of temporary procedures after success/failure. It also compares native stored-function execution with traced execution (66), using the PostgreSQL renderer wrapper and Oracle's ordinary-function instrumenter. Oracle additionally verifies that a failed trace's output does not enter the next trace. Trace storage is replaced by an in-memory sink for this scenario; compilation, execution, output parsing and temporary-object cleanup use the production executors and real databases. Owned fixture objects are removed at the end.


### Record load failures and PostgreSQL custom types

`tests/table-record-editor.test.cjs` checks both editors against failed/rejected requests, deleted rows, ambiguous results and incomplete rows for update/duplicate operations. It checks valid NULL fields, binary typed arrays and empty binary values, and rejects binary display placeholders. `tests/postgres-column-types.test.cjs` covers catalog identity, misleading enum names, exact built-in matching, array/domain exclusion, quoted casts, whitespace preservation and precise numeric input. Sidebar metadata tests continue to assert bound schema/table names against the shared catalog query.

Each database has an integration scenario that simulates a fetch failure, retries with real full text/binary data, duplicates the record, verifies byte equality, distinguishes zero-length binary from NULL, rolls back the copies and rejects both editor actions after the original row has been deleted. PostgreSQL additionally creates mixed-case enum types whose names contain Print, Date and Boolean; real catalog metadata drives record inserts/updates and table/sidebar CSV imports, preserving enum values including surrounding spaces. Those changes remain uncommitted and are rolled back. All owned fixtures are removed.

The Electron scenario opens a PostgreSQL record containing a PrintStatus enum and verifies its original value is shown in a text input. Other Oracle/PostgreSQL screen scenarios remain enabled. This screen test uses simulated IPC; the database integration scenarios test the actual SQL and values.


### Update counts and binary no-op saves

Seven added cases in `tests/table-record-editor.test.cjs` cover dialog input retention and error logs for zero/missing/unexpected counts, inline old-row retention, no SQL for equal binary content, exclusion of unchanged binary columns when changing another field, changed-byte binding, and byte comparisons across hex/typed arrays/ArrayBuffer, view offsets, metadata changes, empty values and invalid representations. Successful mock updates report one affected row.

A shared integration scenario uses two real DB clients and disposable tables with an audit trigger. It verifies that unchanged saves produce no UPDATE or audit event. Another connection changes the binary, then the editor changes only a text field; the new binary remains intact and only actual updates appear in the audit table. After that connection deletes a different target, dialog and inline edits report zero rows and preserve input/display. A separate pending edit remains visible only to the main connection until rollback, confirming that error handling neither commits nor cancels other work. The scenario runs on both Oracle and PostgreSQL and cleans up its owned objects.

The Electron scenario simulates a zero-row save from the PostgreSQL record dialog, verifies the translated error, retained dialog/input, and absence of a follow-up data query. IPC is simulated for the screen check; the separate integration scenario validates the database behavior.

### Literal searches, explicit NULL and deletion outcomes

`tests/table-query-safety.test.cjs` exercises both query builders and production table hooks via `tests/helpers/tableData.cjs`. It checks quoted identifiers, apostrophes, whitespace, literal LIKE `%`/`_`/`!`, exact numeric values, invalid numeric expressions, unsafe operators/sort fragments, zero/unknown deletion counts, retained selection and partial-progress reporting. Shared deletion tests stop before later batches on zero, invalid/missing counts, database errors and rejected IPC calls. The table harness keeps translation identity stable across renders so pending real database requests are not cancelled by its own scheduling.

`tests/table-record-editor.test.cjs` also distinguishes text `null`, explicit NULL and omitted/default fields in PostgreSQL INSERTs. `tests/view-data.test.cjs` verifies literal LIKE construction and rejection of invalid numeric conditions before any query, retaining the previous view results.

The real integration scenario runs in both databases with two connections. It searches literal punctuation and exact decimals, edits a row whose text primary key is `null`, and confirms that a concurrent deletion produces a zero-row notification without cancelling an unrelated pending edit. PostgreSQL additionally encounters a real foreign-key violation on the second DELETE: the first deletion stays pending, the second row remains, confirmed progress is reported and selection is retained. Explicit NULL overrides a default while a blank INSERT field still uses it. Fixtures are registered for reverse-order cleanup on success or failure.

The Electron scenario tests the PostgreSQL **Set NULL** action and its resulting `UPDATE ... SET ... = NULL` after a zero-row failure has retained the dialog. These UI tests use simulated IPC; real SQL execution is covered separately by `test:db`.

### NULL duplication and exact temporal record values

`tests/temporal-values.test.cjs` covers canonical fractional timestamps, timezone offsets, configured calendar formats, Oracle typed projections and raw source values surviving date-only grid formatting and inline edits. Both real record editors must duplicate an original NULL as explicit SQL NULL even when the column has a default, and retain the complete timestamp when the grid displays only its date. Existing tests now distinguish retained NULLs from empty UI input and supply actual column metadata for Oracle export projections.

The real integration scenario runs both table hooks with date-only input/output settings. Oracle uses TIMESTAMP(9), a named-region TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH LOCAL TIME ZONE and a DATE containing time. PostgreSQL uses TIMESTAMP(6), TIMESTAMP WITH TIME ZONE and DATE, including a timestamp in the primary key. It duplicates the row, compares the stored timestamps/NULL/default values, updates a different column using the original full key and exports every fractional digit with a time-bearing format. All writes remain in the dedicated test schema and are rolled back or removed with the fixtures. Other real view, export, binary, transaction and Git scenarios continue to run.

The Electron scenarios exercise the new NULL/date explanations in both dialogs alongside the existing editing and sidebar flows. Raw Oracle SQL precision remains subject to the separate driver mapping described in ARCHITECTURE.md; these tests validate the typed record workflows rather than claiming all native SQL results have nanosecond precision.

### Fractional timestamp searches and TIME-only operations

Three additional cases in `tests/temporal-values.test.cjs` compare both dialects' temporal search SQL with their record-save conversion for equality and range operators, and check PostgreSQL TIME casts, microseconds, offsets and safe quoting of invalid input.

The exact-timestamp real integration scenario now creates a view and checks both table/view filters. Equality must find two rows at the exact fractional timestamp; a lower bound one fractional unit later must find none. Zoned timestamp equality retains the represented time, including Oracle's named region.

A PostgreSQL-only scenario exercises a table with TIME in its primary key plus TIME WITH TIME ZONE. It inserts, duplicates and edits through the production table hook, checks exact microseconds/offsets, performs equality and range searches, loads/searches the real view, and imports through both table and sidebar paths. A deliberately invalid time must leave the dialog input intact and preserve an earlier uncommitted edit. The dedicated fixtures are cleaned up on success and failure.

The Electron scenario includes TIME and TIME WITH TIME ZONE metadata and values. It checks that the editor retains all digits and the offset, has no date calendar for TIME, and sends a changed time as a time-typed cast.

### Table metadata/count failure recovery

`tests/table-query-recovery.test.cjs` drives both production table hooks. Eleven cases cover failed/rejected/empty/invalid metadata, explicit Execute retries without an automatic loop, failed and malformed counts, retained rows/columns/count/page/selection, initial count/data failures, failed metadata reloads, data-read failures, genuine zero results and stale count responses that must not start another query. Count validation includes NULL, booleans, missing/multiple rows, fractions, negative values and unsafe integers. The existing pagination and grid-identity tests retain their guarantees while checking the new staged request order and selection clearing at successful row replacement.

`tests/helpers/tableData.cjs` supports bounded waits for real requests and dispatching reload events. The real database recovery scenario creates a dedicated table, keeps a pending edit, then injects actual invalid-column SQL at the metadata, count and data boundaries. Both database hooks must recover, retain complete previous results on failure and preserve the uncommitted edit as observed from a second connection. No privileges or server settings are changed; only disposable test fixtures are created and cleaned up.

The Electron test fails the first table metadata request in both dialects, verifies that no main query runs, and uses Execute to recover. It then fails a pagination count, verifies that no data query starts and that the first page remains displayed, and retries pagination successfully with one count/data pair. These UI errors use simulated IPC; real SQL error behavior is covered separately by `test:db`.


### View pagination failure recovery

`tests/view-data.test.cjs` covers count/data failures during pagination, retrying the same destination, failed page-size changes, and page retention during failed Execute/sort requests and delayed responses. Frozen prior conditions verify that sorting does not mutate previous React state. The real-view integration scenario injects invalid-column SQL at both query stages, verifies recovery and retained page state, and checks previous sort conditions and pending data. Electron tests verify retained rows and pagination controls after failure and successful retry of the same destination for both databases.


The table recovery tests also freeze prior condition objects before header sorting. Both databases cover ascending/descending order, switching columns, failed counts, retained filter values, and disabled/transposed sorting guards. The real-table recovery scenario verifies frozen prior conditions, actual row ordering, retry after a SQL error, and retained pending edits.

The Electron harness keeps renderer errors as test failures. On a grid resize error it also logs column labels and ancestor element heights/display styles to help diagnose intermittent zero-height warnings. A successful rerun alone does not establish that the layout warning has been fixed.


### Measured grids and language switching

`tests/grid-viewport.test.cjs` verifies deferred mounting for inactive/zero-sized containers, restoration after measurement, retained children across positive-size resizes, observer cleanup, ignored stale callbacks, and synchronous removal before a queued grid measurement. Electron tests retain native ResizeObserver delivery and deliberately queue a MUI measurement behind a viewport collapse to reproduce the race deterministically; the previous implementation fails this assertion. Console errors are forwarded unchanged, with warning-time dimensions and test phase captured for diagnosis. Electron tests exercise English/Japanese/English changes through the real Settings dialog for both databases. They collapse and restore a table viewport, switch repeatedly between Result and Execution Log, and verify retained page/selection without additional SQL. View results retain their page across the same tab switch. Existing refresh checks and a positive-size resize verify that an open export dialog retains its instance. Renderer errors, including grid sizing warnings, remain test failures.


### SQL tuning context fidelity

`tests/sql-tuning-ai-sidebar.test.cjs` covers separate schemas with the same table name, repeated scans, tuple-key collisions involving periods, apostrophes/double quotes in names, exact numeric/array/custom types, constraints, and rejected incomplete PostgreSQL source. Oracle table and index names are checked as bound values. PostgreSQL transaction tests assert the verbose JSON EXPLAIN query retains background isolation, bound parameters and rollback.

The real database suite builds tuning context from an actual plan for a disposable table and index with quoted names in the authorized test schema. PostgreSQL additionally verifies schema output, numeric modifiers, arrays, custom types, constraints and comments. Both database scenarios retain an uncommitted row visible only to the main connection. The AI sidebar callback is captured; no external AI request is made. Cross-schema name collisions are tested with deterministic fixtures without creating or modifying other schemas.


### Plan navigation and incomplete tuning metadata

`tests/explain-navigation.test.cjs` exercises the real parser and click handler with schema mismatches, periods, quotes and Unicode. It verifies that only authoritative table identities emit a quoted navigation request. Index-only, alias-only, missing-identity and internal temporary nodes emit nothing. Oracle transaction tests verify matching statement IDs, row/object association and background-only rollback.

The tuning tests reject failed, rejected and missing-row responses at each metadata stage and distinguish successful empty index lists. Real DB tests inject invalid-column queries into background statistics/index reads, verify that no context is opened until recovery, and preserve pending edits. Electron tests display plans for both DBs and capture the navigation event at the application boundary: table clicks retain the actual schema and dotted name; index/alias clicks emit no event. PostgreSQL selects an execution schema before analysis. No external AI request is made.


### SQL/plan snapshot consistency

`tests/explain-snapshot.test.cjs` uses the real execution and tuning hooks through `tests/helpers/sqlWindow.cjs`. Ten cases cover both databases: edits before/after an awaited response, schema changes, selected text with separate typed binds, the final statement in a script, failed analysis, and invalidation by ordinary execution. Tuning must use captured plan rows even if unrelated display rows are supplied. Missing correspondence stops context creation before any metadata query.

Real DB tests use the same execution harness to analyze a multi-statement script with a bound value, then change editor text/schema and verify that the context still contains the exact analyzed SQL and actual analysis schema. Pending database edits remain untouched. Electron tests edit the SQL after analysis, change the PostgreSQL schema, and capture the normal file-export path entirely in mock IPC; neither external AI nor actual output files are used. Tuning export is verified before navigating to the table screen.


### AI settings loading and draft protection

`tests/ai-settings-loading.test.cjs` drives the production settings hook with deferred IPC responses. Thirteen cases cover failed, missing and rejected loads with retry, outdated startup responses, closing and reopening, saving during refresh, language changes, duplicate saves, save failure with draft retention, and disposal. The English/Japanese cases use the actual translation dictionaries. Saving is checked at the operation boundary as well as through disabled controls.

The Electron suite opens AI settings in both database workspaces, holds the load pending and verifies disabled fields/Save, returns a simulated failure and retries, then edits and saves a model name. AI requests remain forbidden; settings reads/writes are simulated and personal configuration is never used.


### Settings and Oracle stored-editor draft preservation

`tests/editor-draft-preservation.test.cjs` runs thirteen cases through the production hooks. General settings retain edits and the selected tab when parent props, callbacks or external settings change; closing and reopening applies the latest saved values. Reset values also survive parent rendering. Oracle stored-source refreshes preserve the edited text, saved baseline and arguments when DDL retrieval fails or returns empty, missing, NULL, numeric or whitespace-only content. Argument/status failures and IPC rejection also retain the draft. Successful retries clear the load error and restore a valid baseline.

The Electron Oracle scenario opens a procedure, edits the actual CodeMirror document, dispatches the same sidebar compilation notification used by the app, and simulates a failed source fetch. It verifies the unchanged draft, the unsaved marker and a separate error Alert. This failure is simulated without executing compilation or contacting a real database; the Oracle integration suite separately checks the existing real database workflows.


### Oracle package argument readiness and compilation identity

`tests/package-execution-safety.test.cjs` uses the production package hook through `tests/helpers/packageLogic.cjs`. Ten cases cover failed/missing/rejected argument responses, switching targets, delayed responses, retries, parameterless programs, refresh and disposal. Both execution handlers must refuse requests until argument metadata matches the selected owner/package/program. The compilation cases assert exact owner/name/type binds without case conversion.

Two Oracle integration scenarios create disposable quoted and case-distinct procedures and packages. They detect actual compilation errors, repair a quoted procedure and distinguish package specification errors from body errors. The second scenario simulates a metadata interruption, refuses execution, reloads real ALL_ARGUMENTS rows, and executes only the selected program with its own argument signature. It does not run the full live trace flow for this case; unit tests verify blocked trace requests.

The Electron Oracle scenario opens a package body, switches from A to B, receives a simulated B metadata failure, and verifies both execution buttons are disabled. Retry fetches B metadata and ordinary execution sends only B arguments. IPC responses are simulated; no real database or AI service is used by the UI suite.


### Oracle stored compilation target and delimiter boundaries

`tests/oracle-compile-boundary.test.cjs` adds fifteen cases using the actual compile helper and stored hook through `tests/helpers/storedLogic.cjs`. Mismatched names, owners, kinds and quoted case, empty programs and additional SQL are rejected before IPC. Matching existing/new declarations are accepted. Block comments, normal/escaped literals and q/nq quotes retain slash-only lines; leading and trailing comments are preserved while the client delimiter is removed. The compile helper sends one program in one request.

The Oracle integration scenario verifies that refusing a changed target creates no second object, then compiles, reloads and executes a real procedure containing slash-only lines inside a comment and quoted strings. The Electron scenario edits the real source document, refuses a different target, then verifies the complete valid source is submitted once with internal slashes preserved. UI responses are simulated; real SQL behavior is checked by the integration scenario.


### Saved connection rename collisions

Credential storage tests verify conflicting renames in encrypted, session-only and failed-decryption modes. Rejection must preserve the exact settings bytes, both DB/SSH credentials, and make no credential-vault mutations. Reordering still succeeds, deleting B leaves A intact, and ordinary edits/unused-name renames remain supported. A stale original name cannot overwrite an existing destination.

Startup tests invoke the actual sender-checked `save-connection` handler with a real disposable connection store and verify English/Japanese conflict messages without modifying the file. These seven added cases use temporary files and fictional credentials, without connecting to a database or OS keychain.

### Connection form loading and reordering

`tests/login-connections.test.cjs` exercises the real connection component with simulated rendering and IPC. Nine cases cover untouched initial selection, edits/new drafts/save-preference changes during delayed loading, late failures after unmount, successful and failed order writes, rejected requests, immediate duplicate clicks, blocked conflicting operations, and retry using the last confirmed order.

Eight additional component cases cover deletion completion after selection/edit/new/duplicate actions, untouched deletion, failed/rejected deletion with retry, and a new-name conflict that preserves input without connecting. The connection component suite now contains seventeen cases. Deletion checks also verify immediate duplicate-click guards and conflicting-operation blocking.

Credential tests reject new/duplicate name collisions in encrypted, session-only and failed-decryption modes, preserving exact file bytes and both DB/SSH credentials without vault mutations. Main-handler tests verify creation conflicts and deletion storage exceptions in English and Japanese through the real sender-checked IPC boundary.

The Electron suite repeats delayed loading, draft preservation, duplicate clicks, failed order saves and successful retries on the rendered login screen for both database types before connecting to each simulated workspace. It also rejects a new-name collision before connection, exercises failed deletion and retry, and verifies that deleting one record preserves edits to another. These checks use fictional records and do not access personal saved connections, OS credentials or a real database.

Twelve more component cases bring the connection suite to twenty-nine cases. They hold DB connection or schema loading pending to verify duplicate-click prevention and conflicting-operation guards, then verify release after failure/rejection and retry. Oracle setup cases cover an existing path, successful persistence, failed/rejected persistence, settings-load/dialog exceptions, declined selection, canceled dialogs and empty selections. Preparation itself is held pending to check that the guard applies before connecting. Failures must stop before `connect-db` and must not display a cancellation message.

The Electron scenarios hold the actual connection button busy and assert one request despite repeated clicks for both DB types. The Oracle scenario also simulates client-path persistence failure, verifies the localized error and zero DB connection requests, then retries successfully. OS dialogs and DB responses are simulated here; these checks do not certify a particular installed Oracle Thick client or external OS authentication configuration.

Five further login cases bring that suite to thirty-four cases. They verify cleanup after failed/rejected schema reads, a localized warning for rejected/unconfirmed cleanup, cleanup retry before a new connection, and retention of the connection guard while cleanup is pending. Both Electron scenarios fail their first schema read, assert one disconnect and no workspace transition, then reconnect successfully.

`tests/app-connection-lifecycle.test.cjs` adds seven actual-App cases for delayed version successes, failures and rejections from an earlier connection, current-session fallback messages, disconnect invalidation and late rejection after unmount. Version-response races are controlled with deferred IPC promises; these are component-level checks rather than real network fault injection.

Three additional App cases cover rejected/unconfirmed disconnect notification, return to login and duplicate-disconnect prevention with later-session retry. The main-handler safety suite retains a persistently failing client, refuses a new connection while cleanup fails, retries that same client and then permits a new connection after recovery. Both Electron scenarios fail a disconnect, verify the warning and login screen, then reconnect successfully. The UI uses simulated cleanup failure; the main-handler case verifies retained-client behavior directly.

Credential persistence tests add eight cases using temporary files and a failing persistence boundary. Encrypted, session-only and locked DB/SSH credentials and AI API keys must preserve their prior loaded values, exact file bytes and persistence status after failed replacement, clearing or rename; failed new connections cannot seed session credentials. Successful retries must apply the new credentials. Legacy DB and AI migrations must commit no staged memory writes if JSON persistence fails, and must migrate normally after retry. The tests use fictional secrets and do not access the OS keychain or paid AI services.

### Export operation and destination-dialog failures

Ten additional cases in `tests/data-export.test.cjs` bring that suite to twenty-five cases. Actual component handlers are invoked consecutively before rendering to verify one fetch, cleanup and file/clipboard write for CSV, Excel and clipboard formats. Deferred cleanup/write operations keep the guard held. Failed output can be retried. Destination browsing covers rejected, canceled and successful responses, preserves the previous path when appropriate, prevents overlapping browse/export and dismissal, and permits retry. A local-storage write failure must not produce output or leave the guard held.

Both Electron workspace scenarios exercise actual Browse and Export buttons with simulated desktop dialogs and output. They verify a localized browse failure, silent cancellation, successful retry, then one export snapshot/open/close/write despite repeated clicks. The output write remains pending long enough to verify disabled controls. No real file is selected or written by these UI checks.

### Import operation guard

Nine additional cases bring `tests/import-data.test.cjs` to seventeen cases. The real import component and both DB-specific table-transfer implementations must submit only one INSERT despite consecutive handler calls before rendering. Other cases hold clipboard/file reads pending, refuse input changes and dismissal, and verify recovery after settings-storage, clipboard, parsing, DB and FileReader failures or missing CSV selection.

Both Electron scenarios hold clipboard reading and then INSERT completion pending. Repeated Execute clicks must read the clipboard once and submit one INSERT; Escape must retain the dialog, and execution controls must stay disabled until completion. These controlled failure/timing checks use simulated IPC and do not create real rows. The dedicated integration suite separately verifies real Oracle and PostgreSQL import behavior under its existing transaction and cleanup rules.

### Bulk import affected-row confirmation

Sixteen additional cases bring `tests/import-data.test.cjs` to thirty-three cases. All four Oracle/PostgreSQL table/sidebar paths reject zero, partial, missing, negative, fractional, excessive and NaN affected-row counts. Multi-batch cases confirm the accumulated actual count and stop before a third INSERT after an unconfirmed response, database failure or IPC rejection. Successful batches must report exact counts. Actual import-dialog cases retain input and the target on failure and close only after an explicit successful retry. Transfer cases also prevent switching to the log tab on count or SQL errors, keeping the grid footer's dialog mounted. Existing successful transfer fixtures now return their actual affected-row counts.

Each real DB suite adds one scenario covering both table and sidebar imports. PostgreSQL uses a real BEFORE INSERT trigger returning NULL for the second batch. Oracle executes that batch against the real database, then deliberately removes its response count at the test boundary. Both cases must stop before the third batch while retaining an unrelated pending insert. The main connection sees its pending rows, an independent observer sees none, and explicit test cleanup rolls back the changes. This verifies real transaction preservation; Oracle's missing-response case is controlled simulation, not network fault injection.

Both Electron scenarios return zero, partial and missing counts to consecutive explicit retries of the table import. They verify the retained dialog, confirmed-row warning and absence of refresh or further INSERTs. A final exact count closes the dialog normally. These UI response counts are simulated; the sidebar paths are covered by the unit and real DB scenarios above.

### Record submission and insert confirmation

Sixteen further cases in `tests/table-record-editor.test.cjs` cover guarded insert/duplicate/update submissions across recreated editor factories, blocked closing, failed response/rejection followed by retry, and retained drafts for zero, missing, negative, fractional, multiple or invalid affected-row counts. Actual table-hook cases rerender during submission and verify that the public draft setter, closing and another submission remain blocked. Existing temporal/editor integration fixtures supply the shared guard required by the editor context.

Each DB integration suite adds a real-table scenario without a uniqueness constraint. Consecutive submissions must create one row, a later ordinary duplicate must create exactly one more row, and the save state must release correctly. PostgreSQL additionally uses a real BEFORE INSERT trigger returning NULL: the resulting zero-row insert must leave the input open and row count unchanged. Test-created tables, triggers and functions follow normal per-run cleanup.

Both Electron scenarios hold record insertion pending, double-click Submit, and check disabled fields/close controls and Escape prevention. Zero and missing counts must preserve the draft without a refresh; one affected row closes and refreshes normally. These controlled response counts are simulated in UI tests; the PostgreSQL suppression case is also verified against the real DB.

### General settings preservation and save failures

`tests/general-settings.test.cjs` runs the actual App and settings dialog/hook with simulated IPC. Six cases verify preservation of Oracle client path and ER notation, failed/rejected saves with unchanged active settings and retained input, successful retry, duplicate-save and dismissal guards, disabled controls, settings refresh after login setup, and failed reads followed by retry. Temporary themes and languages must not become active on a failed save.

Both Electron workspace scenarios hold a real settings save pending, double-click Save, attempt Escape dismissal, then return failure and verify the open draft and unchanged persisted timeout. A successful retry and reopening must retain the timeout, ER notation and Oracle path. These UI tests use in-memory settings, not the user's settings file. Translation validation also requires nonempty plural forms for record-deletion counts, pending work and successful deletion messages.

### AI proposal review and submission preview

`tests/ai-review.test.cjs` covers the real SQL/stored generation hooks, sidebar interactions and the actual diff component. Cases verify English/Japanese response instructions, deferred one-time application, changed source/schema/object and unmounted targets, trigger source/settings applied together, discarded proposals, hidden legacy diagnostics, editable initial drafts, exact preview/submission equality, changed-preview refusal, clarification-only replies and request switches invalidating captured Apply callbacks. Provider replies are simulated; no paid AI service is contacted.

The sidebar records an editable summary only after successful adoption. `tests/ai-source-history.test.cjs` round-trips it through real temporary history files and rejects invalid adoption data without replacing prior contents. Summary loading preserves a commit draft edited while the load is pending. An additional case uses real source-history persistence, the production Git-tab hook, production Git handlers and a disposable local Git repository to verify the adopted summary becomes the commit message. It runs with the full check and the focused AI-review test command; existing `npm run test:git` continues to cover the separate Git suites. No external push or database compilation is performed by these tests.

The existing Electron suite still covers both DB workspaces. New AI proposal/preview interactions are exercised by the component/hook harness, with the actual diff renderer also rendered to HTML; they are not additional Electron AI scenarios.

### Schema Git review, grouped commits and conflict resolution

`tests/git-review.test.cjs` uses disposable real repositories to verify separate DB/local/HEAD snapshots, grouped source commits, unborn branches, preservation of unrelated staged and working files, stale HEAD/local edit rejection, duplicate/forged path rejection, rejected-commit file/index/HEAD protection, and legacy-source preservation. Actual merge conflicts exercise both source sides, stale content, conflict-marker rejection, individual choices/manual edits, completion as a two-parent commit, changed-index refusal and explicit abort. Hooks that exit without output must not cause false success. No external remote is pushed.

`tests/git-review-ui.test.cjs` runs the actual dialog components with simulated IPC/DB boundaries. It checks cross-category selection, selected DB definition revalidation before writing Git, cancellation and late results, reversed two-revision responses, retained conflict edits after failure and completion only after all resolutions. Source mapping tests retain overload signatures and trigger table identity. These tests run in both `npm run check` and `npm run test:git`.

Each real DB suite also creates its own quoted function, records the definition with real Git, changes the function on the background connection, and records the newly reviewed definition. An earlier main-connection insert remains uncommitted and invisible to a separate observer. This verifies the shared DB-definition path and actual grouped recording; every metadata category is not independently tested by this scenario. The new Git dialog interactions are verified through component harnesses; the existing Electron suite covers the DB workspaces and prior Git/settings operations.


### ER schema persistence, synchronization review and editing history

`tests/er-editor.test.cjs` covers document fingerprints, schema-aware v2 persistence, rejection of unversioned files, missing/blank schemas and unknown versions, independent parallel-relation comparison, column/table synchronization previews, cancellation, stale preview/response rejection, grouped dragging, selection neutrality, undo/redo branches, failed/successful save dirty state, clean close, reversible relation/table deletion, schema restoration and scoped image export. Hook state updaters are evaluated twice to catch mutation-based implementations. Existing ER-history and metadata suites also verify the new review/apply boundary, retry preservation and successfully empty synchronization snapshots.

Both Electron scenarios open the real custom ER editor with isolated in-memory IPC data. They cancel a synchronization review, apply it, undo/redo it, commit the resulting v2 document, and check retained schema and parallel relations. They then export both the custom and automatic ER canvases through the actual HTML-to-image implementation and Electron download handling, verifying PNG signatures. Files are written only in the test's temporary directory and removed during cleanup. No external Git remote or AI service is used. The DB integration suite separately validates exact ER identifiers and composite foreign keys in both dedicated databases.


### Visual query builder regression coverage

`tests/query-builder-editor.test.cjs` exercises ANSI outer joins independent of table order, multiple conditions on the same pair, reversed directions, disconnected components, over ten joins, cycles, exact quoted columns, aggregate ordering and full-document validation. Actual document hooks cover grouped dragging, undo/redo branching, failed/successful saves, cancellation, duplicate save exclusion, reversed/delayed/failed file reads and unmount. Actual DB-specific builder hooks verify duplicate execution exclusion, frozen design state, retry after SQL errors, late responses and retention/formatting of exact timestamp strings. `tests/helpers/queryBuilder.cjs` supplies the shared hook harness and simulated boundaries.

`tests/query-builder-ai-review.test.cjs` verifies that replies become a review, confirmation fetches fresh definitions and applies once, and discard, design edits, changed DB metadata, metadata failures and disposal cannot apply. Clarifications leave the design alone and every new request reloads definitions. Paid AI services are not contacted.

Each real-DB suite creates three disposable tables and executes the generated composite-key LEFT/RIGHT joins, reordered tables, quoted columns, grouped SUM ordering and explicit cross components. Oracle uses a quoted column containing a space; PostgreSQL additionally exercises an embedded double quote. See [Oracle's identifier restriction](https://docs.oracle.com/en/error-help/db/ora-25716/). All fixture rows and tables follow the existing rollback and cleanup rules.

Both Electron scenarios import a current-format builder document, edit a condition, undo/redo, simulate a failed file write and successful retry, and inspect the persisted database type. They enable an isolated mock AI provider through the real settings dialog, submit one in-process mock request, review the SQL/settings, apply, undo and redo, then double-click Execute while its response is pending. The resulting nanosecond timestamp text is retained in the grid. The actual SQL-result viewport is collapsed behind a queued MUI frame and restored without a second SQL request. HTTP(S) requests remain blocked, no real AI endpoint is used, and file writes are mocked.


### SQL window execution and file actions

`tests/sql-window-workflow.test.cjs` covers separate string/decimal/date binds, invalid-input rejection before any statement, quoted/comment boundaries, exact DDL schemas, one retained row result after a later failure, a hundred SELECT statements followed by DML retaining only the latest rows and a log entry per statement, duplicate execution, stopping pending scripts, unmount handling, sender/connection ownership and serialized history reads/additions/clears. `tests/sql-files.test.cjs` verifies that mounting/editing/closing performs no automatic file operations. Simulated dialogs exercise Save as destination selection on every invocation, cancellation, write failure, duplicate requests, edits during saving, late reads and unmount handling. Native-selection tests use a temporary SQL file to check UTF-8 BOM removal, cancellation and missing-file errors. Existing execution-plan and PostgreSQL-result tests also use the new batch boundary.

Each dedicated DB suite executes the actual SQL-window hooks through the database IPC handlers. Exact decimals, quoted input text and offset timestamps are verified without value interpolation. Another scenario retains a successful SELECT and uncommitted INSERT after a later invalid statement, verifies observer isolation, and rejects another statement after cancellation between requests. The pre-existing actual cancellation tests continue to exercise database interruption. The execution-plan scenario now passes separate numeric binds through both real drivers.

Both production Electron scenarios open a SQL file, run a script containing an error, open the single Result tab to see the preceding successful row result, assert no numbered result buttons, retry a failed file save using Save as, and stop a pending statement before the following statement starts. IPC/file responses are in-memory mocks and the Electron profile is temporary; these scenarios never overwrite personal SQL files. They also assert that Open/Save as use icons with tooltips in the existing execution toolbar and reject any attempt to access removed draft channels. Table-to-SQL navigation also verifies that hidden data grids do not emit measurement warnings. Real OS file-dialog interaction is not automated by these scenarios.

The Electron SQL/query-builder scenarios assert that edits do not produce saved/unsaved status text, closing an edited SQL tab requires no file-save confirmation and hidden table panels stop rendering their grids, and file write failures retain the editor content. Query-builder AI-button height is compared with the adjacent toolbar buttons using actual element rectangles for both databases. Undo/redo is verified through field values and aggregation selections rather than saved-state labels. ER saved-state checks are retained.

The query-builder Electron scenario checks that instructions appear inside the empty canvas and outside the action header, and disappear after loading a single table. It verifies icon-only Undo/Redo/Read/Save controls, icons on Clear/Execute, and actual tooltip display for all six controls, including disabled actions. Existing interactions continue to verify Undo/Redo, failed/successful saving, AI review and execution. Both database workspaces are exercised.

Custom ER addition coverage verifies TABLE/VIEW selection, exact case, duplicates, schema rejection and atomic failure preservation in the hook tests. The real DB ER scenario additionally creates a disposable view, lists it through the shared object repository and reads its exact column names through ER metadata in both databases. The production Electron scenarios use the actual shared picker: they check two allowed categories, 100 first-page rows, the next page, an already-added disabled object, preserved table selection while switching to views, addition of both selected objects, and the two action tooltips. ER and data-generator pickers fix the schema to their owning window; the existing query-builder picker stays configurable.

The data-generator Electron scenarios open the table-selection button, verify that TABLE is the only available category, inspect a 100-row first page, select a different table on the next page and confirm that only one selection remains. The selected table loads its existing generation rules. Both database scenarios verify the shortened Execute label and explanatory tooltip before the existing invalid-count, exact-number and generation checks. Generator hook fixtures also assert that initialization does not retrieve an unpaged table list. DB fixtures wait for schema initialization before selecting their disposable target through the existing hook API.

Generator Electron checks open the picker and wait for TABLE to be preselected and the first 100 rows to appear without category interaction. After choosing a table on the second page, they reopen the dialog and verify that it returns to the first 100 rows; cancelling preserves the chosen generation target. Both Oracle and PostgreSQL scenarios cover this path.


Data-generator workflow coverage includes twelve additional hook cases (64 total in `tests/data-generator.test.cjs`): explicit NULL versus unspecified/default columns, previews without writes, exact preview reuse with uniqueness continued into later rows, invalidation after edits, stop after a pending batch, unmount during failure, and corrected inline validation. Both real DB generator scenarios additionally preview twelve rows, verify the first ten inputs against stored values and defaults, and stop after a real 500-row batch. An observer sees no pending rows; no automatic commit/rollback is requested and cleanup explicitly rolls back. Both production Electron scenarios verify disabled Execute plus inline count feedback, a two-row preview without writes, execution of the displayed exact integers, and an operable stop button while the first batch is held. Mocked UI responses cover interaction; the dedicated DB suites verify stored values and transaction visibility.


Sidebar coverage includes ten additional cases in `tests/sidebar-categories.test.cjs`: refresh failure with retained rows, initial failure versus empty success, literal bound search values and debounce guards, next-page failure/retry and duplicate-request prevention for both databases, full selection keys, and signature-preserving routine menu opening. Oracle query-builder assertions verify bound original schema/filter values and explicit LIKE escaping. The PostgreSQL DB metadata helper can retrieve table categories as well as types.

Both real DB suites create disposable mixed-case table names containing `_`, `%` and `!`, search them case-insensitively through the production sidebar query path, and reject a wildcard-like decoy. All listing requests must use background IPC; an earlier INSERT remains pending and invisible to an independent observer until cleanup rollback. Oracle case-sensitive schema binding is checked by the query contract fixtures without creating additional database users.

The production Electron sidebar scenarios additionally verify unique click selection, keyboard focus movement, left/right category expansion, Enter opening, Shift+F10 menus, visible retained rows during a held refresh, retry after its failure, loaded counts, bound special-character search and clearing. These use deterministic IPC responses; real DB scenarios separately validate SQL semantics. No external AI or remote Git service is involved.
The PostgreSQL Electron scenario also right-clicks one of two same-named functions with different signatures, verifies that only the selected overload is highlighted, and inspects the menu without invoking an ambiguous DROP.


Table-window coverage adds `tests/table-window-resources.test.cjs` with eight cases for both DB adapters: genuine empty statistics without refetch, atomic retention after partial statistics failure and explicit retry, source retention plus out-of-order response rejection, and exact schema/table event targeting. Existing event fixtures now use the qualified payload. Two query-builder cases verify composite-key ordering, quoted keys and missing tie breakers; the existing sort assertions include physical fallbacks. A grid case verifies that NULL markers change rendering only, preserving formatter output and literal NULL/empty-string distinctions.

Two table-recovery cases verify draft/applied condition separation through successful and failed searches, page retrieval and actual export SQL construction, plus unrelated-schema event rejection. Both real DB suites additionally create a disposable table inserted in reverse key order, page through duplicate sort values, retain a draft filter while paging the displayed results, and verify that a pending insert remains invisible to an observer. Dedicated test objects are cleaned up normally.

The production Electron table scenarios check the pending-condition message and its disappearance after reverting input, actual NULL markers, retained statistics after partial failure and Retry, retained source text after a failed refresh and Retry, and grid visibility when leaving statistics. Existing PostgreSQL source-generation and cached-data checks remain in place. No external AI request or remote Git push is used.


Index-window coverage adds `tests/index-window.test.cjs` with fifteen cases. The real Oracle/PostgreSQL hooks must retain native source clauses, bind exact metadata identities, block actions after initial/refresh failures, recover through Retry, clear stale columns after target changes while preserving same-target selection, reorder unique keys consistently with CREATE SQL, and reread dependencies before deletion. Tests verify actual constraint names, referenced constraints, changed definitions and unknown reference counts. The DDL hook harness exposes a replaceable confirmation callback for deterministic destructive-action boundaries.

Each DB suite creates a disposable expression index and a separately named primary key. The PostgreSQL definition includes DESC, INCLUDE and a predicate; Oracle uses DBMS_METADATA and verifies source reloading after switching visibility to INVISIBLE. The production index hook deletes the ordinary expression index, then refuses deletion while a foreign key references the primary constraint. After the temporary foreign key table is removed, PostgreSQL drops the actual constraint while Oracle keeps protecting its constraint-backed index. Git IPC in this specific scenario is simulated; real local Git remains covered by its existing suites. Dedicated schema objects are cleaned up normally.

Both production Electron scenarios open the new-index window, inspect TABLE-only 100-row pages and a radio-selected next-page table, add/reorder keys with a button and Alt+Down, then open an existing index with a simulated first-load failure. They verify disabled actions, successful Retry, preserved native source clauses, and English statistics-menu text. Returning from hidden statistics must not produce grid-size errors. No real AI requests or external Git pushes occur.

### Trigger window preservation and recovery

`tests/trigger-window.test.cjs` covers Oracle bound metadata reads, quoted header keywords, preservation of WHEN/UPDATE OF/aliases/ordering and disabled state, unsupported read-only forms, exact quoted creation names, stale-definition rejection, main-connection reservation/read-only mode, both windows' failed refresh recovery and preserved drafts, target invalidation, reversed definition/column responses, column-fetch failures and PostgreSQL function/condition summaries. The AI screen callback test also verifies that existing settings cannot be overwritten by a proposal. These use controlled IPC/catalog boundaries; they do not contact an AI provider.

The Oracle real DB suite creates an ordered, disabled trigger with aliases, a WHEN condition and a quoted UPDATE OF column. It saves an edited body through the actual window hook and IPC handler, rejects an old definition, and compares stored attributes. Actual updates verify disabled behavior and, after explicit enable, column/WHEN filtering and the edited body. It also creates a trigger containing an apostrophe in its name, rejects duplicate creation without replacement, and checks actual insert behavior. PostgreSQL retains the real WHEN/UPDATE OF/function/security/state preservation and shared-function tests. All objects belong to the run's disposable test schema and are cleaned up.

The production-build Electron suite checks Oracle settings, structured save, failed source refresh with blocked save and Retry, PostgreSQL condition/function summaries, and both DBs' trigger target pickers with an initial 100 objects, the next page, selection, target reset and switching to VIEW. Electron IPC is simulated; this is separate from real DB verification. Oracle integration was run on 23.26 and PostgreSQL on 16.15; Oracle 12-specific runtime behavior is not verified by that environment.

Oracle trace tests additionally use a mixed-case table name containing an apostrophe, and unit checks cover quoted schema/column names and escaped diagnostic literals in the generated program.

### View window saves, recovery and information

`tests/view-window.test.cjs` and `tests/helpers/viewEditor.cjs` exercise the shared view editor, tokenizer-based target validation, escaped identifiers and literal separators, refused alternative targets and statement batches, failed refresh preservation, successful retry retention of existing dirty drafts, synchronous duplicate-operation guards, source/Git snapshot consistency, failed DDL, main-connection deletion, Oracle FORCE diagnostics and lazy data revision refresh with compatible filters. They also check bound dependency metadata, metadata failure/retry, reversed responses and cache invalidation after successful Oracle DDL when fetching diagnostics fails. Existing Git/view identity/source-state tests use successful source loading and the new bound catalog query. The shared editable-source behavior is covered through both its own regression tests and the real view editor hook.

Both real DB suites create disposable quoted tables, a view and a dependent view. Actual window hooks save an added column, data hooks reload metadata/results and retain a compatible filter, and catalog queries verify direct references/dependents. Another target is rejected without DDL. Invalid definitions exercise native PostgreSQL error positions and Oracle FORCE/ALL_ERRORS diagnostics. The new Git calls in this scenario are simulated; the existing real-Git scenarios remain separate. All DB objects are cleaned up in reverse dependency order. The full DB run also caught and fixed apostrophe escaping in PostgreSQL trigger simulation TG_TABLE_NAME/TG_TABLE_SCHEMA literals; that existing real trace test remains enabled with the quoted name.

The production-build Electron suite opens each real view window with simulated IPC. It checks refused target changes without DDL, retained edits after source refresh failure, disabled save until Retry succeeds, save/data-column refresh and Information-tab columns/dependency headings. Real DB tests use the configured dedicated environment; Electron tests do not contact it or any paid AI service. Oracle 12-specific runtime verification and Windows/Linux GUI execution are not provided by the local macOS/Oracle 23/PostgreSQL 16 run.


### Procedure/function windows

`tests/routine-window.test.cjs` covers explicit defaults, automatic NULL for missing/empty numeric/date/text inputs, preserved whitespace and literal null text, INOUT numeric validation, catalog default expression splitting, Unicode/body-context diagnostics, leading Oracle comment offsets, failed metadata operation blocking, retained dirty drafts, successful retry and reversed load responses. Both real hooks also forward the selected modes to execution and trace; PostgreSQL generated trace assignments are checked and renderer-level blanket rollback is forbidden. Existing compiler, precision and trace-return tests use the readiness and generated-bind contracts.

The dedicated DB suites execute explicit defaults, NULL, automatic NULL for empty inputs, whitespace and Japanese arguments through the actual window hooks. They verify exact routine metadata and a dependent view, compile with a pending main transaction and confirm the existing DDL commit policy using an independent connection, check native diagnostic positions with leading comments, then repair the definition. Oracle also executes quoted formal argument names and verifies the original OUT name/value. PostgreSQL adds an overload, verifies default omission is refused, then verifies an explicit typed value still selects the correct overload. The production-build Electron suite verifies failed-load blocking/retry with retained edits, actual argument-mode selection/execution and the Information tab for both DBs. Its IPC and Git replies are simulated; real DB suites use the dedicated environment and do not send paid AI requests.


### Oracle package windows and overload resolution

`tests/oracle-package-program.test.cjs` checks token-based package renaming with quoted, apostrophe and Japanese identifiers, preserved comments/literals, schema-qualified self references and unchanged other-schema references. It verifies typed invocation and OUT assignment, bound identity revalidation, rejected stale/missing/unsupported/ambiguous-default metadata, warning/error separation, original editor offsets, single-program compilation, overload picker identities, scalar numeric validation and background trace-freshness reads.

`tests/package-execution-safety.test.cjs` exercises the actual hook with failed/missing/rejected argument metadata, parameterless routines, stale/disposed argument responses, dirty definition recovery, compile/execution blocking, trace input modes, absence of renderer rollback, reversed definition responses, edits during loading and unsupported composite arguments. The numeric-input, package-source-loading and trace-closing-name tests continue to run against the revised contracts.

The dedicated Oracle suite creates a disposable package with NUMBER/VARCHAR2 overloads, a defaulted function and quoted formal names. Actual window execution and the real trace executor call both overloads using the same textual input, distinguish default/NULL/whitespace, preserve a literal containing the original package name, reject unsaved trace input, and return quoted OUT names. A dependent view is visible in package information. Main-connection compilation commits prior pending work as observed from another connection; invalid compilation with leading comments maps to the editor line, blocks execution, and recovers after repair. The trace executor's SQL runs on the real DB; only trace-history persistence is replaced in this scenario so personal history files are untouched. Temporary trace packages and test-created schema objects are cleaned up.

The production-build Electron suite uses simulated IPC to select a different package member, fail/retry its metadata, select NULL and execute the structured package/member/ID request, then inspect package status, signatures and dependencies. Local verification uses macOS, Oracle 23 and PostgreSQL 16. Oracle 12 and Windows/Linux GUI runtime checks remain outside that local run.


### TYPE windows, change review and metadata

`tests/type-window.test.cjs` runs actual type hooks for both DBs. It verifies failed-read operation blocking, retained drafts/baselines, retry, reversed responses and edits during loading. Oracle cases reject another schema/name, TYPE BODY and statement batches, preserve slash-containing quoted text/comments, prevent Git recording after native diagnostic errors or diagnostic-read failure, separate warnings, record the actual successful definition, and align warning markers with canonical source after leading editor comments disappear. PostgreSQL cases cover preview/cancel without DDL, live-plan revalidation, duplicate-confirmation protection, partial-success status and retrying only remaining additions. Generated ALTER positions map only unambiguous tokens to the original Unicode source. Existing PostgreSQL safety tests explicitly confirm review plans and continue to verify non-destructive ALTER behavior, Git failures and RESTRICT deletion.

The real DB suites create a disposable quoted type and a real local Git repository. Failed/retried metadata reads preserve the actual editor draft. Oracle rejects a different target and a batch before DDL, reports an invalid method return type without Git recording, then repairs and records the actual definition. Information reads cover object attributes/methods, a dependent table, a VARRAY element and separate invalid TYPE BODY source/diagnostics. PostgreSQL executes the first ENUM addition, makes the second fail through real invalid ALTER SQL, then reviews and executes only the remaining change. An existing composite-type test uses the real IPC error-position response for a missing datatype and verifies the editor line plus statement-level atomicity. Successful definitions are checked in actual Git history. Run-created schema objects and repositories are cleaned up.

The production-build Electron suite uses simulated IPC for TYPE interactions: Oracle target rejection, dirty-source refresh failure/retry, repaired compilation and Information with TYPE BODY diagnostics; PostgreSQL unchanged-save behavior, preview cancellation, partial failure, remaining-change review/retry, and ordered ENUM/dependency information. Local runtime coverage uses macOS, Oracle 23 and PostgreSQL 16; Oracle 12 and Windows/Linux GUI checks are not supplied by that local run.


### Oracle synonyms

`tests/synonym-window.test.cjs` uses `tests/helpers/synonymData.cjs` to run the production hook and definition helpers with controlled IPC. Twenty cases cover exact names and editionability, plain CREATE/collision refusal, invalid identifiers and database links before any request, failed/missing metadata, fixed existing identity, no-op saves, stale responses, activation/retry with edits, native source versus planned SQL, clipboard failure, concurrent target review, explicit discard, duplicate Execute prevention, changed-definition deletion protection, PUBLIC confirmation, remote inspection opt-in, missing versus invisible targets and local navigation.

The Oracle integration suite creates randomly named tables and an apostrophe-containing mixed-case synonym. It checks native DDL, no-op execution with pending DML invisible to a second connection, actual concurrent target changes, explicit review, direct dependencies, a not-yet-created target, existing-name refusal and synonym deletion without deleting the target. A synonym referencing an unavailable test database link is inspected locally without following the link. All created fixtures are removed. PUBLIC mutation and actual remote-link connectivity are simulated only; the test does not grant privileges or connect to an external database.

The Electron scenario starts with a failed synonym metadata read, verifies disabled mutation, retries, checks the fixed name and no-op execution, reviews an external change, retains draft input after another failure, selects from page two of the 100-row picker, distinguishes saved/planned source, retries failed source loading and opens a visible local target from Information. The picker is the shared component used by other object screens; native SQL behavior is covered separately by the Oracle integration test.


### Materialized view windows

`tests/mview-window.test.cjs` and `tests/helpers/mviewData.cjs` exercise the production common hook and SQL/metadata helpers. Nineteen cases cover initial/refresh failures, blocked mutations, source/edit preservation, stale responses, fixed existing identities, refresh with an unsaved rename, duplicate clicks, changed object IDs, exact saved DDL/options, dependencies, no-op/minimal Oracle ALTER, conflict review, shared schedule protection, invalid query/date expressions, Oracle version restrictions, PostgreSQL population/unique-index gating and transaction completion. Failed Git commits are retried without repeating CREATE/ALTER; rename retry skips an already completed Git rename. Pending PostgreSQL refresh must issue no subsequent background read until the transaction ends.

Both real-DB integration suites create disposable base tables and apostrophe-containing materialized view names through the actual hook, with an isolated real Git repository. They verify exact source/indexes, metadata reads and no-op saves preserve pending base-table edits, ordinary refresh results, direct dependencies and refresh with a separate rename candidate. Oracle additionally verifies minimal ALTER and native CREATE DDL in Git; PostgreSQL verifies WITH NO DATA, eligible concurrent refresh, source recreation with a renamed index and actual rename/Git history. Refresh with pending edits checks Oracle's commit of earlier DML and PostgreSQL's retained transaction/observer invisibility followed by rollback and metadata restoration. All owned fixtures are cleaned up.

Electron tests use production renderer builds with controlled IPC for each database. They cover failed initial reads and retry, fixed details identity, no-op/minimal settings saves, PostgreSQL unpopulated guidance and concurrent eligibility, refresh double-click suppression and saved-target use despite an unsaved rename, Information dependencies and complete DDL in Version Control. Failures and version limits are simulated; native SQL/transaction/Git behavior is checked separately in the real-DB suite. Oracle 12.1 restrictions are simulated rather than verified against a 12.1 server.

The numeric trigger trace integration step commits the hook metadata/event-callback effects, verifies tracing is enabled, and verifies the trace settings dialog and both column definitions before entering values. This models the enabled UI interaction rather than calling a handler while its metadata callback is still stale.

### Oracle materialized view logs

`tests/mview-log-window.test.cjs` uses `tests/helpers/mviewLogData.cjs` to exercise the production hook and definition reader. Cases cover exact quoted/comma-containing filter names, native DDL parsing without system-column guessing, key/type/SCN validation, forbidden removals, metadata/DDL failures and retry with edits, missing logs, saved versus pending source, no-op saves without any IPC, minimal ALTER including EXCLUDING NEW VALUES, definition/object conflicts, duplicate clicks, stale responses, target changes, existing-log collisions, clipboard rejection and delete cancellation.

The Oracle integration suite creates a disposable master table and log through the actual hook. It checks native source and quoted filter columns, a no-op save with pending DML invisible to another connection, column additions and INCLUDING/EXCLUDING changes. A dependent primary-key materialized view is fast-refreshed after INSERT, UPDATE and DELETE; physical DMLTYPE$$ records and resulting view values are checked. Concurrent external changes block ALTER. Normal DML allocation of deferred log storage does not cause a false settings conflict. The test drops the dependent view, deletes the log through the hook, recreates a ROWID-only log with an explicit primary-key column and checks that column is retained. It also checks ROWID defaults for a table without a primary key and COMMIT SCN rejection for a LOB table. Run-owned MBT_ objects are cleaned up on success or failure. No grants or server configuration changes are made.

The production Electron scenario checks failed initial metadata, blocked mutation, Retry, disabled no-op Execute, pending EXCLUDING versus unchanged saved native DDL, minimal execution, purge information, empty-log guidance and the TABLE-only picker with existing logs disabled and page-two selection. IPC is simulated for the UI; SQL, DML capture and fast refresh are verified separately against Oracle. Oracle 12-specific behavior, object-table logging and asynchronous purge scheduling are not exercised against a native 12 server.

### Oracle database links

`tests/db-link-window.test.cjs` and `tests/helpers/dbLinkData.cjs` exercise the production hook, preview helper, main-process service and disposable-session client method. Fifteen cases cover password masking in source/copies/logs/errors, exact usernames and escaped connect strings, multiline descriptors and multibyte limits, owner/read-only restrictions, unsupported authentication, missing/conflicting metadata, no-op saves without IPC, ALTER without DROP, recreation/deletion cancellation, failed DROP, partial recreation and explicit recovery, replacement-name collisions, duplicate clicks, stale responses, clipboard failure and successful DDL followed by failed metadata reads without repeated DDL. The production connection-test method is checked for independent session ownership, timeout and cleanup on both success and failure.

The Oracle integration suite creates only random MBT_ private links pointing back to the same dedicated database (`127.0.0.1:1521/<configured service>` as resolved inside the Oracle server). It verifies create/native metadata, explicit connection testing with pending main DML invisible to an observer, unchanged-save behavior, password updates without recreation, existing-name refusal, real authentication failure/recovery, an injected native CREATE syntax failure after an approved DROP, explicit recreation retry and deletion. Connected-user and shared links are inspected as read-only without connecting through them. Owned links are registered for cleanup, including failed creation attempts and unsupported-format fixtures. The suite does not grant privileges or modify another account, PUBLIC link or external database. Missing CREATE/ALTER privileges fail instead of being skipped.

The Oracle CI job prepares CREATE/ALTER DATABASE LINK privileges for its disposable service account before the integration run, using the disposable service's administrator. This preparation is confined to the GitHub service container and is not run by `npm run test:db` against personal environments.

The production Electron scenario uses controlled IPC to verify initial failure/Retry, mutation gating, fixed identity, masked previews and console after password input, single ALTER and connection-test requests under double-clicks, cleared passwords, saved-source versus pending fields, Information, cancelled recreation and explicit retry after partial failure. No real credentials or external databases are used by this scenario. Native SQL and loopback networking are tested separately above. PUBLIC mutation/shadowing and unconfirmed authentication are simulated; Oracle 12 and heterogeneous remote databases are not covered by the native run.

The existing table pagination integration scenario waits for the initial 50-row result as well as completed structure loading before manually fetching sorted pages. This prevents a test action from being discarded by the initial search's busy guard.

### Oracle directory management

`tests/directory-window.test.cjs` uses the production renderer helper, main-process directory service and `tests/helpers/directoryData.cjs` hook harness. Thirteen cases cover quoted/case-sensitive names and apostrophe paths, input limits, new-name collision refusal, no-op paths, read-only validation, type-constrained grants, labeled visibility fallback, failed reads without fabricated empty rights, role/PUBLIC recipients, grantors/grant options, unconfirmed-recipient protection, grant/revoke generation, mixed-grantor restrictions, object conflicts, failure/retry with selection, reversed responses, cancellation, duplicate clicks, completed DDL with failed metadata reload, and repeated selection/filter restoration without invalidating loaded rights.

The native Oracle scenario creates only an approved random MBT_ directory definition and an isolated pending-data table in the dedicated test schema. It uses an intentionally nonexistent synthetic path and never creates, reads, writes, moves or deletes OS folders/files. Through the actual hook and IPC it verifies plain CREATE, exact quoted names and apostrophe paths, automatic READ/WRITE/EXECUTE grants, unchanged-object identity and retained grants during path replacement, collision refusal, concurrent-definition rejection and explicit reload/review, and DROP with cleanup. Reads and already-satisfied grant requests preserve pending main-session data; actual CREATE is checked for its implicit commit using an independent observer. The pending-data table is separate from fixtures used by later scenarios. Only run-owned global directory definitions are deleted. A failed CREATE may leave no definition; cleanup accepts ORA-04043 only for a registered owned DIRECTORY name.

No real grants to other users, roles or PUBLIC are added/removed by the native scenario. Those mutation paths and limited catalog visibility are covered with controlled query/IPC tests. The tests never alter existing server directories or grant system privileges in a personal environment. The Oracle GitHub job prepares CREATE ANY DIRECTORY and DROP ANY DIRECTORY only in its disposable service alongside the link-test privileges. Oracle 12, OS access and PDB common/inherited-directory behavior remain outside the native coverage.

Electron exercises the production DIRECTORY screen: failed initial load and disabled creation, Retry, stable selection, direct grants with role/PUBLIC rows and protected foreign grantors, failed privilege reads and retry, path-change cancellation and apostrophe preservation, a successful grant followed by refreshed check state, grant-option details and current-session information. The UI uses mocked IPC; native DDL and transaction behavior are verified separately as above.

### Oracle table-column constraint identity

The native Oracle regression scenario loads tables with exactly `before`, `after` and `meo` columns, both without a primary key and with an ordered composite primary key. A read-only CTE extends the real constraint catalog with synthetic primary-key rows in two other owners that share a local CHECK constraint name. It creates no other schemas or objects outside the dedicated schema. The production data-tab hook must load the rows, leave non-key columns unmarked and retain composite-key positions. Against the same fixture, the previous constraint-name-only join must raise ORA-01427. The scenario also checks that background metadata reads preserve uncommitted data and that an independent connection cannot see it. Run with `MONABASE_TEST_DATABASES=oracle` and the usual explicit write opt-in.

### Definition metadata regression coverage

`tests/table-definition-metadata.test.cjs` runs the production structure hooks. It checks stable owner/name identities for same-named Oracle indexes and triggers, exact names with surrounding spaces, owner-specific ALTER/DROP and Git/sidebar notifications, PostgreSQL composite/first-key positions, INCLUDE separation, expression order and both function-list SQL paths. `tests/oracle-full-ddl.test.cjs` additionally verifies that same-named indexes/triggers in different owners are fetched with each object's own owner.

The native scenario in both dedicated databases loads a three-column table with an ordered composite primary key through the actual data and structure hooks. PostgreSQL includes a nullable INCLUDE column and an expression index, verifying key membership/order and full expression/INCLUDE display. A read-only catalog CTE supplies another `trigger` type name to both production function-list paths, without creating or modifying another schema. Oracle verifies real index/trigger owners and complete table DDL retrieval. Both databases preserve pending data and an independent connection cannot see it. The run removes only its random MBT_ objects. Cross-owner Oracle mutation is simulated, not performed on another user's objects.

Electron opens the production structure tab with mocked metadata. Oracle displays owners for same-named indexes/triggers and emits the correct owner on double-click. These navigation events are captured before opening another screen. PostgreSQL displays ordered index expressions and INCLUDE annotations. Existing native-DDL and main/background transaction tests remain separate from these UI mocks.

### Immediate table-opening indicator

`tests/table-opening.test.cjs` exercises the production opening hook, paint barrier and desktop loading scopes. Eight cases cover loader-before-mount ordering, the two-frame handoff, another pending operation, idempotent/stale releases after reset, unmount before opening, suspended-frame fallback and thrown opens, and both databases' first metadata wait/failure/unmount paths. Existing identity, row-selection and pagination tests stub the paint boundary while retaining their original assertions.

Electron holds the initial table metadata response and verifies that the full-screen loader is already visible at the first background request and covers the viewport. It then releases a simulated failure and exercises normal retry and data loading in both workspaces. The native table-hook harness skips only the browser paint wait and uses the same real SQL paths in the dedicated databases; it does not claim to test browser rendering.

### Blank routine arguments and compact coding buttons

The shared argument-builder tests verify that missing/empty fields become NULL, numeric emptiness is accepted, explicit database defaults omit the argument, and whitespace/literal null text remain values. The actual Oracle/PostgreSQL routine hooks and Oracle package hook send blank arguments as NULL through both normal and trace requests without selecting NULL. Native routine tests exercise the same blank-to-NULL behavior in both databases, and the native Oracle package test checks it in normal execution and trace execution.

Electron verifies that optional arguments retain the value/default chooser without a NULL option, while a required package argument has no chooser. Blank execution sends a real null in the mocked IPC payload. It also measures the coding-request AI button at 24px in both routine windows and the Oracle package window. No real AI request is sent.

### Oracle lock management

`tests/lock-window.test.cjs` runs the production lock service, structure IPC handlers and `useLockTab` with `tests/helpers/lockData.cjs`. Thirteen cases check stable resource/session identities, query joins and time semantics, readonly/privilege/managed/system protection, selected-session revalidation without implicit blocker termination, ORA-00031 pending results and sanitized errors, failed reads with retained state/retry, local/remote blocker navigation, cancellation and duplicate clicks, completed commands with failed reloads, auto-refresh suspension/late replies, filtering/search, Oracle-only IPC without transaction updates, and a single reserved background connection with main-process command serialization.

The native Oracle scenario creates a run-owned random MBT_ table and two dedicated test-user connections. One connection holds a row update; the other waits on that row. Through the actual list IPC and renderer hook it checks waiting/current SQL, blocker identities and waiter count, local blocker inspection, lack of fabricated TX holder objects, application-session protection readiness and preservation of pending changes on the main connection. ROLLBACK of the run's holding connection releases the wait, then both test connections roll back/close. No real session termination or privileges are changed. The full suite removes only its registered MBT_ objects. SELECT on SYS.V_$SESSION, SYS.V_$LOCK and SYS.V_$SQLAREA is required; privilege failures are failures, not skipped tests. The disposable Oracle CI setup grants only these read permissions for this scenario, not ALTER SYSTEM. Personal environment grants are never changed automatically.

Electron exercises the production lock screen with mocked IPC: initial failure/retry, stable waiter selection and SQL detail, blocker inspection without mutation, failed refresh with retained rows and disabled termination, explicit termination cancellation, a single selected-session command under duplicate clicks, refreshed observation and a confirmation that explains rollback. Native SQL and transaction behavior are tested separately. Real termination, cross-instance RAC operation, Oracle 12 hardware and other users' sessions are outside the native coverage. The feature intentionally supports local-instance/current-container TX/TM visibility rather than all Oracle lock classes.

### Oracle object privileges

`tests/object-privilege-window.test.cjs` exercises the production service and `useObjectPrivilegeTab` through `tests/helpers/objectPrivilegeData.cjs`. It covers exact mixed-case/apostrophe/quote identifiers and bound type filters, explicit owner authority, dictionary-only fallbacks, roles/PUBLIC, invalid and readonly requests, changed object fingerprints, direct grant-option delegation, conservative revocation, column scope, failed reads with retained state, confirmation cancellation, duplicate commands, applied-but-unconfirmed outcomes and inactive/stale replies. Structured IPC tests check sanitized driver errors and main transaction state on writes only. Fourteen cases also verify that materialized-view DML grants require a current UPDATABLE=Y catalog result.

The native Oracle scenario creates a run-owned random MBT_ table, reads its privileges through the actual IPC and hook, and checks that background metadata, stale-change rejection and readonly rejection preserve pending DML on the main connection. It rolls back and the suite removes the registered table. It does not grant/revoke privileges to existing users, roles or PUBLIC and does not create users or roles. Actual successful GRANT/REVOKE, mixed-grantor and PUBLIC paths are covered by mocked catalog/command execution; they are not claimed as native coverage. No additional local system privileges are granted by the test.

Electron exercises initial recipient-load failure/retry, paged object selection, role and column-grant details, failed privilege refresh with retained checks and disabled editing, canceling revocation and exactly one structured command under duplicate clicks. The confirmation explains main-connection commit. Run the standard `npm run check`, dedicated DB command above and `npm run test:ui`; the latter includes the renderer production build. Oracle 12 and external administrators racing a mutation are not covered by the local native scenario.

### Oracle PDB management

`tests/pdb-manager.test.cjs` and `tests/helpers/pdbData.cjs` exercise the actual service, hook, IPC and client connection wrapper. Eighteen mocked cases cover identity/state/protection, input quoting and path coverage (including tempfiles), readonly and privilege rejection, single-use review tokens and typed confirmation, XML incompatibility without deletion, attachment-only recovery after catalog removal, local-user password verification with secrets excluded from review/errors, applied-but-unconfirmed results, retained snapshots, canceled dialogs, credential cleanup, duplicate execution, stale responses, filtered selection, dedicated connection cleanup and preservation of main transaction reporting. Administration is never sent to the main or background pool connection; only a serialized identity read is performed on the main connection.

The ordinary native suite uses the existing dedicated local test account only to inspect its identity on a separate connection, verify expected rejection of local-user CDB$ROOT management, and check that pending main DML remains invisible to an observer and can still be rolled back. This expected denial is explicitly asserted; the suite does not claim successful root administration. No real PDB, existing user, password or server setting is changed by this scenario. Electron separately checks initial failure/retry, active-PDB protection, a password-free review payload, password clearing after an execution error, disabled execution until acknowledgment, duplicate-command suppression and the exact-name gate before deletion. UI commands use mocked IPC.

Destructive native smoke tests are deliberately outside `npm test`, `npm run test:db` and the normal CI workflow. `tests/disposable/pdb.test.cjs` can create/open/close/drop one random `MBT_` PDB only on a separately authorized disposable CDB. Do not use the ordinary `local/db-tests.json`, a production CDB, or the local dedicated test user's database for this test. It requires an independent Git-ignored config with this shape (replace placeholders locally; do not commit credentials):

```json
{
  "disposableCdb": true,
  "expectedDatabase": "EXPECTED_DB_UNIQUE_NAME",
  "connection": {
    "host": "DISPOSABLE_HOST",
    "port": 1521,
    "database": "ROOT_SERVICE",
    "user": "SYS",
    "password": "LOCAL_SECRET",
    "useSysdba": true
  }
}
```

The root service must land in CDB$ROOT, SYSDBA must be available through the configured Oracle client, Oracle Managed Files must be configured, and DB_UNIQUE_NAME must match `expectedDatabase`. All three explicit switches are necessary:

```sh
MONABASE_PDB_DISPOSABLE=1 MONABASE_PDB_TEST_CONFIG=local/pdb-disposable-tests.json node --test tests/disposable/pdb.test.cjs
```

Absent opt-in/config fails instead of silently skipping. The test never prepares local privileges or server settings. It uses the production review/execute path and removes only its generated PDB, checking its observed GUID before cleanup. Failure and cleanup errors are sanitized. This smoke test does not cover native plug/unplug, cloning, password changes, Oracle 12 or multi-instance administration; those operations require additional explicitly authorized disposable-environment scenarios. It has not been run against the ordinary local environment.

### Oracle session management

`tests/session-window.test.cjs` exercises the production service, renderer hook, structured IPC/client wrapper and splitter through `tests/helpers/sessionData.cjs`. Sixteen cases cover stable/recycled identities, readonly/ALTER SYSTEM/managed/system protection, SQL execution revalidation and SQL_ID-qualified cancellation, old/unknown version rejection, ORA-00031 pending results, exact statistics and container-aware joins, selection across refresh, retained read failures/retry, reversed detail responses, confirmation cancellation, duplicate commands, completed commands with failed observation, auto-refresh suspension, filtered selections, sanitized transaction-neutral IPC, reserved background connections, legacy unsafe entry-point rejection, measured keyboard resizing/cursor cleanup, and late command failures after reactivation.

The native Oracle scenario creates only a run-owned MBT_ table and pending test-user DML. Through production IPC/hook it locates the main session, verifies self-protection, reads nonempty statistics as strings, retains selection across refresh and confirms that the observer cannot see pending main edits. It rolls back and removes the registered table. It never calls the session-management command channel, terminates a real session or cancels another connection's SQL. Required reads are SYS.V_$SESSION, SYS.V_$SQLAREA, SYS.V_$SESSTAT and SYS.V_$STATNAME; missing access is a failure, not an empty successful result. The disposable CI setup grants the additional statistics-view SELECT privileges only in its own service, not ALTER SYSTEM. Local privileges are not changed automatically.

Electron checks initial list failure/retry, own-session protection, exact statistics and current/previous SQL display, failed detail reads with retained values and disabled cancellation, detail retry, SQL cancellation with an execution signature, canceled termination confirmation, one selected-session command under duplicate clicks, pending termination notices, keyboard panel resizing and pointer/cursor cleanup when the tab closes during a drag. The native destructive commands and Oracle 12/18 hardware or cross-instance RAC behavior are not claimed as covered; their decision paths use mocks. Standard check and both-DB native suites remain separate from mocked Electron operations.

## Oracle tablespaces

`tests/tablespace-window.test.cjs` covers permanent/TEMP/offline capacity, unknown free space, precision, file generation changes, validation/escaping, protected/default tablespaces, references, connection-bound reviews and partial DDL results. Hook tests cover initial resize values, retained failed reads, retry, renewed acknowledgement and late responses. Electron UI tests use simulated IPC to exercise the production dashboard, protected rows, actual-size defaults and resize-success/AUTOEXTEND-failure recovery.

The ordinary real-DB suite reads kinds, capacity, datafiles/tempfiles and user/quota/segment dependencies, and checks that pending main-connection DML remains invisible to another connection. It never creates, resizes or drops a tablespace or physical file. The test user needs SELECT on `V_$TABLESPACE`, `V_$DATAFILE`, `V_$TEMPFILE`, `V_$PARAMETER`, `DBA_TABLESPACES`, `DBA_DATA_FILES`, `DBA_TEMP_FILES`, `DBA_FREE_SPACE`, `DBA_TEMP_FREE_SPACE`, `DATABASE_PROPERTIES`, `DBA_USERS`, `DBA_TS_QUOTAS` and `DBA_SEGMENTS`. An administrator must prepare missing read privileges; the suite does not grant them. CI grants only these additional read privileges in its disposable service.

For storage mutation tests, provision a **separate disposable Oracle database** with OMF and CREATE/ALTER/DROP TABLESPACE privileges. Do not use the ordinary local DB test config. A private config must contain `disposableDatabase: true`, `expectedDatabase` (DB_UNIQUE_NAME), `expectedContainer` (CON_NAME), and `connection` (the normal application Oracle connection options). Then run:

```sh
MONABASE_TABLESPACE_DISPOSABLE=1 MONABASE_TABLESPACE_TEST_CONFIG=local/disposable-tablespace.json node --test tests/disposable/tablespace.test.cjs
```

This opt-in test checks the database/container before writing, creates only its random MBT_ BIGFILE with OMF, changes size and bounded autoextension, and drops its own tablespace and files. Failure cleanup checks the same generation when known. It is excluded from `npm run check` and the ordinary `test:db`; a successful mock or read-only integration run does not prove storage mutation success on your Oracle version. Interrupted processes may require manual cleanup after verifying the run-owned name.

## PostgreSQL locks

`tests/postgres-lock-window.test.cjs` covers exact lock identities, PID reuse and connection generations, blocker deduplication, prepared/internal/application session protection, missing privileges, read-only mode, changed SQL, rejected signals, acceptance versus completion, follow-up failure, unknown transport outcomes, reserved-slot release, duplicate commands, stale responses, filtering and retries. `tests/helpers/postgresLockData.cjs` exercises the production hook with simulated IPC. Background slots with pending transactions are rejected without touching their data.

The ordinary PostgreSQL integration suite creates a run-owned MBT_ table and two dedicated raw driver connections. One holds a row update; the other waits. The production hook/service locates the blocker, cancels only that waiter, checks that the waiter's connection remains usable, then terminates only that run-owned holder and verifies its update was rolled back. Before sending any command, the test checks that the selected PID belongs to those two connections. Main/observer/application-pool sessions are never termination targets. Main pending inserts remain invisible to the observer throughout. Cleanup rolls back/closes the two run-owned connections before normal fixture cleanup. No additional signal/admin role is granted: the test signals its own dedicated user's connections.

Electron UI tests simulate initial read failure/retry, protected rows, blocker navigation, retained observations on failure, cancel/terminate confirmation, refusal, double clicks and distinct result messages. They do not signal a real backend. Read visibility depends on PostgreSQL privileges; missing metadata and permission failures are failures to investigate, not successful skips. These lock scenarios use PostgreSQL 10+ catalog fields; the existing integration CI runs its configured PostgreSQL version, and local validation does not establish coverage of every supported server version.

## PostgreSQL object privileges

`tests/postgres-privilege-window.test.cjs` and `tests/helpers/postgresPrivilegeData.cjs` exercise the production service and hook: exact names and overload identities, literal searches and 100-row pages, roles/PUBLIC/default ACLs, sequence/column access, ordinary owner revocation, multiple grantors, grant options, explicit SET ROLE authority, stale ACL/role/connection reviews, acknowledgement, duplicate requests, failed verification, late activation responses and safe IPC errors. Client tests check background transaction isolation, pending-transaction refusal, rollback, cleanup failure and unknown commit outcomes.

The PostgreSQL integration scenario creates only run-owned MBT_ tables, a sequence, two function overloads and a procedure in the dedicated schema. Privilege changes target only the dedicated test role itself. It checks special quoted identifiers, column ACL retrieval and table-revocation effects, sequence SELECT/UPDATE/USAGE, exact overload isolation, default PUBLIC EXECUTE observation, reviewed revoke/restore and preservation of uncommitted main data. It never grants/revokes privileges to PUBLIC or another role and never creates/changes roles or server privileges. The ordinary fixture cleanup drops only this run's objects. PUBLIC changes, other recipients, role inheritance and grant-option edge cases use mocks.

Electron tests use simulated IPC to exercise the production matrix, non-login roles and PUBLIC display, 100-row target selection, function signatures, retained failed reads/retry, no immediate mutation on checkbox click, SQL review/acknowledgement, refusal, failure recovery and duplicate clicks. The service requires PostgreSQL 11+ catalog fields. Local native validation does not establish coverage of all supported server versions or membership configurations.

Local verification on 2026-10-27 also ran the checks, production renderer build, Electron UI scenarios and database integration tests with Node.js v26.12.1 and npm 11.20.0. This records the tested local toolchain; CI still uses its configured Node.js 22 jobs. Electron UI tests use Electron's bundled runtime. No dependency versions were changed during this verification.

## PostgreSQL schemas

`tests/schema-manager.test.cjs` and `tests/helpers/schemaManagerData.cjs` cover exact schema identifiers, `pgx`/`toast` visibility, system/public/extension protection, ownership/SET ROLE/database-CREATE checks, UTF-8 byte limits and escaping, OID-preserving rename, RESTRICT defaults, typed-name confirmation, explicit CASCADE with cross-schema dependencies, oversized/system graph refusal, stale reviews, failed verification, retained reads, acknowledgement, duplicate writes, hidden responses and navigation refresh. Tests also exercise the shared column splitter and real application-hook expanded/saved selection updates with reversed response ordering.

The shared PostgreSQL privilege tests additionally cover schema ACL type `n` and inherited owner authority that does not require entering a special owner role. Their existing transaction-boundary tests apply to schema operations as well: pending background work is refused without commit/rollback, main edits remain untouched, failed operations roll back, broken cleanup removes the connection, and uncertain commit results are reported explicitly.

Native schema tests are **read-only with respect to schemas**: the dedicated test schema's identity, direct/effective ACLs, contained-object inventory and dependency graph are retrieved through the production hook/client; pending main DML remains invisible to an observer. They never create/rename/drop schemas, transfer ownership or change an existing schema's ACL. Successful structural changes, cascading deletion, owner transfer and schema GRANT/REVOKE use mocks. No local server settings, roles or privileges are changed. SQL text hidden in application functions and external application dependencies are outside the catalog graph's coverage.

Electron scenarios simulate list/detail failure and retry, protected public and hidden system schemas, `pgx`/`toast`, mixed inherited access, reviewed ACL changes, RESTRICT refusal, CASCADE dependency/name confirmation and cancellation, failed rename then retry, sidebar/saved-selection rename tracking and keyboard column resizing. These scenarios execute no real schema DDL or ACL changes.


## PostgreSQL sessions

`tests/postgres-session-window.test.cjs` and `tests/helpers/postgresSessionData.cjs` exercise the production service/hook: sessions without locks, backend and connection generations, exact duration strings, protected main/metadata/pool/internal backends, permissions and read-only mode, hidden/disabled SQL, active-only cancellation, stale identities, accepted/refused signals, observed completion, failed observation and unknown transport results. They also cover current/all-database scope, state/search filters, hidden selections, retained failures, retries, duplicate commands, optional-refresh cleanup and stale activation responses. IPC/client tests verify background isolation, shared lock/session command guards and rejection of PID-only administration.

The ordinary PostgreSQL integration scenario creates one dedicated raw-driver connection for that run. It observes idle-in-transaction and active states, cancels only that connection's `pg_sleep`, verifies the same connection remains usable, then terminates only that connection and observes its disappearance. Before every signal, the test asserts the selected PID equals this run-owned connection's PID. Main pending DML remains uncommitted and invisible to an observer. Cleanup closes the worker and rolls back pending fixture work even after failure. Existing user/application/main/metadata/pool connections are never signal targets; no server role or privilege is changed. This permission does not authorize cancelling or terminating real Oracle sessions.

Electron scenarios use simulated IPC to check initial/refresh failures and retry, retained detail and disabled commands, protected activity, idle transaction and current/last/hidden SQL display, exact duration rendering, confirmation refusal, duplicate cancellation, unknown termination followed by manual reload, observed exit and current/all-database filtering. They never send real DB signals. Native validation on PostgreSQL 16 does not establish coverage of every server version or role configuration.


## PostgreSQL tablespaces

`tests/postgres-tablespace-window.test.cjs` and `tests/helpers/postgresTablespaceData.cjs` exercise the production service and hook: OID/connection identity, exact size strings, default/global location distinction, protected built-ins, read-only and owner/SET ROLE checks, special identifier/path quoting, byte/path validation, database/file/object dependencies and unavailable usage. They cover single-use reviews, metadata/role conflicts, confirmation, result verification, rejected SQL, uncertain transport, completed SQL with failed observation, retained list/detail/drafts, renewed acknowledgement, duplicate writes, hidden/stale results and background transaction isolation. IPC tests check DB type, sanitized errors and absence of main transaction-state updates. Broken slots are removed; pending background work is never committed or rolled back.

The ordinary native PostgreSQL suite uses only the two read endpoints. It reads the current default tablespace, exact size, database association and object inventory through the production hook/IPC/client while pending main DML remains invisible to an independent observer. It never creates, renames, transfers or drops a tablespace, changes roles/permissions, or accesses server directories. Required metadata failures fail this requested test rather than silently skipping it. On the dedicated environment, the role must be allowed to call pg_tablespace_size for the tested default tablespace (tablespace CREATE privilege or pg_read_all_stats may permit this on the server); administrators prepare any missing rights. The suite does not grant them. The UI can represent unavailable size/usage for less privileged application connections.

Electron tests simulate first-list/detail failures, retry, built-in protection, precise sizes, retained failed refresh, reviewed rename, explicit acknowledgement, unknown execution, input retention, manual reload and renewed review, duplicate clicks, server-path help and keyboard splitter resizing. These tests never execute real storage DDL.

For real storage mutation, provision a **separate disposable PostgreSQL cluster** and an existing empty directory owned by the PostgreSQL OS user. Prepare a private config with `disposableDatabase: true`, `expectedDatabase`, `expectedSystemIdentifier` (as a string), `location` (absolute server directory), and `connection` (normal PostgreSQL connection options for a disposable superuser). Do not reuse local/db-tests.json or an ordinary application cluster. Then explicitly opt in:

```sh
MONABASE_PG_TABLESPACE_DISPOSABLE=1 MONABASE_PG_TABLESPACE_TEST_CONFIG=local/disposable-pg-tablespace.json node --test tests/disposable/postgres-tablespace.test.cjs
```

This separate test verifies pg_control_system/current_database identities and an empty prepared directory before creation, then creates a random MBT_ tablespace, renames it while retaining its OID identity, drops it and checks the result. Failure cleanup targets only the same generated name/location/known identity. The test never creates/deletes OS directories or changes privileges. It is excluded from ordinary `check`/`test:db` and has not been executed against the normal dedicated environment. A successful mock/read-only run does not prove real storage mutation support on every PostgreSQL version. An interrupted process may require manual cleanup after checking the run-owned name.


## PostgreSQL users and roles

`tests/postgres-role-window.test.cjs` and `tests/helpers/postgresRoleData.cjs` exercise the production service/hook: exact mixed-case/quoted names and OID identity, system/self/read-only protection, version-specific CREATEROLE/ADMIN authority, NOLOGIN/LOGIN/password modes, safe identifier/credential quoting, and exclusion of passwords from reviews/responses. Cases include a redaction marker inside a role name, invalid/empty/NUL/oversized passwords, grantor-specific membership, ADMIN/INHERIT/SET and legacy SQL, self/cycle refusal, cluster dependencies, single-use/stale reviews, failed result verification and option-only revocation retaining its row. Hook tests cover pgx filtering, retained failures, hidden selections, duplicate writes, stale activation results, password clearing, explicit reload and renewed acknowledgement. IPC/client tests verify wrong-DB refusal, sanitized errors, separate background transactions, pending-work refusal, main-data retention and unknown commit outcomes.

The ordinary native PostgreSQL suite calls **only list/detail role endpoints** for the dedicated connection role, checking exact identity, attributes, memberships/effective access, cluster dependency inventory, selection retention and pending main DML remaining invisible to an observer. It never creates/drops roles, changes an existing password or LOGIN/SUPERUSER attribute, grants/revokes membership, changes server privileges or server configuration. Metadata failures are failures, not empty successful observations. PostgreSQL 16 is the locally exercised server version; older option/permission branches also use mocks rather than a claim of native coverage on every supported release.

Electron tests use simulated IPC to check list/detail failure and retry, retained observations, self-protection, current/indirect membership display, masked password review, no password in review requests, password clearing after failure, fresh entry/review before retry, double clicks, NOLOGIN creation confirmation, 100-row role selection, deletion name requirements and keyboard column resizing. Real existing accounts and authentication services are not contacted by these UI tests.

For actual role mutation/authentication, provision a **separate disposable PostgreSQL 16+ cluster** using password authentication and a superuser. Store private configuration with `disposableDatabase: true`, `expectedDatabase`, `expectedSystemIdentifier` (string), and `connection` (normal application options). Do not reuse local/db-tests.json. Explicit opt-in is required:

```sh
MONABASE_PG_ROLE_DISPOSABLE=1 MONABASE_PG_ROLE_TEST_CONFIG=local/disposable-pg-role.json node --test tests/disposable/postgres-role.test.cjs
```

The script checks the cluster/database identity, creates only two run-owned MBT_ LOGIN/NOLOGIN roles, verifies password authentication and password replacement with independent driver connections, grants/revokes membership/options between those roles, changes only the generated LOGIN/SUPERUSER/password settings, and drops them. It never creates objects owned by the roles or changes the actor's attributes. Cleanup verifies generated names/known identities and never performs DROP OWNED or REASSIGN OWNED. Authentication failures must have the expected error code; trust authentication is not counted as successful password verification. This script is excluded from normal check/test:db and has not been run against the ordinary local dedicated environment. Separate config and user authorization for a disposable cluster are required before running it; an interrupted run may need manual cleanup after checking its MBT_ names.


## Oracle users and roles

`tests/oracle-user-role-window.test.cjs` and `tests/helpers/oracleUserRoleData.cjs` exercise the production service/hook: exact case/apostrophes, ID/container/connection generations, expiry versus timed locks and unknown states, full/visible catalog scope, self/common/maintained/read-only/CDB-root protection, Oracle 12.1 conservative branches, safe password handling, ordinary role/user creation and catalog-allowlisted grants. They cover direct/PUBLIC/role paths, inherited grants, ADMIN behavior, no automatic CREATE SESSION, CASCADE defaults/dependencies/name confirmation, exact non-MB and large quota values, zero/unlimited, no-op refusal, review conflicts/single-use tokens, applied-but-unobserved DDL, unknown outcomes, retained failures, re-entry/review, duplicate writes, hidden results and connection cleanup. Main-connection calls are restricted to identity reads; no main commit/rollback is allowed.

The ordinary native Oracle scenario calls **only list/detail endpoints**, reading the dedicated user's identity, direct/role privileges, owned/dependent objects and permanent-tablespace quotas while main DML remains uncommitted and invisible to another connection. It never creates/drops users or roles, changes passwords, locks accounts, grants/revokes privileges, changes quotas or switches containers. The account needs SELECT access to DBA_USERS, DBA_ROLES, DBA_ROLE_PRIVS, DBA_SYS_PRIVS, DBA_OBJECTS, DBA_DEPENDENCIES, DBA_CONSTRAINTS, DBA_TABLESPACES, DBA_TS_QUOTAS and DBA_SEGMENTS, plus the normal public SESSION_PRIVS/SYSTEM_PRIVILEGE_MAP/DUAL access. Missing dictionaries or partial scope fail the requested native check rather than silently skipping it. Administrators prepare missing local rights; the test does not grant them. CI explicitly adds SELECT on DBA_ROLES, DBA_ROLE_PRIVS, DBA_SYS_PRIVS, DBA_OBJECTS, DBA_DEPENDENCIES and DBA_CONSTRAINTS to its existing dictionary-read grants, only in the disposable service. It does not add CREATE/ALTER/DROP USER or role-management system privileges.

Electron scenarios simulate initial list/detail failures, retained failed refresh, self-protection, expired-but-unlocked status, exact quota bytes/edit defaults, masked SQL review, no password in review requests, secret clearing and applied-but-unverified warnings, explicit reload/re-entry, duplicate clicks, non-CASCADE refusal then CASCADE review/name confirmation, 100-row candidates, user/role switching and ordinary role creation review without a password field. The tests use no real credentials or account mutations.

For real account and authentication changes, provision a **separate disposable Oracle 12.2+ PDB** with independent administrative credentials and a permanent default tablespace. Prepare a private config with `disposableDatabase: true`, `expectedDatabase` (DB_UNIQUE_NAME), `expectedContainer` (CON_NAME), and `connection` (normal application Oracle options). The actor needs dictionary access and CREATE/ALTER/DROP USER, CREATE ROLE, DROP ANY ROLE, GRANT ANY ROLE and GRANT ANY PRIVILEGE in that disposable container. Do not reuse local/db-tests.json. Explicit opt-in:

```sh
MONABASE_ORACLE_USER_DISPOSABLE=1 MONABASE_ORACLE_USER_TEST_CONFIG=local/disposable-oracle-users.json node --test tests/disposable/oracle-user-role.test.cjs
```

The script verifies the expected DB/PDB, creates only run-owned MBT_ user/role names, separately grants CREATE SESSION/CREATE TABLE and membership, verifies password authentication/replacement and lock/unlock, sets quota for that generated user, creates a table in its schema, confirms non-CASCADE refusal and drops the generated schema with explicit CASCADE plus its role. Failure cleanup checks generated names and known identities before deleting only those run-owned principals. A principal whose creation identity was never confirmed is left for manual inspection; failures include only the generated run-owned names alongside sanitized diagnostics. It does not change existing accounts or the actor's privileges and is excluded from normal check/test:db. This script has not been run against the ordinary dedicated environment; successful mock/read-only runs do not prove real user mutation or authentication across every Oracle version/profile. An interrupted run may need manual cleanup after verifying its generated names.


### Workspace UX regression checks

`workspace-feedback.test.cjs` verifies notice delivery, severity, explicit retry, subscription disposal and standalone fallback. Credential-storage tests verify that environment labels/colors survive restart, duplication, rename and reordering, and invalid metadata cannot overwrite saved records.

The Electron sidebar suite exercises command/tab search, reuse of existing tabs, modal/loading restrictions and keyboard sidebar resizing in both workspaces. It checks persistent error display and confirms that hosted success messages do not call the native alert fallback. Notification events are observed through a test-only adapter so existing error assertions remain valid without introducing blocking dialogs into the application. Manual checks should also cover narrow windows, long names, all themes and screen-reader behavior; automated DOM checks do not establish full accessibility compliance.


Workspace feedback tests also cover chat reading-position retention during answer updates, resuming follow mode, context changes, delayed notification copies, individual/bulk dismissal, overloaded routine signatures and trigger-table identities. The actual AI review tests load the real scroll hook.

The Electron suite checks connection actions at 720×520 and 420×640, the collapsible saved list, notice-list dismissal and the AI jump-to-latest control in both DB workspaces. It also switches through Simple, Dark and Mona themes, measures the actual SQL-error foreground/background colors (including text alpha), and requires a contrast ratio of at least 4.5:1. Set `MONABASE_UI_CAPTURE_DIR` when running `node scripts/run-ui-tests.cjs` to save narrow-login PNGs to a chosen artifact directory; screenshots use mocked connection data. These checks do not call a paid AI service.


### Selection, connection search and AI send keys

`object-picker-selection.test.cjs` covers cross-page/schema/category draft selection, individual/bulk removal, single selection, existing-design protection and reopening. Login tests check filtering without draft/order changes and prohibit reorder writes while filtering. Workspace tests cover skipping disabled commands, all-disabled results, shortcut hints and clipboard false/rejection/retry behavior.

Settings tests verify `aiSendKey` defaults, validation, persistence and propagation to the workspace. AI review tests exercise both key modes, IME/Shift/Alt guards and retained drafts. The Electron suite saves and reopens the modifier-Enter preference, sends a query-builder request to the isolated mock using Ctrl+Enter, and confirms plain Enter does not send. It also operates connection filtering, inline clipboard failures and picker deselection in both DB workspaces. No paid AI service or external Git remote is used.


Tab-search keyboard regression coverage opens three SQL tabs and sends real Electron Up/Down/Return input, rather than invoking only a React callback. It verifies active-row movement, wraparound, Enter selecting the expected existing tab, focus recovery after a result receives focus, and reopening through both the toolbar and shortcut. A zero-movement mouse event must not undo a keyboard selection. Unit coverage also verifies IME protection and the dialog-level capture handler.


### Security boundary regression checks

Run `npm run check` for the normal suite and `npm run audit:security` for the
current npm advisory check (moderate severity or higher fails the command). CI
runs the advisory check after a locked install. The maintainer reviews npm, GitHub
Actions and DB-image updates at least weekly, using Dependabot alerts without
automatic update PRs; see [CI security](CI_SECURITY.md). A clean audit only describes
known advisories at that time.
The SheetJS dependency uses its pinned official distribution tarball and lockfile
integrity rather than the obsolete npm registry release.

`security-hardening.test.cjs` exercises native-save capabilities (sender/frame,
path, expiry and changed symlinks), raw IPC refusal, desktop token forwarding,
AI URL normalization and redirect refusal, Git URL validation/redaction, browser
permission denial and configured Electron fuses. The redirect test sends a dummy
request only to a disposable loopback HTTP server, with no paid AI request.
Existing file/export tests obtain an OS-dialog grant before saving.

`postgres-tls.test.cjs` creates a temporary certificate with OpenSSL and uses the
real pg driver against a disposable loopback PostgreSQL-protocol TLS endpoint.
It verifies trusted matching-name success, wrong-name rejection and untrusted-CA
rejection. Application tests also verify TLS options on main, metadata, background
and cancellation clients through a mocked SSH tunnel. Tests require loopback listen
permission and OpenSSL (Windows Git's bundled OpenSSL is also supported); missing
prerequisites are failures, not successful skips. This endpoint is not a full DB
server and does not replace `test:db` on the dedicated Oracle/PostgreSQL environment.

Package verification checks the actual Electron fuse wire in each built artifact,
including disabled RunAsNode/NODE_OPTIONS/CLI inspect and enabled ASAR requirements
and integrity validation. The package verifier does not launch the artifact, prove
signing/notarization, or verify every OS's runtime integrity enforcement.

### Additional Git and AI security checks

The real local Git tests cover multiple push URLs in both orders, expanded fetch
and push URL rewrites, and multiple permitted destinations. They inspect disposable
local configuration only and never send data to the example URLs. Secret-redaction
tests include credential-bearing SSH URLs.

`ai-response-limits.test.cjs` verifies finite integer settings, timer disposal,
idle progress versus an absolute deadline, UTF-8 byte counting before parsing,
JSON/SSE/error limits, cumulative retry budgets, pending-reader cancellation,
split UTF-8/CRLF, incomplete stream refusal, and distinct manual cancellation.
Handler tests use a mocked AI transport, verify no automatic retry or adoptable
answer after a limit, and apply changed settings to the next request. Sidebar
regressions verify no review/apply action after each of the three limit failures.
No paid AI endpoint is contacted. Fake clocks exercise deadline boundaries; a
short real timer also exercises the handler's wait for response headers.

Settings tests cover validation, failed-save draft retention, persistence,
reopening and reset defaults. The Electron suite opens the AI tab, edits all three
limits and verifies saved/reopened values in both workspaces. History tests verify
unchanged existing contents and POSIX 0700/0600 permissions after saving/reading.
On Windows they test content preservation, without claiming POSIX mode enforcement.

### Provider errors, spreadsheet values and local file limits

`security-boundaries.test.cjs` uses dummy credentials and a mock AI transport for
HTTP, JSON and SSE errors, including provider text resembling a translation key.
It checks redaction, truncation, control characters, no raw HTML/plain-text response
exposure, and no credentials in delivered errors or captured diagnostics. No paid
AI service is contacted. Real temporary-file tests cover UTF-8, exact capacity,
oversize rejection, directories, and independent live SQL/ER settings. POSIX tests
also reject symlinks/FIFOs. A simulated growing file verifies an upper bound of the
configured capacity plus one byte and descriptor cleanup without returning partial
text. These checks do not create devices or deliberately exhaust application memory.

Export regressions verify formula-like headers/values in CSV and clipboard TSV,
actual negative numeric values, exact/raw round trips, the safe default and
persistence/restoration of an explicit choice. They check generated content rather
than launching Excel or LibreOffice; spreadsheet/version-specific interpretation
and re-save behavior require separate artifact checks.

Settings tests cover the Files tab, integer/range validation, invalid stored values,
failed-save draft preservation, persistence/reopening and reset defaults. The
Electron suite edits both file limits in each DB workspace and exercises the
spreadsheet-safety checkbox and persisted export preference. Native SQL and ER
read boundaries are tested in the main-process handler tests; mocked UI IPC is not
presented as a real file-read verification.

### XLSX metadata and real Electron IPC origin checks

Export tests generate and read back real XLSX bytes. JSON values resembling cell
objects must remain literal text, with no formula/link/rich-text/comment metadata.
They also cover arrays, formula-like strings, JSON BigInt, exact large-number text,
finite numbers, booleans, blanks and valid Dates. SheetJS can derive an HTML display
field when reading ordinary strings, so metadata assertions disable that derived
HTML output (`cellHTML: false`) rather than mistaking it for an injected field.
Date checks inspect the stored cell value and use UTC conversion when reading rows.
Excel/LibreOffice execution is not part of these tests.

`ipc-security.test.cjs` covers exact document/origin checks, other files, credentials
in URLs, query/path/port/scheme changes, inherited/opaque document URLs, destroyed
frames, unconfigured wrappers and redirects using modern/legacy event shapes.
Startup tests verify that main loads the same canonical file/development URL used
by the trust policy, with sandboxing and DevTools retained.

`npm run test:ui` first runs `tests/e2e/ipc-security.cjs`, then the workspace suite.
The security fixture uses the actual preload bridge and real Electron IPC. It
checks a local file whose name includes spaces/Japanese/`#`/`%`, then forces another
file and a loopback HTTP page into the same window from the test main process;
the privileged operation must be refused. A development fixture succeeds only at
its approved URL. A loopback redirect must be canceled before requesting its target.
All servers/profile/files are disposable; no real DB, paid AI service or external
website is used. Expected `Untrusted IPC sender` logs come from rejected probes.
The test accepts Electron's ERR_ABORTED/ERR_FAILED variations only alongside an
observed redirect event and zero redirected-target requests. It keeps the process
alive while replacing windows so an automatic exit cannot masquerade as success.
This exercises bundled-file trust policy, not an installed release executable.

### SQL-history privacy regression checks

`sql-privacy.test.cjs` exercises comment/quote/bind forms, PASSWORD and IDENTIFIED
BY, PostgreSQL user mapping options, Oracle database links, and harmless occurrences
of password in data/column names. Subscription cases cover both conninfo and URI
credentials (including a URI with no PASSWORD keyword), quoted names, comments,
dollar quoting and binds. Keystore cases cover open/create/export and external
stores. Harmless subscription enable/disable/rename/refresh/drop and quoted or
commented command mentions remain ordinary SQL. Direct history-IPC calls must not create or
append sensitive entries. Toggling history off preserves file bytes and toggling
back on resumes normal recording. Legacy sensitive records are hidden without
rewriting their file. Invalid inspection requests fail instead of returning a
successful classification.

The real SQL-window hooks use the main inspector through the mocked transport.
For both dialects, success, returned errors and rejected requests must submit the
original SQL while excluding its dummy secret from logs/result descriptions,
notifications and compile errors; sensitive history appends must not occur.
The same execution checks include Oracle keystore passwords and PostgreSQL
subscription URI/conninfo commands. Legacy-history checks include all recognized
credential forms and assert byte-for-byte preservation during read/refused append.
Cancellation during delayed privacy inspection must start no SQL or DB batch and
send no premature cancellation request. Settings tests verify defaults, boolean
validation, failed-save draft retention, reopening and reset.

The Electron workspace suite uses the real main-process inspector for its privacy
channel while SQL execution remains mocked. It saves/reopens the history opt-out
and submits fictional credential-changing SQL, confirms original SQL reaches the
mock and checks the visible execution log is redacted. The scenario retains
user/role-password cases and adds Oracle keystore commands and PostgreSQL
subscription CREATE with URI and ALTER with conninfo credentials. It never changes real
passwords/users for this feature. Existing dedicated `test:db` tests check DB
regressions separately; successful mocks do not establish server-side log redaction
or complete detection of constructed SQL and arbitrary secrets.


### Internal history privacy and capacity

`tests/internal-data-safety.test.cjs` covers AI-usage CSV formula prefixes,
whitespace/full-width operators, embedded quotes/newlines, unchanged literal
apostrophes and numeric tokens. It checks both AI history IPC responses after
malformed JSON, translated trace/nested-variable errors without dummy secret
values, and unchanged original bytes. Real production trace IPC handlers are
driven with disposable files in both dialects, covering UI and AI-context paths,
nested variables, console secrecy, the capacity ceiling after approval, and
confirmation followed by successful retry. Sparse files just over 64 MiB exercise
bounded asynchronous/synchronous reads, JSON history, AI history, trace history,
and usage append/read rejection without allocating their full contents. The
suite checks retry after an error, link rejection, JSON-write failure preserving
the original and temporary-file cleanup, and Git per-file/combined limits before
content retrieval. Existing bounded-reader tests cover a file growing during read.

`tests/git-review.test.cjs` additionally commits an oversized blob to a disposable
local repository. Working-source and historical-source reads must refuse it while
preserving HEAD/staging; a later repaired commit must load. Oversized manual
conflict resolution must leave working bytes, index entries and MERGE_HEAD
unchanged. Existing batch/merge/commit-failure tests remain active. Git tests use
only disposable local repositories; CSV tests do not launch Excel or execute
formulas. Full-platform spreadsheet behavior is not established by these tests.


### Legacy reads, recovery copies and Windows portability

Git review tests exercise oversized legacy source discovery before history/review,
verify unchanged staging/file size and retry after replacement with a valid
fixture. JSON tests check excessive-size and directory recovery-copy collisions,
original-byte preservation and a later matching recovery copy. The synchronous
reader applies the per-call limit throughout descriptor reads, including growth.

`tests/build-portability.test.cjs` checks the Windows allowlist and command-local
rebuild override. A copied SSH dependency tree without cpu-features or native
crypto establishes a real loopback SSH session, checks the server public key,
authenticates dummy credentials and exchanges fixed text. It does not run OS
commands or contact an external server. This proves the fallback on the host
runtime; Windows startup/SSH and Oracle Thick mode still require Windows testing.
The package verifier checks runtime dependencies and Windows-specific native-file
inclusion/exclusion in addition to existing security fuses/private-data checks.


### Connection identification appearance

The Electron scenario sets an environment label and identification color through
the actual login form, then checks both workspaces in Simple, Dark and Mona themes.
It verifies the rounded gradient badge, database icon, environment text, bounded
header dimensions and PostgreSQL TLS label. Setting `MONABASE_UI_CAPTURE_DIR`
also captures each workspace/theme's connection badge in addition to login
screenshots. Connections, credentials and SQL remain mocked in this UI scenario.


### Credential destination and encryption-failure regression checks

Credential-storage tests simulate OS storage unavailability, denied decryption
and encryption exceptions without accessing the real OS keychain. Changing AI/DB
destinations plus secrets must fail with unchanged file bytes/session state and
recover the previous complete record after a fresh vault restart. Retrying after
unlock must save the new complete pair. A failure encrypting SSH after DB
password encryption succeeds must publish neither field.

Unreadable-secret tests exercise endpoint origins/paths, DB identities and ports,
SSH routes/users/auth/key files and TLS settings. Safe label/color/name/model
changes and equivalent host/URL spellings retain ciphertext, while changed
recipients require re-entry. Re-entering only the DB password may retain an
unreadable SSH secret when the SSH recipient is unchanged. Existing migration,
clear, disk-failure and session-only-new-record tests remain active; tests that
previously accepted session-only replacements of encrypted records now require
complete preservation and a failed save.

Main/AI IPC tests check both fixed failure codes in English/Japanese, without
provider messages or dummy secrets in responses. Electron scenarios explicitly
enable connection saving, inject a failed save and verify zero connect requests
and retained input. AI settings failure keeps its draft/dialog and allows a
successful retry without publishing the rejected request. UI persistence is
mocked; the separate store tests exercise real disposable files and fresh vaults.


### Bounded Git history pages

`tests/git-history-limits.test.cjs` creates disposable local repositories with
more than 50 revisions and checks both DB-source and ER history pages, exact
messages, duplicate-path handling and page-specific remote ancestry status. A
single 9 MiB commit subject must fail during streaming without returning its
content. Separate stdout/stderr overflow and timeout fixtures verify child
termination and fixed errors. Invalid page arguments fail before retrieval;
credential-bearing discovery errors must be redacted before logging.

Hook/component tests exercise page replacement, failure preserving the current
list, stale responses, and cross-page revision selection without resetting the
chosen comparison. The Electron sidebar scenario exercises newer/older ER
history buttons and boundary disabling in both database workspaces using mocked
IPC. Run `npm run check` and `npm run test:ui`; real DB/source/Git integration
remains part of `npm run test:db` against the dedicated configured environment.


### Dynamic SQL and private execution

`tests/sql-privacy.test.cjs` covers anonymous and stored-program bodies, nested
quotes, dollar quotes, Oracle q quotes, PostgreSQL E-string escapes, literal
concatenation, runtime-unknown EXECUTE and DBMS_SQL.PARSE, plus inspection size,
work and nesting limits. Ordinary SELECT literals and known harmless dynamic
SELECTs remain distinguishable. Direct history append/view tests include dynamic
credential statements and preserve old file bytes rather than silently deleting
existing entries. No account/role/password changes are executed by these fixtures.

For each dialect, real SQL-window hooks verify original SQL submission, protected
logs/errors/notifications, history omission, visible successful result rows, no AI
plan context, whole-script coverage and normal history restoration after the
manual toggle is disabled. Electron scenarios exercise fixed dynamic credential
statements with mocked DB execution and the private toggle on/off with an error.
The dedicated native DB suite executes only harmless dynamic SELECT blocks and
manually private SELECTs, checking unchanged pending transactions and observer
visibility. These tests do not assert suppression of DB server audit/trace logs or
protection of secrets passed through arbitrary application-specific functions.


### Authentication file reads

`tests/credential-files.test.cjs` checks exact binary bytes, unchanged permissions,
inclusive 1 MiB private-key and 4 MiB CA limits, oversized files, directories,
missing paths, selected regular-file links and dangling links. POSIX fixtures
check FIFO rejection in a child with a hard timeout and reject device files;
Windows uses a directory junction to exercise linked regular targets. Descriptor
fixtures exercise replacement, growth and read failures, checking closure and
fixed errors without dummy content/path excerpts.

Both database clients must reject an unreadable key before creating an SSH client,
then succeed on retry with the exact key bytes and passphrase. PostgreSQL rejects
an invalid CA before creating either SSH or database clients. Existing real TLS
negotiation tests await CA loading and continue to cover certificate/host rejection
and the main/metadata/background/cancellation policy. Run `npm run check` and the
normal dedicated `npm run test:db` suite. Dedicated local SSH checks can additionally
verify the approved unencrypted/encrypted test keys against the test jump host;
keep credentials in ignored configuration and never print key contents or passphrases.


### Maintainer-only CI policy

`security-hardening.test.cjs` checks both workflow event mappings (push/manual
only), read-only permissions, official full Action SHA pins, disabled checkout
credential persistence, fixed DB image digests and the absence of update-PR
configuration/templates. Local validation also parses YAML. Image manifest bytes
and Linux amd64 availability must be checked against the registry when updating
a digest. The actual service startup and packaged OS jobs require GitHub Actions
after a reviewed push or manual dispatch; local DB tests use the dedicated local
configuration and do not validate a changed CI image. GitHub repository settings
are a separate prerequisite described in [CI security](CI_SECURITY.md).


### AI code completion and individual historical source limits

`ai-response-limits.test.cjs` rejects explicit `length`, `content_filter`,
`tool_calls` and `function_call` completion reasons for all five code-generation
request types in buffered mode. It also covers streaming compatibility fallback,
normal completion, providers omitting finish reasons, conversational partial text,
no automatic retry and sender-listener cleanup. `ai-review.test.cjs` checks that
an incomplete response never opens code review or changes the original SQL.
The translation test separately checks code classification and stream opt-in.
All provider responses are simulated; no paid AI request is sent.

`git-history-limits.test.cjs` uses disposable real repositories with 1,000 ordinary
edits and renamed paths to check direct source loading without a history scan,
bounded rename-only discovery, preserved pre-rename contents and explicit refusal
beyond 128 renames without modifying HEAD, index or working files. Injected readers
and clocks verify cumulative metadata limits, total deadlines and malformed or
traversing rename paths. These run in both `npm run check` and `npm run test:git`.
Existing Git source/DB integration tests continue to verify real definitions and
history reads. No external remote is pushed and personal repositories are retained.


### Connection isolation for AI conversations

`ai-source-history.test.cjs` verifies that destination changes produce different
scopes while password/key-file/label changes do not. Both database variants use
temporary source/debug folders to verify separate messages for same-named objects,
isolated deletion (including Oracle package bodies), unchanged legacy bytes and
no legacy fallback. IPC tests reject missing, forged and wrong-database scopes
before file access. Controller cases exercise late loads, final saves and deletion
notifications across connections.

`ai-review.test.cjs` switches the mounted workspace scope and checks the exact
mocked AI payload excludes the prior connection's messages. It also checks missing
scopes block sending, and Git summary retrieval uses the current scope and ignores
late results from a previous scope. Tests use simulated AI only. The real-DB
connection lifecycle step checks the production `connect-db` response and the
main process's registered scope for repeated Oracle/PostgreSQL connections. The
Electron fixture supplies a successful connection scope to the production login
and workspace; existing navigation and screen scenarios remain enabled.


### Search editing, diff layout, notification history and panel widths

`workspace-feedback.test.cjs` verifies native Home/End handling in the search
textbox while retaining arrow navigation, IME protection and result-focused
navigation. Notification cases cover reopening closed errors and expired successes
from the header, timestamps, newest-first 50-entry retention, copy failures,
individual/bulk removal, subscription cleanup and exclusion of archived retry
callbacks. These cases use in-memory notices and simulated clipboard IPC.

Width-hook cases cover quick unmount/reopen, distinct DB/panel keys, invalid and
unavailable storage, minimum/maximum bounds and shrinking then restoring a viewport
without replacing the preferred width. `ai-review.test.cjs` exercises source and
settings diffs on narrow/wide viewports, both layout controls, automatic defaults,
manual-choice retention, unchanged proposal text and the existing apply guard.
The actual diff component also retains its server-rendered markup check.

The production Electron scenario additionally checks native Home/End editing with
unchanged result selection, header notification opening, individual history removal,
reopening a closed committed-success notice with its timestamp and real browser
storage after keyboard resizing. Both database workspaces retain their existing
full screen scenarios. No external AI request is sent by these checks.


### SQL history reuse, result summaries and reference disclosure

`sql-window-workflow.test.cjs` checks both database hooks keep result counts and
durations attached to their rows across later DML/errors, then replace them for a
zero-row successful result. Component tests verify history double-click/new-tab
buttons emit an open request without editing SQL, only explicit Replace changes
the editor, stale selection is disabled after history removal and zero count/time
are displayed in a polite status region.

`ai-submission.test.cjs` renders the reference panel with a controlled external
selection store. Collapsing must preserve all targets; loading/error counts continue
to update, and retry and closed-origin notices remain available. The shared picker
suite checks direct clicked-row confirmation rather than an earlier draft, duplicate
click suppression, failure retention and double-click retry, disabled/already-added
protection and unchanged explicit confirmation in multiple-selection mode.

The production Electron scenario seeds fictional SQL history through simulated IPC.
It opens a new tab from history, checks original editor contents, reselects the
originating tab and explicitly replaces its text. It also checks the result toolbar
sits above the grid with count/time after a later failed SQL, and confirms a table
by double-click from the single-selection generator picker after paging. The DB
integration suite remains the check for real execution/transaction behavior. AI
reference failure/count cases are simulated; no paid AI request is sent.


### Settings errors, shared Git layouts and condition display

The settings suite checks empty draft preservation, inline required/range errors,
first-invalid-tab selection and focus, no validation alert/persistence, and valid
zero timeout alongside existing failed-save recovery. Git UI tests exercise the
shared real layout hook and revision swapping, verify source identities reverse,
retain explicit layout choices and restrict calls to read-only Git IPC. The AI
review tests continue to exercise the same layout hook after it became shared.

`condition-panel.test.cjs` verifies literal column-name search and active-only
filtering retain hidden predicates, report hidden active columns and never execute
a query. Clearing must call the parent once; the production helper preserves types,
exclusions and exact special identifiers (including `__proto__`), avoids mutation,
and clears all input/sort drafts. Disabled controls and explicit Execute are checked.

Both production Electron scenarios also verify saving with an empty general-setting
field from another tab moves focus back to that invalid input without a settings
write. Table-condition search hides an entered predicate; Clear all removes it
without issuing a main query. The Git object diff is switched to unified mode and
both old/current searches must find their appropriate lines, then the revision
comparison swaps selected sides. Existing full workspace scenarios remain enabled.
The dedicated Oracle/PostgreSQL integration suite continues to check real search,
export and transaction behavior; UI failure branches use simulated boundaries.

### Import preview, stopped exports and SQL pane controls

`import-data.test.cjs` verifies no INSERT occurs before explicit preview confirmation, repeated preview/execute guards, real column mapping, ignored columns, invalid row widths, sample limits, invalidation and explicit retry after partial/unconfirmed insertion failures. The existing four DB table/sidebar paths remain covered.

`data-export.test.cjs` verifies known/unknown progress, stopping a pending fetch, exactly one snapshot cleanup, no partial save/copy or success notification, retry, visible cleanup errors and a noncancelable indeterminate saving phase. Existing XLSX/CSV/TSV fidelity tests remain in place. `sql-window-workflow.test.cjs` verifies pane modes, preferred-height restoration, keyboard/drag limits, blur cleanup and hide/show observation.

The Electron suite checks both database screens: preview without INSERT, explicit insertion and failure review, stopping output before saving, and SQL editor/results maximization, split restoration and keyboard resizing without extra SQL calls. Real DB tests retain existing import/export and transaction checks; stopping an in-flight production DB request is cooperative and does not send a database cancellation request. The screen suite rejects zero-height grid diagnostics during pane switching. The adopted-summary Git test also asserts the commit response before reading history so a failed command reports its actual cause. It runs concurrent real Git status checks alongside that commit and verifies every response succeeds, exercising the workspace queue against index-lock races. Windows/Linux native UI and large-output CPU/memory behavior are not established by the macOS simulated-IPC screen suite.

### Success notifications, fetched-cell inspection and keyboard selection

`cell-value-inspector.test.cjs` verifies exact decimal strings, Unicode/newlines, NULL versus empty text, binary/unavailable handling, read-only inspection with no DB requests, literal clipboard contents, duplicate-copy guards and retained values/retry after errors. `data-export.test.cjs` captures nonblocking success notices and their severity, rejects blocking alerts, and checks inline failures with retry. `git-review-ui.test.cjs` checks successful grouped commits produce a success notice.

`object-picker-selection.test.cjs` checks search-to-list focus, skipped protected rows, arrows/Home/End without selection, single tab stop, Space toggling, multiple Enter without confirmation, ButtonBase-generated clicks, IME/repeat guards and pending submissions. The Electron suite exercises actual MUI keydown/keyup behavior, table/SQL cell menus and clipboard IPC, no extra SQL during inspection, and export inline errors/nonblocking success on both database screens. Clipboard IPC is simulated; no personal clipboard content is read or written by these tests. The changes do not alter SQL, connection or transaction behavior.

### SQL history filtering and adaptive SQL editor controls

`sql-window-workflow.test.cjs` verifies case-insensitive/trimmed history filtering, zero results, restoring all rows, page reset and selection invalidation, preserving the original history array and issuing no new-tab/editor-change/SQL action while filtering. `sql-editor-layout.test.cjs` checks actual available/control width switching, popover closure on expansion, hidden-container stability, observer cleanup, and both DB editors retaining bind values/types across automatic/manual collapsing and narrow-screen drawers.

The Electron suite checks both database screens using real search input, matching/total counts and disabled hidden-row actions. Wide/narrow window sizes exercise bind type/value entry, collapsed editor width, drawer restoration, a toolbar without horizontal overflow, SQL formatting via More, and restoration to one row. The checks compare SQL call counts to confirm those presentation operations do not execute SQL. Existing file, history-reuse, execution and privacy flows remain covered. These are macOS simulated-IPC UI checks; they do not establish native Windows/Linux behavior.

The full sidebar UI suite applies its 90-second deadline separately to each database rather than sharing one deadline across both runs. Individual operation wait conditions remain unchanged. ER Undo/Redo checks target a visible enabled button before clicking, avoiding interaction with an inactive control.

### SQL execution-log filtering and line navigation

`sql-window-workflow.test.cjs` covers SQL/result/error-text matching, trimmed and case-insensitive queries, errors/stopped-only filtering, combinations, zero matches, reset and unchanged logs/editor/desktop state. It verifies normalized English/Japanese error prefixes become native buttons, while malformed, missing, zero and unsafe line numbers remain plain text. Both real DB-specific hooks are exercised with a fake editor to check exact selection/scroll/focus and rejection of out-of-range lines without SQL requests.

The Electron suite runs a multiline script with a simulated line error on both database screens. It uses native Enter activation and clicks, verifies actual CodeMirror active-line/focus changes, restores a maximized log/results pane before navigating, and exercises the actual search input and issue checkbox. SQL call counts and source text must remain unchanged throughout navigation and filtering. These UI checks use simulated IPC on macOS rather than a live database.

Native log-button keyboard tests send keyDown, char and keyUp for Enter/Space. A keyDown/keyUp-only Enter simulation does not produce the browser's native button click; this was confirmed independently in a minimal Electron window. The full suite asserts navigation and unchanged SQL rather than substituting a programmatic click for keyboard activation.

### Keyboard cell actions and AI usage-history recovery

Cell inspector tests verify Shift+F10/Menu keys and cell positioning, preservation of editing/IME/modifier behavior, preview focus isolation, focus restoration after transition/copy, rerendered cells, missing rows and unmount cleanup. The Electron table/SQL helper exercises pointer and both key paths, Escape, preview close and direct copy; the originating cell must regain focus and SQL counts must stay unchanged.

Usage-history tests drive the actual component to check month limits, invalid drafts, This month, missing totals during loading/failure, explicit retry, successful zero data, same-year reuse and pagination reset, late year/update responses and subscription cleanup. Electron tests cover a held failure/retry, direct month input, positive totals versus empty-month zero and no database SQL. DataGrid visibility is checked through actual records, using a flex parent for GridViewport; displaying totals alone is insufficient. All IPC/clipboard/usage data in these screen tests is simulated; no paid AI request or real clipboard operation is performed.

### macOS application logo

Startup tests verify both development and packaged macOS paths set the shared Dock/window icon before storage preparation, settings loading or window creation. The PNG was rendered directly from the login SVG using Electron canvas, visually inspected, and loaded as a nonempty 1024×1024 nativeImage accepted by the macOS Dock API. This does not verify a newly built .app/ICNS or Finder/Dock cache behavior; renderer builds alone do not rebuild existing application bundles.

## Website checks

The independent Astro/Starlight site is validated with
`npm --prefix website run check` and `npm --prefix website run build` after
`npm --prefix website ci`. Checks cover literal translation extraction, complete
dual-language catalogs, matching guide routes and DB badges, Pages base paths,
and manual-only/public-repository deployment boundaries. The production verifier
requires all 70 landing/manual pages, their language counterparts, a search index,
and valid local links/assets under `/monabase/`. Every guide and illustrated section
requires matching English/Japanese PNGs, and generated HTML must contain the
expected image identities and locale. Every PNG must also have an explicit import
in `website/src/content/screenshots.ts`, ensuring assets outside the website root
are registered in both development and production. The start-category style guide requires
Mona/Simple/Dark captures and the landing page must link to it. Built-in error
pages are additional.
These checks neither contact a database nor deploy Pages. Website browser checks
should include both language searches, same-guide language switching, narrow-screen
layout, mobile navigation and screenshots; a successful static build alone does not
establish those interactions. See [website instructions](../website/README.md).


### PostgreSQL SQL-result output date format

`data-grid-date-formatting.test.cjs` covers strict output patterns for PostgreSQL
canonical timestamp strings, date-only values, NULL and date-looking text, and
checks that the default precision-preserving mode remains available. The actual
SQL-window hook tests use the real grid column builder and alternate configured
patterns while retaining exact raw values. The PostgreSQL integration suite executes
`current_timestamp`, a fixed microsecond TIMESTAMP, DATE and matching text through
the actual SQL IPC path, then verifies the displayed calendar pattern and unchanged
raw rows. A production-renderer Electron check also executes real `SELECT
current_timestamp;` against the dedicated test database and verifies the visible
`DD-MMM-YY HH:mm:ss` cell. This checks the normal SQL result grid, not every other
database screen or exported file format.


## Settings persistence and behavior

Settings tests use isolated temporary `settings.json` files, never the personal
file in the project root. They check saved values as well as their consumers:

| Suite | What it verifies |
| --- | --- |
| `tests/settings-defaults.test.cjs` | Defaults, missing/invalid values, safe integer limits, fixed timezone offsets, all preference round-trips and snapshot isolation |
| `tests/general-settings.test.cjs` | Every settings tab, numeric boundaries, save/cancel/defaults, folder selection/cancellation/failure, disk persistence and a newly created application controller |
| `tests/settings-runtime.test.cjs` | Saved history enablement/limits, independent SQL/ER size boundaries, next-request AI budgets/deadlines, cross-tab numeric formatting and workspace tab limits |
| `tests/e2e/settings.cjs` | Production renderer/preload, all five settings tabs, validation, three styles, both languages, saved values and renderer reload |
| `tests/integration/settings.test.cjs` | Real Oracle/PostgreSQL connections using the persisted settings, five output and ten bind-input date patterns per DB, transaction preservation, reconnect-sensitive query timeouts and Oracle session timezones |

The DB suite runs automatically with `npm run test:db`. To run it alone:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 node --test --test-concurrency=1 tests/integration/settings.test.cjs
```

It uses the same private configuration, database filter and schema checks as the
other integration suites. Its disposable `MBT_` table and independent observer
verify that saving settings does not commit pending data. Reconnection applies a
one-second timeout, which cancels a longer query; zero permits it. Oracle main and
background connections are checked with positive quarter-hour, negative and zero
session offsets. PostgreSQL date tests do not claim that its session timezone is
changed by the Oracle-specific timezone preference.

AI budgets use controlled clocks and no external AI requests. The Oracle client
path is selected, cancelled, saved and restored as a preference; loading an actual
Oracle thick-client library is not covered. Renderer reload is not a full packaged
application restart, and these scenarios do not establish exhaustive coverage of
every export format, operating system or database version.

### AI request evidence, source snapshots and explicit paid context checks

`tests/ai-request-evidence.test.cjs`, `tests/ai-review.test.cjs` and
`tests/ai-submission.test.cjs` cover whitelisted main-session settings, busy/error
handling, optional expected/actual results, user-run verification, exact request
previews, context switches and explicit selection of related catalog objects.
No normal test contacts an AI service. `tests/sql-tuning-ai-sidebar.test.cjs`
checks estimated-versus-observed evidence and bind-sharing consent that expires
when the plan changes. `tests/e2e/sidebar.cjs` edits the optional expected-result
field in the real sidebar and checks that the mocked outgoing request contains
that value and the collected environment for both databases.

`tests/integration/ai-context.test.cjs` uses the dedicated test schema with random
MBT names. It verifies actual main-session settings, pending-row preservation,
view dependencies and foreign-key references. The regular trace integration
suite verifies source snapshots and SHA-256 identifiers in persisted trace files.
Run both databases after changes to these paths:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 npm run test:db
```

The optional paid entry point below is intentionally outside `npm test`, `check`,
`test:db` and all CI workflows. It requires a fresh explicit user request and a
one-time key entered through standard input; never put a key in command arguments,
source, documentation or an environment file. It refuses CI. It fixes the model to
`gpt-6-luna`, permits at most 14 requests with 4096 completion tokens each, and
forbids automatic HTTP retries:

```sh
MONABASE_TEST_CONFIG=local/db-tests.json MONABASE_DB_TEST_ALLOW_WRITE=1 node tests/live-ai/context-effect.cjs --allow-paid
```

The run measures real tuning results/read counts for four scenarios, diagnoses
and verifies a five-iteration trace bug on both databases, then saves eight
program-generation answers for source review. Existing strict test-fixture
validators restrict generated operations to run-owned objects. The program
answers are **not executed by that command**. Inspect their complete source and
use the separate `program-effect.cjs --verify=... --review-sha256=...` step described
above to apply exactly the reviewed file. Reports remain under ignored
`local/ai-test-reports/`. Fixtures cover explicit requirements and boundary cases;
a passing run is not a statistical before/after comparison of general AI accuracy.
