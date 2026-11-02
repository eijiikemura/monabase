// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { SITE } from './src/config.ts';
import { siteContent } from './src/content/site.ts';
import { translator } from './src/i18n/index.ts';


const ANALYTICS_SCRIPT = "(function () {\n  'use strict';\n  const MEASUREMENT_ID = 'G-2MV9LLEF3H';\n  const KEY = 'monabase.analytics.consent.v1';\n  const jp = /(?:^|\\/)ja(?:\\/|$)/.test(location.pathname);\n  const messages = jp ? {\n    title: 'アクセス解析について',\n    body: 'サイト改善のためGoogle Analyticsを利用します。「同意する」を選択した場合のみ、閲覧情報がGoogleへ送信されます。拒否してもマニュアルを利用できます。',\n    accept: '同意する', reject: '拒否する', settings: 'アクセス解析の設定',\n    policy: 'プライバシーポリシー'\n  } : {\n    title: 'Website analytics',\n    body: 'We use Google Analytics to improve this website. Data is sent to Google only if you choose Accept. You can use the documentation without accepting.',\n    accept: 'Accept', reject: 'Decline', settings: 'Analytics settings',\n    policy: 'Privacy policy'\n  };\n  const policyUrl = (jp ? '/monabase/ja/' : '/monabase/') + 'guides/privacy-policy/';\n  let loaded = false;\n  function stored() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }\n  function save(value) { try { localStorage.setItem(KEY, value); } catch (_) {} }\n  function initializeAnalytics() {\n    if (loaded) return;\n    loaded = true;\n    window.dataLayer = window.dataLayer || [];\n    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };\n    window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });\n    window.gtag('consent', 'update', { analytics_storage: 'granted' });\n    window.gtag('js', new Date());\n    window.gtag('config', MEASUREMENT_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });\n    const script = document.createElement('script');\n    script.async = true;\n    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);\n    document.head.appendChild(script);\n  }\n  if (stored() === 'accepted') initializeAnalytics();\n  function makeButton(text, cls, click) {\n    const b = document.createElement('button'); b.type = 'button'; b.className = cls;\n    b.textContent = text; b.addEventListener('click', click); return b;\n  }\n  function showBanner() {\n    if (document.getElementById('monabase-analytics-consent')) return;\n    const panel = document.createElement('section');\n    panel.id = 'monabase-analytics-consent'; panel.setAttribute('role', 'dialog');\n    panel.setAttribute('aria-label', messages.title);\n    const heading = document.createElement('strong'); heading.textContent = messages.title;\n    const p = document.createElement('p'); p.textContent = messages.body;\n    const link = document.createElement('a'); link.href = policyUrl; link.textContent = messages.policy;\n    const controls = document.createElement('div'); controls.className = 'monabase-analytics-actions';\n    controls.appendChild(makeButton(messages.reject, 'analytics-reject', function () {\n      save('declined'); panel.remove(); if (loaded) location.reload();\n    }));\n    controls.appendChild(makeButton(messages.accept, 'analytics-accept', function () {\n      save('accepted'); panel.remove(); initializeAnalytics();\n    }));\n    panel.append(heading, p, link, controls); document.body.appendChild(panel);\n  }\n  function init() {\n    const area = document.querySelector('.landing-footer') || document.querySelector('footer') || document.body;\n    if (!document.getElementById('monabase-analytics-settings')) {\n      const b = makeButton(messages.settings, 'monabase-analytics-settings', showBanner);\n      b.id = 'monabase-analytics-settings'; area.appendChild(b);\n    }\n    if (!stored()) showBanner();\n  }\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });\n  else init();\n})();";
const ANALYTICS_CSS = "#monabase-analytics-consent{position:fixed;z-index:99999;bottom:16px;left:16px;right:16px;max-width:520px;padding:18px 20px;background:var(--sl-color-bg,#fff);color:var(--sl-color-text,#1d1d1d);border:1px solid var(--sl-color-hairline,#bbb);box-shadow:0 8px 36px #0003;border-radius:12px;font-size:14px;line-height:1.5}#monabase-analytics-consent strong{font-size:16px}#monabase-analytics-consent p{margin:8px 0}#monabase-analytics-consent a{display:inline-block;margin-bottom:12px;text-decoration:underline}.monabase-analytics-actions{display:flex;gap:10px;justify-content:flex-end}.monabase-analytics-actions button{cursor:pointer;border-radius:6px;padding:7px 14px;border:1px solid var(--sl-color-gray-4,#888);background:transparent;color:inherit}.monabase-analytics-actions .analytics-accept{background:var(--sl-color-accent,#356ed1);border-color:var(--sl-color-accent,#356ed1);color:white}.monabase-analytics-settings{background:none;border:none;color:inherit;text-decoration:underline;opacity:.8;cursor:pointer;font:inherit;font-size:.8rem;margin:8px}";

const en = siteContent(translator('en'));
const ja = siteContent(translator('ja'));
export default defineConfig({
  site: SITE.origin,
  base: SITE.base,
  trailingSlash: 'always',
  integrations: [starlight({
    title: SITE.title,
    favicon: "/favicon.png",
    description: en.ui.manual_description,
    logo: { src: '../src/assets/icon.png', replacesTitle: false, alt: 'MonaBase' },
    defaultLocale: 'root',
    locales: { root: { label: 'English', lang: 'en' }, ja: { label: '日本語', lang: 'ja' } },
    social: [
      { icon: 'github', label: 'GitHub', href: SITE.repository },
      { icon: 'x.com', label: 'X', href: 'https://x.com/eijiikemura' },
    ],
    sidebar: [
      { slug: '', label: 'Overview', translations: { ja: '概要' } },
      ...en.groups.map(group => ({
        label: group.label,
        translations: { ja: ja.groups.find(item => item.slug === group.slug).label },
        // Place contact and privacy policy immediately after settings in the starting group.
        ...(group.slug === 'start' ? { collapsed: false } : {}),
        items: [
          ...en.pages.filter(page => page.group === group.slug && !['styles', 'settings', 'contact', 'privacy-policy'].includes(page.slug)),
          ...(group.slug === 'start' ? ['styles', 'settings', 'contact', 'privacy-policy'].map(slug => en.pages.find(page => page.slug === slug)) : []),
        ].map(page => ({
          slug: `guides/${page.slug}`,
          label: page.title,
          translations: { ja: ja.pages.find(item => item.slug === page.slug).title },
        })),
      })),
    ],
    // Consent-first GA4: no Google tag is downloaded until the visitor accepts.
    head: [
      { tag: 'style', content: ANALYTICS_CSS },
      { tag: 'script', content: ANALYTICS_SCRIPT },
    ],
    customCss: ['./src/styles/custom.css'],
    components: { PageTitle: './src/components/PageTitle.astro' },
    credits: false,
    editLink: { baseUrl: `${SITE.repository}/edit/main/website/` },
    lastUpdated: false,
  })],
});
