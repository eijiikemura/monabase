# CI security and maintainer settings

MonaBase does not accept pull requests, including dependency-update PRs. The
maintainer reviews changes locally and pushes reviewed commits directly. Issues
remain available for feedback; vulnerability details belong in a private report
as described in [SECURITY.md](../SECURITY.md).

## Repository settings on GitHub

These settings live on GitHub and cannot be enabled by committing workflow YAML.
Apply them to the publishing repository and verify them after repository creation
or migration:

1. **Settings → General → Features → Pull requests:** turn off Pull requests.
2. **Settings → Actions → General → Workflow permissions:** select read-only
   repository contents/packages permissions, and leave permission to create or
   approve pull requests disabled.
3. Under fork workflow approvals, require approval for **all external
   contributors** and do not approve unsolicited PR code. Keep this protection if
   PRs are ever temporarily re-enabled. Do not enable privileged execution of
   untrusted fork code.
4. Under **Settings → Advanced Security** (or **Code security**, depending on the
   interface), enable the dependency graph and **Dependabot alerts**. Disable
   **Dependabot security updates**, which create automatic PRs. Version-update
   configuration and the PR submission template are intentionally absent.
5. Keep signing/deployment credentials and personal DB/SSH configuration out of
   these CI jobs. Do not add a persistent self-hosted runner to execute external
   contributions.

Disabling PR creation on GitHub is the repository-level control. Removing the
`pull_request` trigger from the checked-in workflows is a complementary change;
it is not a GitHub-wide rule preventing every workflow that could be proposed in
an untrusted PR. Confirm the GitHub settings rather than relying on the written
contribution policy or tests alone. Forking a public repository is still allowed
and does not grant write access to the original repository.

Official references:

- [Disable pull requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-pull-requests)
- [Manage Actions permissions and fork approvals](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Dependabot alerts](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-dependabot-alerts)
- [Dependabot security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)

## Workflow boundaries

[CI](../.github/workflows/ci.yml) and
[integration tests](../.github/workflows/integration.yml) run on repository pushes
and manual dispatch, not PR events. Both use GitHub-hosted runners and
`contents: read`. They do not publish releases. Every checkout uses
`persist-credentials: false`, and external Actions use full commit SHAs.
The disposable DB credentials in integration.yml are for that run's service
containers, not personal database accounts.

All four workflows, including release preparation and the website, pin
[`checkout` v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and
[`setup-node` v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
to their full commit SHAs. These Actions use the Node.js 24 runtime, removing
the deprecated Node.js 20 Action runtime. The separate `node-version: 22`
setting still selects Node.js 22 for application installation and tests.
Keep these versions separate when reviewing future Action updates.

Oracle privilege preparation uses SQLPlus with local SYSDBA authentication inside
`job.services.oracle.id`, switches to `FREEPDB1`, and grants only the listed test
privileges to `MONABASE_TEST`. It does not use a personal database or grant the
application user DBA/SYSDBA. SQL/OS errors terminate setup with an Oracle error
instead of being replaced by a generic JavaScript catch message.

The Linux UI job resolves Electron's lazy binary download first, then sets only
that runner's `chrome-sandbox` helper to owner `root:root` and mode `4755` before
running Xvfb. Renderer sandboxing stays enabled; neither `--no-sandbox` nor a
host-wide AppArmor/user-namespace policy change is used.
Xvfb provides a 2560×1440 virtual screen so the suite's deliberate narrow and
2200-pixel-wide window checks are not constrained by its smaller default display.

DB service images use immutable manifest-index digests. The readable tags identify
the intended major version, but the digest determines the downloaded image. The
registry response bytes and the presence of a Linux amd64 manifest were verified
when pinning these references:

| Image tag | Manifest index digest |
| --- | --- |
| `postgres:16` | `sha256:1beaa3084eee2676f20a9cd9928f0bf2c5bf674f8e49f81017912183d377c61c` |
| `gvenzl/oracle-free:23-slim-faststart` | `sha256:f5ff19033860d662c821cb04eb10483fa94f14f78eae252d054291ea07028093` |

A fixed digest prevents a tag from silently switching content. It does not
establish that the image has no vulnerabilities. The same limitation applies to
Action SHA pins and npm lockfile integrity.

## Dependency maintenance without update PRs

At least weekly, and before each release, the maintainer should:

1. Review Dependabot alerts, upstream security notices and release notes for npm
   dependencies, GitHub Actions and both DB images.
2. Run `npm run audit:security` and inspect `npm outdated` locally. An advisory
   failure must be investigated; an empty audit does not prove absence of malware.
3. For a needed update, inspect the publisher and changes before modifying the
   dependency/lockfile, Action SHA or image digest. Obtain digests from the expected
   registry over verified HTTPS; verify the Linux amd64 entry for these CI jobs.
   Preserve full SHA/digest pins rather than reverting to mutable tags.
4. Run `npm ci`, `npm run check` and `npm run build:renderer`. Apply the additional
   DB/UI/package checks appropriate to the change in [TESTING.md](TESTING.md) and
   [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
5. Push the reviewed change and check both Actions workflows. Use the Actions
   **Run workflow** control when a manual repeat is needed. Validate changed DB
   images in the actual integration jobs before treating them as tested.

`tests/security-hardening.test.cjs` guards the checked-in trigger policy, read-only
permissions, Action pins, checkout credential settings, DB digest shapes and
absence of automatic update-PR configuration. It deliberately requires the
explicit YAML event layout used here; alternate layouts require a conscious test
review. These tests do not inspect GitHub account/repository settings or execute
GitHub-hosted jobs locally.

### Build-tool compatibility overrides

The root lockfile pins `joi` to 17.13.9 and glob versions 9 and newer to 14.0.3
for GHSA-4528-x5fx-h6hg and GHSA-3g3m-2fjr-6pw4. Legacy glob v7 retains its
callback interface; its minimatch dependency is replaced as described below.

For GHSA-g3hv-75wg-m249, every minimatch dependency resolves through the private
[`scripts/minimatch-compat`](../scripts/minimatch-compat/README.md) package to
the official `minimatch@11.0.3` tarball, recorded as the `minimatch-v11` npm alias.
Older consumers expect a callable CommonJS export and glob v7 expects compiled
parts with raw-pattern metadata and `String.match` support. The bridge adapts
these interfaces to upstream's nonrecursive matcher; it does not reintroduce a
regex matcher or suppress audit findings. ESM/CommonJS share constructors and
the GLOBSTAR symbol. Keep the local package and lockfile together when cloning.

[`tests/build-dependency-compat.test.cjs`](../tests/build-dependency-compat.test.cjs)
exercises both module interfaces, React lint rules, old/new glob traversal,
ASAR packing/unpacking, directory comparison and wait-on configuration. After
updates, verify clean installation using the CI Node.js/npm versions as well as
local versions. A successful incremental install alone does not establish that
`npm ci` will reproduce the dependency tree. Remove compatibility overrides once
the consuming tools support patched upstream versions natively.

Workflow-text checks normalize CRLF to LF and run against both line endings while
retaining the same strict event, permissions, pinned-Action and credential checks.
`.gitattributes` also keeps text checkouts in LF on all operating systems and marks
PNG assets as binary. A disposable real-Git test enables `core.autocrlf` and checks
that these attributes retain LF source bytes and unchanged PNG bytes.

## Manual release preparation

[Prepare release](../.github/workflows/release.yml) is a separate, manual-only
workflow. The default branch and an existing matching version tag must identify
the same commit. Forks are refused. Tests, audit, native OS packaging and ASAR
verification must pass before the later jobs run. No ordinary push publishes a
release; the last job creates only a draft for maintainer review.

The baseline and build jobs retain `contents: read`. Only the attestation job gets
`id-token: write` and `attestations: write`; only the draft job gets
`contents: write` plus `attestations: read` to verify provenance. Neither privileged
job checks out or executes project code or installs dependencies. Downloads are
limited to this workflow run, with three exact distribution names and no overwrite
of existing releases. The draft job checks provenance against the repository,
workflow and source commit, rejects self-hosted attesters, checks SHA-256 values,
and rechecks the tag before attaching assets. All Actions remain SHA-pinned and
all checkouts disable persisted credentials. No personal token is required.

Protect the default branch, workflow files and version tags against unauthorized
writes/deletion in repository rulesets. The guard cannot protect an account with
permission to change the workflow itself. Keep repository-wide token defaults
read-only; the release jobs request their narrower exceptions explicitly. The
workflow's version/permissions/asset checks are exercised in
`tests/build-portability.test.cjs`. GitHub-hosted builds, OIDC and draft upload must
also be verified in GitHub itself; local tests cannot prove them successful.

## Website publication

[Website](../.github/workflows/website.yml) validates the independent Astro/Starlight
site on relevant `main` pushes and manual dispatch. Forks and non-default refs do
not enter its build job. The build uses read-only contents access, a separate npm
lockfile/cache, translation/type/content checks, an audit, production build and
local-resource verification. It uploads only `website/dist` as a seven-day Pages
artifact. Pushes do not deploy.

Only manual dispatch in the exact intended public repository
`eijiikemura/monabase` can enter the separate `github-pages` deployment job. That
job has only Pages/OIDC write permissions and runs the pinned official deploy
Action without checking out or executing project source. Configure Pages to use
GitHub Actions before the first manual deployment. The private test repository can
validate builds but does not publish. No desktop release is created by this workflow.
