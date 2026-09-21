import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { defaultNotificationSettings } from '../notification-shared.js';
import { quoteSummary } from '../quote-summary.js';
import { verifySms } from './sms.integration.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp: AdminTimestamp } = require('firebase-admin/firestore');
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
  for (const deviceId of ['device-desktop-00000001','device-android-00000002']) await setDoc(doc(admin, 'users', 'notify-admin', 'notificationDevices', deviceId), {token: 'emulator-token-' + deviceId, platform: 'Android', enabled: true, createdAt: now(), updatedAt: now(), lastUsedAt: now()});
  await setDoc(doc(alice, 'users', 'notify-alice'), { uid: 'notify-alice', name: 'Notification Alice', email: 'notify-alice@example.com', business: 'Test Business', role: 'customer', status: 'active', createdAt: now(), updatedAt: now() });
  await setDoc(doc(publicDb, 'leads', 'notify-quote'), { name: 'Notification Visitor', business: 'Test Business', email: 'notify@example.com', phone: '7025550100', service: 'Website Development', message: 'Emulator quote', customerId: null, status: 'new', quoteAmount: null, followUpDate: '', internalNotes: '', createdAt: now(), updatedAt: now() });
  await setDoc(doc(publicDb, 'contactMessages', 'notify-contact'), contact('Emulator contact'));
  for (const type of ['bug-fix', 'redesign-change', 'feature-request', 'project-request', 'other']) await setDoc(doc(alice, 'supportTickets', 'notify-' + type), {
    ownerId: 'notify-alice', ownerEmail: 'notify-alice@example.com', ownerName: 'Notification Alice', type, projectName: 'Test Project', projectId: null,
    title: `Emulator ${type}`, details: 'Test request', status: 'open', priority: 'normal', createdAt: now(), updatedAt: now(), lastMessageAt: now()
  });
  await direct('notify-alice', 'customer', alice, 'customer-message');
  await reply(alice, 'notify-alice', 'customer', 'customer-reply');
  const records = await eventually(async () => { const items = await notices(); return items.length === 10 && items.every(item => item.pushStatus === 'simulated') && items; }, 'all six deployed emulator triggers and ten categories');
  assert.deepEqual(records.map(item => item.category).sort(), Object.keys(defaultNotificationSettings().categories).sort());
  assert.ok(records.every(item => item.createdAt && item.read === false && item.dashboardEnabled === true));
  assert.equal(records.find(item => item.type === 'client-reply').clientId, 'notify-alice');
  assert.ok(records.every(item => !('providerId' in item) && !('phone' in item) && !('authToken' in item)));
  assert.ok((await getDoc(doc(admin, 'leads', 'notify-quote'))).exists());
  assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-contact'))).exists());
  console.log('PASS Real Firestore emulator writes triggered all six Functions, created ten category alerts, and invoked simulated push without calling FCM.');
  for (const item of records) assert.equal((await serverDb.doc('_notificationDeliveries/' + item.id).get()).data().simulated, 2);

  await direct('notify-admin', 'admin', admin, 'admin-message'); await reply(admin, 'notify-admin', 'admin', 'admin-reply');
  const quote = (await getDoc(doc(admin, 'leads', 'notify-quote'))).data();
  const adminQuote = { ...quote, customerId: 'notify-admin', email: 'notify-admin@example.com', createdAt: now(), updatedAt: now() };
  const quoteBatch = writeBatch(admin);
  quoteBatch.set(doc(admin, 'leads', 'admin-quote'), adminQuote);
  quoteBatch.set(doc(admin, 'customerQuotes', 'admin-quote'), quoteSummary(adminQuote));
  await quoteBatch.commit();
  await updateDoc(doc(alice, 'users', 'notify-alice'), { business: 'Updated business', updatedAt: now() });
  await new Promise(resolve => setTimeout(resolve, 2000)); assert.equal((await notices()).length, 10);
  await assertFails(getDocs(collection(alice, 'adminNotifications')));
  // Firestore emulator 1.22.0 hardcodes fake-auth-id@gmail.com for auth-context events.
  // Exercise the exact exported production handlers with trusted auth context explicitly;
  // do not weaken the production guard or add actor fields to the existing contact schema.
  process.env.FUNCTIONS_EMULATOR = 'true'; process.env.GCLOUD_PROJECT = projectId;
  const handlers = require('../functions/src/index.js');
  await handlers.adminNotifyContact.run({ id:'admin-contact-context', authType:'api_key', authId:'notify-admin', params:{contactId:'notify-contact'}, data:await serverDb.doc('contactMessages/notify-contact').get() });
  await handlers.adminNotifyQuote.run({ id:'admin-quote-context', authType:'api_key', authId:'notify-admin', params:{leadId:'notify-quote'}, data:await serverDb.doc('leads/notify-quote').get() });
  assert.equal((await notices()).length,10);
  console.log('PASS Real admin quote/message writes and profile updates skip alerts. Exported quote/contact handlers also skip injected admin auth context; native emulator auth context is a placeholder.');

  const settings = { ...defaultNotificationSettings(), updatedAt: now(), updatedBy: 'notify-admin' }; settings.categories.contacts = false;
  await setDoc(doc(admin, 'adminSettings', 'notifications'), settings);
  await setDoc(doc(publicDb, 'contactMessages', 'notify-disabled'), contact('Disabled push category'));
  const disabled = await eventually(async () => (await notices()).find(item => item.subject === 'Disabled push category'), 'disabled category history');
  assert.equal(disabled.pushStatus, 'disabled'); assert.equal(disabled.dashboardEnabled, false);
  assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-disabled'))).exists());
  console.log('PASS Disabled categories still save original submissions and notification history, without push or unread badges.');

  await setDoc(doc(admin, 'adminSettings', 'notifications'), { ...defaultNotificationSettings(), updatedAt: now(), updatedBy: 'notify-admin' });
  let sends = 0;
  const input = { eventId: 'concurrent-store-fixture', kind: 'contact', data: { name: 'Store Fixture', subject: 'Duplicate delivery test' }, params: { contactId: 'notify-contact' }, store,
    sendPush: async () => { sends++; return { status: "accepted", accepted: 2, failed: 0 }; }, log: () => {} };
  const results = await Promise.all(Array.from({ length: 6 }, () => processNotification(input)));
  assert.equal(sends, 1); assert.equal(results.filter(item => item.duplicate).length, 5);
  const notificationId = results[0].notificationId;
  assert.equal((await serverDb.doc('adminNotifications/' + notificationId).get()).data().pushStatus, 'accepted');
  console.log('PASS Firestore transactions reserve concurrent duplicate events once.');

  const logs = []; const failure = await processNotification({ ...input, eventId: 'failure-store-fixture', sendPush: async () => { throw Object.assign(new Error('PRIVATE TOKEN DETAILS'), { code: 'messaging/server-unavailable' }); }, log: (...args) => logs.push(args) });
  assert.equal((await serverDb.doc('adminNotifications/' + failure.notificationId).get()).data().pushStatus, 'unknown');
  assert.ok(!JSON.stringify(logs).includes('PRIVATE')); assert.ok((await getDoc(doc(admin, 'contactMessages', 'notify-contact'))).exists());
  console.log('PASS Injected provider failure retains admin history and original contact data, recording only safe aggregate diagnostics.');
  const first = (await store.targets())[0];
  await store.disableInvalid(first);
  assert.equal((await first.ref.get()).data().enabled, false);
  assert.equal((await store.targets()).length, 1);
  await first.ref.update({ token: 'refreshed-token-never-disable-with-old-result', enabled: true });
  await store.disableInvalid(first);
  assert.equal((await first.ref.get()).data().enabled, true);
  await serverDb.doc('roles/inactive-admin').set({role:'admin',active:false});
  await serverDb.doc('users/inactive-admin/notificationDevices/ignored-device').set({token:'never-send-inactive-admin',enabled:true});
  const second = (await store.targets()).find(item=>item.deviceId !== first.deviceId);
  await serverDb.doc('users/notify-admin/notificationDevices/duplicate-token-device').set({token:second.token,enabled:true,updatedAt:AdminTimestamp.fromMillis(0)});
  assert.equal((await store.targets()).length, 2);
  console.log('PASS Multiple enabled devices are targeted; inactive admins, duplicate and invalid tokens are excluded; rotated tokens survive stale failures.');
  await verifySms({ serverDb, alice, admin, publicDb, eventually });
} finally { await env.cleanup(); await serverDb.terminate(); await deleteApp(serverApp); const {getApps}=require('firebase-admin/app');for(const app of getApps()){await getFirestore(app).terminate();await deleteApp(app);} }
