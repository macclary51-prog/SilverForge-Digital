const twilio = require('twilio');
const { EXPECTED_PROJECT } = require('./config');

function createSmsSender({ project, emulator, readSecrets, clientFactory = twilio }) {
  return async body => {
    // Emulator tests must never read real secrets or call the paid transport.
    if (emulator) return { status: 'simulated' };
    if (project !== EXPECTED_PROJECT) throw new Error('Unexpected SMS project.');
    const { accountSid, authToken, from, to } = readSecrets();
    if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid) || !authToken || !/^\+[1-9]\d{7,14}$/.test(from) || !/^\+[1-9]\d{7,14}$/.test(to)) {
      throw new Error('Invalid SMS secret configuration.');
    }
    // Explicitly disable both SDK retries and provider request debugging.
    const client = clientFactory(accountSid, authToken, { autoRetry: false, maxRetries: 0, timeout: 15000, logLevel: 'silent' });
    const result = await client.messages.create({ from, to, body });
    return { status: 'accepted', twilioMessageSid: result.sid };
  };
}
module.exports = { createSmsSender };
