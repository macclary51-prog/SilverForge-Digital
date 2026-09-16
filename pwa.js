let registration;
export function ensurePwa() {
  if (!isSecureContext || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ||= navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/', updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready);
  return registration;
}
ensurePwa().catch(() => {});
