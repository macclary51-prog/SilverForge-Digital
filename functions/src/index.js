const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { statusHandler } = require("./status");
const { processNotification } = require("./notifications");
const { createStore } = require("./store");
const { createSmsSender, REGION, EXPECTED_PROJECT } = require("./sms");

initializeApp();
const db = getFirestore(); const store = createStore(db);
const accountSid = defineSecret("TWILIO_ACCOUNT_SID");
const authToken = defineSecret("TWILIO_AUTH_TOKEN");
const fromPhone = defineSecret("TWILIO_PHONE_NUMBER");
const adminPhone = defineSecret("ADMIN_PHONE_NUMBER");
const secrets = [accountSid, authToken, fromPhone, adminPhone];
const emulator = process.env.FUNCTIONS_EMULATOR === "true";
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const sendSms = createSmsSender({ project, emulator, getSecrets: () => ({ accountSid: accountSid.value(), authToken: authToken.value(), from: fromPhone.value(), to: adminPhone.value() }) });

function trigger(document, kind) {
  return onDocumentCreated({ document, region: REGION, secrets, retry: true, timeoutSeconds: 60, maxInstances: 3 }, async event => {
    if (!event.data) return;
    if (!emulator && project !== EXPECTED_PROJECT) throw new Error("Notification functions must use the SilverForge Firebase project.");
    const data = event.data.data(); let parent = {};
    // Exclude admin messages before creating dashboard history or invoking Twilio.
    if (["clientMessage", "reply"].includes(kind) && data.senderRole !== "customer") return;
    const actor = data.senderId || data.ownerId || data.customerId || (kind === "account" ? event.params.userUid : null);
    if (actor) { const role = await db.doc(`roles/${actor}`).get(); if (role.data()?.role === "admin" && role.data()?.active === true) return; }
    if (kind === "reply") { const ticket = await db.doc(`supportTickets/${event.params.ticketId}`).get(); parent = ticket.data() || {}; }
    await processNotification({ eventId: event.id, kind, data, params: event.params, parent, store, sendSms, log: (name, details) => logger.warn(name, details) });
  });
}
exports.adminNotifyQuote = trigger("leads/{leadId}", "quote");
exports.adminNotifyContact = trigger("contactMessages/{contactId}", "contact");
exports.adminNotifyAccount = trigger("users/{userUid}", "account");
exports.adminNotifyRequest = trigger("supportTickets/{ticketId}", "request");
exports.adminNotifyClientMessage = trigger("clientConversations/{clientUid}/messages/{messageId}", "clientMessage");
exports.adminNotifyRequestReply = trigger("supportTickets/{ticketId}/messages/{messageId}", "reply");

exports.adminSmsStatus = onRequest({ region: REGION, secrets: [authToken], timeoutSeconds: 30, maxInstances: 3 },
  statusHandler({ project, emulator, getToken: () => authToken.value(), store, log: (name, details) => logger.error(name, details) }));
