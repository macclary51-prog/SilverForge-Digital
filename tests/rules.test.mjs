import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { quoteSummary } from '../quote-summary.js';

let env, alice, bob, admin, inactive, anonymous;
const now = () => serverTimestamp();
const lead = (customerId = null, email = 'public@example.com') => ({ name: 'Test Client', business: 'Test Business', email, phone: '7025550100', service: 'Website Development', message: 'New website project', customerId, status: 'new', quoteAmount: null, followUpDate: '', internalNotes: '', createdAt: now(), updatedAt: now() });
const ticket = (ownerId = 'alice') => ({ ownerId, ownerEmail: `${ownerId}@example.com`, ownerName: 'Test Client', type: 'bug-fix', projectName: 'Client Website', title: 'Broken button', details: 'The save button does not respond.', status: 'open', priority: 'normal', createdAt: now(), updatedAt: now(), lastMessageAt: now() });
const contact = () => ({ name: 'Visitor', email: 'visitor@example.com', category: 'General Question', subject: 'Question', message: 'Hello SilverForge', status: 'new', createdAt: now(), updatedAt: now() });
async function createQuote(db, id, data) {
  const batch = writeBatch(db); batch.set(doc(db, 'leads', id), data);
  if (data.customerId) batch.set(doc(db, 'customerQuotes', id), quoteSummary(data));
  return batch.commit();
}
async function reply(db, id, senderId, senderRole, changes = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'supportTickets', 'alice-ticket', 'messages', id), { senderId, senderRole, senderName: senderRole === 'admin' ? 'SilverForge' : 'Alice', message: 'Test reply', createdAt: now(), ...changes });
  batch.update(doc(db, 'supportTickets', 'alice-ticket'), { updatedAt: now(), lastMessageAt: now() });
  return batch.commit();
}
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-silverforge', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  alice = env.authenticatedContext('alice', { email: 'alice@example.com' }).firestore();
  bob = env.authenticatedContext('bob', { email: 'bob@example.com' }).firestore();
  admin = env.authenticatedContext('admin', { email: 'admin@example.com' }).firestore();
  inactive = env.authenticatedContext('inactive', { email: 'inactive@example.com' }).firestore();
  anonymous = env.unauthenticatedContext().firestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'roles', 'admin'), { role: 'admin', active: true });
    await setDoc(doc(db, 'roles', 'inactive'), { role: 'admin', active: false });
    const legacy = lead(); delete legacy.customerId;
    await setDoc(doc(db, 'leads', 'legacy'), { ...legacy, internalNotes: 'Private CRM notes' });
  });
});
after(async () => { await env?.cleanup(); });

test('anonymous quotes remain valid; public cannot read leads or summaries', async () => {
  await assertSucceeds(createQuote(anonymous, 'public', lead()));
  await assertFails(getDoc(doc(anonymous, 'leads', 'public')));
  await assertFails(getDocs(collection(anonymous, 'leads')));
  await assertFails(getDocs(collection(anonymous, 'customerQuotes')));
});
test('signed-in quote creates an exact safe summary atomically', async () => {
  await assertSucceeds(createQuote(alice, 'alice-quote', lead('alice', 'alice@example.com')));
  const summary = await assertSucceeds(getDoc(doc(alice, 'customerQuotes', 'alice-quote')));
  assert.deepEqual(Object.keys(summary.data()).sort(), ['business','createdAt','customerId','quoteAmount','service','status']);
  await assertFails(setDoc(doc(alice, 'leads', 'missing-summary'), lead('alice', 'alice@example.com')));
});
test('cannot spoof quote UID, authenticated email or anonymous ownership', async () => {
  await assertFails(createQuote(alice, 'spoof-owner', lead('bob', 'alice@example.com')));
  await assertFails(createQuote(alice, 'spoof-email', lead('alice', 'bob@example.com')));
  await assertFails(createQuote(anonymous, 'spoof-public', lead('alice', 'alice@example.com')));
  await assertFails(createQuote(alice, 'null-owner', lead(null, 'alice@example.com')));
});
test('rejects quote injection, invalid service, preset amounts and forged times', async () => {
  for (const change of [{ service: 'Invalid' }, { quoteAmount: 25 }, { internalNotes: 'Injected' }, { lastEmailBody: 'Injected' }, { createdAt: Timestamp.fromMillis(0) }]) {
    await assertFails(createQuote(anonymous, 'invalid', { ...lead(), ...change }));
  }
});
test('customer queries must be scoped; CRM internals and other customers stay private', async () => {
  await assertSucceeds(getDocs(query(collection(alice, 'customerQuotes'), where('customerId', '==', 'alice'))));
  await assertFails(getDocs(collection(alice, 'customerQuotes')));
  await assertFails(getDoc(doc(bob, 'customerQuotes', 'alice-quote')));
  await assertFails(getDoc(doc(alice, 'leads', 'alice-quote')));
  await assertFails(getDoc(doc(alice, 'leads', 'legacy')));
});
test('customers cannot edit summaries or inject private fields', async () => {
  await assertFails(updateDoc(doc(alice, 'customerQuotes', 'alice-quote'), { status: 'accepted' }));
  await assertFails(deleteDoc(doc(alice, 'customerQuotes', 'alice-quote')));
  await assertFails(setDoc(doc(alice, 'customerQuotes', 'fake'), quoteSummary(lead('alice', 'alice@example.com'))));
  const data = lead('alice', 'alice@example.com'); const batch = writeBatch(alice);
  batch.set(doc(alice, 'leads', 'injected-summary'), data);
  batch.set(doc(alice, 'customerQuotes', 'injected-summary'), { ...quoteSummary(data), internalNotes: 'leak' });
  await assertFails(batch.commit());
});
test('admin can update old leads and preserve email drafts and history', async () => {
  await assertSucceeds(getDocs(collection(admin, 'leads')));
  await assertSucceeds(updateDoc(doc(admin, 'leads', 'legacy'), { status: 'contacted', quoteAmount: 100, internalNotes: 'Private note updated', updatedAt: now() }));
  await assertSucceeds(updateDoc(doc(admin, 'leads', 'legacy'), { lastEmailTemplate: 'custom', lastEmailSubject: 'Hello', lastEmailBody: 'Draft', lastEmailMarkedSentAt: now(), updatedAt: now() }));
  await assertSucceeds(setDoc(doc(admin, 'leads', 'legacy', 'communications', 'email'), { type: 'email', template: 'custom', subject: 'Hello', body: 'Hello customer', recipient: 'public@example.com', markedSentAt: now(), createdBy: 'admin' }));
  await assertFails(getDocs(collection(alice, 'leads', 'legacy', 'communications')));
});
test('admin quote edits publish the matching safe summary in one batch', async () => {
  const data = (await getDoc(doc(admin, 'leads', 'alice-quote'))).data();
  const changes = { status: 'quote-sent', quoteAmount: 1250, internalNotes: 'Customer must not read this', updatedAt: now() };
  await assertFails(updateDoc(doc(admin, 'leads', 'alice-quote'), changes));
  const batch = writeBatch(admin); batch.update(doc(admin, 'leads', 'alice-quote'), changes);
  batch.set(doc(admin, 'customerQuotes', 'alice-quote'), quoteSummary({ ...data, ...changes }));
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(alice, 'customerQuotes', 'alice-quote'))).data().quoteAmount, 1250);
  await assertFails(updateDoc(doc(admin, 'leads', 'alice-quote'), { customerId: 'bob', updatedAt: now() }));
});
test('only active roles grant admin access and users cannot grant roles', async () => {
  await assertFails(getDocs(collection(inactive, 'leads')));
  await assertFails(getDocs(collection(alice, 'users')));
  await assertFails(setDoc(doc(alice, 'roles', 'alice'), { role: 'admin', active: true }));
  await assertSucceeds(getDocs(collection(admin, 'users')));
});
test('customers create own profiles and update safe fields only', async () => {
  const profile = { uid: 'alice', name: 'Alice', business: '', email: 'alice@example.com', role: 'customer', status: 'active', createdAt: now(), updatedAt: now() };
  await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), profile));
  await assertSucceeds(updateDoc(doc(alice, 'users', 'alice'), { name: 'Alice Updated', business: 'My Company', updatedAt: now() }));
  await assertFails(updateDoc(doc(alice, 'users', 'alice'), { role: 'admin', updatedAt: now() }));
  await assertFails(updateDoc(doc(alice, 'users', 'alice'), { email: 'bob@example.com', updatedAt: now() }));
  await assertFails(getDoc(doc(bob, 'users', 'alice')));
});
test('public contact is separate, validated and unreadable to customers', async () => {
  await assertSucceeds(setDoc(doc(anonymous, 'contactMessages', 'general'), contact()));
  await assertFails(getDoc(doc(anonymous, 'contactMessages', 'general')));
  await assertFails(getDocs(collection(alice, 'contactMessages')));
  for (const change of [{ category: 'Quote' }, { subject: ' ' }, { email: 'invalid' }, { status: 'closed' }, { extra: true }]) {
    await assertFails(setDoc(doc(anonymous, 'contactMessages', 'invalid'), { ...contact(), ...change }));
  }
  await assertSucceeds(updateDoc(doc(admin, 'contactMessages', 'general'), { status: 'closed', updatedAt: now() }));
  await assertFails(updateDoc(doc(admin, 'contactMessages', 'general'), { message: 'Changed', updatedAt: now() }));
});
test('customer creates own Bug Fix ticket; forged fields/defaults denied', async () => {
  await assertSucceeds(setDoc(doc(alice, 'supportTickets', 'alice-ticket'), ticket()));
  await assertSucceeds(setDoc(doc(bob, 'supportTickets', 'bob-ticket'), ticket('bob')));
  for (const change of [{ ownerId: 'bob' }, { ownerEmail: 'bob@example.com' }, { priority: 'urgent' }, { status: 'working' }, { type: 'invalid' }, { details: ' ' }, { createdAt: Timestamp.fromMillis(0) }]) {
    await assertFails(setDoc(doc(alice, 'supportTickets', 'invalid'), { ...ticket(), ...change }));
  }
  await assertFails(setDoc(doc(anonymous, 'supportTickets', 'anonymous'), ticket()));
});
test('tickets are isolated, with owner-filtered customer lists and full admin lists', async () => {
  await assertSucceeds(getDocs(query(collection(alice, 'supportTickets'), where('ownerId', '==', 'alice'))));
  await assertFails(getDocs(collection(alice, 'supportTickets')));
  await assertFails(getDoc(doc(bob, 'supportTickets', 'alice-ticket')));
  await assertSucceeds(getDocs(collection(admin, 'supportTickets')));
  await assertFails(getDocs(collection(inactive, 'supportTickets')));
});
test('customers cannot change owners, status, priority, details or delete tickets', async () => {
  for (const change of [{ ownerId: 'bob' }, { status: 'closed' }, { priority: 'high' }, { details: 'Replace' }]) {
    await assertFails(updateDoc(doc(alice, 'supportTickets', 'alice-ticket'), { ...change, updatedAt: now() }));
  }
  await assertFails(deleteDoc(doc(alice, 'supportTickets', 'alice-ticket')));
  await assertSucceeds(updateDoc(doc(admin, 'supportTickets', 'alice-ticket'), { status: 'working', priority: 'high', updatedAt: now() }));
  await assertFails(updateDoc(doc(admin, 'supportTickets', 'alice-ticket'), { ownerId: 'bob', updatedAt: now() }));
});
test('customer/admin messages succeed and update parent activity in atomic batches', async () => {
  await assertSucceeds(reply(alice, 'customer-one', 'alice', 'customer'));
  await assertSucceeds(reply(admin, 'admin-one', 'admin', 'admin'));
  await assertSucceeds(reply(alice, 'customer-two', 'alice', 'customer'));
  assert.equal((await getDocs(collection(alice, 'supportTickets', 'alice-ticket', 'messages'))).size, 3);
  assert.equal((await getDocs(collection(admin, 'supportTickets', 'alice-ticket', 'messages'))).size, 3);
});
test('messages reject role impersonation, other owners, whitespace and non-batched sends', async () => {
  await assertFails(reply(alice, 'fake-admin', 'alice', 'admin'));
  await assertFails(reply(admin, 'fake-customer', 'admin', 'customer'));
  await assertFails(reply(alice, 'fake-sender', 'bob', 'customer'));
  await assertFails(reply(bob, 'wrong-owner', 'bob', 'customer'));
  await assertFails(reply(alice, 'blank', 'alice', 'customer', { message: ' \n ' }));
  await assertFails(setDoc(doc(alice, 'supportTickets', 'alice-ticket', 'messages', 'no-batch'), { senderId: 'alice', senderRole: 'customer', senderName: 'Alice', message: 'Hello', createdAt: now() }));
  await assertFails(getDocs(collection(bob, 'supportTickets', 'alice-ticket', 'messages')));
});
test('messages are immutable to customers and admins; closed conversations can continue', async () => {
  for (const db of [alice, admin]) {
    await assertFails(updateDoc(doc(db, 'supportTickets', 'alice-ticket', 'messages', 'customer-one'), { message: 'Edited' }));
    await assertFails(deleteDoc(doc(db, 'supportTickets', 'alice-ticket', 'messages', 'customer-one')));
  }
  await assertSucceeds(updateDoc(doc(admin, 'supportTickets', 'alice-ticket'), { status: 'closed', updatedAt: now() }));
  await assertSucceeds(reply(alice, 'follow-up', 'alice', 'customer'));
  assert.equal((await getDoc(doc(alice, 'supportTickets', 'alice-ticket'))).data().status, 'closed');
});
test('admin quote deletion removes its safe summary atomically', async () => {
  await assertFails(deleteDoc(doc(admin, 'leads', 'alice-quote')));
  const batch = writeBatch(admin); batch.delete(doc(admin, 'leads', 'alice-quote')); batch.delete(doc(admin, 'customerQuotes', 'alice-quote'));
  await assertSucceeds(batch.commit());
});
test('catch-all denies unknown collections even to admin', async () => {
  await assertFails(setDoc(doc(admin, 'unexpected', 'doc'), { public: true }));
});
