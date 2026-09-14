const { createHash } = require("node:crypto");

const CATEGORIES = ["quotes", "contacts", "accounts", "clientMessages", "bugFix", "redesign", "feature", "projectRequests", "otherRequests", "replies"];
const SITE = "https://silverforgedigitalsolutions.com";
const DEFAULT_SETTINGS = { channels: { sms: true, dashboard: true, email: false }, categories: Object.fromEntries(CATEGORIES.map(key => [key, true])) };
const clean = (value, maximum = 120) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) : "";
const id = value => typeof value === "string" && value.length <= 128 && !value.includes("/") && value ? value : null;

function preferences(data) {
  if (!data) return structuredClone(DEFAULT_SETTINGS);
  // A malformed stored preference fails closed, rather than enabling SMS.
  return { channels: { sms: data.channels?.sms === true, dashboard: data.channels?.dashboard === true, email: false },
    categories: Object.fromEntries(CATEGORIES.map(key => [key, data.categories?.[key] === true])) };
}
function notificationFor(kind, data, params, parent = {}) {
  if (!data || (kind === "account" && data.role !== "customer")) return null;
  if (["clientMessage", "reply"].includes(kind) && data.senderRole !== "customer") return null;
  const result = { clientId: id(data.customerId || data.ownerId || params.clientUid || (kind === "account" ? params.userUid : null)),
    projectId: id(data.projectId || parent.projectId || (kind === "quote" ? params.leadId : null)), requestId: id(params.ticketId),
    clientName: clean(data.ownerName || (kind === "clientMessage" || kind === "reply" ? data.senderName : data.name)),
    projectName: clean(data.projectName || parent.projectName || (kind === "quote" ? data.business : "")),
    subject: clean(data.title || data.subject || (kind === "quote" ? data.service : data.message), 180) };
  if (kind === "quote") Object.assign(result, { type: "new-quote", category: "quotes", title: "New Quote Request", link: `crm.html?lead=${encodeURIComponent(params.leadId)}` });
  if (kind === "contact") Object.assign(result, { type: "new-contact", category: "contacts", title: "New General Contact", link: `crm-support.html?contact=${encodeURIComponent(params.contactId)}` });
  if (kind === "account") Object.assign(result, { type: "new-account", category: "accounts", title: "New Client Account", subject: clean(data.business), link: `crm.html?client=${encodeURIComponent(params.userUid)}` });
  if (kind === "request") {
    const labels = { "bug-fix": ["bugFix", "Bug Fix Request"], "redesign-change": ["redesign", "Redesign / Change Request"], "feature-request": ["feature", "Feature Request"], "project-request": ["projectRequests", "Client Project Request"] };
    const [category, title] = labels[data.type] || ["otherRequests", "Client Support Request"];
    Object.assign(result, { type: data.type, category, title, link: `crm-support.html?ticket=${encodeURIComponent(params.ticketId)}` });
  }
  if (kind === "clientMessage") Object.assign(result, { type: "client-message", category: "clientMessages", title: "New Client Message", link: `crm.html?client=${encodeURIComponent(params.clientUid)}&tab=messages` });
  if (kind === "reply") Object.assign(result, { type: "client-reply", category: "replies", title: "Client Reply to Request", clientId: id(parent.ownerId), link: `crm-support.html?ticket=${encodeURIComponent(params.ticketId)}` });
  if (!result.category) return null;
  result.message = [result.clientName, result.projectName, result.subject].filter(Boolean).join(" · ").slice(0, 400) || result.title;
  return result;
}
function smsBody(notification) {
  return [`SilverForge: ${clean(notification.title, 52)}`,
    notification.clientName && `Client: ${clean(notification.clientName, 35)}`,
    notification.projectName && `Project: ${clean(notification.projectName, 40)}`,
    notification.subject && `Subject: ${clean(notification.subject, 80)}`,
    `${SITE}/crm-notifications.html`].filter(Boolean).join("\n");
}
function errorDetails(error) {
  return { code: Number.isInteger(error?.code) && error.code >= 10000 && error.code <= 99999 ? error.code : null,
    status: error?.configuration === true ? "not-configured" : Number(error?.status) >= 400 && Number(error?.status) < 500 ? "failed" : "unknown" };
}
async function processNotification({ eventId, kind, data, params, parent, store, sendSms, log }) {
  const notification = notificationFor(kind, data, params, parent);
  if (!notification) return { skipped: "admin-or-unrelated-event" };
  if (!eventId) throw new Error("A stable event ID is required.");
  const notificationId = createHash("sha256").update(`${kind}:${eventId}`).digest("hex");
  const claim = await store.claim(notificationId, notification);
  if (!claim) return { duplicate: true, notificationId };
  if (!claim.smsEnabled) return { skipped: "preferences", notificationId };
  // The durable claim is made BEFORE the external call. Never reclaim an
  // ambiguous attempt: provider timeouts cannot prove that no SMS was queued.
  let outcome;
  try {
    const result = await sendSms({ body: smsBody(notification), notificationId });
    outcome = { status: result.simulated ? "simulated" : "accepted", providerId: result.sid || null, code: null };
  } catch (error) {
    outcome = { ...errorDetails(error), providerId: null };
    // Never log the raw Twilio error, request, body, credentials or phone numbers.
    log("admin_sms_attempt_failed", { notificationId, status: outcome.status, code: outcome.code });
  }
  await store.finish(notificationId, outcome);
  return { notificationId, smsStatus: outcome.status };
}
module.exports = { CATEGORIES, DEFAULT_SETTINGS, SITE, preferences, notificationFor, smsBody, errorDetails, processNotification };
