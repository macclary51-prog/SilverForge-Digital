import { auth } from './firebase-config.js';
import { isSupported, listenForPush } from './push-messaging.js';
import { deviceState } from './push-state.js';
// FCM forwards pushes to open website windows. Keep opted-in public tabs listening too.
// This never requests permission, generates a token or reads the device collection.
if ('Notification' in window && Notification.permission === 'granted' && await isSupported()) {
  const stop = listenForPush(async payload => {
    const state = await deviceState();
    if (state?.enabled && state.uid === auth?.currentUser?.uid) {
      (await navigator.serviceWorker.getRegistration('/'))?.active?.postMessage({ type: 'DISPLAY_ADMIN_PUSH', payload });
    }
  });
  window.addEventListener('beforeunload', stop);
}
