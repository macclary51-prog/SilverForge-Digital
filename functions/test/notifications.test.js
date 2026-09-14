const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preferences, CATEGORIES, notificationFor, smsBody, processNotification } = require("../src/notifications");
const { createSmsSender, callbackUrl, EXPECTED_PROJECT } = require("../src/sms");
const { statusHandler } = require("../src/status");
const twilio = require("twilio");

test("all requested events map to their category and real existing admin routes", () => {
  const cases = [["quote", {}, "quotes"], ["contact", {}, "contacts"], ["account", { role: "customer" }, "accounts"],
    ["clientMessage", { senderRole: "customer" }, "clientMessages"], ["reply", { senderRole: "customer" }, "replies"],
    ...Object.entries({ "bug-fix": "bugFix", "redesign-change": "redesign", "feature-request": "feature", "project-request": "projectRequests", other: "otherRequests" }).map(([type, category]) => ["request", { type }, category])];
  for (const [kind, data, category] of cases) {
    const item = notificationFor(kind, data, { leadId: "lead", contactId: "contact", userUid: "alice", clientUid: "alice", ticketId: "ticket" }, { ownerId: "alice", projectId: "project" });
    assert.equal(item.category, category); assert.match(item.link, /^crm(?:-support)?\.html\?/);
    assert.ok(!smsBody(item).includes("undefined"));
  }
  assert.equal(notificationFor("reply", { senderRole: "admin" }, {}), null);
  assert.equal(notificationFor("clientMessage", { senderRole: "admin" }, {}), null);
  assert.equal(notificationFor("account", { role: "admin" }, {}), null);
});
test("SMS summaries omit missing fields, remove control characters and bound user input", () => {
  const item = notificationFor("contact", { name: "Name\nInjected", subject: "X".repeat(5000) }, { contactId: "one" });
  const body = smsBody(item); assert.ok(body.length < 320); assert.ok(!body.includes("Project:")); assert.match(body, /Client: Name Injected/);
  assert.ok(!body.includes("undefined")); assert.ok(body.endsWith("/crm-notifications.html"));
});
test("missing settings default on; malformed values fail closed", () => {
  assert.ok(CATEGORIES.every(key => preferences(null).categories[key]));
  assert.equal(preferences({ channels: { sms: "true" }, categories: { quotes: 1 } }).channels.sms, false);
  assert.equal(preferences({}).categories.quotes, false); assert.equal(preferences(null).channels.email, false);
});
function harness(prefs = preferences(null)) {
  const history = new Map(); let calls = 0; const logs = [];
  const store = { async claim(id, data) { if (history.has(id)) return null; history.set(id, { ...data }); return { smsEnabled: prefs.channels.sms && prefs.categories[data.category] }; },
    async finish(id, outcome) { Object.assign(history.get(id), outcome); } };
  const input = { eventId: "stable-event", kind: "contact", data: { name: "Visitor", subject: "Hello" }, params: { contactId: "one" }, store,
    sendSms: async () => { calls++; return { simulated: true }; }, log: (...args) => logs.push(args) };
  return { input, history, logs, calls: () => calls };
}
test("concurrent duplicate events create one history record and invoke SMS once", async () => {
  const h = harness(); const results = await Promise.all(Array.from({ length: 8 }, () => processNotification(h.input)));
  assert.equal(h.history.size, 1); assert.equal(h.calls(), 1); assert.equal(results.filter(item => item.duplicate).length, 7);
  await processNotification({ ...h.input, eventId: "different" }); assert.equal(h.calls(), 2);
});
test("disabled channel/category retain history but never invoke provider; admin messages do neither", async () => {
  for (const prefs of [{ channels: { sms: false }, categories: { contacts: true } }, { channels: { sms: true }, categories: { contacts: false } }]) {
    const h = harness(prefs); assert.equal((await processNotification(h.input)).skipped, "preferences"); assert.equal(h.history.size, 1); assert.equal(h.calls(), 0);
  }
  const h = harness(); await processNotification({ ...h.input, kind: "clientMessage", data: { senderRole: "admin" } }); assert.equal(h.calls(), 0); assert.equal(h.history.size, 0);
});
test("provider failures keep history, sanitize diagnostics and never retry ambiguous outcomes", async () => {
  for (const [error, expected] of [[{ code: 21610, status: 400 }, "failed"], [{ status: 503 }, "unknown"], [{ configuration: true }, "not-configured"], [{ code: "ETIMEDOUT" }, "unknown"]]) {
    const h = harness(); let calls = 0;
    h.input.sendSms = async () => { calls++; throw Object.assign(new Error("PRIVATE BODY TOKEN PHONE"), error, { request: "PRIVATE" }); };
    assert.equal((await processNotification(h.input)).smsStatus, expected);
    assert.equal(h.history.size, 1); assert.ok(!JSON.stringify(h.logs).includes("PRIVATE"));
    await processNotification(h.input); assert.equal(calls, 1);
  }
});
test("emulator cannot read secrets or contact Twilio; wrong projects fail before reading secrets", async () => {
  const forbidden = () => { throw new Error("must never run"); };
  const simulated = createSmsSender({ emulator: true, getSecrets: forbidden, clientFactory: forbidden });
  assert.deepEqual(await simulated({}), { simulated: true });
  await assert.rejects(createSmsSender({ project: "wrong", getSecrets: forbidden })({}), error => error.configuration === true);
  await assert.rejects(createSmsSender({ project: EXPECTED_PROJECT, getSecrets: () => ({}) })({}), error => error.configuration === true);
});
test("Twilio adapter uses server-only configuration, a verified callback URL and disables retries", async () => {
  const secrets = { accountSid: "AC" + "0".repeat(32), authToken: "1".repeat(32), from: "+15005550006", to: "+15005550009" };
  const notificationId = "a".repeat(64); let payload;
  const send = createSmsSender({ project: EXPECTED_PROJECT, getSecrets: () => secrets, clientFactory: (sid, token, options) => {
    assert.equal(sid, secrets.accountSid); assert.equal(token, secrets.authToken); assert.deepEqual(options, { autoRetry: false, maxRetries: 0, timeout: 10000 });
    return { messages: { create: async value => { payload = value; return { sid: "SM" + "0".repeat(32) }; } } };
  } });
  await send({ body: "Test", notificationId });
  assert.deepEqual(payload, { body: "Test", from: secrets.from, to: secrets.to, statusCallback: callbackUrl(EXPECTED_PROJECT, notificationId) });
});
test("status callback rejects tampered, unsigned and emulator requests; valid signatures update state", async () => {
  const notificationId = "a".repeat(64); const token = "test-only-token"; let calls = 0;
  const body = { MessageSid: "SM" + "0".repeat(32), MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature(token, callbackUrl(EXPECTED_PROJECT, notificationId), body);
  const makeRequest = (sig, fields = body) => ({ method: "POST", query: { notificationId }, body: fields, get: () => sig });
  const response = () => ({ code: 0, status(code) { this.code = code; return this; }, send() {} });
  const options = { project: EXPECTED_PROJECT, getToken: () => token, store: { deliveryStatus: async () => { calls++; } }, log: () => {} };
  for (const request of [makeRequest(""), makeRequest(signature, { ...body, MessageStatus: "failed" })]) {
    const res = response(); await statusHandler(options)(request, res); assert.equal(res.code, 403);
  }
  let res = response(); await statusHandler({ ...options, emulator: true })(makeRequest(signature), res); assert.equal(res.code, 403); assert.equal(calls, 0);
  res = response(); await statusHandler(options)(makeRequest(signature), res); assert.equal(res.code, 204); assert.equal(calls, 1);
});
