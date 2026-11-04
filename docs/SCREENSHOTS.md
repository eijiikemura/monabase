# Screenshot walkthrough

Use a fictional order-management workspace to show a complete workflow: inspect orders, understand table relationships, then explain a calculated total with an execution trace. The fixtures contain no real customer data.

The README includes reviewed captures from a real Oracle and PostgreSQL demo database:

| Image | Database | View |
| --- | --- | --- |
| [Git source history](screenshots/git-source-history.png) | Oracle | Three local revisions and a side-by-side source diff |
| [AI coding assistant](screenshots/ai-coding-assistant.png) | Oracle | A real request, the AI response, and generated comments in the source editor |
| [SQL workspace](screenshots/sql-workspace.png) | Oracle | Three-table order summary with six result rows |
| [ER diagram](screenshots/er-diagram.png) | PostgreSQL | Four demo tables and three foreign-key relationships |
| [Execution trace](screenshots/trace-debugging.png) | Oracle | Paused at the return statement, showing the calculated total |

The application content area was set to 1600 × 1000; the display scale produced 3200 × 2000 PNG files. Connection labels were anonymized before capture. The ER layout was adjusted in memory to focus on the four related tables; the aggregate view was omitted from the canvas without changing database objects. The AI capture was taken with the earlier collapsed diagnostic display. The current sidebar omits those diagnostics and adds proposal review and optional request preview; the existing image predates these controls. The ER and AI images were refreshed after the type-label and diagnostic-display fixes using Electron 44. SQL results, table definitions, relationships, Git revisions, AI output, and trace variables come from the actual application and services.

## Prepare the demo

Use an empty development account or database, with permission to create tables, a view, and a function. For Oracle, connect as the demo owner, not as `SYS` or `SYSTEM`. PostgreSQL creates a dedicated `monabase_demo` schema in the connected database. These scripts create new objects and never drop or replace existing ones. If a name already exists, stop and choose another demo environment rather than rerunning the scripts over existing data.

Choose the folder for your database:

| Step | Oracle | PostgreSQL |
| --- | --- | --- |
| 1. Tables, relationships, comments, view | [01_schema.sql](../examples/screenshots/oracle/01_schema.sql) | [01_schema.sql](../examples/screenshots/postgresql/01_schema.sql) |
| 2. Fictional data and commit | [02_seed.sql](../examples/screenshots/oracle/02_seed.sql) | [02_seed.sql](../examples/screenshots/postgresql/02_seed.sql) |
| 3. Total-calculation function | [03_function.sql](../examples/screenshots/oracle/03_function.sql) | [03_function.sql](../examples/screenshots/postgresql/03_function.sql) |
| 4. Screenshot and verification queries | [04_queries.sql](../examples/screenshots/oracle/04_queries.sql) | [04_queries.sql](../examples/screenshots/postgresql/04_queries.sql) |

1. Connect with a neutral profile name such as `Demo · Order Management`.
2. Open an SQL window and select the demo owner's schema. Run files 01, 02, and 03 **separately**, in that order. Execute the whole function definition, including its body. Oracle's trailing `/` is a client separator, not part of the stored function.
3. After PostgreSQL file 01, reconnect to refresh the schema list, then select `monabase_demo`. Its SQL files use qualified object names, so they do not depend on the connection's search path.
   Also select `monabase_demo` in the SQL window's **Schema** dropdown; MonaBase requires an execution schema even for qualified SQL.
4. Refresh the object browser. Run each verification query in file 04 separately by selecting its text before executing.
5. Confirm **4 customers, 4 products, 6 orders, 11 order lines**, and a combined subtotal of **USD 1,790.00**. Function calls `(1001, 10)` and `(1003, 10)` should return **230.40** and **61.20**.

The seed file commits its inserts. Do not rerun it: fixed primary keys deliberately detect duplicate loading. Oracle DDL commits implicitly, so use an isolated demo account even if you expect to roll back. No cleanup or destructive reset script is included.

## Consistent framing

- Set the interface language to **English** and use the **Mona** theme throughout.
- Use the same window size, ideally around **1600 × 1000**, with readable SQL and result text. Retina captures may have twice as many pixels.
- Close unrelated tabs, notifications, menus, and developer tools. Keep the object browser visible, showing the demo tables and function.
- Use the same date format, such as `YYYY-MM-DD HH:mm:ss`, and enable number grouping if it improves readability.
- Capture only the application window. Use the operating system's window screenshot tool; on macOS, press **Shift + Command + 4**, then **Space** and click the window. Remove the shadow if you want clean rectangular edges.
- Keep raw captures in ignored `local/screenshots/`. Review them before copying the selected images to `docs/screenshots/`. Do not include personal connection names, real hosts, credentials, SQL history, or real schemas.

## Shot 1: SQL workspace

Suggested output: `docs/screenshots/sql-workspace.png`.

Run the first query in file 04. Keep its complete SQL and all six result rows visible. Give the results about the lower half of the workspace and fit all seven columns without horizontal scrolling. Keep the newest orders at the top and the demo table list visible on the left.

The README leads with Git source history and AI-assisted editing, followed by SQL, ER diagrams, and tracing. Keep the existing connection screenshot as setup documentation.

## Shot 2: ER diagram

Suggested output: `docs/screenshots/er-diagram.png`.

Japanese companion: [er-diagram-ja.png](screenshots/er-diagram-ja.png) (3200 × 2000). Captured from the current Japanese production renderer for Store submission, using simulated PostgreSQL metadata matching the four-table fixture in `examples/screenshots/postgresql/01_schema.sql`. It shows the three real fixture relationships, comments, and types; no live DB changes or external requests were made. The existing English and manual captures are unchanged.

Open **ER Diagram Viewer** from the application menu, select the demo schema, select **All**, and click **Draw ER Diagram**. An empty demo account ensures unrelated tables do not crowd the diagram. The aggregate view may also appear in the generated diagram; omit it from the canvas when focusing on table relationships. If the account contains other tables, starting from `MB_DEMO_ORDERS` / `mb_demo_orders` shows its immediate relations, which can omit indirectly related tables such as products.

Show these four tables and all three foreign-key relationships:

```text
customers → orders → order_items ← products
```

Fit the diagram to the viewport, keep all table headings readable, and enable **Draw Comments** if the English descriptions fit. Prefer physical table names for the first capture. Use a custom ER diagram if you need manual positioning. The ER diagram's own image export is useful for a diagram-only image; the README screenshot should retain the surrounding application controls.

## Shot 3: Execution trace

Suggested output: `docs/screenshots/trace-debugging.png`.

Open `MB_DEMO_ORDER_TOTAL` / `mb_demo_order_total` under **Functions**. In the arguments panel, enter `1001` for `p_order_id` and `10` for `p_discount_pct`. Click **Execute Trace** and open **Trace Analysis** after execution completes.

Step through the recorded trace until the final calculation has run. Show the source, the current line, and the variables together:

| Variable | Expected value |
| --- | --- |
| `v_subtotal` | 256.00 |
| `v_discount` | 25.60 |
| `v_shipping` | 0.00 |
| `v_total` | 230.40 |

Choose the `RETURN v_total` step so the calculated values are visible. Keep playback controls and return values in frame. A second run with `(1003, 10)` demonstrates the shipping branch: subtotal 57.00, discount 5.70, shipping 9.90, total 61.20. Pick the clearer of the two captures.

Trace execution needs the database permissions and instrumentation used by MonaBase. The scripts are preparation fixtures, not proof that tracing has been verified on your database. If compilation or trace execution fails, keep the error output and resolve it before publishing a screenshot.

## Shot 4: Git source history

Published image: `docs/screenshots/git-source-history.png`.

Japanese companion: [git-source-history-ja.png](screenshots/git-source-history-ja.png) (3200 × 2000). Captured from the current Japanese production renderer for Store submission. It reuses the original three recorded Git revisions read-only, with the owner anonymized as DEMO and simulated DB metadata/source retrieval; no live DB or Git writes and no AI requests were made. The existing English and manual captures are unchanged.

Use a separate copy of the demo function so the original remains available for SQL and trace captures. Copy Oracle file 03, rename both the function declaration and its final closing name to `MB_DEMO_GIT_TOTAL`, and create it only if that name is unused.

1. Initialize a local database-source Git repository through MonaBase's Git menu. Use an isolated capture workspace so existing repositories and author settings remain untouched.
2. Open `MB_DEMO_GIT_TOTAL` and its **Version Control** tab. Record the baseline with **Git Commit**.
3. In **Source**, change the shipping charge from `9.90` to `7.90`, compile, and record the second revision.
4. Add an English comment explaining the USD 200 free-shipping threshold, compile, and record a third revision.
5. Open **Version History**, select the baseline, and scroll the diff to the changed comment and shipping charge. Resize the diff pane so the changes and all three history rows are visible together. The capture uses Japanese commit messages authored through the application.

The published image shows actual local commits and the current database source. No remote was configured or pushed. The separate demo function and capture repository are kept for repeatable captures; the original order-total function is unchanged.

## Shot 5: AI coding assistant

Published image: `docs/screenshots/ai-coding-assistant.png`.

Use the original `MB_DEMO_ORDER_TOTAL` function and an isolated copy of the configured AI settings. Keep the API key and endpoint settings off-screen. With permission to make a billable request, open **Ask AI to code**, add the original function as a target object, and send:

> Add concise English comments explaining that free shipping applies when the discounted subtotal is at least USD 200. Keep every calculation and return value unchanged.

Wait for the real response and the confirmation that the generated program was applied to the source editor. Close the arguments panel, scroll the editor to the added comment, and keep the target object, user request, response, and token usage visible. Avoid showing unrelated conversations.

The published capture used one actual request: 1,298 input tokens and 529 output tokens. The generated source was checked against the original after removing comments and whitespace; the calculation was unchanged. It was left as an uncompiled editor preview, preserving the database function and its expected totals. The refreshed image reuses that saved conversation and its generated source as an uncompiled editor preview; no second AI request was sent. Diagnostic messages use their normal collapsed state, and no response text was fabricated or edited.

## Publish reviewed images

The five selected feature PNG files are in `docs/screenshots/` and linked from the README. The connection image remains in the setup section. When replacing them, review the full-resolution image and its legibility at the README's displayed width before updating the files.

Files in `docs/` are readable directly on GitHub; the README is the entry point linking to them. This repository does not automatically turn that folder into an application help screen or a documentation website.


## Localized manual screenshots

The website now uses **35 distinct screenshots per language (70 PNG files)** in
[`screenshots/manual/en/`](screenshots/manual/en/) and
[`screenshots/manual/ja/`](screenshots/manual/ja/). All 34 guides have an image;
Getting started and Connection share the login screenshot. The App styles guide
adds Mona, Simple and Dark screenshots of the same SQL workspace in both languages.
The additional style captures use isolated settings at
`local/manual-capture/styles/{mona,simple,dark}/{en,ja}/settings.json`, with both
`theme` and `language` set before the app loads. Landing-page images
also follow the website language. Original images used by the README above are
preserved.

These manual images were captured on 2026-10-30 from the actual production
renderer, using fictional data and simulated IPC responses adapted from
`tests/e2e/sidebar.cjs`. This makes management screens available without changing
a live server. The AI response is a **prepared demo response**, not a real model
request. These images illustrate the interface; they are not evidence of live DB
execution or a real AI answer. The website captions disclose these boundaries.
Oracle screens illustrate shared functionality, except Schema management, which
uses PostgreSQL. Database badges describe supported databases, not the database
pictured in every image.

For this capture, separate ignored settings files were used at
`local/manual-capture/en/settings.json` (`"language": "en"`) and
`local/manual-capture/ja/settings.json` (`"language": "ja"`). The app loaded those
settings before capture. Personal root settings were not overwritten. Japanese
images are actual localized app screens; SQL identifiers and source code remain
English. Each PNG is 1600 pixels wide.

To refresh, build the renderer with `npm run build:renderer`, open the matching
screen in each app language using disposable demo data, wait until loading ends,
and capture under the same basename in each locale directory. For management,
Git and AI examples, retain the simulated demo boundary or document any new real
capture accurately. Never include credentials, private hosts or personal history.
Run `npm --prefix website run check` and `npm --prefix website run build`; check
both the English/Japanese guide and its language switch in the browser. These
commands require every guide image, distinct English/Japanese PNGs and matching
locale/image attributes in the built HTML. No GitHub publishing is performed by
these local commands.

| Guide | English | Japanese |
| --- | --- | --- |
| `getting-started` | [login.png](screenshots/manual/en/login.png) | [login.png](screenshots/manual/ja/login.png) |
| `connection` | [login.png](screenshots/manual/en/login.png) | [login.png](screenshots/manual/ja/login.png) |
| `workspace` | [workspace.png](screenshots/manual/en/workspace.png) | [workspace.png](screenshots/manual/ja/workspace.png) |
| `sql` | [sql-workspace.png](screenshots/manual/en/sql-workspace.png) | [sql-workspace.png](screenshots/manual/ja/sql-workspace.png) |
| `query-builder` | [query-builder.png](screenshots/manual/en/query-builder.png) | [query-builder.png](screenshots/manual/ja/query-builder.png) |
| `tables` | [tables.png](screenshots/manual/en/tables.png) | [tables.png](screenshots/manual/ja/tables.png) |
| `views` | [views.png](screenshots/manual/en/views.png) | [views.png](screenshots/manual/ja/views.png) |
| `indexes` | [indexes.png](screenshots/manual/en/indexes.png) | [indexes.png](screenshots/manual/ja/indexes.png) |
| `check-constraints` | [check-constraints.png](screenshots/manual/en/check-constraints.png) | [check-constraints.png](screenshots/manual/ja/check-constraints.png) |
| `stored-programs` | [stored-programs.png](screenshots/manual/en/stored-programs.png) | [stored-programs.png](screenshots/manual/ja/stored-programs.png) |
| `packages` | [packages.png](screenshots/manual/en/packages.png) | [packages.png](screenshots/manual/ja/packages.png) |
| `types` | [types.png](screenshots/manual/en/types.png) | [types.png](screenshots/manual/ja/types.png) |
| `sequences` | [sequences.png](screenshots/manual/en/sequences.png) | [sequences.png](screenshots/manual/ja/sequences.png) |
| `triggers` | [triggers.png](screenshots/manual/en/triggers.png) | [triggers.png](screenshots/manual/ja/triggers.png) |
| `materialized-views` | [materialized-views.png](screenshots/manual/en/materialized-views.png) | [materialized-views.png](screenshots/manual/ja/materialized-views.png) |
| `materialized-view-logs` | [materialized-view-logs.png](screenshots/manual/en/materialized-view-logs.png) | [materialized-view-logs.png](screenshots/manual/ja/materialized-view-logs.png) |
| `synonyms` | [synonyms.png](screenshots/manual/en/synonyms.png) | [synonyms.png](screenshots/manual/ja/synonyms.png) |
| `database-links` | [database-links.png](screenshots/manual/en/database-links.png) | [database-links.png](screenshots/manual/ja/database-links.png) |
| `git` | [git-source-history.png](screenshots/manual/en/git-source-history.png) | [git-source-history.png](screenshots/manual/ja/git-source-history.png) |
| `ai` | [ai-coding-assistant.png](screenshots/manual/en/ai-coding-assistant.png) | [ai-coding-assistant.png](screenshots/manual/ja/ai-coding-assistant.png) |
| `trace` | [trace-debugging.png](screenshots/manual/en/trace-debugging.png) | [trace-debugging.png](screenshots/manual/ja/trace-debugging.png) |
| `er-diagrams` | [er-diagram.png](screenshots/manual/en/er-diagram.png) | [er-diagram.png](screenshots/manual/ja/er-diagram.png) |
| `data-generator` | [data-generator.png](screenshots/manual/en/data-generator.png) | [data-generator.png](screenshots/manual/ja/data-generator.png) |
| `cross-tab` | [cross-tab.png](screenshots/manual/en/cross-tab.png) | [cross-tab.png](screenshots/manual/ja/cross-tab.png) |
| `settings` | [settings.png](screenshots/manual/en/settings.png) | [settings.png](screenshots/manual/ja/settings.png) |
| `admin-sessions` | [admin-sessions.png](screenshots/manual/en/admin-sessions.png) | [admin-sessions.png](screenshots/manual/ja/admin-sessions.png) |
| `admin-locks` | [admin-locks.png](screenshots/manual/en/admin-locks.png) | [admin-locks.png](screenshots/manual/ja/admin-locks.png) |
| `admin-privileges` | [admin-privileges.png](screenshots/manual/en/admin-privileges.png) | [admin-privileges.png](screenshots/manual/ja/admin-privileges.png) |
| `admin-users` | [admin-users.png](screenshots/manual/en/admin-users.png) | [admin-users.png](screenshots/manual/ja/admin-users.png) |
| `admin-tablespaces` | [admin-tablespaces.png](screenshots/manual/en/admin-tablespaces.png) | [admin-tablespaces.png](screenshots/manual/ja/admin-tablespaces.png) |
| `admin-pdb` | [admin-pdb.png](screenshots/manual/en/admin-pdb.png) | [admin-pdb.png](screenshots/manual/ja/admin-pdb.png) |
| `admin-directories` | [admin-directories.png](screenshots/manual/en/admin-directories.png) | [admin-directories.png](screenshots/manual/ja/admin-directories.png) |
| `admin-schemas` | [admin-schemas.png](screenshots/manual/en/admin-schemas.png) | [admin-schemas.png](screenshots/manual/ja/admin-schemas.png) |
| `styles` — Mona | [style-mona.png](screenshots/manual/en/style-mona.png) | [style-mona.png](screenshots/manual/ja/style-mona.png) |
| `styles` — Simple | [style-simple.png](screenshots/manual/en/style-simple.png) | [style-simple.png](screenshots/manual/ja/style-simple.png) |
| `styles` — Dark | [style-dark.png](screenshots/manual/en/style-dark.png) | [style-dark.png](screenshots/manual/ja/style-dark.png) |
