const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preferences, CATEGORIES, notificationFor, processNotification } = require("../src/notifications");
const { createPushSender } = require('../src/push');
const { EXPECTED_PROJECT } = require('../src/config');
const { isAdminOrigin } = require('../src/actor');

test("all requested events map to their category and real existing admin routes", () => {
  const cases = [["quote", {}, "quotes"], ["contact", {}, "contacts"], ["account", { role: "customer" }, "accounts"],
    ["clientMessage", { senderRole: "customer" }, "clientMessages"], ["reply", { senderRole: "customer" }, "replies"],
    ...Object.entries({ "bug-fix": "bugFix", "redesign-change": "redesign", "feature-request": "feature", "project-request": "projectRequests", other: "otherRequests" }).map(([type, category]) => ["request", { type }, category])];
  for (const [kind, data, category] of cases) {
    const item = notificationFor(kind, data, { leadId: "lead", contactId: "contact", userUid: "alice", clientUid: "alice", ticketId: "ticket" }, { ownerId: "alice", projectId: "project" });
    assert.equal(item.category, category); assert.match(item.link, /^crm(?:-support)?\.html\?/);
    assert.ok(item.target); assert.ok(item.recordId);
  }
  assert.equal(notificationFor("reply", { senderRole: "admin" }, {}), null);
  assert.equal(notificationFor("clientMessage", { senderRole: "admin" }, {}), null);
  assert.equal(notificationFor("account", { role: "admin" }, {}), null);
});
test("push summaries sanitize control characters and bound user input", () => {
  const item = notificationFor('contact', {name:'Name\nInjected',subject:'X'.repeat(5000)}, {contactId:'one'});
  assert.ok(item.message.length <= 400); assert.ok(!item.message.includes('\n')); assert.ok(!item.message.includes('undefined'));
});
test("missing settings default on; malformed values fail closed", () => {
  assert.ok(CATEGORIES.every(key => preferences(null).categories[key]));
  assert.equal(preferences({ channels: { push: "true" }, categories: { quotes: 1 } }).channels.push, false);
  assert.equal(preferences({}).categories.quotes, false); assert.equal(preferences(null).channels.email, false);
});
function harness(prefs = preferences(null)) {
  const history = new Map(); let calls = 0; const logs = [];
  const store = { async claim(id, data) { if (history.has(id)) return null; history.set(id, { ...data }); return { pushEnabled: prefs.channels.push && prefs.categories[data.category] }; },
    async finish(id, outcome) { Object.assign(history.get(id), outcome); } };
  const input = { eventId: "stable-event", kind: "contact", data: { name: "Visitor", subject: "Hello" }, params: { contactId: "one" }, store,
    sendPush: async () => { calls++; return { status: "simulated", accepted: 0, failed: 0 }; }, log: (...args) => logs.push(args) };
  return { input, history, logs, calls: () => calls };
}
test("concurrent duplicate events create one history record and invoke push once", async () => {
  const h = harness(); const results = await Promise.all(Array.from({ length: 8 }, () => processNotification(h.input)));
  assert.equal(h.history.size, 1); assert.equal(h.calls(), 1); assert.equal(results.filter(item => item.duplicate).length, 7);
  await processNotification({ ...h.input, eventId: "different" }); assert.equal(h.calls(), 2);
});
test("disabled channel/category retain history but never invoke provider; admin messages do neither", async () => {
  for (const prefs of [{ channels: { push: false }, categories: { contacts: true } }, { channels: { push: true }, categories: { contacts: false } }]) {
    const h = harness(prefs); assert.equal((await processNotification(h.input)).skipped, "preferences"); assert.equal(h.history.size, 1); assert.equal(h.calls(), 0);
  }
  const h = harness(); await processNotification({ ...h.input, kind: "clientMessage", data: { senderRole: "admin" } }); assert.equal(h.calls(), 0); assert.equal(h.history.size, 0);
});

test('sender failures retain history, sanitize logs and are never automatically resent', async () => {
  const h = harness(); let calls = 0;
  h.input.sendPush = async () => { calls++; assert.equal(h.history.size, 1); throw new Error('PRIVATE token and payload'); };
  assert.equal((await processNotification(h.input)).pushStatus, 'unknown');
  await processNotification(h.input); assert.equal(calls, 1);
  assert.equal(h.history.size, 1); assert.ok(!JSON.stringify(h.logs).includes('PRIVATE'));
});
const sample = { notification: notificationFor('contact', {name:'Visitor',subject:'Hello'}, {contactId:'contact-id'}), notificationId:'a'.repeat(64) };
const target = i => ({uid:'admin',deviceId:`device-${i}`,token:`PRIVATE-${i}`});
test('FCM adapter sends separate data payloads to all devices in batches of 500', async () => {
  const batches=[];
  const send=createPushSender({project:EXPECTED_PROJECT, store:{targets:async()=>Array.from({length:501},(_,i)=>target(i))}, messaging:{sendEach:async messages=>{
    batches.push(messages); return {responses:messages.map(()=>({success:true}))};
  }}, log:()=>{}});
  assert.deepEqual(await send(sample),{status:'accepted',accepted:501,failed:0,invalid:0});
  assert.deepEqual(batches.map(batch=>batch.length),[500,1]);
  for(const msg of batches.flat()){
    assert.equal(msg.notification,undefined); assert.equal(msg.data.recordId,'contact-id'); assert.equal(msg.data.recipientUid,'admin');
    assert.ok(Object.values(msg.data).every(value=>typeof value==='string')); assert.ok(msg.data.body.length<=180);
    assert.equal(msg.webpush.headers.TTL,'3600');
  }
});
test('invalid registrations are disabled; transient failures are retained and logs exclude tokens', async () => {
  const disabled=[],logs=[];
  const send=createPushSender({project:EXPECTED_PROJECT, store:{targets:async()=>[0,1,2,3].map(target), disableInvalid:async item=>disabled.push(item.deviceId)}, messaging:{sendEach:async()=>({responses:[{success:true},{error:{code:'messaging/registration-token-not-registered',message:'PRIVATE'}},{error:{code:'messaging/invalid-registration-token'}},{error:{code:'messaging/server-unavailable'}}]})},log:(...args)=>logs.push(args)});
  assert.deepEqual(await send(sample),{status:'partial',accepted:1,failed:3,invalid:2});
  assert.deepEqual(disabled,['device-1','device-2']); assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
});
test('unknown transport result is reported safely without retrying the batch', async () => {
  let calls=0; const logs=[];
  const send=createPushSender({project:EXPECTED_PROJECT, store:{targets:async()=>[target(1)]}, messaging:{sendEach:async()=>{calls++; throw new Error('PRIVATE');}}, log:(...args)=>logs.push(args)});
  assert.deepEqual(await send(sample),{status:'unknown',accepted:0,failed:1,invalid:0});
  assert.equal(calls,1); assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
});
test('project guard and emulator prevent unintended live FCM calls', async () => {
  const forbidden=()=>{throw new Error('must never run');};
  const store={targets:async()=>[target(1),target(2)]};
  assert.deepEqual(await createPushSender({emulator:true,store,messaging:{sendEach:forbidden}})(sample),{status:'simulated',accepted:0,failed:0,simulated:2});
  await assert.rejects(createPushSender({project:'wrong-project',store:{targets:forbidden}})(sample),/Unexpected push project/);
  assert.equal((await createPushSender({project:EXPECTED_PROJECT,store:{targets:async()=>[]}})(sample)).status,'no-devices');
});
test('admin actions are skipped using trusted auth context and existing actor fields', async () => {
  const admin=async uid=>uid==='admin';
  assert.equal(await isAdminOrigin({authId:'admin',authType:'unknown'},'contact',{},admin),true);
  for(const authType of ['system','service_account']) assert.equal(await isAdminOrigin({authType},'quote',{},admin),true);
  for(const field of ['senderId','ownerId','customerId']) assert.equal(await isAdminOrigin({},'request',{[field]:'admin'},admin),true);
  assert.equal(await isAdminOrigin({},'clientMessage',{senderRole:'admin'},admin),true);
  assert.equal(await isAdminOrigin({authId:'client',authType:'unknown'},'contact',{},admin),false);
  assert.equal(await isAdminOrigin({authType:'unauthenticated'},'contact',{},admin),false);
  assert.equal(await isAdminOrigin({},'clientMessage',{senderRole:'customer',senderId:'client'},admin),false);
});
test('existing category and dashboard preferences survive settings migration',()=>{
  const prefs=preferences({schemaVersion:1,channels:{dashboard:false},categories:{quotes:true,contacts:false}});
  assert.equal(prefs.channels.push,true); assert.equal(prefs.channels.dashboard,false);
  assert.equal(prefs.categories.quotes,true); assert.equal(prefs.categories.contacts,false);
});
