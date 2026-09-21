const { createHash } = require('node:crypto');

const TICKET_TYPES = { 'bug-fix': 'Bug Fix', 'redesign-change': 'Redesign / Change', 'feature-request': 'Feature Request', 'project-request': 'Project Request', other: 'Support' };

// Use a conservative GSM alphabet and fixed field budgets: one segment, at most
// 160 characters. Never copy raw documents, internal notes or full message bodies.
function text(value, maximum, fallback = '') {
  const clean = typeof value === 'string' ? value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/[^a-zA-Z0-9 .,!?@&()+%\-/:;'"\n]/g, ' ')
    .replace(/\s+/g, ' ').trim() : '';
  const result = clean || fallback;
  return result.length > maximum ? result.slice(0, maximum - 3).trimEnd() + '...' : result;
}

function smsBody(kind, data, parent = {}) {
  if (!data || (['clientMessage', 'reply'].includes(kind) && data.senderRole !== 'customer')) return null;
  const name = text(data.ownerName || data.senderName || data.name, 24, 'a customer');
  if (kind === 'quote') return `SilverForge: New quote request from ${name} / ${text(data.business, 24, 'Business')}.
Service: ${text(data.service, 30, 'Requested service')}.
Check the CRM.`;
  if (kind === 'contact') return `SilverForge: New contact message from ${name}.
Type: ${text(data.category, 20, 'General Question')}.
Subject: ${text(data.subject, 28, 'Website message')}.
Check the CRM.`;
  if (kind === 'request') return `SilverForge: New support request from ${name}.
${TICKET_TYPES[data.type] || 'Support'} - ${text(data.projectName, 32, 'Client project')}.
Check Support Inbox.`;
  if (kind === 'clientMessage') {
    // A preview is optional. Do not forward text that looks like credentials;
    // detection is best-effort, so all other bodies/details stay out of SMS.
    const sensitive = /password|passcode|secret|token|api[ _-]?key|bearer|-----BEGIN|https?:\/\/|\b[A-Za-z0-9_-]{32,}\b/i.test(data.message || '');
    const preview = sensitive ? 'Message preview omitted.' : text(data.message, 42, 'New website message.');
    return `SilverForge: New client message from ${name}.
"${preview}"
Open the Client Workspace.`;
  }
  if (kind === 'reply') return `SilverForge: New support reply from ${name}.
Request: ${text(parent.title, 42, 'Support request')}.
Open Support Inbox.`;
  return null;
}

function deliveryId(kind, snapshot) {
  const created = snapshot?.createTime;
  if (!snapshot?.ref?.path || !Number.isInteger(created?.seconds) || !Number.isInteger(created?.nanoseconds)) {
    throw new Error('A persisted document creation identity is required.');
  }
  // Unlike just event.id, this also deduplicates two event IDs describing the
  // same creation. A delete/recreate with a new createTime is a new submission.
  return createHash('sha256').update(JSON.stringify([kind, snapshot.ref.path, created.seconds, created.nanoseconds])).digest('hex');
}

function safeError(error) {
  const code = Number.isInteger(error?.code) && error.code >= 0 && error.code <= 999999 ? error.code : null;
  const httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
  return { twilioCode: code, httpStatus };
}

async function processSms({ event, kind, data, parent, store, sendSms, log }) {
  const body = smsBody(kind, data, parent);
  if (!body) return { skipped: true };
  const id = deliveryId(kind, event.data);
  const context = { eventType: kind, documentId: event.data.id, documentPath: event.data.ref.path, eventId: event.id, deliveryId: id };
  if (!event.id) throw new Error('A stable event ID is required.');
  if (!await store.claim(id, context)) return { duplicate: true, deliveryId: id };
  let outcome;
  try {
    outcome = await sendSms(body);
  } catch (error) {
    const diagnostic = safeError(error);
    outcome = { status: diagnostic.httpStatus && diagnostic.httpStatus < 500 ? 'failed' : 'unknown', ...diagnostic };
    log('admin_sms_send_failed', { ...context, ...outcome });
  }
  // Retain the reservation even if the network or this final write fails. Never
  // reclaim an ambiguous attempt: Twilio may already have accepted the message.
  try { await store.finish(id, outcome); }
  catch { log('admin_sms_result_write_failed', { ...context, status: outcome.status }); }
  log('admin_sms_attempt_finished', { ...context, status: outcome.status });
  return { deliveryId: id, ...outcome };
}

module.exports = { smsBody, deliveryId, processSms, safeError };
