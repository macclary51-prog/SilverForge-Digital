import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const files = fs.readdirSync(root);
for (const name of files.filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(name, root))], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const source = fs.readFileSync(new URL(name, root), 'utf8');
  for (const [, version] of source.matchAll(/gstatic\.com\/firebasejs\/([^/]+)\//g)) assert.equal(version, '12.16.0', `${name}: Firebase version drift`);
}
let links = 0;
for (const name of files.filter(file => file.endsWith('.html'))) {
  const html = fs.readFileSync(new URL(name, root), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${name}: duplicate element ID`);
  for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target)) continue;
    const file = target.split(/[?#]/)[0];
    if (!file || !/\.(html|css|js|png|svg|ico)$/.test(file)) continue;
    assert.ok(fs.existsSync(new URL(file, root)), `${name}: broken local link ${target}`); links++;
  }
  for (const [, attrs, label] of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/g)) {
    if (/Request a Quote|Start a Project/.test(label)) assert.ok(/href="quote\.html"/.test(attrs), `${name}: quote CTA must use quote.html`);
  }
}
assert.ok(!fs.readFileSync(new URL('script.js', root), 'utf8').includes('contactForm'), 'Shared navigation script must not submit the old quote form');
console.log(`PASS JavaScript syntax, Firebase 12.16.0 consistency, HTML IDs and ${links} local links.`);
