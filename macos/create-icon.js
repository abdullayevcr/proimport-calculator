'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  console.error('macOS icon generation requires macOS (sips and iconutil).');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'ui', 'logo-proimport.png');
const build = path.join(__dirname, 'build');
const iconset = path.join(build, 'ProImport.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });

for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    const suffix = scale === 2 ? '@2x' : '';
    const output = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
    execFileSync('sips', ['-z', String(pixels), String(pixels), source, '--out', output], { stdio: 'inherit' });
  }
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')], { stdio: 'inherit' });
fs.rmSync(iconset, { recursive: true, force: true });
console.log('Generated macOS icon: macos/build/icon.icns');
