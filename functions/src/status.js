const twilio = require("twilio");
const { callbackUrl, EXPECTED_PROJECT } = require("./sms");

function statusHandler({ project, emulator, getToken, store, log }) {
  return async (request, response) => {
    const notificationId = request.query.notificationId;
    if (request.method !== "POST" || typeof notificationId !== "string" || !/^[0-9a-f]{64}$/.test(notificationId)) { response.status(400).send("Invalid callback"); return; }
    if (emulator || project !== EXPECTED_PROJECT) { response.status(403).send("Forbidden"); return; }
    try {
      const signature = request.get("X-Twilio-Signature") || "";
      // Verify the configured URL, never a caller-controlled host header.
      if (!twilio.validateRequest(getToken(), signature, callbackUrl(project, notificationId), request.body)) { response.status(403).send("Forbidden"); return; }
      await store.deliveryStatus(notificationId, request.body.MessageSid || "", request.body.MessageStatus || "", request.body.ErrorCode);
      response.status(204).send();
    } catch {
      log("admin_sms_callback_failed", { notificationId }); response.status(503).send("Try again later");
    }
  };
}
module.exports = { statusHandler };
