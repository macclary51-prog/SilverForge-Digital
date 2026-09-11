import { db } from "./firebase-config.js";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const ticketTypes = {
  "bug-fix": "Bug Fix", "redesign-change": "Redesign / Change",
  "feature-request": "Feature Request", "content-update": "Content Update",
  maintenance: "Maintenance / Update", "technical-issue": "Technical Issue",
  billing: "Billing / Service Question", other: "Other"
};
export const ticketStatuses = { open: "Open", "in-review": "In Review", working: "Working", resolved: "Resolved", closed: "Closed" };
export const ticketPriorities = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const contactCategories = ["General Question", "Billing Question", "Partnership / Business", "Existing Project Question", "Other"];
export const services = ["App Development", "Website Development", "Social Media Management", "Content and Video Creation", "Digital Advertising", "Multiple Services"];
export const $ = (id) => document.getElementById(id);
export function element(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
export function message(node, text, state = "") {
  node.textContent = text;
  node.dataset.state = state;
}
export function options(select, labels) {
  for (const [value, label] of Object.entries(labels)) {
    const option = element("option", label);
    option.value = value;
    select.append(option);
  }
}
export const millis = (timestamp) => timestamp?.toMillis?.() || 0;
export function date(timestamp) {
  return timestamp?.toDate ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp.toDate()) : "Just submitted";
}
export function currency(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value) : "Awaiting quote";
}
export function metadata(items) {
  const list = element("dl", "", "portal-metadata");
  for (const [label, value] of items) {
    const item = element("div", "");
    item.append(element("dt", label), element("dd", value || "—"));
    list.append(item);
  }
  return list;
}

// The batch keeps the ticket activity time and its immutable message together.
export async function sendTicketMessage(ticketId, user, senderRole, text) {
  const ticketRef = doc(db, "supportTickets", ticketId);
  const batch = writeBatch(db);
  batch.set(doc(collection(ticketRef, "messages")), {
    senderId: user.uid, senderRole,
    senderName: senderRole === "admin" ? "SilverForge" : (user.displayName || user.email || "Customer").slice(0, 254),
    message: text, createdAt: serverTimestamp()
  });
  batch.update(ticketRef, { updatedAt: serverTimestamp(), lastMessageAt: serverTimestamp() });
  await batch.commit();
}

// One binding per selected ticket. Disposing removes the listener and submit handler.
export function conversation(ticketId, user, senderRole, { list, form, input, status }) {
  let disposed = false;
  let busy = false;
  let loaded = false;
  const button = form.querySelector('button[type="submit"]');
  list.replaceChildren();
  message(status, "Loading conversation...");
  const unsubscribe = onSnapshot(query(collection(db, "supportTickets", ticketId, "messages"), orderBy("createdAt", "asc")), (snapshot) => {
    list.replaceChildren();
    for (const record of snapshot.docs) {
      const data = record.data();
      const bubble = element("article", "", `portal-message portal-message-${data.senderRole === "admin" ? "admin" : "customer"}`);
      bubble.append(element("strong", data.senderRole === "admin" ? "SilverForge" : data.senderName), element("p", data.message), element("small", date(data.createdAt)));
      list.append(bubble);
    }
    if (!loaded && !busy) message(status, snapshot.empty ? "No replies yet. Send a message below." : "");
    loaded = true;
  }, () => {
    list.replaceChildren();
    message(status, "Conversation could not be loaded. Check your connection and access, then reopen the request.", "error");
  });
  const submit = async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || !form.reportValidity()) return;
    if (!text) { message(status, "Enter a message.", "error"); return; }
    busy = true;
    button.disabled = true;
    message(status, "Sending...");
    try {
      await sendTicketMessage(ticketId, user, senderRole, text);
      if (!disposed) { form.reset(); message(status, "Message sent.", "success"); }
    } catch {
      if (!disposed) message(status, "Message could not be sent. Your text is still here; please try again.", "error");
    } finally {
      busy = false;
      if (!disposed) button.disabled = false;
    }
  };
  form.addEventListener("submit", submit);
  return () => { disposed = true; unsubscribe(); form.removeEventListener("submit", submit); form.reset(); button.disabled = false; list.replaceChildren(); };
}
