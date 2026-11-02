# Development and maintenance

MonaBase is maintained by its author and does not accept pull requests, including automated dependency-update PRs. Bug reports and feature suggestions are welcome through issues. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

The following instructions are for local development, forks and maintainer changes. GitHub repository settings and dependency-update procedures are documented in [CI security](docs/CI_SECURITY.md).

Use Node.js 22.12 or later and install the locked dependencies with `npm ci`. Electron 44 requires macOS 13 or later on Mac.

Before recording a maintainer change, run:

```sh
npm run check
npm run build:renderer
```

For UI changes, also run `npm run dev` and check English and Japanese. For database changes, state which database version was used and verify the affected transaction behavior against that database. Unit tests do not replace database integration testing.

Run `npm run test:db` against dedicated test databases and `npm run test:ui` for automated Electron sidebar checks. See [the testing guide](docs/TESTING.md) for private connection settings, required permissions, cleanup, CI, and current coverage limits.

Git is required for real repository regression tests. Run `npm run test:git` to focus on source history, synchronization, retries, and workspace safety. These tests also run in the normal checks and use disposable local repositories/remotes.

Keep maintainer changes focused. Record the problem, resulting behavior and verification in the commit or accompanying maintenance notes. Check screenshots for visible UI changes when appropriate.

## Code conventions

Keep text files in LF format. `.gitattributes` applies this to Git checkouts on
Windows, macOS and Linux, complementing the editor settings in `.editorconfig`.
PNG artwork is explicitly binary and must not undergo newline conversion. Tests
should use Node's path utilities for filesystem paths and handle CRLF input where
they inspect text; URL paths continue to use forward slashes.

Add the following short license header to new original source files, using the
file format's comment syntax. Preserve a shebang or other required leading
declaration. Keep existing third-party copyright and license notices; do not
relabel third-party code as MonaBase's original work.

```ts
// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
```

Use `--` for SQL, `#` for YAML, and block comments for CSS/HTML. JSON and binary
assets must remain valid in their own formats; their licensing is declared in
the README and LICENSE. Preserve the applicable copyright years and owners when
maintaining existing files. The [Apache licensing FAQ](https://www.apache.org/foundation/license-faq.html#how-should-i-apply-the-apache-license-to-my-own-software)
documents this short form. A complete license copy still accompanies distribution.

- Write comments and translation keys in English. Explain constraints and reasons rather than recording that code was added or changed.
- Prefer explicit TypeScript types and narrow values at process boundaries.
- Keep cross-feature data models in `src/shared/types/`; shared models and IPC contracts should not import feature implementations.
- Test exported behavior directly. Extract reusable validation when necessary instead of evaluating copied fragments of a component.
- Keep database-specific behavior explicit; share behavior only when it has the same meaning in both databases.
- Define new IPC arguments and responses in `src/shared/api/desktopContract.ts` and keep its channels aligned with the preload allowlist.
- Keep React hook calls unconditional and effect dependencies complete; avoid suppressing the checks.
- Use the shared desktop API for renderer-to-main communication. Do not expose Node.js or Electron internals to React components.
- Execute transactional DML and table/view data reads through the main database connection. Use background connections for metadata and administrative reads.
- Keep credentials and sensitive source or query data out of logs and test fixtures.
- Use `electron/services/jsonFiles.js` for connection, AI, and application settings. Preserve damaged files and unreadable encrypted credentials; do not treat failed decryption as an intentional clear.
- Keep SSH host-key verification in the shared main-process service. Unknown keys need explicit approval; changed keys must block before authentication.
- Shared generation rules and random helpers belong in `src/features/data-generator/`; database SQL and date conversion remain in their database features.
- Add meaningful regression tests when behavior changes. Existing tests cover transaction state, trace instrumentation, history persistence, and translation consistency.

See [the architecture guide](docs/ARCHITECTURE.md) and [translation guide](docs/INTERNATIONALIZATION.md) for implementation details.

For packaging and storage changes, run `npm run build:unpacked` and
`npm run verify:package` against the newly built application. Follow the
[release checklist](docs/RELEASE_CHECKLIST.md) for OS-specific and real database
checks; an unpacked build does not verify an installer or portable launcher.

Use English test descriptions and developer diagnostics. Keep localized UI text in the translation catalogs and retain multilingual fixtures when they verify language handling. TypeScript strict checking is enabled; avoid suppressions and validate optional values explicitly. See the architecture guide for import conventions and feature boundaries.
