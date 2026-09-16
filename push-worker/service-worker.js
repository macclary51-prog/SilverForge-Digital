import { initializeApp } from 'firebase/app';
import { getMessaging, isSupported, onBackgroundMessage } from 'firebase/messaging/sw';
import { deviceState } from '../push-state.js';
import { notificationPath } from '../push-routing.js';
const CACHE = 'silverforge-public-offline-v1';
let displayQueue = Promise.resolve();

// Install only public branding/offline assets. Never cache CRM pages or API responses.
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icons/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('silverforge-public-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname === '/icons/icon-192.png') {
    event.respondWith(caches.match('/icons/icon-192.png').then(cached => cached || fetch(event.request)));
  } else if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
function display(data) {
  displayQueue = displayQueue.catch(() => {}).then(async () => {
    const state = await deviceState();
    if (!state?.enabled || data?.recipientUid !== state.uid || data?.deviceId !== state.deviceId || !/^[a-f0-9]{64}$/.test(data?.notificationId || '')) return;
    const recent = (await deviceState(undefined, 'recent')) || [];
    if (recent.includes(data.notificationId)) return;
    await deviceState([...recent, data.notificationId].slice(-100), 'recent');
    const latest = await deviceState();
    if (!latest?.enabled || latest.uid !== data.recipientUid || latest.deviceId !== data.deviceId) return;
    await self.registration.showNotification(String(data.title || 'SilverForge').slice(0, 100), {
      body: String(data.body || 'New admin activity.').slice(0, 180), icon: '/icons/icon-192.png',
      tag: `silverforge-${data.notificationId}`, data: { ...data }, renotify: false
    });
  });
  return displayQueue;
}
// Register click handling before Firebase initializes its own worker listeners.
self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation(); event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {}, state = await deviceState();
    const path = state?.enabled && state.uid === data.recipientUid ? notificationPath(data) : 'crm-login.html';
    const url = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && /\/crm(?:-[a-z]+)?\.html$/.test(new URL(client.url).pathname));
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
self.addEventListener('message', event => {
  if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  if (event.data?.type === 'DISPLAY_ADMIN_PUSH') event.waitUntil(display(event.data.payload?.data));
  if (event.data?.type === 'CLEAR_ADMIN_PUSH') event.waitUntil(displayQueue.catch(() => {}).then(() => self.registration.getNotifications()).then(items => items.forEach(item => item.close())));
});
isSupported().then(supported => { if (supported) onBackgroundMessage(getMessaging(initializeApp(__FIREBASE_CONFIG__)), payload => display(payload.data)); }).catch(() => {});
