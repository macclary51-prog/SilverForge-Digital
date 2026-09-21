const test = require('node:test');
const assert = require('node:assert/strict');
const { smsBody, deliveryId, processSms } = require('../src/sms');
const { createSmsSender } = require('../src/sms-sender');
const { createSmsHandler, createSmsTriggers } = require('../src/sms-triggers');

const snapshot = (path = 'leads/quote-1', seconds = 100) => ({ id: path.split('/').at(-1), ref: { path }, createTime: { seconds, nanoseconds: 12 } });
const fixture = (overrides = {}) => {
  const records = new Map(), sends = [], logs = [];
  const input = { kind: 'quote', data: { name: 'John Smith', business: 'ABC Company', service: 'Website Development' }, event: { id: 'event-1', data: snapshot() },
    store: { claim: async (id, data) => { if (records.has(id)) return false; records.set(id, { ...data, status: 'attempting' }); return true; }, finish: async (id, data) => records.set(id, { ...records.get(id), ...data }) },
    sendSms: async body => { sends.push(body); return { status: 'accepted' }; }, log: (...args) => logs.push(args), ...overrides };
  return { input, records, sends, logs };
};

test('all five SMS templates use existing schema fields and only bounded public summaries', () => {
  const data = { name: 'John Smith', ownerName: 'John Smith', senderName: 'John Smith', business: 'ABC Company', service: 'Website Development', category: 'General Question', subject: 'Website question', type: 'bug-fix', projectName: 'ABC Website', senderRole: 'customer', message: 'Can we change the homepage?', internalNotes: 'PRIVATE INTERNAL NOTE', details: 'FULL SUPPORT DETAILS', lastEmailBody: 'PRIVATE EMAIL' };
  assert.match(smsBody('quote', data), /John Smith \/ ABC Company/);
  assert.match(smsBody('contact', data), /Type: General Question/);
  assert.match(smsBody('request', data), /Bug Fix - ABC Website/);
  assert.match(smsBody('clientMessage', data), /Can we change the homepage/);
  assert.match(smsBody('reply', data, { title: 'Login button problem' }), /Request: Login button problem/);
  for (const kind of ['quote', 'contact', 'request', 'clientMessage', 'reply']) {
    const body = smsBody(kind, data, { title: 'Login button problem' });
    assert.ok(body.length <= 160, `${kind}: ${body.length}`);
    assert.doesNotMatch(body, /PRIVATE|FULL SUPPORT/);
    if (kind !== 'clientMessage') assert.doesNotMatch(body, /Can we change/);
  }
});

test('maximum-length and Unicode input remains a single conservative GSM segment', () => {
  const long = 'Zoë 🛠 “hello” {nested} ^ field\r\n\t'.repeat(300);
  const data = Object.fromEntries(['name', 'ownerName', 'senderName', 'business', 'service', 'category', 'subject', 'projectName', 'message'].map(key => [key, long]));
  data.senderRole = 'customer'; data.type = 'redesign-change';
  for (const kind of ['quote', 'contact', 'request', 'clientMessage', 'reply']) {
    const body = smsBody(kind, data, { title: long });
    assert.ok(body.length <= 160, `${kind}: ${body.length}`);
    assert.match(body, /^[a-zA-Z0-9 .,!?@&()+%\-/:;'"\n]+$/);
    assert.doesNotMatch(body, /\r|\t/);
  }
});

test('credential-like direct message previews are omitted', () => {
  for (const message of ['My password is dontforward', 'Bearer abc', 'api_key=abc', 'https://example.com/?key=secret', 'a'.repeat(40)]) {
    assert.match(smsBody('clientMessage', { senderRole: 'customer', message }), /Message preview omitted/);
  }
});

test('admin, missing and invalid sender roles never send or claim a message/reply', async () => {
  for (const kind of ['clientMessage', 'reply']) for (const senderRole of ['admin', undefined, 'Customer']) {
    const f = fixture({ kind, data: { senderRole } });
    assert.deepEqual(await processSms(f.input), { skipped: true });
    assert.equal(f.records.size, 0); assert.equal(f.sends.length, 0);
  }
});

test('parallel redelivery, different event IDs and restart reuse one durable reservation', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => processSms({ ...f.input, event: { ...f.input.event, id: `event-${i}` } })));
  assert.equal(f.sends.length, 1); assert.equal(results.filter(r => r.duplicate).length, 19);
  await processSms({ ...f.input, sendSms: async () => assert.fail('restart must not resend') });
  assert.equal(f.records.size, 1);
});

test('new document incarnation is distinct, missing identity fails closed', () => {
  assert.notEqual(deliveryId('quote', snapshot()), deliveryId('quote', snapshot('leads/quote-1', 101)));
  assert.throws(() => deliveryId('quote', { ref: { path: 'leads/quote-1' } }));
});

test('Twilio rejections, 5xx and ambiguous timeouts never retry and log only safe diagnostics', async () => {
  for (const status of [400, 429, 500, undefined]) {
    let attempts = 0;
    const f = fixture({ sendSms: async () => { attempts++; throw Object.assign(new Error('SECRET AUTH TOKEN +PRIVATE PHONE'), { status, code: 21608, request: { auth: 'PRIVATE' } }); } });
    const result = await processSms(f.input); await processSms(f.input);
    assert.equal(result.status, status && status < 500 ? 'failed' : 'unknown'); assert.equal(attempts, 1);
    assert.equal(f.logs[0][1].twilioCode, 21608);
    assert.equal(f.logs[0][1].eventType, 'quote'); assert.equal(f.logs[0][1].documentId, 'quote-1');
    assert.doesNotMatch(JSON.stringify([...f.records.values(), f.logs]), /SECRET|PRIVATE|AUTH TOKEN/);
  }
});

test('post-send persistence failure and crash reservation cannot cause a second send', async () => {
  const f = fixture(); f.input.store.finish = async () => { throw new Error('database offline'); };
  await processSms(f.input); await processSms(f.input);
  assert.equal(f.sends.length, 1); assert.equal([...f.records.values()][0].status, 'attempting');
  const crashed = fixture(); await crashed.input.store.claim(deliveryId('quote', crashed.input.event.data), {});
  assert.equal((await processSms(crashed.input)).duplicate, true); assert.equal(crashed.sends.length, 0);
});

test('claim failure does not reach the SMS transport', async () => {
  const f = fixture(); f.input.store.claim = async () => { throw new Error('unavailable'); };
  await assert.rejects(processSms(f.input)); assert.equal(f.sends.length, 0);
});

test('Twilio adapter loads secrets only at send time, sends once, disables retries/debug logs', async () => {
  let reads = 0, calls = 0;
  const sender = createSmsSender({ project: 'silverforge-digital', emulator: false,
    readSecrets: () => { reads++; return { accountSid: 'AC' + '0'.repeat(32), authToken: 'test-only-not-a-real-token', from: '+15005550006', to: '+15005550009' }; },
    clientFactory: (sid, token, options) => {
      assert.equal(sid, 'AC' + '0'.repeat(32)); assert.equal(token, 'test-only-not-a-real-token');
      assert.deepEqual(options, { autoRetry: false, maxRetries: 0, timeout: 15000, logLevel: 'silent' });
      return { messages: { create: async args => { calls++; assert.deepEqual(args, { from: '+15005550006', to: '+15005550009', body: 'test' }); return { sid: 'SM_TEST_ONLY' }; } } };
    } });
  assert.equal(reads, 0); assert.deepEqual(await sender('test'), { status: 'accepted', twilioMessageSid: 'SM_TEST_ONLY' });
  assert.equal(reads, 1); assert.equal(calls, 1);
});

test('emulator and wrong-project guards cannot read secrets or call Twilio', async () => {
  const dependencies = { readSecrets: () => assert.fail('secret read'), clientFactory: () => assert.fail('Twilio call') };
  assert.deepEqual(await createSmsSender({ ...dependencies, project: 'demo-silverforge', emulator: true })('test'), { status: 'simulated' });
  await assert.rejects(createSmsSender({ ...dependencies, project: 'wrong-project', emulator: false })('test'));
});

test('production triggers bind all four secrets and only the five create-event paths', () => {
  const handlers = createSmsTriggers({ db: {}, project: 'silverforge-digital', emulator: false, log() {} });
  const expected = { notifyNewQuote: 'leads/{leadId}', notifyNewContact: 'contactMessages/{messageId}', notifyNewSupportTicket: 'supportTickets/{ticketId}', notifyNewClientMessage: 'clientConversations/{clientUid}/messages/{messageId}', notifyNewSupportReply: 'supportTickets/{ticketId}/messages/{messageId}' };
  assert.deepEqual(Object.keys(handlers), Object.keys(expected));
  for (const [name, fn] of Object.entries(handlers)) {
    const endpoint = fn.__endpoint;
    assert.equal(endpoint.platform, 'gcfv2'); assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, expected[name]);
    assert.match(endpoint.eventTrigger.eventType, /created/); assert.equal(endpoint.eventTrigger.retry, false);
    assert.deepEqual(endpoint.secretEnvironmentVariables.map(item => item.key).sort(), ['ADMIN_SMS_NUMBER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']);
    assert.ok(!endpoint.httpsTrigger && !endpoint.callableTrigger);
  }
});

test('trusted admin, system and service-account origins skip; guard errors are isolated', async () => {
  for (const event of [{ authId: 'admin', authType: 'api_key' }, { authType: 'system' }, { authType: 'service_account' }]) {
    const f = fixture();
    const handler = createSmsHandler({ ...f.input, project: 'silverforge-digital', emulator: false, db: { doc: () => ({ get: async () => ({ data: () => ({ role: 'admin', active: true }) }) }) } });
    await handler({ ...f.input.event, ...event, data: { ...snapshot(), data: () => f.input.data } });
    assert.equal(f.sends.length, 0);
  }
  const f = fixture();
  const handler = createSmsHandler({ ...f.input, project: 'silverforge-digital', emulator: false, db: { doc: () => { throw new Error('PRIVATE'); } } });
  await handler({ ...f.input.event, authId: 'customer', data: { ...snapshot(), data: () => f.input.data } });
  assert.equal(f.sends.length, 0); assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE/);
});
