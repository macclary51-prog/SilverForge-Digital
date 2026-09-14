const { FieldValue } = require("firebase-admin/firestore");
const { preferences } = require("./notifications");
const TERMINAL = new Set(["delivered", "undelivered", "failed", "canceled"]);
const CALLBACK_STATUSES = new Set(["accepted", "scheduled", "queued", "sending", "sent", ...TERMINAL]);
const RANK = { accepted: 0, scheduled: 0, queued: 1, sending: 2, sent: 3, delivered: 4, undelivered: 4, failed: 4, canceled: 4 };

function createStore(db) {
  const refs = id => [db.doc(`adminNotifications/${id}`), db.doc(`_notificationDeliveries/${id}`)];
  return {
    async claim(id, data) {
      return db.runTransaction(async transaction => {
        const [notification, delivery] = refs(id);
        const [existing, settings] = await Promise.all([transaction.get(delivery), transaction.get(db.doc("adminSettings/notifications"))]);
        if (existing.exists) return null;
        const prefs = preferences(settings.exists ? settings.data() : null);
        const enabled = prefs.categories[data.category]; const smsEnabled = prefs.channels.sms && enabled;
        const smsStatus = smsEnabled ? "attempting" : "disabled";
        transaction.create(notification, { ...data, read: false, createdAt: FieldValue.serverTimestamp(), dashboardEnabled: prefs.channels.dashboard && enabled, smsStatus, smsErrorCode: null });
        transaction.create(delivery, { status: smsStatus, providerId: null, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return { smsEnabled };
      });
    },
    async finish(id, outcome) {
      await db.runTransaction(async transaction => {
        const [notification, delivery] = refs(id); const current = await transaction.get(delivery);
        // A signed status callback can beat the API response. Preserve its outcome.
        if (!current.exists || CALLBACK_STATUSES.has(current.data().status)) return;
        transaction.update(delivery, { status: outcome.status, providerId: outcome.providerId, updatedAt: FieldValue.serverTimestamp() });
        transaction.update(notification, { smsStatus: outcome.status, smsErrorCode: outcome.code });
      });
    },
    async deliveryStatus(id, sid, status, code) {
      if (!CALLBACK_STATUSES.has(status) || !/^SM[0-9a-fA-F]{32}$/.test(sid)) return false;
      return db.runTransaction(async transaction => {
        const [notification, delivery] = refs(id); const current = await transaction.get(delivery);
        if (!current.exists) return false;
        const previous = current.data();
        if (previous.providerId && previous.providerId !== sid) return false;
        if (previous.status === "disabled" || previous.status === "simulated" || TERMINAL.has(previous.status)) return true;
        if ((RANK[previous.status] ?? -1) > RANK[status]) return true;
        transaction.update(delivery, { status, providerId: sid, updatedAt: FieldValue.serverTimestamp() });
        transaction.update(notification, { smsStatus: status, smsErrorCode: /^\d{5}$/.test(String(code || "")) ? Number(code) : null });
        return true;
      });
    }
  };
}
module.exports = { createStore };
