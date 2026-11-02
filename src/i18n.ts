// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation dictionaries maintained by the extraction tool.
// Keep both dictionaries checked into source control.
import jaJSON from './locales/ja.json';
import enJSON from './locales/en.json';

i18n
  .use(initReactI18next) // Integrate i18next with React.
  .init({
    resources: {
      ja: { translation: jaJSON },
      en: { translation: enJSON }
    },
    lng: 'en', // Initial language; App.tsx later applies the user's or system's language.
    fallbackLng: 'en', // Fallback language for missing translations.
    
    // Treat translation keys as literal strings.
    keySeparator: false, // Do not treat periods as key separators.
    nsSeparator: false,  // Do not treat colons as namespace separators.
    
    interpolation: {
      escapeValue: false // React already escapes rendered values.
    }
  });

export default i18n;