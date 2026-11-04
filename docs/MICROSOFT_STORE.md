# Microsoft Store AppX packaging

The Store package uses the existing MonaBase icon in `src/assets/icon.png`.
Store identity, publisher, application ID, languages and package version are read
from the existing `package.json` registration. Do not change them to fix artwork.
The current registration produces version `1.0.0.0` from app version `1.0.0`.

## Build on Windows

Use a Windows working copy of the project; do not reuse macOS `node_modules`.
From that project directory, run:

```powershell
npm ci
npm run build:store
```

The locked electron-builder 26.18.0 target is `appx`. The command validates the
source images, builds the renderer, generates the Windows x64 AppX, and validates
its manifest and packaged images. The artifact is normally
`release\MonaBase 1.0.0.appx`. This command does not submit anything to Partner Center.
Optional SSH native accelerators are excluded by the existing Windows file list;
only the Store command disables native rebuilding for cross-packaging compatibility.
NSIS/portable targets, their artifact names and Mac configuration are unaffected.

For a specific newly built package:

```powershell
npm run verify:appx -- ".\release\MonaBase 1.0.0.appx"
```

The verifier rejects changed Store registration, missing/wrong tile references,
missing `resources.pri`, unknown/default images and any packaged PNG whose size
or SHA-256 differs from the reviewed MonaBase assets. A local verification failure
is not a successful Store certification. Test installation and the actual Start
menu/taskbar icons on Windows before resubmitting.

## Artwork and reproducibility

The default build resource directory is `build/`. Store artwork is in
`build/appx/`, which electron-builder reads automatically for AppX targets.
Do not put README files or unrelated artwork inside that asset directory.

| Base image | Pixels at 100% | Use |
| --- | --- | --- |
| `StoreLogo.png` | 50 × 50 | Package/Store logo |
| `Square44x44Logo.png` | 44 × 44 | App list icon |
| `Square150x150Logo.png` | 150 × 150 | Medium tile |
| `Wide310x150Logo.png` | 310 × 150 | Wide tile |
| `SmallTile.png` | 71 × 71 | Small tile |
| `LargeTile.png` | 310 × 310 | Large tile |

All six images have 125%, 150%, 200% and 400% variants. The 44-pixel icon also
has target-size 16, 24, 32, 48 and 256 variants with normal and unplated forms.
There are 40 PNGs. The icon is centered without changing its aspect ratio on a
transparent canvas. Tile images reserve 10% padding on each side of the shorter
axis; target-size icons use the complete square. No generated text or replacement
logo is used.

`build/appx-assets.json` records dimensions and checksums plus the source icon's
checksum. After an intentional product icon change, regenerate all variants:

```powershell
npm run assets:appx
npm run verify:appx -- --assets
```

Generation uses the project's existing Electron dependency and an isolated
profile. Commit the PNGs and the checksum file together. No AI service is used.
Missing custom assets previously triggered electron-builder's `SampleAppx`
fallback. Preflight checks now stop the build rather than allowing that fallback.

## Inspect the actual archive with PowerShell

An AppX is a ZIP archive. Copy it to a temporary ZIP without modifying the file
that will be uploaded:

```powershell
$package = Resolve-Path ".\release\MonaBase 1.0.0.appx"
$inspection = Join-Path $env:TEMP ("MonaBase-AppX-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $inspection | Out-Null
Copy-Item $package (Join-Path $inspection "package.zip")
Expand-Archive (Join-Path $inspection "package.zip") (Join-Path $inspection "contents")
notepad (Join-Path $inspection "contents\AppxManifest.xml")
Start-Process (Join-Path $inspection "contents\assets")
```

Check these references in `AppxManifest.xml`:

- `Properties/Logo`: `assets\StoreLogo.png`.
- `uap:VisualElements`: `assets\Square44x44Logo.png` and `assets\Square150x150Logo.png`.
- `uap:DefaultTile`: `assets\Wide310x150Logo.png`, `assets\SmallTile.png` and `assets\LargeTile.png`.

Open the PNGs in the extracted `assets` directory. Every base and scale/target
variant must show the MonaBase M/paw mark. Check `resources.pri` is present; it
lets Windows select the correct qualified image. Run the verifier against the
original AppX to compare every packaged PNG with the source assets automatically.

The separate Partner Center declaration for generative AI is managed in Partner
Center and is not changed by this packaging work.

References: [electron-builder AppX assets](https://www.electron.build/appx/),
[Microsoft app icon construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction).
