# MonaBase website

**English** | [日本語](README.ja.md)

An English-first product landing page and bilingual, screen-by-screen manual built
with Astro and Starlight. This is an independent npm project: installing it does not
change the desktop app's dependency tree.

- [English website](https://eijiikemura.github.io/monabase/) · [Japanese website](https://eijiikemura.github.io/monabase/ja/)
- [Desktop project README](../README.md) · [日本語の製品README](../README.ja.md)

## Local development

Use Node.js **22.23.4 or later** (Node.js 26 is supported):

```sh
cd website
npm ci
npm run dev
```

Open `http://localhost:4321/monabase/` (English) or
`http://localhost:4321/monabase/ja/` (Japanese). GitHub Pages redirects the
extensionless `/monabase/ja` request to the slash-terminated page.
The upper-right language selector preserves the guide you are reading.
Starlight also provides search, a mobile menu, a table of contents and theme selection.
Search indexes are available in the production build/preview, not the dev server.

```sh
npm run i18n:extract
npm run check
npm run build
npm run preview
```

`check` verifies translation completeness, strict Astro/TypeScript diagnostics and
content regression tests. `build` also verifies generated page counterparts,
database badges and local links/assets under `/monabase/`. Preview serves the
production build at `http://localhost:4321/monabase/` by default.

## Product positioning

The landing page highlights five integrated AI workflows (stored/trigger coding,
trace debugging, SQL creation, SQL tuning and data generation), provider choice,
Git versioning for both stored source and custom ER diagrams, and controls for
production work. AI receives selected context, not a database connection or
SQL-execution tool. The main window provides explicit transaction Commit/Rollback;
read-only connections are a complementary safeguard.

Do not imply that a release is available just because Releases is linked. The
configured packages are Windows x64 installer/portable and Apple Silicon Mac DMG;
Linux and Intel Mac packages are not distributed. GitHub-distributed Windows builds
may show SmartScreen warnings due to missing trusted code signing.

Keep claims precise: trace replay avoids dependence on a live DBMS_DEBUG session,
not all possible runtime/size limitations. AI reconstructs recorded steps rather
than autonomously executing the database. Read-only mode and transaction controls
reduce accidental changes; they complement database privileges and do not undo
implicitly committed DDL. Do not claim ER diagram versioning is unique without a
verified comparison. The trace, AI, ER and other manuals can combine optional `sections` and `tables`
fields. Keep section ordering consistent with `scripts/generate-content.mjs` and
the screen-specific ordering in the content model. The transaction-control guide
explains main-connection Commit/Rollback and read-only connection limits.

## Editing and translation

- `src/content/site.ts` defines the landing-page text keys, screen order, support
  badges, summaries, steps and database-specific notes. Add **literal English
  keys**, such as `t('sql_title')`.
- `src/i18n/en.json` and `ja.json` hold the actual English/Japanese copy.
- Run **`npm run i18n:extract` inside `website/`** to add keys without overwriting
  existing translations. This command uses the TypeScript parser to extract actual
  `t()` calls, ignoring examples and comments. It does not machine-translate text.
  New translations start empty; fill both catalogs before check/build can pass.
  Removed keys are retained for review; remove unused entries intentionally.
- `scripts/generate-content.mjs` generates MDX and the Starlight UI overrides
  before dev/check/build. Do not edit `src/content/docs/`, `src/content/i18n/`,
  `.generated/` or `public/favicon.png`: these are ignored build inputs. The authored
  content model is the source of truth, and edit links point to it.
- The desktop app's own `npm run i18n:extract` remains separate and unchanged.
- `src/components/` and `src/styles/custom.css` define presentation. Locale-specific demo
  screenshots in `../docs/screenshots/manual/en/` and `manual/ja/` are optimized into WebP;
  `../src/assets/icon.png` supplies the logo and generated favicon.
- `src/content/screenshots.ts` explicitly imports every localized PNG. When adding
  an image, add its import and locale/name entry there too. Explicit imports make
  these assets outside the website root visible to both the running dev server
  and production builds; a regression check catches missing registrations.

Guide pages can include structured `tables` with translated titles, descriptions,
headers and rows. Generation checks column counts and escapes pipe characters;
tables use keyboard-focusable horizontal scroll regions on narrow screens.
The data-generation guide includes configuration tables and an AI-assisted order
scenario. The Settings guide lists all 17 fields across the five app tabs, plus
Save/Cancel/Apply Default, in six tables. Each row explains available values and
the effect of changing them, including reconnect/reopen requirements and the
separate AI provider dialog.
The SQL guide has six tables (34 rows) covering execution/editing, results, binds,
estimated plans, tuning routes and exported context, followed by step-by-step
in-app/external-AI tuning workflows and validation guidance. The external route
uses the app-generated UTF-8 `tuning_info.txt`; creating it does not send data to
an AI service.
The Query builder guide has five tables (35 rows) for buttons, source placement,
field settings, aggregates and joins, plus AI request/review steps and examples.
It explains per-column OR versus cross-column AND, pre-aggregation filtering,
join direction and supported-query boundaries.
The Cross-tab guide adds five tables (34 rows) for source/setup controls, axes,
conversions/grouping, aggregation, filters and chart/result output. Examples cover
monthly totals and integer bands, and the guide documents the current database
COUNT differences, 200-column-category limit and integer-only display formatting.
The Tables guide documents all six tabs in eight tables (50 rows): filters and
paging, record editing, import/export, structure, foreign keys, automatic ER,
statistics and DDL/Git source. It distinguishes draft versus applied conditions,
all-matching-page versus transposed exports, real definition changes, database
statistics versus live counts, and recovery SQL versus automatic restoration.
The Views guide covers its four tabs in five tables (36 rows): read-only data
filters/paging, result export, definition editing, Git source history and catalog
information. It documents current-input paging/export, the schema-qualified
single-VIEW guard, compile diagnostics, separate DB/Git outcomes, preserved drafts
on refresh and the scope of direct dependencies.
The Indexes guide (`guides/indexes/`) covers its three existing-index tabs and
creation form in six tables (35 rows). It explains ordered keys/expressions,
Oracle options, limited existing-index alteration, constraint-aware deletion,
database-specific statistics and actual DDL versus the ALTER draft. It does not
claim that this window offers rebuild/reindex or a Git history editor.
The Check constraints guide covers Edit/Source and new creation in four tables
(24 rows), including required names, condition-only input, Oracle enable/disable,
PostgreSQL rename-only editing, generated ADD versus planned ALTER, deletion and
NULL/boundary examples. It distinguishes generated source from a full catalog DDL
backup and links the official CHECK/NULL documentation.
The Procedures & functions guide covers Source, conditional Trace analysis,
Version control and Information plus argument/result panels in five tables
(36 rows). It separates compile/run/replay/Git, blank NULL versus declared defaults,
AI coding versus trace debugging and catalog dependency scope. Trace descriptions
and the workflow section link to the same-language `guides/trace/` page.
The Packages guide documents Oracle specification/body differences and the four
conditional tabs in six tables (40 rows): source compilation, member/overload and
argument selection, trace replay, Git and information. It includes scalar-type
limits, compile-before-trace, target-change resets and package log-clearing effects.
Both trace explanations link to the same-language `guides/trace/` page.
The Types guide covers Source, Version control, Information and the PostgreSQL
change dialog in six tables (35 rows). It documents Oracle TYPE compilation versus
read-only body inspection, PostgreSQL ENUM/composite additions, unsupported kinds
(including domains), refreshed change plans, partial success and separate Git
outcomes. It does not imply a generic type-creation or method-execution form.
The Sequences guide covers Settings, Source and Information in six tables (32 rows).
It separates saving settings, editing a restart candidate and actually restarting;
explains Oracle options, cached metadata references and concurrent-edit review;
and distinguishes creation DDL from exact numbering-state recovery and PostgreSQL
OWNED BY column associations from role ownership.
Desktop Mona/Simple/Dark styles appear in a small lower-page note linking to
`guides/styles/` in the Start here category. That dedicated guide explains
selection, saving, scope and the separate website theme, with all three styles
captured in English and Japanese. Sections may include an optional `image` to
place a screenshot next to its explanation.

The content model currently contains **42 guide/support pages in each language**,
including transaction control, Contact & Support and Privacy Policy. Oracle-only
and PostgreSQL-only screens carry their supported database badge. Screenshot-backed
guides use separate English/Japanese images captured in the matching app language.
The original 70 demo captures in `docs/screenshots/manual/{en,ja}/` use the
production renderer with fictional data and simulated database/AI responses;
no live database or AI service was used for those captures. Informational pages
such as Contact & Support and Privacy Policy do not require app screenshots.
The original README screenshots remain in `docs/screenshots/`.
See [the capture notes](../docs/SCREENSHOTS.md#localized-manual-screenshots) for
scope and refresh instructions. Tests require both locales for every guide, and
the production verifier checks the image identity and locale in generated HTML.
Do not claim support based on badges alone; keep database notes aligned with the app.

## Contact, privacy and analytics

The site includes bilingual `guides/contact/` and `guides/privacy-policy/`
pages. In the **Start here** group, the order ends with Styles → Settings →
Contact & Support → Privacy Policy, both in the Starlight sidebar and on the
landing page.

Support is routed through GitHub Issues, GitHub Discussions, GitHub private
vulnerability reporting and X DMs (`https://x.com/eijiikemura`). There is no
support email inbox or contact form. X accepts message requests from all
accounts with spam filtering; responses are not guaranteed. Never encourage
posting credentials, private SQL/data or security vulnerabilities publicly.

The `astro.config.mjs` Starlight head includes the **consent-first GA4** setup
(`G-2MV9LLEF3H`). The Google Analytics tag is only loaded after the visitor
accepts; rejection leaves the site usable. The localized preference UI allows
visitors to change their choice. Keep the privacy-policy explanation consistent
with the code whenever analytics behavior changes. This is website analytics,
not desktop-app telemetry.

## GitHub Pages

The intended public repository is **`eijiikemura/monabase`**. Check the
repository name/case and the deployment repository allowlist in
`.github/workflows/website.yml` before publishing; repository/release/edit
links are derived from `src/config.ts`. A repository or Releases link does not
confirm that the application has already been published.

1. Push the source and website lockfile to the new repository's `main` branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Confirm the **Website** workflow's build passed.
4. Run **Actions → Website → Run workflow** on the default branch to publish.
5. Review English, Japanese, language switching, search and mobile layout at:
   - `https://eijiikemura.github.io/monabase/`
   - `https://eijiikemura.github.io/monabase/ja/`

Ordinary pushes validate/build and upload a seven-day Pages artifact; they do not
deploy. Deployment requires manual dispatch in the exact intended **public**
repository. Private test repositories can build without publishing. The build job
has read-only repository access; only the separate deployment job receives Pages
and OIDC write permissions. Official Actions are pinned to full commit SHAs, no PR
triggers or personal tokens are used, and deployment does not execute project code.
The desktop CI, real-database integration tests and application release workflow
are independent. Website deployment does not publish desktop releases.

## License

Authored source and copy follow the repository's Apache License 2.0. Third-party
Astro/Starlight dependencies retain their respective licenses. Images use the
repository's existing MonaBase logo and fictional demo captures.


## MySQL guide coverage

The English/Japanese landing page and supported guides include MySQL badges.
Database-specific guides include authored MySQL notes; shared settings, styles
and workspace pages do not need a MySQL-only differences section. MySQL-specific explanations remain alongside Oracle/PostgreSQL notes, without
a separate MySQL operations and differences table.
Operation headings use their own titles without an Oracle/PostgreSQL suffix;
engine-specific restrictions are described in the relevant text.
The schema guide also covers MySQL database creation/defaults, while its
PostgreSQL ownership/ACL controls remain distinct. Unsupported object categories
(packages/types/independent sequences/materialized views/synonyms/DB links and
Oracle-only administration) do not receive a MySQL badge. Existing screenshots
remain Oracle/PostgreSQL examples, with captions identifying that scope. No new
UI screenshot is presented as a MySQL capture. i18n:extract remains the source-key
workflow; content generation, strict checks and built-page verification check
both the positive and negative capability badges.

The start group also includes `guides/database-support/`, a bilingual reference for actual verified server versions (Oracle 23.26.3.0.0, PostgreSQL 16.15, MySQL 8.4.13). Landing and guide overview text uses the unversioned MySQL name. MySQL notes are nested under Database-specific behavior, following the Oracle/PostgreSQL notes; they are not a separate introductory feature block. The table describes local verification servers, whose versions were rechecked with read-only connections on November 16, 2026; this does not rerun the feature test suite. The manual describes macOS and MySQL as available capabilities without release-history annotations; those belong in release notes. The start sidebar explicitly places Database support directly after Getting started.

Database-specific behavior sections are omitted when their only content is a MySQL note. The transaction comparison table covers Oracle, PostgreSQL and MySQL, including InnoDB DML, implicit DDL commits and error handling.

The Session, Lock, Object Privilege, User/Role and Tablespace administration guides each include three dedicated MySQL reference tables alongside the existing Oracle/PostgreSQL tables (15 tables, 48 rows total). They describe list filters, details, actions and permission/read-only limits using the current MySQL UI and docs/MYSQL.md as references. These belong to the page’s normal operation reference, not the removed generic MySQL operations and differences block.

## Standalone sitemap

`src/pages/sitemap.xml.ts` builds `/monabase/sitemap.xml` as a simple UTF-8 XML urlset. It lists the English and Japanese landing/guide URLs directly, without a sitemap index, child sitemap or extension namespaces. The route list comes from the content model, so new guides are included automatically. The Starlight-generated sitemap-index.xml and sitemap-0.xml remain available for existing registrations. Submit the standalone URL in Search Console to test this simpler format; a valid XML file does not itself prove that Google can fetch it. Tests and built-site verification check the exact route set, duplicates and XML shape.

The start group contains `guides/video-tutorials/` with the official MonaBase YouTube channel, topic descriptions and advice on matching the video’s database/version. The landing page includes a localized tutorial card and YouTube icon link. The channel is configured once in `src/config.ts` as `SITE.youtube`; no player is embedded.

## Temporary security audit exception

Run `npm run audit:security` before publication. The Website workflow uses the same command. `security-audit-policy.json` records the user-approved exception for [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), limited to picomatch 2.3.2/4.0.7 in this static website's build tools, expiring **2026-12-02 00:00 UTC**. No upstream patched release was available when reviewed on November 18. Visitor input is not used as a glob pattern and no Node server is deployed. This exception does not mean the dependency has no vulnerability.

The audit helper accepts only that exact advisory and dependency chains composed entirely of that advisory. Other moderate/high/critical findings, unknown/malformed audit reports, network errors, nonstatic output, unreviewed versions and expired exceptions fail the check. It does not use `--force`, lower the severity threshold or change desktop-app audit rules. Recheck the upstream release and advisory before the expiry date; remove the exception after installing a verified fix.


## Social sharing cards (Open Graph and X)

The landing pages and every guide include localized titles, descriptions and social images in static HTML. The two committed 1200×630 PNGs in `public/social/` are approximately 110 KB each. Canonical and Open Graph URLs preserve the project base, locale and guide path. X uses `summary_large_image` and the developer's account.

`src/social.ts` builds page-specific frontmatter head entries through `scripts/generate-content.mjs`; Starlight merges these with its defaults without duplicate tags. No custom Head component or client-side injection is needed. Copy lives in `src/content/site.ts` and the website translation catalogs. Guides use their own titles and summaries.

`node scripts/create-social-images.mjs` is an authoring tool using the existing sharp installation, the official icon and real localized SQL screenshots. Run it with Japanese fonts available and inspect the output. Commit the PNGs; ordinary builds do not regenerate them or require those fonts. Social metadata tests and the production-site verifier cover both locales and all 80 public pages.

When changing an image, use a new versioned filename and update its generator, `socialImagePath` and verification references. Social networks may cache earlier cards; successful HTTP checks do not guarantee that a particular network has refreshed its preview.

## Data validation guides

The localized landing cards and Source & workflows group link to `guides/data-masking/`, `guides/result-comparison/` and `guides/stored-regression/`. Keep their three-database badges, control/settings tables, localized real UI captures and related links from SQL, stored programs, packages and data generation. Document the actual boundaries: masking exports a copy as JSON, comparison covers fetched rows, and regression suites run explicitly without automatic Commit/Rollback. The six new captures were made on 2026-11-26 with an isolated production renderer, fictional data and simulated IPC; they are not evidence of live database execution or AI responses.
