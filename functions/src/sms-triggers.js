const { onDocumentCreatedWithAuthContext } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { isAdminOrigin } = require('./actor');
const { REGION, EXPECTED_PROJECT } = require('./config');
const { processSms } = require('./sms');
const { createSmsStore } = require('./sms-store');
const { createSmsSender } = require('./sms-sender');

const accountSid = defineSecret('TWILIO_ACCOUNT_SID');
const authToken = defineSecret('TWILIO_AUTH_TOKEN');
const fromNumber = defineSecret('TWILIO_FROM_NUMBER');
const adminNumber = defineSecret('ADMIN_SMS_NUMBER');
const secrets = [accountSid, authToken, fromNumber, adminNumber];

function createSmsHandler({ db, kind, project, emulator, store, sendSms, log }) {
  return async event => {
    if (!event.data) return;
    const context = { eventType: kind, documentId: event.data.id, eventId: event.id };
    try {
      if (!emulator && project !== EXPECTED_PROJECT) {
        log('admin_sms_wrong_project', context);
        return;
      }
      const data = event.data.data();
      const isAdmin = async uid => {
        const role = (await db.doc(`roles/${uid}`).get()).data();
        return role?.role === 'admin' && role?.active === true;
      };
      if (await isAdminOrigin(event, kind, data, isAdmin)) return;
      const parent = kind === 'reply' ? (await db.doc(`supportTickets/${event.params.ticketId}`).get()).data() || {} : {};
      return await processSms({ event, kind, data, parent, store, sendSms, log });
    } catch {
      // Raw SDK errors may include private payloads or request credentials.
      log('admin_sms_processing_failed', { ...context, stage: 'prepare-or-reserve' });
    }
  };
}

function createSmsTriggers({ db, project, emulator, log }) {
  const store = createSmsStore(db);
  const sendSms = createSmsSender({ project, emulator, readSecrets: () => ({ accountSid: accountSid.value(), authToken: authToken.value(), from: fromNumber.value(), to: adminNumber.value() }) });
  const trigger = (document, kind) => onDocumentCreatedWithAuthContext({
    document, region: REGION, secrets: emulator ? [] : secrets,
    retry: false, timeoutSeconds: 60, maxInstances: 3
  }, createSmsHandler({ db, kind, project, emulator, store, sendSms, log }));
  return {
    notifyNewQuote: trigger('leads/{leadId}', 'quote'),
    notifyNewContact: trigger('contactMessages/{messageId}', 'contact'),
    notifyNewSupportTicket: trigger('supportTickets/{ticketId}', 'request'),
    notifyNewClientMessage: trigger('clientConversations/{clientUid}/messages/{messageId}', 'clientMessage'),
    notifyNewSupportReply: trigger('supportTickets/{ticketId}/messages/{messageId}', 'reply')
  };
}
module.exports = { createSmsHandler, createSmsTriggers };
