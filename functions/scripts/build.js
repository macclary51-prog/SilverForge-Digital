const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

for (const directory of ['src', 'scripts']) {
  for (const file of readdirSync(join(__dirname, '..', directory)).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', join(__dirname, '..', directory, file)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('PASS Functions JavaScript build (no transpilation required).');
