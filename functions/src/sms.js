const twilio = require("twilio");
const REGION = "us-central1";
const EXPECTED_PROJECT = "silverforge-digital";
function callbackUrl(project, notificationId) {
  return `https://${REGION}-${project}.cloudfunctions.net/adminSmsStatus?notificationId=${notificationId}`;
}
function createSmsSender({ getSecrets, project, emulator, clientFactory = twilio }) {
  return async ({ body, notificationId }) => {
    // The emulator is always simulated; test configuration can never send SMS.
    if (emulator) return { simulated: true };
    if (project !== EXPECTED_PROJECT) throw Object.assign(new Error("Wrong project"), { configuration: true });
    const values = getSecrets();
    if (!/^AC[0-9a-fA-F]{32}$/.test(values.accountSid || "") || !/^[0-9a-fA-F]{32}$/.test(values.authToken || "")
      || !/^\+[1-9]\d{7,14}$/.test(values.from || "") || !/^\+[1-9]\d{7,14}$/.test(values.to || "")) {
      throw Object.assign(new Error("SMS secrets are incomplete"), { configuration: true });
    }
    const client = clientFactory(values.accountSid, values.authToken, { autoRetry: false, maxRetries: 0, timeout: 10000 });
    return client.messages.create({ from: values.from, to: values.to, body, statusCallback: callbackUrl(project, notificationId) });
  };
}
module.exports = { createSmsSender, callbackUrl, REGION, EXPECTED_PROJECT };
