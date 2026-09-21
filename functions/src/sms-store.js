const { FieldValue } = require('firebase-admin/firestore');

function createSmsStore(db) {
  return {
    async claim(id, context) {
      return db.runTransaction(async transaction => {
        const ref = db.doc(`_smsDeliveries/${id}`);
        if ((await transaction.get(ref)).exists) return false;
        transaction.create(ref, { ...context, status: 'attempting', startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return true;
      });
    },
    async finish(id, outcome) {
      await db.doc(`_smsDeliveries/${id}`).update({ ...outcome, updatedAt: FieldValue.serverTimestamp() });
    }
  };
}
module.exports = { createSmsStore };
