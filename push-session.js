import { auth, db } from './firebase-config.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { doc, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { deviceState } from './push-state.js';
let revision = 0;
export const pushSessionRevision = () => revision;
export function currentDeviceId() {
  let value = localStorage.getItem('silverforge-push-device');
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(value || '')) { value = crypto.randomUUID(); localStorage.setItem('silverforge-push-device', value); }
  return value;
}
export const optedIn = uid => localStorage.getItem(`silverforge-push-optin:${uid}`) === 'true';
async function boundedCleanup(action) {
  let timer;
  try { await Promise.race([action(), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
  catch { /* Cleanup is best effort; local push is already muted. */ }
  finally { clearTimeout(timer); }
}
export async function setDeviceOptIn(uid, enabled) {
  if (!enabled) revision++;
  if (uid) localStorage.setItem(`silverforge-push-optin:${uid}`, String(enabled));
  const previous = await deviceState();
  if (previous?.uid && previous.uid !== uid) localStorage.setItem(`silverforge-push-optin:${previous.uid}`, 'false');
  await deviceState({ uid: uid || '', deviceId: currentDeviceId(), enabled });
  if (!enabled && 'serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    registration?.active?.postMessage({ type: 'CLEAR_ADMIN_PUSH' });
  }
  return previous;
}
export async function signOutWithPushCleanup() {
  const uid = auth?.currentUser?.uid;
  try {
    const wasEnabled = uid && optedIn(uid);
    await setDeviceOptIn(uid, false);
    if (wasEnabled && navigator.onLine) {
      await boundedCleanup(() => updateDoc(doc(db, 'users', uid, 'notificationDevices', currentDeviceId()), { enabled: false, updatedAt: serverTimestamp(), lastUsedAt: serverTimestamp() }));
      await boundedCleanup(async () => (await import('./push-messaging.js')).removeToken());
    }
  } catch { /* Storage availability must not trap the user in a signed-in session. */ }
  return signOut(auth);
}
