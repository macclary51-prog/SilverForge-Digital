const { EXPECTED_PROJECT } = require('./config');
const INVALID_TOKENS = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
function createPushSender({ project, emulator, store, messaging, log }) {
  return async ({ notification, notificationId }) => {
    if (!emulator && project !== EXPECTED_PROJECT) throw new Error('Unexpected push project');
    const targets = await store.targets();
    if (!targets.length) return { status: 'no-devices', accepted: 0, failed: 0, invalid: 0 };
    // FCM has no emulator. Never call its production transport during local tests.
    if (emulator) return { status: 'simulated', accepted: 0, failed: 0, simulated: targets.length };
    let accepted = 0, failed = 0, invalid = 0, unknown = false;
    for (let offset = 0; offset < targets.length; offset += 500) {
      const batch = targets.slice(offset, offset + 500);
      try {
        const result = await messaging.sendEach(batch.map(target => ({ token: target.token, data: {
          notificationId, recipientUid: target.uid, deviceId: target.deviceId,
          title: `SilverForge — ${notification.title}`, body: notification.message.slice(0, 180),
          target: notification.target, recordId: notification.recordId || '', clientId: notification.clientId || ''
        }, webpush: { headers: { TTL: '3600', Urgency: 'high' } } })));
        for (let index = 0; index < result.responses.length; index++) {
          const response = result.responses[index];
          if (response.success) { accepted++; continue; }
          failed++;
          if (INVALID_TOKENS.has(response.error?.code)) {
            invalid++;
            try { await store.disableInvalid(batch[index]); }
            catch { log('admin_push_token_cleanup_failed', { notificationId }); }
          }
        }
      } catch {
        // Never log token-bearing SDK errors or automatically repeat ambiguous sends.
        failed += batch.length; unknown = true;
      }
    }
    const status = unknown ? 'unknown' : failed ? (accepted ? 'partial' : 'failed') : 'accepted';
    if (failed) log('admin_push_send_failed', { notificationId, status, accepted, failed, invalid });
    return { status, accepted, failed, invalid };
  };
}
module.exports = { createPushSender, INVALID_TOKENS };
