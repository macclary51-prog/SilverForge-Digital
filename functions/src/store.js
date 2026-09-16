const { FieldValue } = require('firebase-admin/firestore');
const { preferences } = require('./notifications');
function createStore(db) {
  return {
    async claim(id, data) {
      return db.runTransaction(async transaction => {
        const history = db.doc(`adminNotifications/${id}`), delivery = db.doc(`_notificationDeliveries/${id}`);
        const [existing, settings] = await Promise.all([transaction.get(delivery), transaction.get(db.doc('adminSettings/notifications'))]);
        if (existing.exists) return null;
        const prefs = preferences(settings.exists ? settings.data() : null);
        const pushEnabled = prefs.channels.push && prefs.categories[data.category];
        const status = pushEnabled ? 'attempting' : 'disabled';
        transaction.create(history, { ...data, read: false, createdAt: FieldValue.serverTimestamp(), dashboardEnabled: prefs.channels.dashboard && prefs.categories[data.category], pushStatus: status, pushAccepted: 0, pushFailed: 0 });
        transaction.create(delivery, { status, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return { pushEnabled };
      });
    },
    async finish(id, outcome) {
      const batch = db.batch();
      batch.update(db.doc(`adminNotifications/${id}`), { pushStatus: outcome.status, pushAccepted: outcome.accepted || 0, pushFailed: outcome.failed || 0 });
      batch.update(db.doc(`_notificationDeliveries/${id}`), { ...outcome, updatedAt: FieldValue.serverTimestamp() });
      await batch.commit();
    },
    async targets() {
      // Query each active admin's own subcollection; no public token query.
      const roles = await db.collection('roles').where('role', '==', 'admin').get();
      const groups = await Promise.all(roles.docs.filter(role => role.data().active === true).map(async role => {
        const devices = await db.collection(`users/${role.id}/notificationDevices`).where('enabled', '==', true).get();
        return devices.docs.map(device => ({ ...device.data(), uid: role.id, deviceId: device.id, ref: device.ref }));
      }));
      const unique = new Map();
      for (const target of groups.flat().sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))) {
        if (typeof target.token === 'string' && target.token && !unique.has(target.token)) unique.set(target.token, target);
      }
      return [...unique.values()];
    },
    async disableInvalid(target) {
      await db.runTransaction(async transaction => {
        const current = await transaction.get(target.ref);
        // A stale send result must not disable a refreshed token.
        if (current.exists && current.data().token === target.token && current.data().enabled === true) transaction.update(target.ref, { enabled: false, updatedAt: FieldValue.serverTimestamp() });
      });
    }
  };
}
module.exports = { createStore };
