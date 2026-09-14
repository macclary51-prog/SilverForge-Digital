import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { defaultNotificationSettings } from '../notification-shared.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createStore } = require('../functions/src/store.js');
const { processNotification } = require('../functions/src/notifications.js');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Integration tests require the local emulator');
const projectId = 'demo-silverforge';
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const serverApp = initializeApp({ projectId }, 'notification-integration');
const serverDb = getFirestore(serverApp); const store = createStore(serverDb);
const alice = env.authenticatedContext('notify-alice', { email: 'notify-alice@example.com' }).firestore();
const admin = env.authenticatedContext('notify-admin', { email: 'notify-admin@example.com' }).firestore();
const publicDb = env.unauthenticatedContext().firestore();
const now = serverTimestamp;
const contact = subject => ({ name: 'Notification Test Visitor', email: 'notify@example.com', category: 'General Question', subject, message: 'Emulator only', status: 'new', createdAt: now(), updatedAt: now() });
async function eventually(check, label) {
  const deadline = Date.now() + 60000; let result;
  do { result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 300)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function notices() { return (await getDocs(collection(admin, 'adminNotifications'))).docs.map(item => ({ id: item.id, ...item.data() })); }
async function direct(senderId, role, db, messageId) {
  const ref = doc(db, 'clientConversations', 'notify-alice'); const old = (await getDoc(ref)).data(); const epoch = Timestamp.fromMillis(0);
  const batch = writeBatch(db); const message = `Emulator ${role} message`;
  batch.set(doc(ref, 'messages', messageId), { senderId, senderRole: role, senderName: role === 'admin' ? 'SilverForge' : 'Notification Alice', message, createdAt: now(), readByAdmin: role === 'admin', readByClient: role === 'customer' });
  batch.set(ref, { clientId: 'notify-alice', clientName: 'Notification Alice', clientEmail: 'notify-alice@example.com', createdAt: old?.createdAt || now(), updatedAt: now(), lastMessageAt: now(), lastMessagePreview: message, lastSenderRole: role, lastMessageId: messageId,
    lastCustomerMessageAt: role === 'customer' ? now() : old.lastCustomerMessageAt,
    lastAdminMessageAt: role === 'admin' ? now() : (old?.lastAdminMessageAt || epoch), adminReadAt: old?.adminReadAt || epoch, clientReadAt: old?.clientReadAt || epoch });
  await batch.commit();
}
async function reply(db, senderId, role, id) {
  const batch = writeBatch(db); const parent = doc(db, 'supportTickets', 'notify-bug-fix');
  batch.set(doc(parent, 'messages', id), { senderId, senderRole: role, senderName: role === 'admin' ? 'SilverForge' : 'Notification Alice', message: 'Emulator request reply', createdAt: now() });
  batch.update(parent, { updatedAt: now(), lastMessageAt: now() }); await batch.commit();
}
try {
  await env.clearFirestore();
  await serverDb.doc('roles/notify-admin').set({ role: 'admin', active: true });
  await setDoc(doc(alice, 'users', 'notify-alice'), { uid: 'notify-alice', name: 'Notification Alice', email: 'notify-alice@example.com', business: 'Test Business', role: 'customer', status: 'active', createdAt: now(), updatedAt: now() });
  await setDoc(doc(publicDb, 'leads', 'notify-quote'), { name: 'Notification Visitor', business: 'Test Business', email: 'notify@example.com', phone: '7025550100', service: 'Website Development', message: 'Emulator quote', customerId: null, status: 'new', quoteAmount: null, followUpDate: '', internalNotes: '', createdAt: now(), updatedAt: now() });
  await setDoc(doc(publicDb, 'contactMessages', 'notify-contact'), contact('Emulator contact'));
  for (const type of ['bug-fix', 'redesign-change', 'feature-request', 'project-request', 'other']) await setDoc(doc(alice, 'supportTickets', 'notify-' + type), {
    ownerId: 'notify-alice', ownerEmail: 'notify-alice@example.com', ownerName: 'Notification Alice', type, projectName: 'Test Project', projectId: null,
    title: `Emulator ${type}`, details: 'Test request', status: 'open', priority: 'normal', createdAt: now(), updatedAt: now(), lastMessageAt: now()
  });
  await direct('notify-alice', 'customer', alice, 'customer-message');
  await reply(alice, 'notify-alice', 'customer', 'customer-reply');
  const records = await eventually(async () => { const items = await notices(); return items.length === 10 && items.every(item => item.smsStatus === 'simulated') && items; }, 'all six deployed emulator triggers and ten categories');
  assert.deepEqual(records.map(item => item.category).sort(), Object.keys(defaultNotificationSettings().categories).sort());
  assert.ok(records.every(item => item.createdAt && item.read === false && item.dashboardEnabled === true));
  assert.equal(records.find(item => item.type === 'client-reply').clientId, 'notify-alice');
  assert.ok(records.every(item => !('providerId' in item) && !('phone' in item) && !('authToken' in item)));
  assert.ok((await getDoc(doc(admin, 'leads', 'notify-quote'))).exists());
  assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-contact'))).exists());
  console.log('PASS Real Firestore emulator writes triggered all six Functions, created ten category alerts, and invoked simulated SMS without reading secrets.');

  await direct('notify-admin', 'admin', admin, 'admin-message'); await reply(admin, 'notify-admin', 'admin', 'admin-reply');
  await updateDoc(doc(alice, 'users', 'notify-alice'), { business: 'Updated business', updatedAt: now() });
  await new Promise(resolve => setTimeout(resolve, 2000)); assert.equal((await notices()).length, 10);
  await assertFails(getDocs(collection(alice, 'adminNotifications')));
  console.log('PASS Admin-created messages and profile updates did not create alerts; clients cannot read history.');

  const settings = { ...defaultNotificationSettings(), updatedAt: now(), updatedBy: 'notify-admin' }; settings.categories.contacts = false;
  await setDoc(doc(admin, 'adminSettings', 'notifications'), settings);
  await setDoc(doc(publicDb, 'contactMessages', 'notify-disabled'), contact('Disabled SMS category'));
  const disabled = await eventually(async () => (await notices()).find(item => item.subject === 'Disabled SMS category'), 'disabled category history');
  assert.equal(disabled.smsStatus, 'disabled'); assert.equal(disabled.dashboardEnabled, false);
  assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-disabled'))).exists());
  console.log('PASS Disabled categories still save original submissions and notification history, without SMS or unread badges.');

  await setDoc(doc(admin, 'adminSettings', 'notifications'), { ...defaultNotificationSettings(), updatedAt: now(), updatedBy: 'notify-admin' });
  let sends = 0; const sid = 'SM' + '1'.repeat(32);
  const input = { eventId: 'concurrent-store-fixture', kind: 'contact', data: { name: 'Store Fixture', subject: 'Duplicate delivery test' }, params: { contactId: 'notify-contact' }, store,
    sendSms: async () => { sends++; return { sid }; }, log: () => {} };
  const results = await Promise.all(Array.from({ length: 6 }, () => processNotification(input)));
  assert.equal(sends, 1); assert.equal(results.filter(item => item.duplicate).length, 5);
  const notificationId = results[0].notificationId;
  assert.equal(await store.deliveryStatus(notificationId, 'SM' + '2'.repeat(32), 'delivered'), false);
  await store.deliveryStatus(notificationId, sid, 'sent'); await store.deliveryStatus(notificationId, sid, 'queued');
  assert.equal((await serverDb.doc('adminNotifications/' + notificationId).get()).data().smsStatus, 'sent');
  await store.deliveryStatus(notificationId, sid, 'delivered'); await store.deliveryStatus(notificationId, sid, 'failed', '21610');
  await store.finish(notificationId, { status: 'unknown', providerId: null, code: null });
  assert.equal((await serverDb.doc('adminNotifications/' + notificationId).get()).data().smsStatus, 'delivered');
  console.log('PASS Firestore transactions reserve duplicate events once; mismatched SIDs, late callbacks and late API results cannot downgrade delivery status.');

  const logs = []; const failure = await processNotification({ ...input, eventId: 'failure-store-fixture', sendSms: async () => { throw Object.assign(new Error('PRIVATE PROVIDER DETAILS'), { status: 400, code: 21610 }); }, log: (...args) => logs.push(args) });
  assert.equal((await serverDb.doc('adminNotifications/' + failure.notificationId).get()).data().smsStatus, 'failed');
  assert.ok(!JSON.stringify(logs).includes('PRIVATE')); assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-contact'))).exists());
  console.log('PASS Injected provider failure retains admin history and original contact data, recording only safe status/error-code diagnostics.');
} finally { await env.cleanup(); await serverDb.terminate(); await deleteApp(serverApp); }
