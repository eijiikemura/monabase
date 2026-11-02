# Security reporting

Do not include passwords, API keys, private database objects, customer data, or private SSH keys in public issues.

If the repository offers private vulnerability reporting, use that channel. Otherwise, ask the maintainer for a private reporting channel without publishing exploit details. Include affected versions, reproduction steps, and impact in the private report.


Use HTTPS for external AI services and verified TLS for remote PostgreSQL servers
where supported. Existing PostgreSQL profiles retain disabled TLS until explicitly
configured; SSH trust and database certificate verification are separate settings.
Do not embed Git access tokens or passwords in remote URLs; use a credential helper
or SSH agent. Keep connection settings, local test configuration and exported data
private even when an example account uses a simple password.

Dependency advisories are checked in CI. Dependabot alerts should remain enabled, while automated version/security-update pull requests should be disabled in the repository settings. The maintainer reviews dependency advisories and upstream releases at least weekly and applies verified updates directly; see [CI security](docs/CI_SECURITY.md).
A passing audit does not guarantee that the application has no vulnerabilities.


AI coding/debug conversations are stored separately for each configured database
connection destination. Conversation files created before connection scoping remain
on disk but are not automatically restored or deleted with scoped objects, because
their owning connection cannot be determined. These files can contain source code
and conversation text; protect them with the same care as other local project data.
