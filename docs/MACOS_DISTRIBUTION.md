# Developer ID distribution for macOS

macOS 13+ on Apple Silicon (arm64) is officially supported from v1.0.1.
This is a **manual Apple Silicon (arm64) DMG workflow**, separate from the
Windows-only GitHub release workflow. It does not publish or upload to GitHub.
Use the locked electron-builder 26 settings; v27 uses a different signing schema.

## Prerequisites and signing

Use macOS with Xcode Command Line Tools, the installed npm dependencies, and an
unlocked keychain containing a valid **Developer ID Application** certificate and
its private key. An Apple Development certificate is insufficient. Check public
identity information with:

```sh
security find-identity -v -p codesigning
```

If multiple distribution identities exist, set `MONABASE_MAC_SIGN_IDENTITY` to
the intended certificate's SHA-1 fingerprint. Do not export/import certificates
as part of this workflow. Keep `.p12`, `.pfx`, API keys and passwords outside Git.
Apple Developer membership expiry and certificate expiry are different dates;
check both before each release.

```sh
npm run check
npm run build:mac
```

The latter builds the renderer, then creates a **new** directory under
`release/mac-developer-id/`. Its absolute path is printed on success. It signs
the app, helpers, frameworks and DMG, contacting Apple's timestamp service.
It does **not** submit software for notarization. Existing output directories
are refused, protecting previously reviewed artifacts.

The dedicated `build/mac/distribution.cjs` profile requires Developer ID signing
and Hardened Runtime. Main-process entitlements enable V8 JIT and loading Oracle
Instant Client libraries with a different signing team. Helpers enable only JIT.
App Sandbox, debug access and unsigned executable memory are not enabled.
SSH uses its JavaScript implementation, as in Windows packages; its optional
native acceleration modules are excluded and native rebuilding is disabled in
this profile only. No dependency versions are changed.

Verify the signed stage, replacing `DIRECTORY` with the printed directory:

```sh
npm run verify:mac -- DIRECTORY --signed-only
```

This checks bundle ID/version, the main entitlements, nested Mach-O signatures,
helper entitlements, signing team, secure timestamps, and recorded artifact
hashes. Signing alone does not establish Gatekeeper acceptance.

## Keychain authentication and explicit Apple submission

Use a profile already stored by `xcrun notarytool store-credentials`. This command
can prompt interactively for the Apple ID, app-specific password and team ID;
never put passwords in shell arguments, source, logs or chat. The alternative
App Store Connect authentication setup is documented by Apple. This project's
submission command reads only the **profile name**, plus an optional keychain
path; it does not accept plaintext credentials.

The profile name is not a certificate name. If the command reports that no
keychain password item exists, create the notarytool profile interactively or
select the correct existing profile before retrying. A signing certificate alone
does not supply notarization authentication.

```sh
export APPLE_KEYCHAIN_PROFILE='YOUR_EXISTING_PROFILE_NAME'
# Optional: export APPLE_KEYCHAIN='/path/to/keychain-db'
```

After reviewing the signed artifacts and approving submission to Apple:

```sh
npm run notarize:mac -- DIRECTORY --allow-apple-upload
```

This explicitly uploads two artifacts: a ZIP of the signed app, then a rebuilt
DMG containing the stapled app. Each must receive `Accepted`. The command staples
and validates both the app and DMG, evaluates Gatekeeper, and writes
`SHA256SUMS`. App ticket stapling precedes the final DMG build so an app copied
from that DMG also carries its offline-verifiable ticket.

The private `mac-release.json` in the output directory records artifact hashes,
submission IDs and completed steps, without credentials. Repeating the same
command resumes saved submission IDs instead of resubmitting completed steps.
A timeout is not acceptance. If rejected, use Apple's `notarytool log` with the
saved submission ID and keychain profile; review the log locally and redact
private information before sharing it. Correct the cause and create a new
build directory rather than modifying submitted artifacts in place.

## Verification and manual release

```sh
npm run verify:mac -- DIRECTORY
codesign --verify --deep --strict --verbose=2 DIRECTORY/mac-arm64/MonaBase.app
xcrun stapler validate DIRECTORY/mac-arm64/MonaBase.app
xcrun stapler validate DIRECTORY/MonaBase-VERSION-mac-arm64.dmg
spctl --assess --type execute --verbose=4 DIRECTORY/mac-arm64/MonaBase.app
spctl --assess --type open --context context:primary-signature --verbose=4 DIRECTORY/MonaBase-VERSION-mac-arm64.dmg
```

Test the app copied from the DMG, including opening the login screen, Oracle and
PostgreSQL connections, SQL, commit/rollback, read-only mode, Git, ER diagrams
and trace analysis. Keep paid AI calls explicitly approved and separate. Stapler
validation and Gatekeeper evaluation do not replace those functional checks.

For a future **reviewed, new version/tag**, manually attach the verified DMG and
its checksum to that release only when publishing is authorized. Do not replace
published v1.0.0 assets or move its tag. The existing Windows release workflow
does not attest this manually built DMG; do not claim that it has a GitHub
Artifact Attestation. Apple notarization and GitHub provenance are separate.

After publishing, download the actual GitHub asset in a browser, compare its
SHA-256, install through Finder and launch normally with quarantine intact.
Test on a clean supported Apple Silicon Mac and, where practical, offline after
installation. Never disable Gatekeeper or remove quarantine to claim success.
This download test cannot be completed before an authorized upload.

The default CI unpacked Mac build keeps its ad-hoc signing profile. Windows
NSIS, Portable and AppX settings, app identity, version, icons and the GitHub
release workflow are unchanged by this manual macOS profile.

References: [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/),
[Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).
