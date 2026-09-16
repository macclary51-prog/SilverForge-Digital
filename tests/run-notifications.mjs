import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'emulators:exec', '--project', 'demo-silverforge', '--only', 'firestore,functions', 'node tests/notifications.integration.mjs'], { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) });
process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
