// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

module.exports = {
    // Languages to extract: English and Japanese.
    locales: ['en', 'ja'],
    
    // Output directory and filename pattern.
    // Write src/locales/ja.json and src/locales/en.json.
    output: 'src/locales/$LOCALE.json',
    
    // Extract translation calls from application and Electron source files.
    input: ['src/**/*.{ts,tsx}', 'electron/**/*.js'],
    
    // Treat English keys as literal strings without separators.
    keySeparator: false,
    namespaceSeparator: false,

    // Keep extraction repeatable without writing obsolete catalog backups.
    createOldCatalogs: false,
    
    // Add new entries while preserving existing translations.
    keepRemoved: true,
    
    // Sort entries to keep dictionaries readable.
    sort: true
  };
