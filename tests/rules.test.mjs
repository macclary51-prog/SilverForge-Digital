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

async function directMessage(db, clientId, id, senderId, role, overrides = {}, metadataOverrides = {}) {
  const ref = doc(db, 'clientConversations', clientId);
  const previous = await getDoc(ref); const old = previous.data(); const epoch = Timestamp.fromMillis(0);
  const profile = (await getDoc(doc(db, 'users', clientId))).data();
  const batch = writeBatch(db);
  batch.set(doc(ref, 'messages', id), { senderId, senderRole: role, senderName: role === 'admin' ? 'SilverForge' : profile.name,
    message: 'Direct website message', createdAt: now(), readByAdmin: role === 'admin', readByClient: role === 'customer', ...overrides });
  batch.set(ref, { clientId, clientName: profile.name, clientEmail: profile.email, createdAt: old?.createdAt || now(), updatedAt: now(), lastMessageAt: now(),
    lastMessagePreview: 'Direct website message', lastSenderRole: role, lastMessageId: id,
    lastCustomerMessageAt: role === 'customer' ? now() : (old?.lastCustomerMessageAt || epoch),
    lastAdminMessageAt: role === 'admin' ? now() : (old?.lastAdminMessageAt || epoch), adminReadAt: old?.adminReadAt || epoch, clientReadAt: old?.clientReadAt || epoch, ...metadataOverrides });
  return batch.commit();
}
test('direct conversations can be started by customer or admin with atomic metadata', async () => {
  await assertSucceeds(directMessage(alice, 'alice', 'client-first', 'alice', 'customer'));
  await assertSucceeds(directMessage(admin, 'alice', 'admin-reply', 'admin', 'admin'));
  await assertSucceeds(setDoc(doc(bob, 'users', 'bob'), { uid: 'bob', name: 'Bob', business: '', email: 'bob@example.com', role: 'customer', status: 'active', createdAt: now(), updatedAt: now() }));
  await assertSucceeds(directMessage(admin, 'bob', 'admin-first', 'admin', 'admin'));
  await assertSucceeds(directMessage(bob, 'bob', 'bob-reply', 'bob', 'customer'));
});
test('direct conversations and messages are private to UID owner and active admin', async () => {
  for (const db of [anonymous, bob, inactive]) {
    await assertFails(getDoc(doc(db, 'clientConversations', 'alice')));
    await assertFails(getDocs(collection(db, 'clientConversations', 'alice', 'messages')));
    await assertFails(getDoc(doc(db, 'clientConversations', 'alice', 'messages', 'client-first')));
  }
  await assertSucceeds(getDocs(collection(alice, 'clientConversations', 'alice', 'messages')));
  await assertSucceeds(getDocs(collection(admin, 'clientConversations')));
  await assertFails(getDocs(collection(alice, 'clientConversations')));
  await assertFails(getDocs(query(collection(alice, 'clientConversations'), where('clientId', '==', 'alice'))));
});
test('direct messages reject impersonation, extra fields, bad text and forged metadata', async () => {
  await assertFails(directMessage(alice, 'alice', 'spoof-admin', 'alice', 'admin'));
  await assertFails(directMessage(admin, 'alice', 'spoof-customer', 'admin', 'customer'));
  for (const changes of [{ senderId: 'bob' }, { senderName: 'Fake Customer' }, { message: ' ' }, { message: 'x'.repeat(5001) }, { extra: true }, { createdAt: Timestamp.fromMillis(0) }, { readByAdmin: true }]) {
    await assertFails(directMessage(alice, 'alice', 'invalid-direct', 'alice', 'customer', changes));
  }
  for (const changes of [{ clientId: 'bob' }, { clientEmail: 'forged@example.com' }, { lastMessagePreview: 'Fake' }, { adminReadAt: now() }, { createdAt: now() }]) {
    await assertFails(directMessage(alice, 'alice', 'bad-meta', 'alice', 'customer', {}, changes));
  }
  await assertFails(updateDoc(doc(alice, 'clientConversations', 'bob'), { lastMessagePreview: 'stolen' }));
  await assertFails(setDoc(doc(bob, 'clientConversations', 'alice', 'messages', 'intruder'), { senderId: 'bob', senderRole: 'customer', senderName: 'Bob', message: 'Hi', createdAt: now(), readByAdmin: false, readByClient: true }));
});
test('conversation metadata cannot be fabricated without a new matching message', async () => {
  await assertFails(updateDoc(doc(alice, 'clientConversations', 'alice'), { lastMessageAt: now(), updatedAt: now(), lastMessagePreview: 'Fake' }));
  await assertFails(setDoc(doc(alice, 'clientConversations', 'alice', 'messages', 'no-parent-update'), { senderId: 'alice', senderRole: 'customer', senderName: 'Alice Updated', message: 'Hello', createdAt: now(), readByAdmin: false, readByClient: true }));
});
test('read receipts allow only the recipient flag and monotonic read timestamps', async () => {
  const customerMessage = doc(admin, 'clientConversations', 'alice', 'messages', 'client-first');
  const adminMessage = doc(alice, 'clientConversations', 'alice', 'messages', 'admin-reply');
  await assertSucceeds(updateDoc(customerMessage, { readByAdmin: true }));
  await assertSucceeds(updateDoc(adminMessage, { readByClient: true }));
  await assertFails(updateDoc(doc(alice, customerMessage.path), { readByAdmin: true }));
  await assertFails(updateDoc(doc(admin, adminMessage.path), { readByClient: true }));
  await assertFails(updateDoc(customerMessage, { readByAdmin: false }));
  await assertFails(updateDoc(adminMessage, { readByClient: false }));
  const parent = (await getDoc(doc(admin, 'clientConversations', 'alice'))).data();
  await assertSucceeds(updateDoc(doc(admin, 'clientConversations', 'alice'), { adminReadAt: parent.lastCustomerMessageAt }));
  await assertSucceeds(updateDoc(doc(alice, 'clientConversations', 'alice'), { clientReadAt: parent.lastAdminMessageAt }));
  await assertFails(updateDoc(doc(alice, 'clientConversations', 'alice'), { adminReadAt: now() }));
  await assertFails(updateDoc(doc(admin, 'clientConversations', 'alice'), { adminReadAt: Timestamp.fromMillis(0) }));
  await assertFails(updateDoc(doc(alice, 'clientConversations', 'alice'), { clientReadAt: now() }));
});
test('direct history cannot be changed or deleted by either participant', async () => {
  for (const db of [alice, admin]) {
    await assertFails(updateDoc(doc(db, 'clientConversations', 'alice', 'messages', 'client-first'), { message: 'Edited', readByAdmin: true }));
    await assertFails(deleteDoc(doc(db, 'clientConversations', 'alice', 'messages', 'client-first')));
    await assertFails(deleteDoc(doc(db, 'clientConversations', 'alice')));
  }
});
test('private notes support admin CRUD but reject all customer and inactive-admin access', async () => {
  const note = { text: 'Private client note', createdAt: now(), updatedAt: now(), createdBy: 'admin', createdByEmail: 'admin@example.com' };
  await assertSucceeds(setDoc(doc(admin, 'users', 'alice', 'adminNotes', 'one'), note));
  await assertSucceeds(updateDoc(doc(admin, 'users', 'alice', 'adminNotes', 'one'), { text: 'Edited private note', updatedAt: now() }));
  await assertSucceeds(getDocs(collection(admin, 'users', 'alice', 'adminNotes')));
  for (const db of [alice, bob, inactive, anonymous]) {
    await assertFails(getDoc(doc(db, 'users', 'alice', 'adminNotes', 'one')));
    await assertFails(getDocs(collection(db, 'users', 'alice', 'adminNotes')));
    await assertFails(setDoc(doc(db, 'users', 'alice', 'adminNotes', 'injected'), note));
    await assertFails(updateDoc(doc(db, 'users', 'alice', 'adminNotes', 'one'), { text: 'Changed', updatedAt: now() }));
    await assertFails(deleteDoc(doc(db, 'users', 'alice', 'adminNotes', 'one')));
  }
  await assertFails(updateDoc(doc(admin, 'users', 'alice', 'adminNotes', 'one'), { createdBy: 'bob', updatedAt: now() }));
  await assertFails(setDoc(doc(admin, 'users', 'alice', 'adminNotes', 'bad'), { ...note, text: ' ' }));
  await assertSucceeds(deleteDoc(doc(admin, 'users', 'alice', 'adminNotes', 'one')));
});
async function linkWithSummary(db, id, uid) {
  const previous = (await getDoc(doc(admin, 'leads', id))).data(); const batch = writeBatch(db);
  batch.update(doc(db, 'leads', id), { customerId: uid, updatedAt: now() });
  if (uid) batch.set(doc(db, 'customerQuotes', id), quoteSummary({ ...previous, customerId: uid }));
  else batch.delete(doc(db, 'customerQuotes', id));
  return batch.commit();
}
test('admin explicitly links legacy projects without exposing private fields', async () => {
  const before = (await getDoc(doc(admin, 'leads', 'legacy'))).data();
  await assertFails(linkWithSummary(alice, 'legacy', 'alice'));
  await assertFails(linkWithSummary(inactive, 'legacy', 'alice'));
  await assertFails(linkWithSummary(admin, 'legacy', 'missing-account'));
  await assertFails(updateDoc(doc(admin, 'leads', 'legacy'), { customerId: 'alice', updatedAt: now() }));
  await assertSucceeds(linkWithSummary(admin, 'legacy', 'alice'));
  const summary = (await assertSucceeds(getDoc(doc(alice, 'customerQuotes', 'legacy')))).data();
  assert.deepEqual(Object.keys(summary).sort(), ['business','createdAt','customerId','quoteAmount','service','status']);
  const after = (await getDoc(doc(admin, 'leads', 'legacy'))).data();
  for (const key of ['internalNotes','lastEmailBody','message','email']) assert.equal(after[key], before[key]);
  await assertSucceeds(getDoc(doc(admin, 'leads', 'legacy', 'communications', 'email')));
});
test('relink and unlink revoke old customer access atomically and preserve leads', async () => {
  await assertSucceeds(linkWithSummary(admin, 'legacy', 'bob'));
  await assertFails(getDoc(doc(alice, 'customerQuotes', 'legacy')));
  await assertSucceeds(getDoc(doc(bob, 'customerQuotes', 'legacy')));
  await assertFails(updateDoc(doc(admin, 'leads', 'legacy'), { customerId: null, updatedAt: now() }));
  await assertFails(deleteDoc(doc(admin, 'customerQuotes', 'legacy')));
  await assertSucceeds(linkWithSummary(admin, 'legacy', null));
  assert.equal((await getDoc(doc(admin, 'customerQuotes', 'legacy'))).exists(), false);
  assert.ok((await getDoc(doc(admin, 'leads', 'legacy'))).exists());
  await assertFails(getDoc(doc(bob, 'leads', 'legacy')));
});
