// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export const SITE = {
  origin: 'https://eijiikemura.github.io',
  base: '/monabase',
  repository: 'https://github.com/eijiikemura/monabase',
  title: 'MonaBase',
};
export function sitePath(locale: 'en' | 'ja', path = '') {
  return `${SITE.base}/${locale === 'ja' ? 'ja/' : ''}${path.replace(/^\/+|\/+$/g, '')}${path ? '/' : ''}`;
}
