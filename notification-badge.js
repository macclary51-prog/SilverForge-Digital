import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export function watchUnreadNotifications(callback, onError = () => {}) {
  let count = 0; let enabled = true;
  const emit = () => callback(enabled ? count : 0);
  const stops = [
    onSnapshot(query(collection(db, "adminNotifications"), where("read", "==", false)), snapshot => { count = snapshot.docs.filter(item => item.data().dashboardEnabled).length; emit(); }, onError),
    onSnapshot(doc(db, "adminSettings", "notifications"), snapshot => { enabled = snapshot.exists() ? snapshot.data().channels?.dashboard === true : true; emit(); }, onError)
  ];
  return () => stops.forEach(stop => stop());
}
const badges = [...document.querySelectorAll("[data-notification-badge]")];
if (badges.length && isFirebaseConfigured && auth && db) {
  let stopRole = () => {}; let stopCount = () => {};
  const display = count => badges.forEach(node => { node.textContent = count ? `(${count})` : ""; });
  const stopAuth = onAuthStateChanged(auth, user => {
    stopRole(); stopCount(); display(0);
    if (!user) return;
    stopRole = onSnapshot(doc(db, "roles", user.uid), snapshot => {
      stopCount(); display(0);
      if (snapshot.data()?.role === "admin" && snapshot.data()?.active === true) stopCount = watchUnreadNotifications(display, () => display(0));
    }, () => { stopCount(); display(0); });
  });
  window.addEventListener("beforeunload", () => { stopAuth(); stopRole(); stopCount(); });
}
