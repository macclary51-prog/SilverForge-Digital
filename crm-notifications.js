import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { $, date, element, message, millis, options } from "./portal-shared.js";
import { defaultNotificationSettings, notificationCategories, smsStatusLabel } from "./notification-shared.js";
import { watchUnreadNotifications } from "./notification-badge.js";

let user; let stops = []; let stopRole = () => {}; let records = new Map(); let cursor;
let dirty = false; let saving = false; let loading = false; let generation = 0;
options($("notificationCategory"), notificationCategories);
for (const [key, label] of Object.entries(notificationCategories)) {
  const node = element("label", ""); const input = document.createElement("input"); input.type = "checkbox"; input.id = `notify-${key}`; input.checked = true;
  node.append(input, document.createTextNode(label)); $("notificationCategorySettings").append(node);
}
function clear() { generation++; stops.forEach(stop => stop()); stops = []; records.clear(); cursor = null; $("notificationList").replaceChildren(); $("notificationApp").hidden = true; $("accessGate").hidden = false; }
function deny() { clear(); location.replace("crm-login.html?reason=unauthorized"); }
function applySettings(settings) {
  $("notifySms").checked = settings.channels?.sms === true; $("notifyDashboard").checked = settings.channels?.dashboard === true;
  for (const key of Object.keys(notificationCategories)) $("notify-" + key).checked = settings.categories?.[key] === true;
}
async function markRead(item) {
  const current = generation;
  await updateDoc(doc(db, "adminNotifications", item.id), { read: true, readAt: serverTimestamp(), readBy: user.uid });
  if (current !== generation) return;
  // Keep newer delivery status received while the read receipt was saving.
  records.set(item.id, { ...(records.get(item.id) || item), read: true }); render();
}
function safeLink(value) {
  try { const url = new URL(value, location.href); return url.origin === location.origin && ["/crm.html", "/crm-support.html"].includes(url.pathname) ? url.href : null; }
  catch { return null; }
}
function render() {
  const filter = $("notificationFilter").value; const category = $("notificationCategory").value;
  const items = [...records.values()].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).filter(item => (category === "all" || category === item.category)
    && (filter !== "unread" || (!item.read && item.dashboardEnabled))
    && (filter !== "sms-issues" || ["failed", "undelivered", "unknown", "not-configured", "attempting"].includes(item.smsStatus)));
  $("notificationList").replaceChildren();
  message($("notificationStatus"), items.length ? `${items.length} notification(s) shown from ${records.size} loaded.` : "No matching notifications. New activity appears here once server notifications are configured.");
  for (const item of items) {
    const card = element("article", "", `portal-record ${!item.read && item.dashboardEnabled ? "notification-card-unread" : ""}`);
    card.append(element("h3", item.title), element("small", `${notificationCategories[item.category] || "Activity"} · ${date(item.createdAt)} · ${item.read ? "Read" : "Unread"}`), element("p", item.message, "notification-body"), element("p", `${smsStatusLabel(item)}${item.smsErrorCode ? ` · Code ${item.smsErrorCode}` : ""}`, "notification-sms"));
    const actions = element("div", "", "portal-actions");
    const link = safeLink(item.link);
    if (link) { const open = element("a", "Open Related Activity", "crm-secondary-button"); open.href = link; actions.append(open); }
    if (!item.read) {
      const button = element("button", "Mark Read", "crm-secondary-button"); button.type = "button"; button.addEventListener("click", async () => {
        button.disabled = true; try { await markRead(item); }
        catch (error) { console.error("Notification read update failed:", error); message($("notificationStatus"), "Could not mark the notification read. Try again.", "error"); button.disabled = false; }
      }); actions.append(button);
    }
    card.append(actions); $("notificationList").append(card);
  }
}
function subscribe() {
  const current = generation; message($("notificationStatus"), "Loading notifications...");
  const fail = error => { console.error("Admin notifications failed:", error); if (error.code === "permission-denied") deny(); else message($("notificationStatus"), "Notifications could not be loaded. Refresh to retry.", "error"); };
  stops.push(onSnapshot(query(collection(db, "adminNotifications"), orderBy("createdAt", "desc"), limit(50)), snapshot => {
    if (current !== generation) return;
    snapshot.docs.forEach(record => records.set(record.id, { ...record.data(), id: record.id }));
    if (!cursor) { cursor = snapshot.docs.at(-1); $("loadMoreNotifications").hidden = snapshot.size < 50; } render();
  }, fail));
  stops.push(onSnapshot(doc(db, "adminSettings", "notifications"), snapshot => { if (!dirty && !saving) applySettings(snapshot.exists() ? snapshot.data() : defaultNotificationSettings()); }, fail));
  stops.push(watchUnreadNotifications(count => { $("notificationUnread").textContent = `${count} unread`; }, fail));
}
$("notificationSettingsForm").addEventListener("input", () => { dirty = true; });
$("notificationSettingsForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!user || saving) return;
  saving = true; $("saveNotificationSettings").disabled = true; const current = generation;
  const data = { ...defaultNotificationSettings(), channels: { sms: $("notifySms").checked, dashboard: $("notifyDashboard").checked, email: false }, categories: Object.fromEntries(Object.keys(notificationCategories).map(key => [key, $("notify-" + key).checked])), updatedAt: serverTimestamp(), updatedBy: user.uid };
  try { await setDoc(doc(db, "adminSettings", "notifications"), data); if (current === generation) { dirty = false; message($("notificationSettingsStatus"), "Notification settings saved.", "success"); } }
  catch (error) { console.error("Notification settings save failed:", error); if (current === generation) message($("notificationSettingsStatus"), "Settings could not be saved. Please try again.", "error"); }
  finally { saving = false; $("saveNotificationSettings").disabled = false; }
});
$("loadMoreNotifications").addEventListener("click", async () => {
  if (loading || !cursor) return; loading = true; $("loadMoreNotifications").disabled = true; const current = generation;
  try {
    const snapshot = await getDocs(query(collection(db, "adminNotifications"), orderBy("createdAt", "desc"), startAfter(cursor), limit(50)));
    if (current !== generation) return;
    snapshot.docs.forEach(record => records.set(record.id, { ...record.data(), id: record.id })); cursor = snapshot.docs.at(-1) || cursor;
    $("loadMoreNotifications").hidden = snapshot.size < 50; render();
  } catch { if (current === generation) message($("notificationStatus"), "Older history could not be loaded. Try again.", "error"); }
  finally { loading = false; $("loadMoreNotifications").disabled = false; }
});
$("notificationFilter").addEventListener("change", render); $("notificationCategory").addEventListener("change", render);
$("signOutButton").addEventListener("click", () => signOut(auth).catch(() => message($("notificationStatus"), "Sign out failed. Try again.", "error")));
if (!isFirebaseConfigured || !auth || !db) $("accessMessage").textContent = "Notifications are temporarily unavailable.";
else onAuthStateChanged(auth, current => {
  stopRole(); clear(); user = current; dirty = false; if (!user) { location.replace("crm-login.html"); return; }
  stopRole = onSnapshot(doc(db, "roles", user.uid), snapshot => {
    if (snapshot.data()?.role !== "admin" || snapshot.data()?.active !== true) { deny(); return; }
    $("adminEmail").textContent = user.email || "Administrator"; $("accessGate").hidden = true; $("notificationApp").hidden = false;
    if (!stops.length) subscribe();
  }, deny);
});
window.addEventListener("beforeunload", () => { stopRole(); clear(); });
