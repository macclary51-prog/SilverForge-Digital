import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// Use inert, local-only secret overrides so the emulator never queries Secret Manager.
const secretFile = new URL('../functions/.secret.local', import.meta.url); let created = false;
try {
  try { await writeFile(secretFile, ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','ADMIN_PHONE_NUMBER'].map(key => `${key}=EMULATOR_SIMULATED_ONLY`).join('\n'), { flag: 'wx' }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const cli = fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));
  const child = spawn(process.execPath, [cli, 'emulators:exec', '--project', 'demo-silverforge', '--only', 'firestore,functions', 'node tests/notifications.integration.mjs'], { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { if (created) await unlink(secretFile); }
