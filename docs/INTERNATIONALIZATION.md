# Internationalization

Write source comments in English and use descriptive English translation keys.
English is the initial and fallback language. Saved settings take priority, and
new installations still select Japanese on Japanese systems and English elsewhere.

```tsx
const { t } = useTranslation();
<Button>{t('save')}</Button>
```

Define the same key in both catalogs:

```jsonc
// src/locales/en.json
{ "save": "Save" }
```

```jsonc
// src/locales/ja.json
{ "save": "保存" }
```

Use static keys and interpolation for variable values. Avoid template literals as
translation keys: extraction cannot discover every runtime value.

```tsx
t('target_user', { user: userName })
```

Run `npm run i18n:extract` after adding translation calls. It scans both `src`
and `electron`, updates both catalogs, and preserves existing translations.
Fill in new entries in both catalogs. English count-based messages use `_one`
and `_other`; Japanese messages use `_other`.

Some AI request types and trace instructions are translated through variables.
Their entries are retained by `keepRemoved: true`; extraction reports warnings
for these dynamic calls. Add catalog entries explicitly for new dynamic keys.

Electron modules use `electron/i18n.js` with the configured language. React uses
the renderer's i18next instance. Neither translation path requires a database
connection.

Main-process modules import `t` from `electron/i18n.js`. The settings store updates
its shared language after loading or saving settings, so already loaded modules
follow language changes without restarting. Do not read settings files or cache
a separate language in individual database or trace modules. `translate` remains
available when an explicit language is required, including isolated tests.

Run `npm test`, `npm run lint`, and `npm run typecheck` to check
the migration. Use `npm run dev` to verify English and Japanese in the app.

## Website translations

The separate Astro/Starlight site uses `website/src/content/site.ts` and
`website/src/i18n/en.json` / `ja.json`. Run `npm --prefix website run i18n:extract`
to extract literal `t('english_key')` calls using the TypeScript parser. It preserves
existing translations and adds empty entries for new keys; authors must fill both
languages. Website check/build rejects missing, empty or unused translations.
This does not change the desktop extractor or translate text automatically.
The website generator derives both manual routes and Starlight UI labels from
these catalogs. See [the website README](../website/README.md).
