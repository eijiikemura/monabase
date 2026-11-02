// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import en from './en.json' with { type: 'json' };
import ja from './ja.json' with { type: 'json' };
export type Locale = 'en' | 'ja';
export type Translate = (key: string) => string;
const catalogs: Record<Locale, Record<string, string>> = { en, ja };
export function translator(locale: Locale): Translate {
  return key => {
    const value = catalogs[locale][key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${locale} website translation: ${key}`);
    return value;
  };
}
