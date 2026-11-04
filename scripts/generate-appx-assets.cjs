// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Render the existing product icon without adding fonts, text, or alternate branding.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { cwd: root, env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-appx-icons-'));
app.setPath('userData', temporary);
app.disableHardwareAcceleration();
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
let window;
app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(root, 'src/assets/icon.png'));
  const specifications = [];
  for (const [name, width, height] of [
    ['StoreLogo', 50, 50], ['Square44x44Logo', 44, 44], ['Square150x150Logo', 150, 150],
    ['Wide310x150Logo', 310, 150], ['SmallTile', 71, 71], ['LargeTile', 310, 310]
  ]) for (const scale of [100, 125, 150, 200, 400]) {
    specifications.push({ name: `${name}${scale === 100 ? '' : `.scale-${scale}`}.png`,
      width: Math.round(width * scale / 100), height: Math.round(height * scale / 100), padding: 0.1 });
  }
  for (const size of [16, 24, 32, 48, 256]) for (const suffix of ['', '_altform-unplated']) {
    specifications.push({ name: `Square44x44Logo.targetsize-${size}${suffix}.png`, width: size, height: size, padding: 0 });
  }
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  const rendered = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify('data:image/png;base64,' + source.toString('base64'))};
    await image.decode();
    return ${JSON.stringify(specifications)}.map(specification => {
      const canvas = document.createElement('canvas'); canvas.width = specification.width; canvas.height = specification.height;
      const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      const size = Math.round(Math.min(canvas.width, canvas.height) * (1 - 2 * specification.padding));
      context.drawImage(image, Math.floor((canvas.width-size)/2), Math.floor((canvas.height-size)/2), size, size);
      return { ...specification, png: canvas.toDataURL('image/png').split(',')[1] };
    });
  })()`);
  const directory = path.join(root, 'build/appx'); fs.mkdirSync(directory, { recursive: true });
  const assets = rendered.map(({ name, width, height, png }) => {
    const buffer = Buffer.from(png, 'base64'); fs.writeFileSync(path.join(directory, name), buffer);
    return { name, width, height, sha256: sha256(buffer) };
  });
  fs.writeFileSync(path.join(root, 'build/appx-assets.json'), JSON.stringify({ source: 'src/assets/icon.png', sourceSha256: sha256(source), assets }, null, 2) + '\n');
  console.log(`Generated ${assets.length} MonaBase AppX assets from src/assets/icon.png.`);
}).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  window?.destroy(); fs.rmSync(temporary, { recursive: true, force: true }); app.quit();
});
