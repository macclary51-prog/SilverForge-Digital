import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { deviceState } from './push-state.js';
export function protectPushSession(auth) {
  // Account changes outside the CRM also disable local push display.
  onAuthStateChanged(auth, async user => {
    try {
      const state = await deviceState();
      if (state?.enabled && state.uid !== user?.uid) {
        localStorage.setItem(`silverforge-push-optin:${state.uid}`, 'false');
        await deviceState({ ...state, enabled: false });
        if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistration('/'))?.active?.postMessage({ type: 'CLEAR_ADMIN_PUSH' });
      }
    } catch { /* Restricted browser storage must not break existing authentication. */ }
  });
}
