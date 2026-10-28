const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'arcsider');
// Explicit allowlist: no tests, temporary profiles or user data in the package.
const files = ['manifest.json', 'background.js', 'content.js', 'sidepanel.html',
  'sidepanel.js', 'sidepanel.css', 'theme.css', 'lib.js', 'LICENSE'];
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, 'assets', 'icons'), path.join(output, 'assets', 'icons'), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap(script => script.js)]) {
  if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing runtime file: ${file}`);
}
console.log(`Built Arcsider ${manifest.version}: ${output}`);
