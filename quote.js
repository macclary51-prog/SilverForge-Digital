import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { quoteSummary } from "./quote-summary.js";
import { $, services, message } from "./portal-shared.js";

const form = $("quoteForm");
const status = $("formMessage");
const email = $("email");
const button = form.querySelector('button[type="submit"]');
let currentUser = null;
let busy = false;
button.disabled = true;
function syncEmail() {
  email.readOnly = Boolean(currentUser);
  if (currentUser) email.value = currentUser.email || "";
  $("quoteAccountNote").textContent = currentUser
    ? "This quote will appear in your Client Dashboard and use your account email."
    : "You can request a quote without an account. Sign in first to track this quote in your Client Dashboard.";
}
if (!isFirebaseConfigured || !auth || !db) {
  message(status, "Quote requests are temporarily unavailable. Please try again later.", "error");
} else {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    syncEmail();
    button.disabled = busy;
  }, () => message(status, "Sign-in state could not be checked. Refresh to try again.", "error"));
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || button.disabled) return;
  syncEmail();
  if (!form.reportValidity()) return;
  const fields = new FormData(form);
  if (fields.get("_honey")) return;
  const data = Object.fromEntries(["name", "business", "email", "phone", "service", "message"].map(key => [key, String(fields.get(key) || "").trim()]));
  if (Object.values(data).some(value => !value) || !services.includes(data.service)) {
    message(status, "Complete every required field.", "error"); return;
  }
  busy = true;
  button.disabled = true;
  message(status, "Sending your project request...");
  try {
    // Read the current auth identity at submission; never trust a form UID/email.
    const user = auth.currentUser;
    const lead = {
      ...data, email: user ? user.email : data.email, customerId: user ? user.uid : null,
      status: "new", quoteAmount: null, followUpDate: "", internalNotes: "",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    const ref = doc(collection(db, "leads"));
    const batch = writeBatch(db);
    batch.set(ref, lead);
    if (user) batch.set(doc(db, "customerQuotes", ref.id), quoteSummary(lead));
    await batch.commit();
    form.reset(); syncEmail();
    message(status, "Thank you. Your project quote request was sent successfully.", "success");
  } catch {
    message(status, "The quote request could not be sent. Please try again.", "error");
  } finally { busy = false; button.disabled = false; }
});
