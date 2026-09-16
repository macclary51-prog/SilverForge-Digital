export const notificationCategories = {
  quotes: "New Quotes", contacts: "New Contact Messages", accounts: "New Client Accounts",
  clientMessages: "New Client Messages", bugFix: "Bug Fix Requests", redesign: "Redesign Requests",
  feature: "Feature Requests", projectRequests: "Client Project Requests", otherRequests: "Other Support Requests", replies: "Client Replies to Requests"
};
export const defaultNotificationSettings = () => ({ channels: { push: true, dashboard: true, email: false }, categories: Object.fromEntries(Object.keys(notificationCategories).map(key => [key, true])), schemaVersion: 2, webPushPublicKey: "" });
export function normalizeNotificationSettings(data) {
  if (!data) return defaultNotificationSettings();
  return { ...data, channels: { push: data.schemaVersion === 1 || data.channels?.push === true, dashboard: data.channels?.dashboard === true, email: false }, webPushPublicKey: data.webPushPublicKey || "" };
}
export function pushStatusLabel(item) {
  const labels = { disabled: "Push disabled by settings", attempting: "Push attempt started", accepted: "Accepted by Firebase Cloud Messaging", partial: "Some devices could not be reached", failed: "Push failed", unknown: "Push outcome unknown — review server logs", "no-devices": "No enabled admin devices", simulated: "Simulated push — no notification sent" };
  if (item.pushStatus === "attempting" && item.createdAt?.toMillis?.() < Date.now() - 120000) return labels.unknown;
  return labels[item.pushStatus] || "No push attempt recorded";
}
