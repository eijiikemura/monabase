# MySQL 8.4 workspace

MySQL support covers **direct/verified SSH connections, InnoDB transaction control, SQL editing, table data/structure management, source definitions, Git version control and AI assistance**. Existing Oracle and PostgreSQL workspaces are unchanged. MariaDB is outside this scope.

## Connect

Select **MySQL 8.4** on the login screen. Enter the host, port (default `3306`), database, username and password. Surrounding whitespace in the host is removed at connection time; usernames, database names and passwords remain exact. Saved passwords use the existing credential vault, scoped to the MySQL endpoint and its TLS settings.

- **TLS with certificate verification** requires a DNS hostname matching the certificate, a trusted certificate chain and a TLS-enabled server. Supply a PEM CA file for a private CA. IP-address connections with verified TLS are currently rejected. Verification never falls back to plaintext.
- **TLS disabled** sends database traffic without TLS. Use a trusted local environment or configure verified TLS for remote connections.
- The **read-only** option combines a server-side read-only transaction setting with an application SQL policy. It rejects DML, DDL, locking reads and session overrides.
- SSH tunnels support password or private-key authentication with the existing trusted-host-key confirmation. OS authentication and SYSDBA are not supported.

## SQL and transactions

The main connection uses `autocommit=0`. SQL tabs share that connection and its transaction. Metadata uses a separate, read-only, autocommit connection; cancellation uses a third connection owned by this client.

| Control | Behavior |
| --- | --- |
| Execute / Ctrl+Enter / Cmd+Enter | Run the selection, or the complete editor text, as sequential single-statement requests. F5 is also supported. Semicolons inside quoted strings, backtick identifiers and comments are preserved. Execution stops at the first error or cancellation; earlier pending work remains pending. A multi-row VALUES list is one INSERT. |
| Default database | SQL tabs always use the connection database as their default schema. There is no schema selector. To query another accessible database, qualify the name, for example ``SELECT * FROM `other_database`.`orders`;`` (using backtick-quoted identifiers in SQL). |
| Bind values | Open the bind-value panel from the SQL toolbar. Detected `:name` placeholders each have a Text / Number / Date field and an explicit NULL checkbox. Empty text remains an empty string. Dates use the configured input date format; numbers preserve exact decimal text (up to 65 total digits and 30 fractional digits), including values beyond JavaScript's integer range. Number/date placeholders are explicitly cast in the submitted SQL; quoted strings and comments are untouched. |
| Parse | Obtain an estimated `EXPLAIN FORMAT=JSON` plan for SELECT/WITH SELECT using the dedicated plan IPC and main connection. The target query is not additionally executed for timing; EXPLAIN ANALYZE is never requested. The shared expandable tree shows access methods, estimates, costs and predicates. Plan aliases are not guessed as table identities. |
| Execution Log / History | Use the Oracle-style result tabs to search logs and saved history, replace editor text or open a history entry in a new SQL tab. History respects settings and retention limits. Private execution excludes SQL from saved history and masks logs; sensitive credential statements are also excluded. |
| Results | Inspect/copy cells, transpose rows and columns, export the current result and resize/maximize the editor/result panes using the common SQL controls. Only the latest successful row result is retained. |
| SQL tuning | From a plan result, request AI tuning with the exact analyzed SQL/database/binds and prior matching execution evidence, native JSON plan, catalog statistics, SHOW CREATE and index information. When AI is unavailable, save a text request for an external chat. Bind values and plan predicates are masked unless explicitly shared for that plan. No row samples are collected; proposals are never executed automatically. |
| Format SQL | Format the editor text with the MySQL dialect. |
| Open / Save as | Open a SQL file or save the current editor text using the existing size and file-permission controls. |
| Stop | Cancel the current main query on the server. The main queue waits for cancellation to finish before accepting a subsequent statement. |
| Commit / Rollback | Finish the transaction shared by all SQL tabs. SQL `SAVEPOINT`, `ROLLBACK TO SAVEPOINT` and `RELEASE SAVEPOINT` are also supported. |
| Transaction feedback | Commit and Rollback pulse for native write/locking state, matching the Oracle toolbar. A plain SELECT or BEGIN does not pulse. A later SELECT preserves earlier pending work; Commit/Rollback or implicit DDL commit clears it. Reduced-motion preferences keep a static filled highlight. A read transaction can remain active without pending writes. |

SQL errors are not automatically retried or followed by an application-wide rollback. MySQL itself can roll back a statement or a whole transaction, for example after a deadlock. **DDL can implicitly commit earlier changes even when the DDL fails.** Rollback cannot undo those committed changes. Nontransactional storage engines such as MyISAM are not supported; do not rely on rollback for their data.

If the connection or cancellation outcome becomes uncertain, state is shown as unknown and further execution is blocked. Reconnect and inspect the DB before retrying a COMMIT whose response was lost.

Results preserve BIGINT/DECIMAL and JSON text and duplicate column labels. Date values remain text across IPC and use the selected output date format for display. Binary values display as hexadecimal. Results are limited to **10,000 rows / 16 MiB**; exceeding either limit fails with a message rather than presenting incomplete data as a complete result. Use `LIMIT` and filters. The configured query timeout is applied when connecting; `0` means unlimited.

## Initial limits

The workspace follows the Oracle layout: logo and menus on the left of the header, shared Commit/Rollback actions and the connection badge on the right, a resizable/collapsible database sidebar, closeable SQL tabs and the common tab/command search. Ctrl/Cmd+N opens SQL; Ctrl/Cmd+W closes the selected tab. The sidebar uses the Oracle table tree: expand a database and Table, select an item with one click and open it with a double click or Enter. View, Index, Procedure, Function and Trigger use their own cached 100-item inline categories. SQL windows open through View / Ctrl+N or a table context menu; SQL Window is not a sidebar category. DBA and features without a MySQL implementation remain disabled. Processing uses the matching theme and the Mona paw Stop button for cancellable SQL; Commit/Rollback cannot be interrupted from that overlay.

Dedicated view, trigger, procedure and function windows support reviewed definition changes. Procedures support execution with IN/OUT/INOUT arguments; functions accept IN parameters and return one scalar value. Restricted trace analysis and dedicated DBA screens are described below. Unsupported IPC operations are rejected rather than routed to PostgreSQL.

Only the default MySQL quoting modes are supported. Connections whose default SQL mode includes `ANSI_QUOTES` or `NO_BACKSLASH_ESCAPES` are rejected. Session `SET` and SQL `USE` (qualify other database names in SQL instead), executable comments (`/*! ... */`), `DELIMITER` scripts, routines, events, triggers, temporary-table DDL, file access and advisory lock operations are intentionally unavailable in this phase. Use ordinary SQL statements and InnoDB tables. The renderer splits ordinary scripts and sends one statement at a time; the driver still has multipleStatements disabled and rejects multi-command requests. DELIMITER definition files use the separate reviewed import dialog described below; the ordinary SQL executor does not execute DELIMITER directives. Compound trigger/procedure/function bodies are accepted only through their dedicated reviewed editors, with multipleStatements still disabled.

## Disposable real-database tests

Requires Docker Compose and OpenSSL. No existing database/container is changed. The fixture uses a pinned MySQL image, localhost port `13306`, a temporary in-memory data directory and dummy credentials (`test` / `test`, database `mb_test`). Do not expose it to the network or use it as a permanent database.

```sh
node scripts/prepare-mysql-test-tls.cjs
docker compose -f tests/fixtures/mysql/compose.yml up -d --wait
MONABASE_MYSQL_DISPOSABLE=1 npm run test:mysql
npm run build:renderer
MONABASE_MYSQL_DISPOSABLE=1 env -u ELECTRON_RUN_AS_NODE npx electron tests/e2e/mysql.cjs
```

On Linux, run the Electron command under `xvfb-run` with a correctly configured Electron sandbox, as for `npm run test:ui`. Normal `test:ui` runs the MySQL screen with simulated IPC and does not require a database.

Tests create random `MBT_` tables and clean them on success and failure. They cover pending-row isolation, actual transaction status, failed DDL implicit commit, savepoints, exact values, read-only enforcement, cancellation, timeout, oversized results and verified TLS. The real UI additionally enters SQL and checks rollback/commit results through the production renderer and IPC.

Test certificates/private keys are generated only under ignored `local/mysql-test-tls/`. They expire after 30 days. Never use them outside this disposable fixture. The preparation script reuses complete existing certificates and refuses to overwrite partial fixtures; inspect expired fixtures before replacing them. Stop and remove only this dedicated environment with:

```sh
docker compose -f tests/fixtures/mysql/compose.yml down
```

The driver is pinned to `mysql2@3.24.6`. A version-pinned protocol adapter negotiates result-ending OK packets on the main connection and adapts the text-query states that otherwise expect legacy EOF. It observes native status/session transaction trackers without mutating packet data/offsets or issuing probes after successful SQL. ERR packets have no transaction flags, so the adapter reads `SHOW WARNINGS` after an error; it does not replay failed SQL. Tests verify preservation of `ROW_COUNT()` and diagnostics. Driver updates must revalidate the adapter. Named binds are escaped at lexer-identified positions using the driver's escaping, rather than whole-string substitution or prepared casts that can narrow an unsigned BIGINT.

## Git and AI

The header uses the same Git and AI menus as Oracle/PostgreSQL. Git settings, normal Push/Pull, conflict handling and branch protections use the existing common implementation. The shared workspace is used, with MySQL sources separated under `MonaBase/MYSQL/<database>/<category>/`. No remote is configured or pushed automatically by this feature.

Table, View, Index, Trigger, Procedure and Function expand into cached, searchable 100-item lists. The source tab reads complete native `SHOW CREATE` output and relevant creation SQL mode/character-set information. Missing definition privileges are reported as errors, including a NULL routine definition; no empty source is committed as a successful read. View/routine/trigger source drafts can be edited locally or exported. The table Source tab directly displays the shared read-only version-control component and has no coding-AI editor. Git Commit, history, comparison of revisions and the schema-wide review use the common Git screens. A schema review reads definitions from the DB; the table/view/trigger/procedure/function Git tabs record the fetched DB definition. Git actions do not apply SQL; the separate explicit compile controls do.

Configure an OpenAI-compatible provider through AI → Settings. SQL and definition editors expose the shared Ask AI button, reference-object selection, request brief, environment information, send preview and explicit diff/adoption workflow. SQL proposals identify the MySQL 8.4 dialect. Definition proposals must retain the selected category/schema/name and are adopted only into the local editor. Routine/trigger conversations and adopted summaries are scoped to the MySQL connection and can supply Git commit summaries. SQL requests remain editor-scoped, as in the existing SQL workspaces.

MySQL environment information describes the actual main session: version, default database, SQL mode, timezone, character set, collation and case handling. Immutable settings are captured on connection; the current default DB is tracked by the adapter. Reading this context does not issue a new SQL probe, overwrite ROW_COUNT(), commit or roll back pending work. Definition metadata uses the background connection and contains no table rows. Native source can contain a DEFINER account and comments: inspect the send preview before sharing it. Provider credentials and connection passwords are never added to that context.

For views, triggers and foreign keys, catalog references can be offered as additional AI targets. Routine Information tabs also offer references/dependents: catalog-confirmed dependent views are labelled separately from source-inferred table/routine/trigger candidates. Dynamic SQL and external callers cannot be resolved completely; select additional AI objects explicitly. AI cannot directly access the DB or execute/apply its answer. Procedure, function and trigger compilation use explicit SQL review; replacement is never silent. Function/procedure trace analysis is available with the limits described below.

The optional end-to-end Git/AI check uses the real disposable DB and real local Git, but replaces only the paid AI boundary with deterministic responses:

```sh
MONABASE_MYSQL_DISPOSABLE=1 MONABASE_MYSQL_UI_FEATURES=1 env -u ELECTRON_RUN_AS_NODE npx electron tests/e2e/mysql.cjs
```

It checks send preview, SQL adoption, procedure-source adoption, unchanged native definitions, and real Git commits. It makes no paid API calls and uses no real API key. The MySQL Integration job also runs it with Xvfb. The disposable service alone enables `log_bin_trust_function_creators` so the test account can create its function fixtures; do not copy this setting to a business server.

MySQL metadata references: [SHOW CREATE PROCEDURE privileges](https://dev.mysql.com/doc/refman/8.4/en/show-create-procedure.html), [CREATE PROCEDURE/FUNCTION grammar](https://dev.mysql.com/doc/refman/8.4/en/create-procedure.html).

## Table window

Expand **Table** in the sidebar, search or load another 100 items, then double-click the table (or select it and press Enter). The opening indicator paints before metadata and data loading start. The layout follows the existing Oracle table window.

| Tab | MySQL behavior |
| --- | --- |
| Data | Bound filters and ordered sorting, 100-row server pages, exact BIGINT/DECIMAL/temporal text, inline cell editing, record editing, insert/duplicate/delete, CSV/clipboard import, page export and transpose. Blank text, SQL NULL and DEFAULT are separate choices in the record dialog. |
| Structure | Native columns, defaults, generated expressions, index columns/expressions/visibility, CHECK constraints and triggers. Add/rename/drop columns, change the table comment or AUTO_INCREMENT counter, add/drop indexes or CHECK constraints, or drop the table after SQL preview. Use the SQL window for column type/default changes, expression indexes and advanced definitions. |
| Relation | Incoming and outgoing foreign keys with composite columns in ordinal order, cross-database targets, ON DELETE and ON UPDATE rules. Add foreign keys after reading the referenced columns; remove only a foreign key owned by the current table. Incoming relationships are read-only. |
| ER Diagram | The current table and up to 30 directly related tables, including cross-database references, with native columns, PK/FK markers, comments/type/logical-name toggles, zoom/pan and PNG export. Metadata failures are shown explicitly. This does not enable the separate custom ER editor. |
| Statistics | Catalog table properties and per-index-column cardinality. InnoDB row counts/cardinalities/sizes are estimates; no ANALYZE TABLE or implicit transaction completion is performed by these reads. |
| Source | Complete native SHOW CREATE in the same read-only VersionControlTab used by Oracle tables, with refresh, Git commit/history/compare. There is no extra source/Git wrapper or editable coding-AI draft here. Definition changes are made through explicit table actions or SQL. |

Data and writes use the existing **main connection**. Metadata uses **execute-sql-bg** and never commits pending rows. Inserts require InnoDB; updates/deletes additionally require a complete primary key and safely comparable types. Primary-key and generated-column editing is disabled. Binary fields use hexadecimal pairs in the record dialog; spatial values are displayed but not edited. Inline writes refetch the stored row, including generated values, before releasing the operation guard.

Updates/deletes check both the original primary key and the complete original row image, using byte-exact comparisons for text. A zero-row result is a conflict, not a successful edit. No automatic replay or whole-transaction rollback occurs. Deletions and imports report already completed pending writes on partial failure. Commit/Rollback is shared across SQL/table tabs and refreshes the active table's data. MySQL's repeatable-read snapshot may require finishing the current transaction before another session's changes become visible; Refresh does not silently end that transaction.

**Structural changes use MySQL DDL and may implicitly commit all pending work on the shared main connection, including when a DDL request fails.** Every structural action requires a SQL preview; destructive actions also require the exact table name. An attempted DDL is not resent automatically. Close, refresh and inspect its outcome before requesting another change. The GUI does not toggle `foreign_key_checks` or alter server settings. Read-only connections cannot execute any of these mutations.

Exports currently include the displayed page; their tooltip states this limit. The SQL window and native SQL remain available for more advanced workflows. No dependencies or Oracle/PostgreSQL SQL paths were changed to add the table window.

`npm run test:ui` also starts an isolated Vite development server on a temporary local port/cache and runs the MySQL workspace smoke test against native development ES modules. This catches module-initialization cycles that the production bundler can mask. It does not use the developer's running server, personal connection settings or paid APIs. The shared ER table node lives in `src/features/er/TableNode.tsx` and imports no ER window/controller.

To run only this development startup regression (without rebuilding distribution assets), use `node scripts/run-ui-tests.cjs --development-only`. Its dependency scan starts only from the application `index.html`, avoiding unrelated local HTML documents.

## Oracle-style table sidebar

| Control | MySQL behavior |
| --- | --- |
| Database / Table | Expand/collapse in place. Opening Table fetches its first 100 tables; collapsing and reopening reuses the cached list. Internal databases are hidden unless they are the connected default database. |
| Search / clear / refresh | Search is debounced and values are bound. A refresh starts at the first page while preserving the search. Old responses cannot overwrite a newer search. Failure retains earlier rows and offers explicit retry. |
| Show 100 more | Append the next page without duplicate rows. Disabled while loading or while a new filter is pending. |
| Select / open | One click selects; double click, Enter or right-click Open opens the table window. Arrow keys navigate the schema/category/object hierarchy; Shift+F10 opens the selected table menu. |
| New table (+) | Open a table-creation workspace. Add/edit/remove column definitions, primary-key columns, nullable/default/comment values and native AUTO_INCREMENT. Review CREATE SQL before executing. A successful create opens the table and refreshes/expands its category. |
| Open in SQL window / copy table name | Open a new SQL editor with a quoted SELECT for the target, or copy its unqualified name. Neither executes SQL automatically. |
| Rename / copy | Preview native RENAME TABLE or one CREATE TABLE ... AS SELECT. Rename closes obsolete object tabs and updates the corresponding Git source if available; Git failure never retries DB SQL. Copy materializes columns/data without indexes, keys, auto increment, generated expressions, triggers or comments, matching the Oracle CTAS workflow. |
| Gather statistics | Preview and execute native ANALYZE TABLE. MySQL's result rows are checked for reported errors. No Oracle sampling-rate option is exposed. |
| Import | Open the existing clipboard/CSV preview and insert into the selected InnoDB table on the main connection. Values remain pending until Commit. All input rows are validated before the first insert; partial failures report completed pending rows without automatic rollback/replay. |
| Export | Open the existing clipboard/CSV/Excel dialog and export the selected table using one main-session SELECT, including pending changes. Pages are read from that immutable materialized result, not separate DB queries. The existing driver limit (10,000 rows / 16 MiB) causes an explicit error rather than silently truncating large exports. |
| Truncate / drop | Preview SQL and require the exact table name. MySQL DDL commits implicitly and cannot be undone by Rollback. Incoming foreign keys may prevent these operations; foreign_key_checks is never disabled. Drop closes obsolete object tabs and updates Git separately. |

The category refreshes after successful SQL-window DDL, GUI creation and context-menu mutations. SQL windows remain available from the View menu and Ctrl/Cmd+N. Oracle's recycle bin, PURGE and sampling percentages are not implemented for MySQL. Read-only/unknown/busy connections disable mutations; a full tab count does not prevent browsing or transfers.

The copy/statistics semantics follow the [MySQL CREATE TABLE ... SELECT reference](https://dev.mysql.com/doc/refman/8.4/en/create-table-select.html) and [ANALYZE TABLE reference](https://dev.mysql.com/doc/refman/8.4/en/analyze-table.html).

## SQL workspace regression coverage

The SQL screen reuses the Oracle/PostgreSQL result/log/history panel and pane controls. `tests/mysql-sql-workspace.test.cjs` checks MySQL quote/comment boundaries, the reported fifteen-row employee INSERT, selection-only execution, sequential requests, stop-on-error/cancel, history privacy, immutable analyzed snapshots, bind masking and alias-safe tuning metadata. `tests/mysql/sql-window.test.cjs` verifies that INSERT, Commit/Rollback, savepoints, readonly planning and background tuning metadata work against the disposable MySQL 8.4 service. The employee data is fictional and test tables use random MBT names with cleanup.

Electron UI tests exercise history recall into a new tab, the estimated plan tree, tuning-file export without AI, an integrated AI send preview without submitting a request, and cancellation before the next script statement. Existing Git/source/table workflows continue to run. No paid AI API is part of these tests.

Planning and execution times are distinct. MySQL optimizer statistics and costs are estimates; obtaining a plan does not measure the target query. MySQL may evaluate expressions during optimization, as documented for [EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html); inspect SQL and functions before requesting a plan. User-defined functions can have side effects. Complex CTE/view dependencies and inaccessible table metadata are explicitly left unresolved rather than guessed. The initial plan decoder accepts MySQL 8.4's query_block JSON representation and reports unsupported representations as errors.

### Table header and source parity

The data-grid header uses the Oracle interaction: clicking a supported column runs a database search sorted ascending, clicking it again sorts descending, and choosing another column clears other sort priorities. Existing filter inputs are preserved and the search returns to page one. Native grid menus/client filtering are disabled. Applied filters and sort direction/priority use the shared result-header decorator; editing a condition alone does not change the marks on an existing result. Disabled columns, transposed headers and busy/unknown-state actions do not start a search.

The table Source tab directly renders `VersionControlTab` with the native SHOW CREATE definition. It offers the common current-source/history/compare/commit and refresh controls. Coding-AI and editable draft controls from the separate routine SourceWindow are absent. Definition changes invalidate the table source; a hidden tab refreshes on its next visit. Failed source retrieval blocks recording a stale/empty definition and provides Retry. MySQL routine/view/trigger draft editing remains available in its separate window.

### Vertical pane sizing

SQL editor/results and the table Data, Structure and Statistics tabs use draggable horizontal dividers, following the Oracle layout. Data separates conditions from results; Structure separates columns from the scrollable index/check/trigger sections; Statistics separates table properties from per-index-column statistics. Initial upper heights match Oracle: 250, 300 and 200 pixels respectively. Drag a divider, focus it and use Up/Down (Shift for larger steps), or double-click to balance the panes. Both sides retain usable space as the window shrinks.

Visited table metadata tabs remain mounted so their chosen split heights survive switching tabs. Hidden grids defer rendering to avoid zero-size measurements. Relations and ER keep their existing single views; Source history/diff already uses the shared version-control divider. Resizing does not run SQL, change a transaction or write a configuration file.

### Read transactions versus pending work

MySQL can start a read transaction for an ordinary InnoDB SELECT when autocommit is disabled. Its native `transactionStatus` therefore stays active, but this is not sufficient to animate Commit/Rollback. The UI uses `hasUncommittedTx`, obtained from the server's write/locking state rather than guessing from SQL text.

The main connection enables session-scoped `session_track_transaction_info=STATE`. Result-ending OK packets deliver those notifications even when a SELECT calls a stored function that writes. Plain reads remain unhighlighted, pending writes survive later reads, locking reads are highlighted, and full Commit/Rollback or implicit DDL commit clears the state. Native flags remain conservative: a zero-row UPDATE or rollback to a savepoint can retain write/locking state until the full transaction ends. No automatic Commit/Rollback was added.

The adapter is restricted to the client's text-query path and pinned mysql2 version. It validates capabilities and packet lengths, distinguishes large length-coded rows from result terminators, and treats malformed/unknown state as unknown. Successful statements do not trigger a PING or extra SQL (which could overwrite ROW_COUNT/warnings). Background connections keep their existing protocol and cannot overwrite the main state. No global server setting or additional privileges are required.

References: [MySQL native transaction trackers](https://dev.mysql.com/doc/c-api/8.4/en/mysql-session-track-get-first.html), [session tracking configuration](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_session_track_transaction_info), [OK result terminators](https://dev.mysql.com/worklog/task/?id=7766).

## Data generator

Open **View → Data generator** (also available in command search). The Oracle-style window shares its table-only 100-item picker, column rules, preview, progress/Stop and JSON settings controls with Oracle. Supported rules include numeric/date sequences, random numbers/strings/regular expressions/dates/times, choices, fixed values and NULL rates. MySQL metadata retains integer signedness, DECIMAL precision/scale, character lengths and temporal precision. AUTO_INCREMENT, generated and unsupported columns are excluded; an unsupported required column without a default prevents generation. Only InnoDB base tables are accepted.

Preview creates no database rows. Execute confirms the destination and count, inserts bounded batches with bound values and leaves Commit/Rollback to the user. Stop prevents the next batch; earlier batches can remain pending after a stop or error. Read-only connections can prepare rules and previews but cannot execute generation.

With AI configured, the request opens the common AI sidebar: inspect the send preview and explicitly send it. Context includes SHOW CREATE, indexes, checks, triggers and foreign keys. Up to 100 existing parent-key tuples per outgoing foreign key are read on the main connection, including its pending rows; review this content before sending. Composite foreign keys require correlated fixed tuples, not independent choices. A response applies validated JSON rules only; it never inserts data automatically. Responses for changed targets/rules are rejected. Without AI configuration, export the prompt for an external chat, obtain JSON and import it through the same settings control. External AI output remains untrusted and database constraints still apply.

`tests/mysql-generator.test.cjs` uses mocked AI only; `tests/mysql/generator.test.cjs` runs all rule families, pending parent samples, exact numbers, previews and rollback against the disposable fixture. Ordinary checks do not call paid AI.

Generation previews format DATE/DATETIME/TIMESTAMP columns with `outputDateFormat`, parsing generated values with `inputDateFormat`. Formatting changes display only; bound insert values retain their original precision. AUTO_INCREMENT and computed columns are labeled **Database managed**, with distinct explanations, rather than being described as unsupported LOB types. They remain omitted from INSERT so MySQL assigns them.

## Query builder

Open **View → Query Builder** or **Ctrl/Cmd+Q**, or use command search. The canvas and controls are shared with Oracle: add tables/views from the 100-item picker, double-click or drag columns into the design grid, drag a column onto another table's column to join, then configure conditions, OR conditions, visibility, aggregates and sorting. INNER/LEFT/RIGHT joins, composite joins and disconnected CROSS JOIN groups are supported; cyclic/self joins and HAVING are rejected. Undo/Redo and JSON Read/Save operate on the design. Files carry `dbType: mysql`; files from a different database type are refused.

Generated MySQL SQL quotes database, table and column names with backticks. Conditions follow the restricted builder expression syntax: SQL comments, additional statements and subqueries are refused. MySQL backslash escapes are unavailable here to avoid ambiguous quote parsing; double embedded apostrophes instead. Use the SQL window for advanced expressions.

Table/view columns and AI definitions use background reads, including SHOW CREATE and comments. Execute uses the main connection, sees pending rows and propagates native transaction state to the common Commit/Rollback controls. It never automatically commits or rolls back. Unknown state disables further execution. Result/log/history controls follow Oracle; read-only connections retain the driver's existing read-only enforcement.

Configured AI receives only the added objects' native definitions, types, comments and current design, not table-row samples. Preview the send content and explicitly send. A valid JSON response becomes a before/after SQL and design review. Applying rechecks fresh metadata and updates the design only; execution is a separate action. Changed settings, changed metadata, foreign objects and invalid MySQL conditions are refused. Ordinary tests use mocked AI, never paid requests.

## Cross-tabulation

Open **View → Cross Tabulation**, **Ctrl/Cmd+P**, or command search. Select a database, TABLE or VIEW and an object, then click Start Setup. Configure row/column fields, casts, date grouping (year/quarter/month/day), integer numeric classes and SUM/COUNT/AVG/MAX/MIN. SUM/AVG require a numeric value column. A text date can use a full date, year-month or year-only format; missing month/day default to January/the first day. Text-to-number casts are validated against DECIMAL(65,30) capacity; invalid filtered values fail rather than silently becoming zero. Binary, JSON and spatial columns are omitted from the supported field list.

The setup, filters, result/export controls, graph choices, settings Read/Save and vertical splitter share the Oracle view. MySQL conditional aggregation replaces Oracle PIVOT. Axis category labels are bound values, and technical result fields avoid collisions with category names such as ROW_VALUE. Table values, sorting and exports preserve exact BIGINT/DECIMAL text and fractional digits. Charts provide a visual numeric approximation. NULL categories are excluded from pivot columns; COUNT counts non-NULL value cells, while SUM/AVG/MIN/MAX retain NULL for missing category cells.

Metadata uses background reads; validation, category discovery and aggregation use the main connection and include its pending rows. No automatic Commit/Rollback is performed. A normal aggregate read does not mark pending writes. The window accepts up to 200 categories and refuses larger results; existing results are kept on errors and empty input. Native result-size limits remain in force. Unsupported casts, invalid settings, wrong-DB files, stale responses and state-unknown execution are refused.

Settings files carry `version: 1` and `dbType: mysql`, are limited to 1 MiB and are checked against freshly loaded columns before atomic adoption. Import does not execute aggregation. Chart types are bar, line and area, with PNG clipboard copying. Only TABLE and VIEW are offered; materialized views are not a MySQL feature. Object lists use the existing 100-item backend pages, with a 10,000-object bound for the Oracle-style dropdown.

## ER diagrams

Open **View → ER Diagram Viewer**, **Ctrl/Cmd+E**, or command search. The automatic and custom windows use the same components and controls as Oracle. Automatic generation shows the selected table and its direct parents/children, or all base tables in the selected database. Custom mode adds TABLE/VIEW objects through the common 100-item picker, keeps placements and virtual relations, and supports Undo/Redo, comments, logical names, data types and PNG export. It does not create database foreign keys or execute DDL.

MySQL information_schema metadata preserves native COLUMN_TYPE text, PK/FK columns, composite constraints, comments and exact schema/name identities. Schema-wide diagrams include accessible external parents once; selected-table generation remains limited to direct neighbors. Missing related metadata fails the operation instead of showing a misleading incomplete diagram. Views can be placed in custom diagrams; their generic MySQL TABLE_COMMENT value VIEW is not used as a logical business name.

Custom documents use the existing version-2 schema-aware JSON format and are isolated under `MonaBase/MYSQL/ErDiagram` in the selected Git workspace. Saving/committing, paginated history, comparison/restoration and reviewed schema synchronization use the existing ER infrastructure. Synchronization changes only the diagram, preserves virtual edges and requires explicit adoption. All DB metadata reads are background reads and do not change the main connection's pending state or commit/rollback. ER metadata loading remains local to the window, so main-session transaction controls remain available as in Oracle. No external Git push is performed automatically.


## Indexes

Expand **Index** under a database in the left sidebar. The inline list uses the same selection, keyboard navigation, search, retry, cached expansion and 100-item pagination as the table list. Search matches both index and owning-table names. Labels and tab identities include the table because MySQL allows identical index names on different tables. Right-click to open/copy an index name, create an index, rename, review a visibility change or deletion, or refresh the category. Mutating actions open the same guarded editor/review; they never execute immediately.

The index window follows the Oracle **Edit / Statistics / Source** layout with an execution console and resizable console divider:

- **Create**: select a table with the shared searchable 100-item picker. Add columns with + or double-click, or select multiple available columns with Ctrl/Shift and use the transfer arrows; select key parts with Ctrl/Shift, reorder with the arrow controls, and specify DESC or BTREE prefix lengths. Scalar functional key parts are supported for BTREE; UNIQUE, FULLTEXT, SPATIAL and visibility use MySQL semantics. MySQL validates engine, expression, key-length and data-type restrictions.
- **Edit**: rename or toggle visibility, applying **one change at a time** (MySQL 8.4 rejects combining these in one ALTER TABLE). Changing key columns/type requires explicitly recreating the index. Oracle-only BITMAP, REVERSE and ALTER INDEX REBUILD are not emulated.
- **Statistics**: per-key-part cardinality estimates, prefix lengths, expression, A/D direction, type and visibility. Refresh uses background reads and does not commit pending work. Statistics collection remains in the table window.
- **Source**: an exact native key clause extracted from SHOW CREATE TABLE and displayed as ALTER TABLE ADD, preserving expression, prefix, direction, comments and visibility options. Source is read-only and copyable; it is not an automatic migration or a new Git source type.
- **Safety**: preview the single SQL statement and implicit-commit warning before execution. Deletion requires the exact index name. PRIMARY changes belong in the table structure editor. Possible foreign-key-supporting indexes cannot be deleted or hidden here. Dropping a UNIQUE index warns that uniqueness will be removed. Existing definitions/dependencies are reread before execution; changed metadata refuses the old review. Failures are never automatically resent. Only native main-session responses update transaction indicators; metadata never overwrites them. Native DDL may commit pending work even on failure.


## Views

Expand **View** under a database to search and page through 100 entries at a time. The category uses an independent cache and the same keyboard/selection/open/retry behavior as tables and indexes. The + button opens a schema-qualified CREATE VIEW template in the SQL window, matching Oracle's entry point. Right-click a view to open it, open SELECT in SQL, copy its name, export data or request reviewed deletion.

The dedicated window follows Oracle's four tabs:

| Tab | MySQL behavior |
| --- | --- |
| Data | Main-session SELECT includes pending rows. Applied filters, Oracle-style header sorting, exact values, outputDateFormat, row/column transpose, 100-row pages, execution logs and a draggable/keyboard split. Data is read-only even for updatable views; table insert/update/delete/import controls are hidden. Export reads one complete filtered result within the native 10,000-row/16-MiB limits; transposed export uses the current page. |
| Edit | Full CREATE OR REPLACE definition, preserving ALGORITHM, DEFINER, SQL SECURITY and CHECK OPTION. AI uses the existing preview/review/local-adoption flow; adopting a draft never runs SQL. Compile/save previews one statement and rereads the native definition/dependencies before applying it on the main connection in the view's database. DDL implicit-commit rules still apply. |
| Version control | Shared MYSQL/VIEW Git component, using the actual native DB source rather than the unsaved draft. Successful compile records the refreshed native source in local Git; deletion removes its source record. A Git failure never repeats a completed database operation. |
| View information | Native column types/nullability, referenced tables/views and dependent views from visible dictionary rows, plus security/definer/check/updateability/character-set settings. Refresh preserves uncommitted main-session work. |

Deletion requires the exact view name, refuses known dependent views and revalidates the reviewed definition. Changed metadata or failed DDL is not automatically retried. Reload preserves an existing local edit; failed source reads disable mutation and Git use until retry succeeds. Only native main-session responses update transaction indicators. Oracle-specific status, FORCE/EDITIONING or table DML semantics are not emulated. Native VIEW security headers are accepted by the MySQL SQL policy; stored-program, temporary-table, executable-comment, multi-statement and readonly restrictions remain enforced.


## Triggers

The **Trigger** category now expands inline with its own cached search, 100-item pages, retry, create/open/copy/delete controls and keyboard navigation. The table **Structure → Trigger** section opens the same editor by trigger name and supports adding a trigger with that table preselected or requesting reviewed deletion.

The editor follows Oracle's **Edit / Source / Version control** structure. Select an InnoDB table, a single INSERT/UPDATE/DELETE event and BEFORE/AFTER timing; MySQL triggers always run FOR EACH ROW. Edit the statement/body or use the existing AI preview/review/adoption flow. AI adoption never applies DB changes. Source and Git use the actual native definition with its creation-mode metadata. Successful operations record/delete the MYSQL/TRIGGER source in local Git.

MySQL has no CREATE OR REPLACE TRIGGER or enable/disable switch. Oracle statement/INSTEAD OF triggers are not emulated. MySQL scalar trigger tracing uses the isolated recorder described below. Replacement is an explicitly reviewed **DROP + CREATE**, requires the exact name and may temporarily leave no trigger for other clients. Use a maintenance window for production. Definition/order fingerprints are checked before any DDL. Relative execution order, definer, supported original SQL mode and UTF-8 creation character/collation settings are preserved. Unsupported stored ANSI_QUOTES/NO_BACKSLASH_ESCAPES/non-UTF-8 creation modes fail before replacement; source and deletion remain available.

If replacement creation fails, the operation reports its stage and retains a bounded, connection-local recovery snapshot for 15 minutes. **Restore previous trigger** previews an explicit recovery action; it is never run automatically. Recovery refuses an existing same-name trigger or changed peer order. The previous definition remains available in the source pane after recovery errors. Unconfirmable outcomes or failed session-setting restoration invalidate the main connection and require reconnecting/verification. Ordinary SQL still rejects trigger/routine DDL; the dedicated IPC validates one trigger body, rejects appended SQL, executable comments, server/session management and file/advisory functions, and keeps mysql2 multipleStatements disabled.


## Procedure category and window

The **Procedure** category follows the Oracle sidebar: expand to fetch, search by name, load another 100 items, click to select, double-click or Enter to open, and use the context menu to open, copy the name or delete. The plus button opens a new procedure editor. Function has its own category/window with the same layout, described below.

| Area | Behavior |
| --- | --- |
| Source | Edit one complete CREATE PROCEDURE definition. Execute the saved DB routine, refresh, compile, delete or request AI assistance. Compiler actions show SQL for explicit review; replacement/deletion require the exact procedure name. |
| Arguments | IN and INOUT values are editable; blank is NULL. OUT inputs are disabled. Date/calendar inputs accept the configured inputDateFormat or canonical MySQL date text. Inputs are escaped as scalar values, never treated as SQL expressions. |
| Results | Display OUT/INOUT values and each CALL result set separately, preserving exact BIGINT/DECIMAL and binary values. Calendar output uses outputDateFormat. The results/console area and source can be resized vertically; the argument panel can be resized or collapsed. |
| Version control | Common MYSQL/PROCEDURE Git view for the actual native definition, creation SQL mode and character metadata. Successful compilation records that fetched definition. Unsaved drafts are never mislabeled as deployed source. Git failure does not rerun SQL. |
| Information | Refresh with an outlined icon button; inspect schema/name, definer, SQL SECURITY, SQL DATA ACCESS, determinism, comment, timestamps, SQL mode, charset/collation and complete native source. |
| AI | Shared request preview, reference selection, response comparison and explicit local adoption. New procedures are not fetched as existing DB references. Adoption never compiles or executes a procedure. |

MySQL has no CREATE OR REPLACE PROCEDURE. Body/parameter changes require **DROP + CREATE** and can implicitly commit pending work. The dedicated service preserves the original definer, creation SQL mode and character settings. Changing the definer through this editor is unsupported. MySQL manages routine-specific privileges when dropping/creating routines; when the creator changes, review EXECUTE/ALTER ROUTINE grants after replacement. The application does not grant server privileges automatically. See [ALTER PROCEDURE](https://dev.mysql.com/doc/refman/8.4/en/alter-procedure.html) and [DROP PROCEDURE](https://dev.mysql.com/doc/refman/8.4/en/drop-procedure.html).

Before replacement or deletion, fresh metadata must match the reviewed fingerprint. A server syntax error after DROP can leave the routine missing: a connection-local backup is retained for 15 minutes (up to 16 snapshots), and **Restore original procedure** requires an explicit review. Recovery never overwrites an existing routine and is never automatic. The stored source remains available if recovery fails. Reconnect/verify after an unknown outcome; do not automatically retry.

CALL uses the main connection and dedicated execute-stored IPC. Metadata uses the background connection and does not change pending rows. A CALL may modify data or commit/roll back internally: native transaction state determines the toolbar, not SQL text. Errors do not cause an application-wide rollback or replay. Read-only/unknown connections cannot execute procedures. Native cancellation/timeout remains available for CALL; multi-step DDL replacement cannot be cancelled halfway from the UI. Creation mode/charset restrictions match trigger editing. Server/session management, dynamic SQL and file/advisory functions are excluded from editor bodies; existing routines changing protected session settings invalidate the connection.

All result sets together are limited to **10,000 rows / 16 MiB / 100 sets**. OUT/INOUT variables use generated, connection-local names and are cleared afterward. A failing cleanup requires reconnecting. Scalar MySQL routine tracing has a dedicated recorder/replay workflow described below. Oracle DBMS_OUTPUT and package behavior are not emulated.


## Function category and window

The **Function** category follows the Oracle-style tree, with cached expansion, name search, 100-item pages, create, open, copy name and confirmed deletion. Double-click or Enter opens the dedicated function window. Its source, Git, information, argument and resizable result/console areas share the procedure layout.

| Area | Function behavior |
| --- | --- |
| Source | Edit one CREATE FUNCTION definition with parameters, RETURNS, characteristics and RETURN body. The initial template declares DETERMINISTIC / NO SQL because it only returns its input; adapt these declarations truthfully when changing its behavior. Compile and deletion use SQL review; replacement/deletion require exact-name confirmation. |
| Arguments | MySQL function parameters are all IN. The catalog return-type row (ordinal position 0) is excluded from inputs. Empty fields become NULL; scalar input is escaped. Calendar inputs accept inputDateFormat or canonical MySQL text. |
| Execution / return | The dedicated execute-stored channel runs SELECT qualified_function(values) on the main connection and displays RETURN_VALUE using its actual RETURNS type and outputDateFormat. Exact decimals/BIGINT, Unicode, NULL, binary and fractional date/time values remain intact across IPC. A function may modify data: native state controls Commit/Rollback. Calls do not auto-commit, retry or roll back the whole transaction after errors. Read-only/unknown connections cannot run arbitrary functions. |
| Git | Shared MYSQL/FUNCTION source/history/diff. Successful compilation records SHOW CREATE and creation-mode metadata from the DB; it never records an unsaved draft as deployed source. Git failure does not rerun SQL. |
| Information | Refresh with an outlined icon button. Inspect RETURNS, definer, security/data-access/determinism, timestamps, comment, SQL mode, charset/collation and native source. Metadata refresh remains available in read-only mode. |
| AI | Shared coding_function request, reference selection, send preview, diff and explicit adoption. Adoption changes the local editor; compilation remains a separate reviewed operation. |

Stored functions return a scalar rather than the procedure CALL result sets. MySQL prohibits COMMIT/ROLLBACK and result-set-producing statements inside stored functions. The function editor validates transaction-control restrictions and a RETURN body; the server remains authoritative for SQL/type semantics. It does not add loadable UDF/plugin installation or App Sandbox behavior. Supported trace recording is described below. See [CREATE PROCEDURE / CREATE FUNCTION](https://dev.mysql.com/doc/refman/8.4/en/create-procedure.html).

Functions also require DROP + CREATE for body changes. The same fingerprint, original-definer/mode preservation, implicit-commit warning, bounded explicit recovery and no-replay safeguards apply. Recovery tokens include the routine kind: a FUNCTION backup cannot be restored as a PROCEDURE. Routine-specific privileges may change when the creator changes; the application does not grant server privileges.

Binary logging may require additional server privileges or administrator configuration for CREATE FUNCTION. Permission errors remain errors; MonaBase does not enable log_bin_trust_function_creators or grant privileges on a user's server. The existing disposable test service already enables its own test-only setting. See [Stored Program Binary Logging](https://dev.mysql.com/doc/refman/8.4/en/stored-programs-logging.html).


## AUTO_INCREMENT management

MySQL 8.4 uses table-column AUTO_INCREMENT rather than standalone Oracle-style sequences. Open a table, select **Structure**, and use **Auto increment** at the top of the lower pane, above the index list.

| Item | Behavior |
| --- | --- |
| Auto-increment column / type | Shows the actual column and SQL integer type, including UNSIGNED. A table without such a column displays a message and disables changes. |
| Observed AUTO_INCREMENT | Reads the live SHOW CREATE TABLE option. INFORMATION_SCHEMA.TABLES can cache this counter; its cached value is not used for this display. An omitted native option denotes the initial value 1. Background reads do not commit pending main-session data, reserve an ID or change server settings. |
| Type maximum | Calculates the signed/unsigned TINYINT, SMALLINT, MEDIUMINT, INT or BIGINT limit with BigInt. Counter input remains decimal text, so BIGINT UNSIGNED values are not rounded through JavaScript Number. |
| Change AUTO_INCREMENT | Accepts a positive integer within the column's range. Preview shows a single qualified ALTER TABLE. Enter the exact table name before execution. No expression, exponent notation, decimal, negative number or appended SQL is accepted. The unchanged observed value is refused before DDL. |
| Result / refresh | The successful ALTER is followed by a fresh metadata read. If metadata retrieval fails after the DDL was applied, the UI reports that distinction and disables another counter change until a successful refresh. It does not repeat the ALTER. |

**ALTER TABLE implicitly commits pending work.** Rollback does not restore the counter setting or undo earlier work committed by that DDL. Existing row IDs remain unchanged. MySQL can adjust a requested counter below existing IDs, so the displayed observed value after execution may differ from the requested value. Concurrent inserts, auto_increment_increment/offset and rolled-back inserts also affect generated IDs; the observed counter is not a reservation or a guarantee of the next inserted ID. MonaBase does not modify global/server increment or offset settings.

Only InnoDB base-table counter changes are enabled. Read-only, busy, unknown-state or failed-metadata views cannot change the counter. This adds no sequence category, synthetic sequence table or NEXTVAL emulation.

References: [Using AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.4/en/example-auto-increment.html), [ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html), [InnoDB AUTO_INCREMENT handling](https://dev.mysql.com/doc/refman/8.4/en/innodb-auto-increment-handling.html).


### Structure columns and editing

The upper Structure grid separates **Data type** from **Length/Precision**, shows PK and UK positions, leaves non-PK cells blank, and distinguishes composite keys by color. Character lengths use character counts rather than byte sizes; DECIMAL displays precision and scale; TIME/DATETIME/TIMESTAMP show fractional-second precision only when greater than zero. Zero precision is displayed as a blank. UK tooltips identify the unique index and any prefix length. Functional key parts remain visible in the index list. CHECK constraints and Triggers start collapsed and can be expanded independently.

The column edit action supports name, type, length/precision, scale, UNSIGNED, ENUM/SET members, NULL allowance, default values/expressions and comments. Column additions use the same form. A SQL preview and exact table name are required before one execution attempt. Type changes can convert existing values, rebuild/lock the table or fail. ALTER TABLE implicitly commits pending work; Rollback cannot undo that DDL.

MySQL's EXTRA describes attributes such as AUTO_INCREMENT, ON UPDATE and generated-column storage. GENERATION_EXPRESSION is the formula for a generated column. These details appear in the column editor rather than crowding the grid. Generated formulas are read only; use the SQL window for advanced definition changes. Unedited native attributes are preserved from SHOW CREATE TABLE, including charset/collation, expression defaults, automatic updates, auto-increment and invisible/generated attributes. Before execution, the current column definition is checked again. This detects changes already visible at preflight; it does not lock out concurrent administrators. Unsupported native syntax is rejected by the existing SQL guards.

The Structure tab omits persistent help paragraphs and the workspace-wide transaction hint to leave more room for the grids. SQL previews and execution-time DDL warnings remain available when making changes.

MySQL treats database and schema as synonyms. The sidebar continues to show other accessible non-system databases; open their objects directly or use **Open in SQL window**, which inserts a database-qualified query while retaining the connection database as the SQL tab default. Object windows continue to use their actual database identity. Access is limited by the connected user’s MySQL privileges.


## CHECK constraint window

Expand **CHECK Constraint** in a table’s Structure tab. **Add** opens a new dedicated editor for that table; click an existing constraint name to edit it, or use its delete action. Existing windows are reused. As in the Oracle workspace, there is no separate CHECK sidebar category.

| Item | Behavior |
| --- | --- |
| Schema / Target table | Fixed to the table that opened the window, including another accessible database. |
| Constraint name | Required, case preserved, identifiers safely quoted. |
| Enable | Maps to MySQL ENFORCED / NOT ENFORCED. Enabling checks existing rows and can fail when rows violate the condition. |
| Condition | MySQL SQL editor with target-column completion. Editable for new CHECKs; existing conditions are read only, matching the Oracle editor. Use explicit SQL for advanced condition replacements. |
| Create / Change / Delete | Review the exact qualified SQL and type the current constraint name (new name for creation). A request is sent once, and is not automatically retried. A name change uses DROP CHECK plus ADD CONSTRAINT with the unchanged expression in one ALTER TABLE. |
| Source / Copy | Shows the database’s actual CHECK expression and enforcement state as a recreatable ALTER TABLE, independent of unsubmitted name/enforcement drafts. Copy uses the desktop clipboard. |
| Refresh / Retry | Rereads native metadata. Missing/inaccessible definitions block mutation. A successful DDL with a failed refresh is reported separately. |

**CHECK DDL implicitly commits pending main-session work**, even when some DDL attempts fail. Rollback cannot undo that implicit commit. The existing transaction monitor reports the actual state. Metadata uses background reads; preflight compares the native definition before mutation, without promising a lock against concurrent administrators. Changes refresh the originating table’s structure/source; deleting the table also closes its CHECK tabs. No Oracle-only VALIDATE options, paid AI, extra privilege grants or server-setting changes are added.

References: [MySQL ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html), [Atomic DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html).

## DBA: User Settings

Open **DBA → User Settings**, or select User Settings in command search. The Oracle-style screen has a searchable account grid on the left and details on the right; drag or use the keyboard on its divider. MySQL identifies an account by **user and host together**. Roles and users are interchangeable accounts, so the role filter shows accounts currently granted as roles rather than guessing that every locked account is a role.

| Control | Behavior |
| --- | --- |
| List / Refresh / Export | Reads account names, hosts, authentication plugins, account lock and password-expiry status. No authentication hash is requested. Internal and known administrative accounts are hidden by default, except the current account. |
| Limited permissions | If required MySQL system-table metadata is denied, the screen explicitly shows only the current account and its SHOW GRANTS. Management is disabled; MonaBase never grants itself privileges. Other errors are reported as errors. |
| Create New | Choose USER or ROLE and specify both username and host. USER creation uses caching_sha2_password. Roles start locked, as defined by MySQL. An existing account is never silently replaced. |
| Change Password | Changes an unprotected caching_sha2_password account. The password is sent only on Execute, excluded from SQL previews/history/errors, and cleared after an attempt, closing or hiding the screen. Saved connection passwords are not edited automatically. |
| Lock / Unlock | Controls new logins; existing sessions are not disconnected. |
| Grant / Revoke privilege | Grants or revokes one supported ordinary privilege at database or global scope. No ALL PRIVILEGES, dynamic administration privileges, proxy grants or GRANT OPTION are offered. Table/column/procedure grants remain visible in SHOW GRANTS but are not edited here. |
| Grant / Revoke role | Uses explicit user@host identities, protects administrative role paths and rejects role cycles. Role administration requires ROLE_ADMIN in this UI; per-role ADMIN OPTION delegation is not edited. |
| Default role | Select a directly granted role, or NONE. This replaces the default role selection for future logins; it does not activate roles in existing sessions. |
| Resource limits | Sets queries, updates and connections per hour, plus concurrent connections. Zero removes a per-account hourly limit; a zero concurrent limit still follows the server's max_user_connections setting. MonaBase uses three sessions per connection, so a low concurrent limit can prevent connecting. |
| Delete | Drops the selected account and its role/privilege assignments. Databases and tables are not dropped. Known DEFINER dependencies, an incomplete dependency scan, protected targets or insufficient privileges block deletion. There is no Oracle-style CASCADE option. |

Details show direct database/global grants, role/default-role memberships, role recipients, limits, DEFINER references and native SHOW GRANTS text. Direct revocation does not prove that inherited, mandatory-role or object-specific access has disappeared. The current account's active roles are identified in the snapshot; this view does not inspect every existing session's effective access.

Mutations require a masked SQL preview, the exact **user@host**, an impact acknowledgement and a fresh server-side metadata check. A connection-bound review token expires after five minutes and is consumed on the first execution attempt. The current account, root, internal accounts, and known administrative/delegable privileges including role paths are protected. No authentication_string or SHOW CREATE USER output is read. Account changes use dedicated IPC and the main queue, retaining the driver's native transaction monitoring. **Account and privilege DDL can implicitly commit pending SQL-window work; Rollback cannot undo it.** A lost outcome is marked unknown and is not automatically retried. Metadata uses background reads and does not commit main-session work.

The screen supports up to 2,000 accounts. An oversized/inaccessible catalog is not presented as a complete mutable snapshot. Complete DEFINER inspection requires global catalog visibility; otherwise deletion stays disabled. This is MySQL account/resource management, not an emulation of Oracle tablespace quotas or account categories.

References: [MySQL roles](https://dev.mysql.com/doc/refman/8.4/en/roles.html), [Account management](https://dev.mysql.com/doc/refman/8.4/en/creating-accounts.html), [CREATE USER](https://dev.mysql.com/doc/refman/8.4/en/create-user.html), [SHOW GRANTS](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html).

## DBA: Object Privileges

Open **DBA → Object Privileges** or use command search. The Oracle-style matrix selects a TABLE, VIEW, PROCEDURE or FUNCTION using the common schema/category picker (100 objects per page). MySQL databases are schemas; other accessible databases can be selected. The recipient is always the exact **user@host**. No Oracle-only object types or PUBLIC/owner privilege emulation are added.

| Control | Behavior |
| --- | --- |
| Target Object / Refresh | Select and refresh a native object; background queries preserve pending main-session work. |
| Recipient search / Granted only / All recipients | Filter accounts and roles; protected recipients are hidden unless granted, self, or explicitly included. |
| Privilege checkbox | Preview one direct object GRANT or REVOKE. It does not change until Execute. |
| Recipient details | Show direct and column privileges, GRANT OPTION and available Grantor metadata. |
| Confirmation | Review SQL, type exact user@host and acknowledge the implicit-commit impact. Reviews expire after five minutes, bind to the connection and can be used once. |

The matrix supports TABLE SELECT/INSERT/UPDATE/DELETE/REFERENCES/ALTER/INDEX/DROP/TRIGGER, VIEW SELECT/INSERT/UPDATE/DELETE/SHOW VIEW, and routine EXECUTE/ALTER ROUTINE. FUNCTION and PROCEDURE remain distinct even when their names match. Column grants are displayed but not changed here. Cells with same-kind column grants or GRANT OPTION are disabled to prevent accidental flattening or broader revokes. Use independently reviewed SQL for advanced changes.

Direct object grants are not effective-access calculations: global, database and role-based access may remain after a revoke. Grantor records the last writer of an object grant row; it does not establish independent per-privilege grant chains. Routine grants come from `mysql.procs_priv`, not a nonexistent INFORMATION_SCHEMA routine-privilege view.

Complete management requires readable MySQL account/role/grant catalogs, definition visibility and global GRANT OPTION as recognized by the account service; MySQL still enforces each native grant privilege. MonaBase does not elevate permissions. Without complete catalog visibility the screen explicitly marks the result partial and disables changes; missing routine grants are unconfirmed, not evidence of no privileges. Self, internal, root and known administrative accounts are protected.

GRANT/REVOKE takes effect immediately, can implicitly commit pending main-session work and cannot be undone by Rollback. Before sending, the backend rechecks recipient, definition and grants against the reviewed snapshot; this is preflight validation, not a lock against concurrent administrators. A post-apply refresh failure is reported separately; unknown outcomes are never retried automatically. Raw object definitions remain in the main process and are hashed for comparison; no routine source or authentication data is returned by this API.

References: [MySQL grant tables](https://dev.mysql.com/doc/refman/8.4/en/grant-tables.html), [GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html), [REVOKE](https://dev.mysql.com/doc/refman/8.4/en/revoke.html).

## DBA: Session Management

Open **DBA → Session Management**, or use command search. The Oracle-style screen has a session grid above statistics and SQL details. Drag the divider or use its arrow/Home/End keys. MySQL uses connection IDs and Performance Schema THREAD_ID rather than Oracle SID/SERIAL#.

| Control | Behavior |
| --- | --- |
| Search / All, Active, Waiting | Search IDs/user/host/database/state/SQL; Active means Query; Waiting matches wait/lock state text and is an aid rather than a complete wait classification. |
| Auto-refresh | Off / 5 / 10 / 30 seconds. Reads do not overlap; refresh stops when inactive or reviewing/submitting an action. |
| Refresh / Export | Retrieve the current snapshot or export the displayed grid. Previous data is unconfirmed after a failed refresh and cannot authorize actions. |
| Select / Refresh detail | Read cumulative per-thread status counters, current SQL and latest retained completed SQL. Counters are strings to preserve large values. |
| Copy SQL / Export statistics | Copy each SQL text or export counters through the common desktop actions. Authentication SQL is hidden before reaching the renderer. |
| Cancel SQL | Preview KILL QUERY, type the exact connection ID and acknowledge. Only the currently verified statement is targeted; earlier pending work can remain and the connection survives. |
| Kill Session | Preview KILL CONNECTION and confirm the exact ID. The selected connection's pending transaction rolls back; cleanup can take time. |

The list uses `performance_schema.threads`, and current execution identity uses `events_statements_current` EVENT_ID/TIMER_START. It is cross-database. If thread metadata cannot be read, SHOW FULL PROCESSLIST displays only the visibility allowed by MySQL; without PROCESS this is limited to the connected user. That fallback cannot establish stable thread identity, so management stays disabled. Complete account/role metadata is also required to protect administrators. Direct CONNECTION_ADMIN or SUPER is required for this first management implementation; role-only administration is conservatively disabled. MySQL enforces native privileges again. No privileges or instrumentation/consumer settings are changed automatically.

MonaBase's main/background/control connections, the current account's connections, root/internal/known administrative accounts, non-client threads and unverified sessions are protected. Empty/unavailable instrumentation does not mean zero activity. State seconds measure time in the current state, not connection age. Previous SQL is a bounded history buffer and may be empty if collection is disabled. Reads occur on the background connection and KILL runs on the control connection, preserving the main transaction and its indicator.

Confirmations are connection-bound, expire after 60 seconds and are consumed once. The server UUID, connection/thread identity and current execution (for cancellation) are checked again immediately before sending. MySQL KILL identifies a connection, so preflight validation is not an atomic lock against the target changing in the small check/send interval. The result distinguishes an observed changed/absent target from a sent request still awaiting confirmation and an unknown communication outcome. No request is automatically resent.

References: [MySQL KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html), [Performance Schema threads](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-threads-table.html), [SHOW PROCESSLIST](https://dev.mysql.com/doc/refman/8.4/en/show-processlist.html).

## DBA: Lock Information

Open **DBA → Lock Management** or use command search. The Oracle-style screen displays **InnoDB data locks** across databases, including native TABLE/RECORD type, granted/requested mode, status, schema/table/index, transaction ID, connection/user/host/state, blocker connections and distinct waiting threads. Native MySQL modes (including gap/record flags) are retained rather than mapped to Oracle lock modes. Metadata locks and advisory locks are outside this first window.

| Control | Behavior |
| --- | --- |
| Search / All / Waiting / Blocking | Search connection/user/object/transaction/mode; filter WAITING locks or locks referenced as blockers. |
| Auto-refresh / Refresh / Export | Off or 5/10/30 seconds; no overlapping reads and no refresh while reviewing/submitting. Export the displayed grid. |
| Select a lock | Show resource identity, current SQL and latest retained completed SQL, with copy actions. SQL privacy and history limitations match Session Management. |
| Inspect blocker | Clear filters and navigate to the blocker row and its page. When multiple blockers exist, select individual blocker buttons in the detail pane. |
| Cancel SQL | Review and cancel the selected verified waiting statement; earlier work can remain and its connection survives. |
| Terminate selected session | Review KILL CONNECTION for the lock holder/waiter. It terminates the connection and rolls back that connection's pending transaction. It is not a single-lock release. |

Lock catalogs come from `performance_schema.data_locks` and `data_lock_waits`. A missing/denied catalog or disabled Performance Schema is an explicit error, never an empty successful list. Each catalog is limited to 5,000 rows and the derived payload to 8 MiB; oversized results fail rather than silently truncate. These are live observations rather than an atomic snapshot. Orphan relationships or waiting locks without observed edges are marked inconsistent and cannot authorize operations. Missing thread mappings stay protected. State duration is not lock age; no exact hold/wait duration is invented.

All reads use the background connection; cancellation/termination reuses the protected Session Management control connection. Self/internal/admin/unknown connections and read-only/unknown main state are guarded there. Review requires a stable lock ID, transaction, thread/session identity and waiting/blocking relationships; cancellation additionally binds the SQL execution visible to the user. Before execution both lock membership and the underlying session/execution are checked again. Confirmation is exact numeric connection ID, expires after a minute, binds to the control connection and is single-use. The native KILL statement cannot atomically lock the check/send interval. Unknown results are never retried automatically.

References: [MySQL data locks](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-data-locks-table.html), [MySQL data lock waits](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-data-lock-waits-table.html).


## Read-only tablespaces and storage (MySQL 8.4)

The DBA menu and command palette open **Tablespaces & storage**. The resizable
upper list supports search, tablespace-type filtering, refresh and export. The
lower tabs show server data-file paths, InnoDB table/partition membership and
row format / filesystem block size / encryption / state metadata.

Two MySQL-only IPC channels, `list-mysql-tablespaces` and
`get-mysql-tablespace-detail`, use `electron/mysql/tablespaceService.js` and the
background metadata connection. They do not return or overwrite main-connection
transaction state. Read-only application connections can open the screen.

The native source is `INFORMATION_SCHEMA.INNODB_TABLESPACES`, supplemented by
`INFORMATION_SCHEMA.FILES` for file information and catalog entries not present
in the first view. Native `SPACE` / `FILE_ID` join keys are preserved. Missing
fields remain unknown, rather than becoming zero. Catalog scope, including
system/undo/temporary entries, depends on what the server reports; this is not
an inventory of OS storage or every possible MySQL engine. NDB is not covered.

File size and bytes actually allocated on disk are distinct exact integer
strings. Neither is Oracle-style used/free capacity, a free-space percentage or
available filesystem space. File sizes are not derived from extent estimates.
For sparse/compressed files disk allocation may differ from logical file size.
No summed file-size claim is made for missing per-space size metadata.

The stored-table grid preserves the InnoDB `NAME` value, including database
prefixes, encoded identifiers and partition suffixes. It does not guess decoded
SQL object names. Server paths are displayed as metadata; MonaBase never opens
those paths on the client or server.

`PROCESS` and access to the relevant catalogs are required. Denial is an explicit
error, not an empty/complete successful snapshot; raw driver errors are hidden.
Each catalog query is limited to 5,001 rows to detect the 5,000-row display limit;
8 MiB response limits prevent presenting oversized partial results. Detail
requests bind the selected numeric space ID and verify its name. Catalog reads
are live observations, not an atomic snapshot of concurrent DDL.

There are no create/drop/resize/relocation/encryption-change operations, implicit
ANALYZE/OPTIMIZE, filesystem operations or server/permission changes.

References: [INNODB_TABLESPACES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-innodb-tablespaces-table.html),
[FILES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-files-table.html),
[INNODB_TABLES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-innodb-tables-table.html).


## SSH tunnel connections

Enable **SSH Tunnel** on the login screen, select password or private key
(with an optional passphrase), and enter the bastion host/port/user. The DB
host and port are interpreted **from the SSH server**, not from the desktop.
All three MySQL connections (main, metadata and cancellation/control) use separate
forwarded SSH streams on one verified SSH connection. No public local listening
port or direct database fallback is created.

The existing host-key trust store/verifier prompts for a new host fingerprint and
rejects changed host keys. Missing/unreadable trust data fails closed. Private
keys are read through the bounded credential-file reader; passwords/passphrases
are supplied only to SSH authentication and are not logged. Existing credential
vault identities already include the SSH endpoint/authentication scope.

TLS is independent of SSH. With **TLS with certificate verification**, the
original DB hostname remains the TLS identity/SNI even though SSH supplies the
socket. A trusted CA and matching DNS name are still required. There is no TLS
fallback to plaintext and no fallback from SSH to a direct TCP connection.
A lost SSH connection invalidates transaction state and destroys its DB
connections; SQL/Commit are not replayed. Failed setup or DB handshakes close
partial channels, and disconnect closes all DB connections and the SSH session.

## Database information

Open **DBA → Database information**, or use command search. The upper list
shows accessible database names, default character sets and collations, with
search, refresh and export. A shared DBA splitter supports drag/keyboard resizing.
The lower grid lists visible tables, views, procedures, functions and triggers;
filter by type/name or export the displayed objects. Table rows/data/index sizes
are catalog estimates, preserved as exact integer strings. Triggers identify
their parent table. Estimates are not measured counts or OS disk allocation.

Catalog reads remain read-only. The separate reviewed Create database / Change database defaults actions described below require an idle main connection. The screen does not drop databases, change permissions, run ANALYZE or switch the main connection database. It uses `INFORMATION_SCHEMA.SCHEMATA`, `TABLES`, `ROUTINES` and
`TRIGGERS` on the background connection through the MySQL-only
`list-mysql-databases` and `get-mysql-database-detail` IPC channels. Permissions
can hide databases and individual objects: the UI explicitly labels the result
as the connected account's visible scope, not a complete server inventory.
Errors and response limits (5,000 entries / 8 MiB) never become successful
partial snapshots. Names are bound parameters; changed or inaccessible selected
databases fail explicitly. Catalog reads are live observations, not an atomic
snapshot during concurrent DDL.

See [MySQL SCHEMATA visibility](https://dev.mysql.com/doc/refman/8.4/en/information-schema-schemata-table.html).


## Routine trace analysis and AI debugging

Saved **Function** and **Procedure** windows include a **Trace analysis** tab.
Expand **Trace inputs**, enter IN/INOUT values (blank means SQL NULL), record a trace, reset/step/replay to
breakpoints, and inspect recorded variable values alongside the captured source.
The input section closes after recording to leave more space for replay; reopen
it to change values or fixtures.
Arguments use the configured input date format. Source rendering escapes HTML;
trace replay does not execute program text. The AI debug button opens the shared
sidebar, send preview, evidence requirements and debug-history workflow.

The recorder supports scalar parameters/locals, DECLARE/DEFAULT, SET,
IF/ELSEIF/ELSE, simple/searched CASE, WHILE/LOOP/REPEAT, labelled LEAVE/ITERATE
and function RETURN. It also supports a restricted, validated subset of single-table
SELECT INTO, INSERT with explicit columns/VALUES, UPDATE and DELETE; cursors
(DECLARE/OPEN/FETCH/CLOSE); CONTINUE/EXIT handlers; and SIGNAL/RESIGNAL.
Handlers accept NOT FOUND, SQLEXCEPTION, SQLWARNING, a numeric error code or
literal SQLSTATE. Handler bodies can be a statement or BEGIN/END block.
Nested BEGIN/END blocks are supported, including block-local variables/cursors,
labelled block LEAVE and nested CONTINUE/EXIT handlers with native RESIGNAL.
Local snapshot keys inside a nested block use `B<number>.name`; the innermost
visible declaration hides an outer same-named variable only within that scope.
`variable_types` retains both types. Block-entry/exit phases mark recorded scope
boundaries (LEAVE/RETURN/EXIT may skip an exit snapshot). All declarations remain
bounded to 64 total variables, 16 total cursors and 32 nested block scopes.


**SQL table inputs are explicit fixtures.** The trace tab loads column rules and
saved-definition fingerprints without reading existing table rows. Expand a table
entry to check required, generated and unsupported columns, then enter JSON such as
`{"orders":[{"id":1,"amount":"12.50"}]}`. Use native MySQL temporal text inside
this JSON, strings for exact decimals/large integers, `null` for SQL NULL and `""`
for empty text. Omitted columns use native defaults. Reload inputs after changing
a table definition. Missing or stale reviewed fingerprints block recording.
Every referenced SQL table uses an empty InnoDB CREATE TABLE LIKE copy, seeded
only with these values. Existing rows, foreign keys and peer triggers are excluded;
this is an isolated logic test, not a complete production integration test.

Supported SQL includes validated scalar projections/aggregates, WHERE, ORDER BY
and bounded literal LIMIT. Joins, views, subqueries, SELECT *, INSERT without an
explicit column list, other routine calls, dynamic SQL, user/session variables in
original code, named CONDITION, GET DIAGNOSTICS and
CASE expressions inside scalar expressions remain unsupported. Unsupported input
is refused before copies are created; no uninstrumented statement is presented as
traced. MySQL native cursor/handler/error semantics are retained within this subset.

The recorder fetches the current saved definition and checks its fingerprint and
editor source. Finish pending main-connection writes first. Read-only or unknown
connections cannot record, although existing records can still be inspected.
Original definitions and data are not modified. A random `mbt_trace_` routine is
created and executed on a dedicated worker connection with SQL SECURITY INVOKER.
Only validated code is copied. Scalar-only runs use a read-only transaction; SQL-enabled runs write only to their isolated table copies and roll back before cleanup.
The main transaction is neither committed nor rolled back. Worker connections
also honor SSH/TLS. CREATE ROUTINE, EXECUTE and permission to drop the owned copy
are required; SQL-enabled runs additionally need CREATE/DROP and fixture-DML privileges for the copies. Missing privileges are errors, not empty successful traces.

Source SQL mode, connection charset/collation and timezone are retained where
supported. Snapshots cast scalar values to text to preserve BIGINT/DECIMAL
precision; character values are JSON-quoted, while unquoted `[SQL NULL]` marks SQL NULL. The trace stores the exact original source,
SHA-256, environment, line numbers, real WHILE/LOOP/REPEAT iteration paths and before/after
phases. Handler-entry/exit snapshots retain the calling loop iteration. SIGNAL snapshots precede the native exception; RESIGNAL preserves native propagation. `return_values` records the native result. An assignment's **after**
snapshot proves its observed effect; a before snapshot does not.

Default limits are 2,000 snapshots, roughly 1 MiB of JSON recording, 64 KiB source,
64 scalar variables, nesting depth 32 and a 30-second worker query timeout.
SQL inputs are bounded to eight tables, 1,000 fixture rows total and 1 MiB of
fixture JSON. After each INSERT, a copy exceeding 1,000 rows stops recording
(the INSERT can temporarily cross that threshold before rollback). The
step/byte limit stops the instrumented block; user exception handlers cannot
swallow it. Available records are retained with `execution_status: incomplete` and a visible warning. Later behavior is
unknown. Server execution and instrumentation have overhead; replay is not a
live debugger and records do not establish original execution timing.

Owned copies are dropped and worker connections destroyed on completion/failure.
If cleanup cannot be confirmed (for example a lost connection), the error names
the generated copy for manual verification and the operation is not resent.
A complete run replaces its saved JSON atomically under `trace/mysql`, with a
connection/schema/type/name identity. Failed setup does not overwrite an older
trace. No logging table is created in the database.

AI receives the stored executed-source snapshot, actual trace, completion status,
phase meanings, environment and user requirements. It does not access the DB or
apply a fix. Current edited source is reference only. Review the send preview
before sending sensitive values. The real-AI tests are opt-in and never run in
ordinary tests or CI; see [Testing](TESTING.md#mysql-real-ai-trace-effect-tests).


### Trigger trace analysis and AI debugging

Existing triggers expose a **Trace analysis** tab. Refresh the saved definition,
enter JSON row values and record. INSERT uses NEW, DELETE uses an OLD seed row,
and UPDATE uses an OLD seed row plus NEW fields to update. Omitted columns use
native defaults; explicit `null` is SQL NULL, and `""` remains empty text. Use
strings for exact decimals and native MySQL date/time text. Generated columns
cannot be supplied; column types are listed in the tab. Unsupported or generated column values cannot be supplied or referenced by the trace grammar.
A table must have 1–64 columns and at least one supported scalar column.

The recorder creates an **empty real InnoDB table with CREATE TABLE LIKE** and
attaches only an instrumented copy of the selected trigger. It fires the actual
INSERT, UPDATE or DELETE against that copy. No existing rows, other triggers or
foreign keys are copied. This intentionally isolates the selected trigger; it
is not a complete constraint, cascade or trigger-order integration test. SQL
reads/writes, cursors, CONTINUE/EXIT handlers and SIGNAL/RESIGNAL inside the body
use the same restricted SQL grammar and explicit fixture inputs as routines.
Stored calls, dynamic SQL, joins and subqueries are refused before creating copies. DECLARE/SET, IF/ELSEIF/ELSE, CASE, WHILE/LOOP/REPEAT and labelled LEAVE/ITERATE use the same strict
scalar grammar as routines. NEW assignments are accepted only in BEFORE
INSERT/UPDATE; OLD values are read-only. Generated or unsupported column
references are rejected. BEFORE INSERT may record an implicit auto-increment
NEW value of zero; the resulting isolated row contains the assigned ID.

Both the saved trigger and table definition are fingerprinted and checked again
before firing. Additional referenced SQL tables are separately fingerprinted and copied; references
to the trigger target reuse its existing isolated copy. OLD/NEW inputs, rather than
the SQL-fixture editor, seed that target. A writable connection with no pending main work is required.
The worker inherits SSH/TLS and source session settings. Copied DML is rolled
back, the empty copied table is checked, and both owned copies are removed.
Original data, trigger definitions and main-connection transactions are never
committed or rolled back by the recorder. CREATE, TRIGGER, clone-DML and DROP
privileges on the chosen database are needed. There is no automatic grant.

The original ACTION_STATEMENT body supplies 1-based source lines and a source
SHA. The saved trace includes actual NEW/OLD/local values, assignment phases,
WHILE/LOOP/REPEAT iteration paths, timing/event, isolated outcome rows and scope limits.
Incomplete bounded executions remain explicitly incomplete. Replay, breakpoints
and **Ask AI** use the shared simulator and send preview. The AI gets the stored
body, actual evidence and scope limits; it does not connect to the DB or apply
repairs automatically. Any recorded values included in the preview are sent
only when the user submits the request.

See [the isolated-trigger test suite](TESTING.md#mysql-trigger-trace-tests).


### Reviewed database creation and defaults

In **DBA → Database information**, choose **Create database**, or select a database
and choose **Change database defaults**. Character sets and compatible collations
come from the actual server. Review the generated SQL, then explicitly execute.
System databases are protected. A writable connection with no pending changes
is required; review tickets expire and can be used once. Definitions are checked
again before DDL. The application does not grant missing privileges.

Changing defaults uses ALTER DATABASE, not ALTER TABLE CONVERT: existing table and
column encodings are not converted. DDL cannot be rolled back. Database renaming,
deleting, moving files and server configuration are outside these actions.
Unconfirmed execution is never retried; reconnect and inspect it. Successfully
created databases refresh the current workspace's sidebar/database choices.

### Importing stored definition files

Use **View → Import stored definitions…**, also available in command search.
Select a target database, open a SQL file (or paste its text), review the complete
list and expand each generated CREATE or DROP + CREATE before executing.
The ordinary SQL editor and its single-statement driver policy are unchanged.

The importer accepts up to 50 complete CREATE PROCEDURE/FUNCTION/TRIGGER
statements and 1 MiB of text. Client DELIMITER directives are recognized outside
strings/comments. A single native compound CREATE definition without DELIMITER
is accepted too. Only the chosen database is allowed. Duplicate targets, arbitrary
SQL, session directives, executable version comments, malformed quotes/blocks
and explicit new DEFINER accounts are rejected before starting. Existing matching
DEFINER settings are retained, as are supported original creation settings and
trigger order. Full mysqldump/server-backup files containing SET, DROP or executable
comments are not accepted; use definition-only files. File comments describing an
old session mode are not executable settings. New objects use the current session.

All targets and saved fingerprints are checked before the first DDL, and again
before each object. Each object reuses its dedicated editor mutation service under
one main-queue reservation. DDL is **not an atomic batch**: the first failure stops
remaining objects, while earlier changes remain applied. Concurrent administrators
can still race native DROP/CREATE; catalog checks are not an exclusive server lock.
The results identify applied/dropped/unknown stages and display an original-source
recovery option when replacement creation fails. Recovery is an explicit action;
it restores the old definition and does not complete the requested import.
After any attempt, close/review again rather than resending the entire file.

Git recording is an optional checkbox. Only successful server-fetched definitions
are committed. A Git failure never rolls back DB DDL or resubmits the import.
No routine body is executed by importing it, and no AI service is called.


## Routine reference information

The Function/Procedure **Information** tab loads references and dependents on the
background connection without committing pending work. Click an object to open
its normal table/view/routine/trigger window. Catalog-confirmed dependent views
(`VIEW_ROUTINE_USAGE`, functions only) have a different badge from source-inferred
candidates. Source matching ignores comments/strings and only resolves visible
objects in the current database; catalog facts can include visible views in other
databases. Dynamic SQL, inaccessible definitions and external applications prevent
a complete dependency graph. Partial scans are explicitly flagged (up to 1,000
tables and 500 routines/triggers per scan, with an 8 MiB source budget).


## MySQL editor diagnostics and local completion

The SQL editor highlights native parser errors when MySQL reports a validated
statement-relative line. The execution log's error line opens that line in the
editor. Script offsets, blank lines and selected text are mapped back to the
original source snapshot. Editing the source clears the stale highlight; an old
log cannot move the caret using a different source snapshot. Errors without
reliable positions remain messages only. Estimated-plan errors are not mapped
because planning rewrites SQL; private execution exposes no line/source diagnostic.

Procedure/function and trigger editors offer visible local variables and routine
parameters as completion candidates, alongside common MySQL built-ins and the
existing SQL keyword completion. Nested shadowed locals replace outer suggestions
only while in scope. Strings/comments/quoted identifiers and qualified references
do not receive these unqualified custom suggestions. Completion reads only the
current editor; it does not fetch whole database catalogs or execute SQL.

### Niche trigger validation

The native regression suite compares selected-trigger tracing with ordinary
execution for NULL-safe comparisons, no-match CASE handlers, handler precedence,
warning SIGNALs, labelled exits, nested EXIT handling, multi-column cursors,
REPEAT/ITERATE, exact decimals and escaped Unicode/text. Unhandled RESIGNAL is
recorded as incomplete rather than a successful run. It also verifies that the
intentionally unsupported forms are refused before copy creation and preserve a
previous trace. A bare `SELECT *` projection is rejected; `COUNT(*)` is supported.
See [the scenario matrix](TESTING.md#mysql-niche-trigger-semantics-and-unsupported-grammar).

### Niche function validation

The native regression suite verifies unsigned 64-bit limits, exact decimal input
versus native return-scale rounding, literal text/NULL/empty text, microsecond
dates and negative TIME, short-circuit expressions, early and handler RETURN,
scoped locals/cursors and isolated function DML. Runtime missing RETURN, unsigned
overflow and unhandled RESIGNAL remain explicitly incomplete failures.

In addition to unsupported SQL forms, JSON return types and a root-block local
that directly duplicates a parameter name remain outside trace grammar. The
latter differs from supported shadowing inside a nested BEGIN block. These forms
are refused before copy creation and preserve a previous recording.
See [the function scenario matrix](TESTING.md#mysql-niche-function-semantics-and-return-values).

### Niche procedure validation

The native suite verifies mixed IN/OUT/INOUT directions, OUT's initial NULL,
multiple precise outputs, single SET bodies without BEGIN, cursor reopen,
handler scope/precedence, early LEAVE and isolated DML against native CALL.
Runtime errors and capacity limits are incomplete records without trusted final
outputs; a failure before the first snapshot keeps the previous recording.

Trace recording does not support procedures that emit SELECT result sets or
execute COMMIT, although those are valid native procedure forms. It refuses them
before copy creation instead of discarding results or committing isolated data.
The existing SQL/type restrictions also apply, including JSON OUT and explicit
parameter charset/collation modifiers not represented in the trace's parameter
contract. See [the procedure matrix](TESTING.md#mysql-niche-procedure-arguments-handlers-and-result-boundaries).
