import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { quoteSummary } from '../quote-summary.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { createSmsStore } = require('../functions/src/sms-store.js');
const { createSmsHandler } = require('../functions/src/sms-triggers.js');

export async function verifySms({ serverDb, alice, admin, publicDb, eventually }) {
  const deliveries = async () => (await serverDb.collection('_smsDeliveries').get()).docs.map(item => ({ id: item.id, ...item.data() }));
  const signedQuote = { name: 'Signed-in Customer', business: 'Test Business', email: 'notify-alice@example.com', phone: '7025550100', service: 'Website Development', message: 'PRIVATE QUOTE DETAILS', customerId: 'notify-alice', status: 'new', quoteAmount: null, followUpDate: '', internalNotes: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const batch = writeBatch(alice);
  batch.set(doc(alice, 'leads', 'sms-signed-quote'), signedQuote);
  batch.set(doc(alice, 'customerQuotes', 'sms-signed-quote'), quoteSummary(signedQuote));
  await batch.commit();
  const expected = ['leads/notify-quote', 'leads/sms-signed-quote', 'contactMessages/notify-contact', 'contactMessages/notify-disabled',
    ...['bug-fix', 'redesign-change', 'feature-request', 'project-request', 'other'].map(type => `supportTickets/notify-${type}`),
    'clientConversations/notify-alice/messages/customer-message', 'supportTickets/notify-bug-fix/messages/customer-reply'];
  const records = await eventually(async () => {
    const rows = await deliveries(); return rows.length === expected.length && rows.every(item => item.status === 'simulated') && rows;
  }, 'all five SMS triggers, signed-in/anonymous quotes and disabled push category');
  assert.deepEqual(records.map(item => item.documentPath).sort(), expected.sort());
  assert.equal(records.some(item => /admin-message|admin-reply|admin-quote/.test(item.documentPath)), false);
  assert.ok(records.every(item => !('body' in item) && !('from' in item) && !('to' in item) && !('authToken' in item)));
  console.log('PASS Five actual SMS create triggers: anonymous/signed-in quotes, contact, all support types, customer direct/reply each record one simulated send; admin direct/reply/quote and parent updates record zero. Push preferences do not suppress SMS.');

  for (const db of [publicDb, alice, admin]) {
    const ref = doc(db, '_smsDeliveries', records[0].id);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { status: 'accepted' }));
  }
  console.log('PASS Existing default-deny rules prevent all browser roles reading or forging SMS reservations.');

  // Exercise production handler + actual Firestore transactions using an inert
  // fixture collection, so a native trigger cannot race the injected transport.
  const fixture = serverDb.doc('_smsFixtures/duplicate');
  await fixture.set({ name: 'Integration Customer', category: 'General Question', subject: 'Twilio test', message: 'PRIVATE BODY' });
  const snapshot = await fixture.get(); let attempts = 0; const logs = [];
  const dependencies = { db: serverDb, kind: 'contact', project: 'demo-silverforge', emulator: true, store: createSmsStore(serverDb),
    sendSms: async () => { attempts++; return { status: 'accepted', twilioMessageSid: 'SM_TEST_ONLY' }; }, log: (...args) => logs.push(args) };
  const handler = createSmsHandler(dependencies);
  const event = { id: 'sms-parallel', authType: 'api_key', authId: 'notify-alice', params: { messageId: snapshot.id }, data: snapshot };
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => handler({ ...event, id: `sms-parallel-${i}` })));
  assert.equal(attempts, 1); assert.equal(results.filter(result => result.duplicate).length, 7);
  assert.equal((await createSmsHandler({ ...dependencies, store: createSmsStore(serverDb) })(event)).duplicate, true);
  assert.equal(attempts, 1);
  console.log('PASS Eight concurrent deliveries and a fresh handler/store instance issue one transport request, including different event IDs for the same document creation.');

  for (const status of [400, 500, undefined]) {
    const ref = serverDb.doc(`_smsFixtures/failure-${status || 'timeout'}`);
    await ref.set({ name: 'Integration Customer', category: 'General Question', subject: 'Failure fixture', message: 'PRIVATE ORIGINAL' });
    let failures = 0;
    const failing = createSmsHandler({ ...dependencies, sendSms: async () => { failures++; throw Object.assign(new Error('PRIVATE CREDENTIALS'), { code: 21608, status }); } });
    const input = { ...event, id: `failure-${status}`, data: await ref.get() };
    const result = await failing(input); await failing(input);
    assert.equal(result.status, status === 400 ? 'failed' : 'unknown'); assert.equal(failures, 1);
    assert.equal((await ref.get()).data().message, 'PRIVATE ORIGINAL');
    assert.equal((await serverDb.doc('_smsDeliveries/' + result.deliveryId).get()).data().twilioCode, 21608);
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
  assert.equal((await getDoc(doc(admin, 'contactMessages', 'notify-contact'))).exists(), true);
  assert.equal((await getDoc(doc(alice, 'customerQuotes', 'sms-signed-quote'))).exists(), true);
  console.log('PASS Injected Twilio rejection, 5xx and timeout leave original writes intact, retain redacted diagnostics, and never retry. No real Twilio network requests made.');

  const handlers = require('../functions/src/index.js');
  const before = (await deliveries()).length;
  await handlers.notifyNewContact.run({ ...event, id: 'sms-admin-context', authId: 'notify-admin', data: await serverDb.doc('contactMessages/notify-contact').get() });
  await handlers.notifyNewQuote.run({ ...event, id: 'sms-admin-quote-context', authId: 'notify-admin', data: await serverDb.doc('leads/notify-quote').get() });
  assert.equal((await deliveries()).length, before);
  console.log('PASS Exported SMS handlers suppress trusted admin auth context (the Firestore emulator itself provides placeholder auth IDs).');
}
