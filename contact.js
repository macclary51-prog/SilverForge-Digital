import { db, isFirebaseConfigured } from "./firebase-config.js";
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { $, contactCategories, message } from "./portal-shared.js";

const form = $("generalContactForm");
const status = $("formMessage");
const button = form.querySelector('button[type="submit"]');
if (!isFirebaseConfigured || !db) {
  button.disabled = true;
  message(status, "Contact is temporarily unavailable. Please try again later.", "error");
} else { button.disabled = false; }
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled || !form.reportValidity()) return;
  const fields = new FormData(form);
  if (fields.get("_honey")) return;
  const data = Object.fromEntries(["name", "email", "category", "subject", "message"].map(key => [key, String(fields.get(key) || "").trim()]));
  if (Object.values(data).some(value => !value) || !contactCategories.includes(data.category)) {
    message(status, "Complete every required field.", "error"); return;
  }
  button.disabled = true;
  message(status, "Sending your message...");
  try {
    await addDoc(collection(db, "contactMessages"), { ...data, status: "new", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    form.reset();
    message(status, "Thank you. Your general contact message has been sent.", "success");
  } catch {
    message(status, "Your message could not be sent. Please try again.", "error");
  } finally { button.disabled = false; }
});
