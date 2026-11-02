// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => {
  const development = command === 'serve';
  const policy = [
    "default-src 'self'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' data: blob:${development ? ' ws://localhost:5173' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ');

  return {
    base: './',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [
      react(),
      {
        name: 'application-content-security-policy',
        transformIndexHtml() {
          return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
        }
      }
    ]
  };
});
