import { auth, db, isFirebaseConfigured } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { collection, deleteDoc, doc, getDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { ensurePwa } from './pwa.js';
import { currentDeviceId, optedIn, pushSessionRevision, setDeviceOptIn } from './push-session.js';

const main = document.querySelector('.crm-main');
let currentUser, active = false, key = '', supported = false, busy = false, generation = 0, sdk, registration;
let stopRole = () => {}, stopSettings = () => {}, stopDevices = () => {}, stopForeground = () => {};
let devices = [], refreshed = false, devicesLoaded = false;
const prompt = document.createElement('section'); prompt.className = 'portal-card push-device-prompt'; prompt.hidden = true;
const title = document.createElement('h2'); title.textContent = 'Notifications on This Device';
const status = document.createElement('p'); status.setAttribute('role', 'status'); status.id = 'pushDeviceStatus';
const button = document.createElement('button'); button.type = 'button'; button.id = 'enablePushNotifications'; button.className = 'crm-secondary-button'; button.textContent = 'Enable Notifications';
prompt.append(title, status, button); main?.prepend(prompt);
const keyValid = () => /^[A-Za-z0-9_-]{87}$/.test(key);
function render() {
  if (!active) return;
  const enabled = supported && Notification.permission === 'granted' && optedIn(currentUser.uid) && devices.some(device => device.id === currentDeviceId() && device.enabled);
  button.hidden = enabled; button.disabled = busy || !supported || !keyValid() || Notification.permission === 'denied';
  status.textContent = !supported ? 'Push notifications are not supported in this browser. Try Chrome on Android or install the supported PWA.'
    : Notification.permission === 'denied' ? 'Notifications are blocked. Allow notifications for this site in your browser and phone settings, then reload.'
    : !keyValid() ? 'Add the Firebase Web Push public key in Notification Settings to finish setup.'
    : enabled ? 'This device is enabled for push notifications.' : 'Enable notifications to receive SilverForge alerts on this device. Permission is requested only when you click the button.';
  const list = document.getElementById('notificationDeviceList');
  if (!list) return; list.replaceChildren();
  if (!devices.length) { const empty = document.createElement('p'); empty.textContent = 'No devices registered for your admin account.'; list.append(empty); }
  for (const device of devices) {
    const row = document.createElement('article'); row.className = 'portal-record';
    const label = document.createElement('p'); label.textContent = `${device.platform || 'Browser'}${device.id === currentDeviceId() ? ' · This device' : ''} · ${device.enabled ? 'Enabled' : 'Disabled'}${device.lastUsedAt?.toDate ? ' · ' + device.lastUsedAt.toDate().toLocaleDateString() : ''}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'crm-secondary-button'; remove.textContent = 'Remove Device';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const isCurrent = device.id === currentDeviceId();
        if (isCurrent) await setDeviceOptIn(currentUser.uid, false);
        await deleteDoc(doc(db, 'users', currentUser.uid, 'notificationDevices', device.id));
        if (isCurrent) { try { await sdk?.removeToken(); } catch {} }
        render();
      } catch { status.textContent = 'Device could not be removed. Please try again.'; remove.disabled = false; }
    }); row.append(label, remove); list.append(row);
  }
}
async function registerDevice(interactive) {
  const user = currentUser, run = generation, revision = pushSessionRevision();
  const canceled = () => run !== generation || !active || revision !== pushSessionRevision();
  if (!active || !user || !supported || !keyValid() || Notification.permission !== 'granted') return;
  const deviceId = currentDeviceId(), ref = doc(db, 'users', user.uid, 'notificationDevices', deviceId);
  const previous = await getDoc(ref);
  if (!interactive && (!optedIn(user.uid) || !previous.exists() || previous.data().enabled !== true)) return;
  if (interactive && previous.exists() && previous.data().enabled === false) { try { await sdk.removeToken(); } catch {} }
  const token = await sdk.registerToken({ vapidKey: key, serviceWorkerRegistration: registration });
  if (canceled() || !token) return;
  const platform = /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : 'Desktop';
  const saved = await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref);
    if (canceled()) return false;
    // A token invalidation/removal during refresh must not silently re-enable this device.
    if (!interactive && (!optedIn(user.uid) || !existing.exists() || existing.data().enabled !== true || existing.data().token !== previous.data().token)) return false;
    transaction.set(ref, { token, platform, enabled: true, createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp(), lastUsedAt: serverTimestamp() });
    return true;
  });
  if (canceled() || !saved) return;
  await setDeviceOptIn(user.uid, true); render();
}
button.addEventListener('click', async () => {
  if (busy || !active || !supported || !keyValid()) return;
  busy = true; button.disabled = true;
  try {
    // Keep this API directly in the explicit click flow; never request permission during initialization.
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission === 'granted') await registerDevice(true);
    busy = false; render();
  } catch { busy = false; render(); status.textContent = 'Device registration failed. Check the Firebase Web Push key, browser settings and connection, then try again.'; }
});
function stop() {
  generation++; active = false; prompt.hidden = true;
  stopSettings(); stopDevices(); stopForeground(); devices = []; key = ''; supported = false; refreshed = false; devicesLoaded = false;
}
function maybeRefresh() {
  if (refreshed || !active || !supported || !devicesLoaded || !keyValid() || Notification.permission !== 'granted' || !optedIn(currentUser.uid)) return;
  refreshed = true;
  registerDevice(false).catch(() => { if (active) status.textContent = 'Device refresh failed. Reload to retry.'; });
}
async function start(user) {
  active = true; prompt.hidden = false; const run = generation;
  stopSettings = onSnapshot(doc(db, 'adminSettings', 'notifications'), snapshot => { if (run !== generation) return; key = snapshot.data()?.webPushPublicKey || ''; render(); maybeRefresh(); }, () => { key = ''; render(); });
  stopDevices = onSnapshot(collection(db, 'users', user.uid, 'notificationDevices'), snapshot => {
    if (run !== generation) return;
    devicesLoaded = true;
    devices = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
    if (optedIn(user.uid) && !devices.some(device => device.id === currentDeviceId() && device.enabled)) setDeviceOptIn(user.uid, false).then(render).catch(() => {});
    render(); maybeRefresh();
  }, () => { setDeviceOptIn(user.uid, false).catch(() => {}); status.textContent = 'Devices could not be loaded. Refresh to retry.'; });
  try {
    sdk = await import('./push-messaging.js'); supported = isSecureContext && 'Notification' in window && await sdk.isSupported();
    if (run !== generation || !active) return;
    registration = await ensurePwa(); supported &&= Boolean(registration);
    if (run !== generation || !active) return;
    if (supported) {
      stopForeground = sdk.listenForPush(payload => { if (active && optedIn(user.uid)) registration.active?.postMessage({ type: 'DISPLAY_ADMIN_PUSH', payload }); });
      maybeRefresh();
    }
    render();
  } catch { if (run === generation) { supported = false; render(); } }
}
if (isFirebaseConfigured && auth && db) onAuthStateChanged(auth, user => {
  stopRole(); stop(); currentUser = user;
  if (!user) { setDeviceOptIn('', false).catch(() => {}); return; }
  stopRole = onSnapshot(doc(db, 'roles', user.uid), snapshot => {
    if (currentUser?.uid !== user.uid) return;
    if (snapshot.data()?.role === 'admin' && snapshot.data()?.active === true) { if (!active) start(user); }
    else { stop(); setDeviceOptIn(user.uid, false).catch(() => {}); }
  }, () => { stop(); setDeviceOptIn(user.uid, false).catch(() => {}); });
});
window.addEventListener('beforeunload', () => { stopRole(); stop(); });
