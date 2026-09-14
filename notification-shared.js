export const notificationCategories = {
  quotes: "New Quotes", contacts: "New Contact Messages", accounts: "New Client Accounts",
  clientMessages: "New Client Messages", bugFix: "Bug Fix Requests", redesign: "Redesign Requests",
  feature: "Feature Requests", projectRequests: "Client Project Requests", otherRequests: "Other Support Requests", replies: "Client Replies to Requests"
};
export const defaultNotificationSettings = () => ({ channels: { sms: true, dashboard: true, email: false }, categories: Object.fromEntries(Object.keys(notificationCategories).map(key => [key, true])), schemaVersion: 1 });
export function smsStatusLabel(item) {
  const labels = { disabled: "SMS disabled by settings", attempting: "SMS attempt started", accepted: "Accepted by Twilio", scheduled: "Scheduled", queued: "Queued", sending: "Sending", sent: "Sent to carrier", delivered: "Delivered", undelivered: "Undelivered", failed: "SMS failed", canceled: "Canceled", unknown: "Outcome unknown — check Twilio logs before retrying", "not-configured": "SMS setup incomplete", simulated: "Simulated SMS — no text sent" };
  if (item.smsStatus === "attempting" && item.createdAt?.toMillis?.() < Date.now() - 120000) return "Outcome unknown — check Twilio logs before retrying";
  return labels[item.smsStatus] || "Status unavailable";
}
