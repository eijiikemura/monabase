// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { build } = require('../../package.json');
// This profile is selected only by scripts/mac-release.cjs; normal CI and Windows builds keep package.json settings.
module.exports = {
  ...build,
  forceCodeSigning: true,
  npmRebuild: false,
  mac: {
    ...build.mac,
    identity: null, // The driver supplies an explicitly validated Developer ID identity.
    type: 'distribution',
    // SSH supports the same JavaScript fallback used by the Windows package.
    files: [...build.files, '!node_modules/cpu-features/**/*', '!node_modules/ssh2/lib/protocol/crypto/build/**/*'],
    target: [{ target: 'dmg', arch: ['arm64'] }],
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    hardenedRuntime: true,
    entitlements: 'build/mac/entitlements.plist',
    entitlementsInherit: 'build/mac/entitlements.inherit.plist',
    preAutoEntitlements: false,
    strictVerify: true,
    notarize: false // Uploads require the separate explicit notarization command.
  },
  dmg: { ...(build.dmg || {}), sign: false } // The driver signs the final DMG with an explicit secure timestamp.
};
