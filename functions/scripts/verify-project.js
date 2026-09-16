const { EXPECTED_PROJECT } = require('../src/config');
if (process.env.GCLOUD_PROJECT !== EXPECTED_PROJECT) {
  console.error('Deployment blocked: these notification functions belong only to silverforge-digital.');
  process.exitCode = 1;
} else console.log('PASS Functions deployment project: silverforge-digital');
