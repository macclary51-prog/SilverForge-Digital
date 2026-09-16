const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreatedWithAuthContext } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { processNotification } = require('./notifications');
const { createStore } = require('./store');
const { createPushSender } = require('./push');
const { isAdminOrigin } = require('./actor');
const { REGION, EXPECTED_PROJECT } = require('./config');
initializeApp();
const db = getFirestore(), store = createStore(db);
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const log = (name, details) => logger.warn(name, details);
const sendPush = createPushSender({ project, emulator, store, messaging: getMessaging(), log });
function trigger(document, kind) {
  return onDocumentCreatedWithAuthContext({ document, region: REGION, retry: true, timeoutSeconds: 120, maxInstances: 3 }, async event => {
    if (!event.data) return;
    if (!emulator && project !== EXPECTED_PROJECT) throw new Error('Notification functions must use the SilverForge Firebase project.');
    const data = event.data.data(); let parent = {};
    if (await isAdminOrigin(event, kind, data, async uid => { const role = await db.doc(`roles/${uid}`).get(); return role.data()?.role === 'admin' && role.data()?.active === true; })) return;
    if (kind === 'reply') parent = (await db.doc(`supportTickets/${event.params.ticketId}`).get()).data() || {};
    await processNotification({ eventId: event.id, kind, data, params: event.params, parent, store, sendPush, log });
  });
}
exports.adminNotifyQuote = trigger('leads/{leadId}', 'quote');
exports.adminNotifyContact = trigger('contactMessages/{contactId}', 'contact');
exports.adminNotifyAccount = trigger('users/{userUid}', 'account');
exports.adminNotifyRequest = trigger('supportTickets/{ticketId}', 'request');
exports.adminNotifyClientMessage = trigger('clientConversations/{clientUid}/messages/{messageId}', 'clientMessage');
exports.adminNotifyRequestReply = trigger('supportTickets/{ticketId}/messages/{messageId}', 'reply');
