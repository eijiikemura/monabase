// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { ThemeProvider, CssBaseline, CircularProgress, LinearProgress } = require('@mui/material');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const themes = loadTypeScript('src/app/themes.ts', { '@mui/material/styles': require('@mui/material/styles') });

// Match the production app's software-rendering policy; emulate the Windows motion preference.
app.disableHardwareAcceleration();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-progress-'));
app.setPath('userData', path.join(temporary, 'userdata'));
const timeout = setTimeout(() => { console.error('Progress animation test timed out.'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  let win, exitCode = 0;
  try {
    win = new BrowserWindow({ width: 600, height: 300, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.debugger.attach('1.3');
    for (const [name, theme] of Object.entries(themes)) {
      // Render the real MUI components and shared theme CSS, without mocking their styles or animations.
      const html = renderToString(React.createElement(ThemeProvider, { theme },
        React.createElement(CssBaseline),
        React.createElement(CircularProgress, { 'data-testid': 'spinner', 'aria-label': 'Loading' }),
        React.createElement(CircularProgress, { 'data-testid': 'determinate', variant: 'determinate', value: 25 }),
        React.createElement(LinearProgress, { 'data-testid': 'linear', sx: { width: 400 } }),
        React.createElement('div', { id: 'decoration', style: { animation: 'decoration 1s linear infinite' } }, 'Decoration')));
      const file = path.join(temporary, name + '.html');
      fs.writeFileSync(file, '<!doctype html><html><head><style>@keyframes decoration{to{opacity:0.5}}</style></head><body>' + html + '</body></html>');
      await win.loadFile(file);
      for (const mode of ['reduce', 'no-preference']) {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode }] });
        const result = await win.webContents.executeJavaScript(`(async () => {
          const spinner = document.querySelector('[data-testid="spinner"]');
          const circle = spinner.querySelector('circle');
          const linear = document.querySelector('.MuiLinearProgress-bar1Indeterminate');
          await new Promise(resolve => setTimeout(resolve, 80));
          const sample = () => ({ transform: getComputedStyle(spinner).transform,
            linear: [getComputedStyle(linear).left, getComputedStyle(linear).right], arc: getComputedStyle(circle).strokeDasharray });
          const before = sample();
          await new Promise(resolve => setTimeout(resolve, 320));
          const after = sample();
          return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, before, after,
            duration: parseFloat(getComputedStyle(spinner).animationDuration),
            circleAnimation: getComputedStyle(circle).animationName,
            linearDuration: parseFloat(getComputedStyle(linear).animationDuration),
            decorationDuration: parseFloat(getComputedStyle(document.getElementById('decoration')).animationDuration),
            determinateAnimation: getComputedStyle(document.querySelector('[data-testid="determinate"]')).animationName,
            determinateValue: document.querySelector('[data-testid="determinate"]').getAttribute('aria-valuenow') };
        })()`);
        assert.equal(result.reduced, mode === 'reduce');
        assert.ok(result.duration >= 1, `${name}/${mode}: spinner duration must remain visible, got ${result.duration}s`);
        assert.notEqual(result.before.transform, result.after.transform, `${name}/${mode}: spinner must rotate over actual elapsed time`);
        assert.ok(result.linearDuration >= 1); assert.notDeepEqual(result.before.linear, result.after.linear, `${name}/${mode}: indeterminate bar must move`);
        assert.equal(result.determinateAnimation, 'none'); assert.equal(result.determinateValue, '25');
        if (mode === 'reduce') {
          assert.equal(result.duration, 2); assert.equal(result.circleAnimation, 'none'); assert.equal(result.before.arc, result.after.arc);
          assert.ok(result.decorationDuration < 0.001, 'Decorative animation must still respect reduced motion.');
        } else {
          assert.equal(result.duration, 1.4); assert.notEqual(result.circleAnimation, 'none'); assert.equal(result.decorationDuration, 1);
        }
        console.log(`${name}/${mode}: circular and linear progress animate; determinate values and decorative motion policy preserved.`);
      }
    }
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(temporary, { recursive: true, force: true }); clearTimeout(timeout); app.exit(exitCode);
  }
});
