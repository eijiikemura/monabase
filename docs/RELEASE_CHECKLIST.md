# Release verification

## Prepare a GitHub Release

The manual [Prepare release workflow](../.github/workflows/release.yml) creates a
draft, not a public release. It does not run on pushes, tags or PRs. Its files are:

| Platform | Architecture | Download (example version 1.0.0) |
| --- | --- | --- |
| Windows installer | x64 | `MonaBase-1.0.0-win-x64-Setup.exe` |
| Windows portable | x64 | `MonaBase-1.0.0-win-x64-Portable.exe` |

1. Review and commit the release source, set `package.json` and the root package
   entry in `package-lock.json` to the same version, and push to the default branch.
   Wait for **CI** and **Integration tests** to succeed on that commit.
2. Create a tag such as `v1.0.0` at that exact commit and push the tag. The tag must
   match `package.json` (`v` plus the version). Do not move an existing release tag.
3. In **Actions → Prepare release → Run workflow**, select the default branch and
   enter the tag. The selected commit must still match the tag; if the branch has
   moved, prepare a new reviewed version/tag instead. Forks and other branches
   cannot pass the workflow's initial guard.
4. Wait for tests, OS builds, package verification, provenance generation and
   verification to succeed. The workflow checks both Windows filenames, generates
   `SHA256SUMS`, attests the downloads and checksum file, and attaches all three to
   the draft. It rechecks the tag's commit before creating the draft.
5. Open **Releases**, review the draft, replace its notes, download and test the
   files on the target systems using the manual checks below. Mark prereleases
   explicitly when appropriate, then select **Publish release** when ready.

An existing release (including a draft) is not overwritten. Investigate failures
before rerunning; after a partial draft creation, inspect/remove only that draft
if a clean retry is needed. Intermediate Actions artifacts expire after seven
days; uploaded Release assets have their own lifetime.

Windows installers allow a per-user installation and a destination choice. The
portable EXE runs without an installer; some connection data and credentials still
use OS storage as described below. Locally, `npm run build:win` creates both EXEs;
macOS and Linux distributions are not currently provided.
`npm run build` also targets Windows; `build:mac` is not defined. Build on the corresponding OS
(Windows cross-packaging exceptions are described below). These commands never
publish. The workflow uses native runners for all architectures.

### Verify GitHub Artifact Attestations

Use a current GitHub CLI, replacing the repository and filename:

```sh
gh attestation verify MonaBase-1.0.0-win-x64-Setup.exe --repo OWNER/REPOSITORY --signer-workflow OWNER/REPOSITORY/.github/workflows/release.yml --deny-self-hosted-runners
```

Verify each download. For a specific reviewed commit, also pass
`--source-digest COMMIT_SHA`. `SHA256SUMS` detects accidental corruption, while
attestation verification checks provenance against the expected repository and
workflow. The draft job performs both checks before upload. The privileged jobs
never check out source or install/run npm packages. They use artifacts only from
the current workflow run; build jobs have no repository-write or OIDC permission.

Artifact attestations are available for public repositories on current GitHub
plans. Private/internal repositories require GitHub Enterprise Cloud. No personal
access token or signing certificate is needed for these workflow attestations;
the workflow uses GitHub's job token and OIDC. Repository/organization policies
must permit these job-level permissions and the pinned official Actions.
Attestation generation/verification needs GitHub and Sigstore network access.
See [GitHub's attestation guide](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
and [CLI verification policy](https://cli.github.com/manual/gh_attestation_verify).

These Windows downloads have no Authenticode signature.
Attestations establish origin; they do not remove SmartScreen warnings or establish absence of vulnerabilities. Apply
the signing and OS checks below before treating the downloads as release-tested.

Mac CI unpacked builds use explicit ad-hoc signing (`build.mac.identity: "-"`) so packaging
changes are covered by a valid bundle signature. `verify:package` runs
`codesign --verify --deep --strict` on macOS and fails on an invalid signature.
This is not a Developer ID signature or notarization: downloaded builds can still
be blocked by Gatekeeper. For general distribution without these warnings,
configure Developer ID signing and Apple notarization. Do not disable Gatekeeper
globally or mistake successful archive/fuse checks for a first-download launch test.


## Automated checks

The CI workflow runs `npm run check` and builds the renderer on Linux. Separate
jobs on Windows and macOS run tests, build an unpacked desktop application with
no trusted publisher signature, and run the package verifier.
Mac CI uses ad-hoc signing for bundle integrity; it does not create a downloadable DMG. The integration workflow keeps
its PostgreSQL, Oracle and Electron UI tests on Linux. These jobs do not publish releases.

To run the packaging checks locally:

```sh
npm run check
npm run build:unpacked
npm run verify:package
```

If `release/` contains older applications, pass the freshly built application
directory or its `app.asar` explicitly:

```sh
npm run verify:package -- release/mac-arm64
```

`build:unpacked` produces an application directory, not an installer or a Windows
portable launcher. `verify:package` checks the actual ASAR for required code,
renderer assets, catalogs, and license files, and rejects bundled local data. It
loads the packaged storage and trace modules and writes/reloads sample traces in
temporary installed and portable data directories. It uses the archive reader
provided by the locked electron-builder development dependencies.

These checks do not launch the packaged executable or connect to a real database.

ASAR member paths are normalized to the host OS before extraction. In particular,
Windows requires native separators for nested member lookup in the locked archive
reader. The portability suite checks real archived files with native and Windows
lookup behavior; it does not hide missing files or weaken content/fuse checks.

## Runtime baseline

The application uses Electron 44. Development requires Node.js 22.12 or later;
use a maintained Node.js LTS release for release builds. Mac artifacts require
macOS 13 or later. Recheck the [Electron support schedule](https://releases.electronjs.org/schedule)
and [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
before changing the runtime major version. An Electron update requires fresh
artifact checks on every supported OS, including native SSH dependencies.

## Data location and migration

| Mode | Settings, Git workspace, AI history, and traces |
| --- | --- |
| Development | Current working directory, normally the project root |
| Installed application | Electron's OS-specific `userData` directory |
| Windows portable launcher | `PORTABLE_EXECUTABLE_DIR`, the directory containing the launcher |

Connection profiles, SQL history, and AI connection settings remain in `userData`
in all modes. Credentials use the OS key store and are not portable across
machines merely by copying the application directory.

On packaged startup, missing settings, AI history, and Git workspaces are copied
from the previous executable-adjacent location. Legacy traces are copied per
database from the old source-relative trace directory, or the executable-adjacent
trace directory. Originals are retained. Existing destination files and complete
workspace directories take priority; repositories are never merged during
migration. Directory copies are staged before becoming the active destination.
Development mode does not migrate another directory's data.

## Settings recovery

Settings saves use a temporary file in the same directory and replace the original
only after writing and flushing succeeds. Invalid JSON is retained with a private
`<filename>.corrupt-<sha256>.bak` copy. That copy preserves damaged contents for
inspection; it is not a known-good backup. Application settings fall back to
in-memory defaults until explicitly saved. Damaged connection or AI settings are
reported instead of silently reset. Keep recovery files private when asking for help.

If Keychain access or another decryption operation fails, the affected credential
fields show a warning. Unlock the key store and reopen the login screen or AI
settings, or enter replacement credentials. Saving display fields/model choices or reordering
connections retains unreadable encrypted values when the credential recipient
is unchanged. Changing DB/SSH targets, TLS trust settings or an AI endpoint with
an unreadable secret requires re-entry. A blank field clears a secret
only after it has been successfully unlocked in the session; deleting a connection
profile still removes that whole profile. If a record already contains encrypted secrets, replacement encryption failure
rejects the whole save and preserves both previous metadata and ciphertext.
New records without prior ciphertext retain the session-only option.

## SSH host key changes

On first connection, compare the displayed SHA-256 fingerprint with the server
administrator's value before selecting **Trust and connect**. MonaBase stores
approved keys by SSH host and port in `ssh-host-keys.json` under Electron's
`userData` directory. This is separate from OpenSSH's `known_hosts`.

A changed key blocks authentication and shows the saved and received fingerprints.
For a legitimate server-key rotation:

1. Verify the new fingerprint with the server administrator through a trusted channel.
2. Quit every MonaBase instance and make a backup of `ssh-host-keys.json`.
3. Remove only the JSON entry matching that SSH host and port, preserving other entries and valid JSON syntax.
4. Reconnect, compare the new fingerprint again, and approve it.

Do not remove the trust file merely to bypass an unexpected warning. If the file
is invalid or cannot be saved, the connection is blocked and any damaged original
is retained. The network handshake timeout pauses while confirmation is open.

## Manual checks on release artifacts

Record the OS, application version, architecture, database version, and result for
each applicable item. Mark untested combinations explicitly.

- Launch the actual artifact on every OS being released; check initial startup,
  restart, English/Japanese, and F12 or the platform's developer-tools shortcut.
- On Windows, check text inputs after native alerts/confirmations, application
  switching, screen lock, sleep, and remote-desktop reconnection. In F12 Console,
  inspect input behavior while using DevTools; focus diagnostics stay in memory
  and do not print to the Console.
  Verify that recovery never takes focus from another app, a modal, or DevTools.
  Save the Console output before restarting if typing still fails.
- On a clean profile, confirm a query timeout of zero and working settings saves.
  Change the UI language and confirm subsequent database and trace messages follow it.
- Test Oracle and PostgreSQL connections, SSH if supported by the environment,
  real SELECT/DML, commit/rollback, cancellation, imports, and trace execution.
- Deny key-store access or use unreadable test ciphertext, then edit connection
  metadata, rename/reorder profiles, and save AI settings. Original encrypted values
  must survive; restored access must recover the original secrets. Check the warning
  in English/Japanese. Change the destination and secret while encryption is
  unavailable, then restart: both previous destination and previous secret must
  remain paired. Check partial DB/SSH encryption failure, unreadable-blank secrets,
  same-recipient rename/model edits, successful retry and session-only new records.
- With a disposable SSH server, verify first-use approval, cancellation, restart
  reuse, a changed key blocked before authentication, and an unwritable trust file.
  Leave confirmation open beyond the network timeout and verify it remains usable.
- With disposable settings, interrupt/fail a save and verify the original remains
  valid. Load damaged JSON and verify the original and recovery copy remain intact.
- In PostgreSQL, update a row without committing, then cause a duplicate-key error,
  a syntax error, and cancellation. Earlier edits must remain visible to that
  connection, invisible to another connection, and available for explicit commit
  or rollback. User savepoints must survive internal recovery. Confirm DDL still
  commits pending main edits before execution, while a background failure leaves
  the main transaction unchanged. An already aborted unmanaged transaction must
  report failure without an automatic full rollback or retry.
- Read, edit, copy, and export BIGINT `9007199254740993` and NUMERIC
  `0.1234567890123456789012345`. Preserve every digit, including primary-key
  predicates, numeric array elements, and stored function/trace returns. Sort
  neighboring large integers and fractional values in numeric order.
- Check named parameters next to `::` casts and inside strings, comments, quoted
  identifiers, and dollar-quoted bodies; only actual placeholders may change.
- In Oracle, verify NUMBER `9007199254740993` and
  `0.1234567890123456789012345` through reads, edits, imports, exports, and stored
  NUMBER output arguments. Small integer metadata such as source line numbers
  must retain compatible behavior.
- In both editors, execute mixed scripts containing quoted semicolons and bind-like
  text inside literals/comments. Include Oracle q-quotes, PL/SQL units separated
  by slash lines, trigger record references, PostgreSQL tagged dollar bodies,
  casts, and SQL-language BEGIN ATOMIC bodies. Error positions must refer to the
  original selected script lines.
- Browse separately named objects such as `SalesView` and `salesview`, and objects
  containing dots or apostrophes. Check tab reuse, data, DDL, Git definition
  preparation, updates, creation notifications, and closing only the deleted target.
- Restart after saving traces, AI history, and Git workspace changes; verify they
  are restored from the expected writable data directory.
- Use disposable legacy data to check migration, preserved originals, and existing
  destination precedence. Move a Windows portable launcher and confirm workspace
  data remains beside that launcher rather than its extraction directory.
- For PostgreSQL scalar function traces, compare the displayed return value with
  a normal execution, including zero and NULL. Confirm that ER diagrams show
  `INTEGER` without storage precision while retaining `NUMERIC(precision, scale)`.
- Open an existing AI conversation: system prompts and raw responses should start
  collapsed, expand on demand, and copy their full contents without sending a request.
- With a disposable workspace, verify invalid source/ER names and external links
  are rejected without altering outside files.
- Test Git synchronization, a real merge conflict, and a connection/authentication
  failure; only an actual conflict should enter conflict resolution.
- Check installer/portable-launcher generation, native libraries, signing,
  notarization, and OS launch permissions for the formats being distributed.

The unit and package checks cannot establish real database driver behavior,
OS key-store integration, executable signing, or portable-launcher behavior on
another operating system.


## Security transport and packaging checks

- Run `npm run audit:security` after `npm ci`, review dependency update PRs and
  preserve the lockfile. SheetJS is pinned to the official fixed distribution
  tarball; audit results alone do not prove a dependency is free of unknown flaws.
- `verify:package` reads the executable's actual Electron fuse settings: RunAsNode,
  NODE_OPTIONS and CLI inspect arguments must be disabled; ASAR-only loading and
  embedded ASAR integrity validation must be enabled. Repeat on each target OS.
  Verify F12/platform DevTools still works in the launched release artifact.
- With disposable profiles, check AI HTTPS enforcement, loopback HTTP support and
  redirect refusal. Use a credential helper/SSH agent for Git authentication;
  credential-bearing remote URLs must be refused and errors must redact secrets.
- For PostgreSQL TLS, test a trusted matching-name certificate and refusal of an
  untrusted CA/wrong hostname, including SSH tunneling. Select verified TLS for
  remote servers that support it; existing profiles retain disabled TLS until
  configured explicitly. Confirm the workspace badge and connection details.
- Export to a restored/manually entered path and verify native confirmation comes
  before retrieval/writing. Cancel, deny access and retry after capability expiry;
  existing files must not be overwritten by an unauthorized request.

Unsigned CI/local builds and fuse verification do not establish publisher identity.
Signing, notarization and launch checks remain required for the release formats
and operating systems actually being distributed.

- In Settings → AI, edit response capacity, idle timeout and overall timeout; save,
  reopen and verify each value. With a disposable/mock AI service, exceed each
  limit and confirm a clear failure, no automatic retry, and no incomplete code
  available for adoption. Cancel manually and confirm it remains a cancellation.
- With disposable Git configuration, include several push URLs and URL rewrites;
  every effective destination must be checked before transport. Verify SSH URL
  passwords are absent from copied errors and the remote display.
- On POSIX systems, save and reopen fictional AI conversations and check private
  directory/file permissions. Existing history contents must survive permission
  repair. Windows ACL isolation must be assessed separately on Windows.

- In Settings → Files, edit the independent SQL/ER capacity limits, save and reopen.
  With disposable files, check an exact-limit file, an oversized file and a refused
  directory/link. Errors must leave the editor/design intact rather than opening a
  truncated file. The default is 16 MiB each; valid integers range from 1 to 64.
- Export fictional formula-like strings and headers to CSV/clipboard with safety
  enabled and disabled. Open only harmless examples in the supported spreadsheet
  applications, confirm no formula evaluation in safety mode, and verify exact mode
  still round-trips DB text. An apostrophe changes exported strings; subsequent
  spreadsheet editing/resaving can remove protections.
- With a mock AI endpoint, return dummy keys in structured errors and verify the
  UI, copied errors, conversation history and development diagnostics do not reveal
  those keys. Retain useful status codes without exposing raw server error pages.

- Export fictional JSON cells containing `f`, `l`, `h` and other SheetJS-like keys
  to XLSX. They must display as JSON text, without formulas, active hyperlinks or
  rich formatting. Check normal numeric/boolean/date values and exact large-number
  strings. CSV safety-mode selection must not weaken XLSX cell typing.
- Run `npm run test:ui` with its real IPC-origin fixture. In release artifacts,
  verify startup from application paths containing spaces/non-ASCII characters and
  keep the approved entry URL shared by loading and trust validation. Recheck normal
  operations and DevTools after the IPC restrictions. Never add a wildcard file
  origin or arbitrary localhost port to work around a startup failure.

- In Settings → General, disable SQL-history saving, save/reopen, execute a harmless
  query and confirm the history file is not appended. Re-enable and verify normal
  history recording resumes. Existing history must remain until explicitly cleared.
- With disposable/mocked credentials, test both successful and failed PASSWORD /
  IDENTIFIED BY SQL. Log/result SQL and error notifications must not expose secret
  values; the original command must still reach the execution boundary. No such
  history entry may be added, even when ordinary history saving is enabled.
  Include CREATE/ALTER SUBSCRIPTION CONNECTION in both conninfo and URI forms,
  and Oracle ADMINISTER KEY MANAGEMENT. URI passwords must be protected even
  without the word PASSWORD. Use simulated execution; do not create subscriptions
  or change production keystores for this check.
- When upgrading a private profile, remember that old history/recovery files may
  retain older secrets. Review/clear history explicitly; do not distribute private
  profile backups. This application policy cannot redact the DB server's own logs.


### Git HTTPS and redirect checks

- Confirm that Git synchronization refuses HTTP redirects even when URL-scoped
  Git configuration enables them. Configure the final official repository URL
  in Git settings instead of relying on a hosting redirect.
- Confirm that an untrusted certificate fails with actionable guidance. For an
  internal CA, install its certificate in the trust store used by Git or configure
  `http.sslCAInfo` as supported by the installed Git TLS backend; on Windows,
  Schannel may use the OS certificate store. SSH is another option.
- MonaBase forces certificate verification and redirect refusal only for its own
  Git invocations. Existing user/repository configuration files must remain
  unchanged. Recheck this behavior on each supported OS; loopback tests on one
  development machine do not establish all-platform packaged behavior.


### Internal history privacy and resource limits

- Malformed AI/trace history must show a fixed error without excerpts of private
  conversation, arguments or variable values in UI/console output. Keep originals.
- Verify the 64 MiB internal-history file limit and 16 MiB Git SQL-source limit;
  review/conflict content has a combined 64 MiB budget. Git ER history follows the
  ER setting. These internal/Git safety bounds are fixed, separate from the
  configurable SQL/ER open-file limits. Reject before mutation and permit a later
  retry with valid data; do not silently prune or truncate existing files.
- New AI-usage CSV rows must neutralize formula-starting text as well as quote
  embedded separators/newlines. Existing rows are retained unchanged. Test with
  the spreadsheet application/version used for distribution; CSV re-saving can
  change escaping and is outside the first-open protection.


### Windows file metadata and publisher identity

`package.json` declares the author name `eiji ikemura`. Electron-builder uses it
for the Windows `CompanyName` version resource and its default copyright text,
including the portable launcher. Rebuild with `npm run build:win`; an already
created EXE does not acquire the updated metadata. Check Properties → Details
for Company name and Copyright on the outer portable EXE and the application EXE.

These editable version resources do not establish a verified publisher. The
publisher shown by SmartScreen and the Digital Signatures tab is based on the
Authenticode signing certificate. To display a verified personal publisher, obtain
an appropriate trusted signing identity and configure Windows signing; the name
must match the validated certificate identity and may differ in spelling/case
from the editable author metadata. Do not set a fictional `publisherName` to
simulate a signature, or bundle certificates/private keys in the repository.
Signing credentials and certificate purchase/enrollment require separate setup.

A valid signature can show a verified publisher while SmartScreen still warns
about an unfamiliar application. Self-signed certificates do not establish public
trust. See [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).


### Windows cross-packaging from macOS/Linux

`npm run build:win` passes `--config.npmRebuild=false` to electron-builder.
The SSH CPU detector and native crypto accelerator are optional, and are excluded
from Windows packages so a host-platform binary cannot be used accidentally.
SSH uses its JavaScript/Node crypto fallback. Oracle's shipped Windows x64
Node-API binary is retained for Thick mode; Oracle Client libraries are still a
separate user installation. Native rebuild defaults for other build commands are
unchanged. No dependency is removed from package.json or the lockfile.

Do not use a `beforeBuild` hook returning false as a drop-in replacement: in the
current builder that also disables automatic dependency collection. Windows file
patterns must retain the common application allowlist as well as exclusions;
a platform list containing only exclusions can broaden application copying.
`verify:package` checks required runtime dependencies, private-data exclusion,
SSH accelerator exclusion and the Windows Oracle binary. Verify the fresh
`win-unpacked` directory, then separately launch the portable EXE on Windows.

The renderer's chunk-size warning is independent of native cross-compilation;
it does not fail the build and its threshold is not increased to hide the warning.


### SQL execution privacy

- Check that credential-bearing dynamic SQL in anonymous/stored blocks is excluded
  from history and masked in execution logs/errors. Unknown EXECUTE expressions
  must use conservative protection; inspection must not evaluate them.
- In both database SQL windows, toggle **Execute without history**, execute a
  script and verify history omission, masked SQL/errors, visible query results and
  no AI tuning snapshot. Switch off and verify normal history resumes. The lock
  state is per-window, and the toggle is disabled during execution.
- Keep explicit file saves/AI requests and DB-side logging outside this policy.
  Existing history must not be deleted or rewritten automatically.


### External authentication files

- Verify bounded asynchronous reads for SSH keys (1 MiB) and PostgreSQL custom CA
  bundles (4 MiB), with no silent truncation or insecure fallback. Selected links
  to regular files remain supported; special files and oversized targets fail.
- Reading external keys/certificates must not modify file bytes or permissions.
  Failure messages must contain neither file content nor raw path/OS diagnostics.
- Recheck encrypted and unencrypted SSH keys on supported platforms. The package
  verifier requires `electron/services/credentialFiles.js` alongside its bounded
  reader. POSIX FIFO/device tests do not establish Windows special-file behavior.


### GitHub repository and CI policy

- Follow [CI security](CI_SECURITY.md): disable PR creation on GitHub, retain
  read-only Actions permissions, require approval for all external contributors,
  keep Dependabot alerts enabled and automatic update PRs disabled. Committed YAML
  does not apply these repository settings.
- CI/integration must admit only pushes/manual dispatch; release preparation must
  admit only manual dispatch on the default branch. Retain full Action
  SHAs, `persist-credentials: false` and fixed DB-image digests.
- Review advisories and upstream npm/Action/image changes weekly and before a
  release. Validate updated image manifests and the actual integration jobs.
  Do not claim GitHub-hosted packaging or DB service success from local checks.


### AI completion and historical source reads

- Buffered and streamed code requests must reject explicit incomplete provider
  completion, including a fallback from unsupported streaming. Preserve the
  editor and keep incomplete output out of code review/adoption.
- Current-path Git sources must load without scanning ordinary history. Confirm
  old content across renames, the 128-rename/256-path discovery limits, shared
  8 MiB metadata budget and 30-second deadline, and the existing 16 MiB blob limit.
  Limit failures must retain repository files, index and HEAD.


### AI conversation isolation

- Same-named programs in different configured servers/databases/users/SSH routes
  must keep separate coding/debug conversations and adopted Git summaries.
- Deleting an object or Oracle package must affect only that connection's history.
  Delayed reads/saves after a workspace switch must retain their original scope.
- Keep unscoped legacy files unchanged and exclude them from automatic restoration
  and scoped deletion. Missing/unissued scopes must fail instead of falling back.


### Workspace usability

- Check search text Home/End editing and Up/Down/Enter result navigation with IME
  enabled. Result-focused navigation must retain its existing behavior.
- Check AI source/settings diffs in unified and split modes, automatic narrow/wide
  defaults and manual selection while resizing. Layout changes must not apply code.
- Reopen closed error/success notices from each workspace header, check timestamps,
  copy and explicit individual/all-history removal. History must remain memory-only
  and must not expose stale retry actions.
- Resize both sidebars by mouse and keyboard, reconnect/restart, and shrink then
  enlarge the window. Restore preferred widths without restoring editor contents;
  restricted browser storage must not break either workspace.


### SQL reuse and selection feedback

- Double-click SQL history to open a new tab without replacing the original draft.
  Check explicit replacement, keyboard row selection and existing tab-limit feedback.
- Keep result counts/times matched to retained rows after failures, cancellation or
  later non-result DML. Check zero rows, zero time, plan mode and transposition.
- Result actions must sit in the existing tab row, above cells, at narrow widths too.
- Collapse AI references and check ready/loading/error feedback remains visible;
  reopening must retain all selections and definition retry controls.
- Double-click an available single-selection picker row, including on a later page.
  Check failed-add retry and duplicate suppression; multiple selection must still
  require Add and retain its existing cross-page selection behavior.


### Settings and Git consistency

- Empty numeric settings must remain empty while editing. Save with invalid values
  on another tab must reveal, describe and focus the first invalid field without
  writing settings. Check zero unlimited timeout and fractional/nonfinite rejection.
- Check split/unified controls across AI, Git object history, two-revision comparison
  and schema review. Verify independent side searches in both modes, manual-choice
  retention, responsive schema preview and revision swapping without writes.
- Search condition columns and show only entered filters/sorts. Hidden predicates
  must remain effective and be indicated. Clear all must preserve column types and
  exclusions, include hidden drafts and leave existing results until Execute.
