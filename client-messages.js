import { db } from "./firebase-config.js";
import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { date, element, message, millis } from "./portal-shared.js";

export const validClientEmail = value => typeof value === "string" && value.length <= 254 && /^[^@\s?&#]+@[^@\s?&#]+\.[^@\s?&#]+$/.test(value);
export function emailDraft(email, text, business = "") {
  if (!validClientEmail(email)) throw new Error("No valid customer email is available.");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`SilverForge Digital Solutions${business ? ` — ${business}` : ""}`)}&body=${encodeURIComponent(text)}`;
}
export function openEmailDraft(href) {
  const link = document.createElement("a");
  link.href = href; document.body.append(link); link.click(); link.remove();
}

// Retry against the latest metadata when both participants send at once.
// The message and its conversation preview must be committed together.
export async function sendClientMessage(clientId, user, role, text) {
  text = text.trim();
  if (!text || text.length > 5000) throw new Error("Enter a message of 1–5,000 characters.");
  const parent = doc(db, "clientConversations", clientId);
  const record = doc(collection(parent, "messages"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(parent);
    const profile = await transaction.get(doc(db, "users", clientId));
    if (!profile.exists() || profile.data().role !== "customer") throw new Error("This customer account is unavailable.");
    const client = profile.data(); const old = previous.data(); const epoch = Timestamp.fromMillis(0);
    transaction.set(record, {
      senderId: user.uid, senderRole: role, senderName: role === "admin" ? "SilverForge" : client.name,
      message: text, createdAt: serverTimestamp(), readByAdmin: role === "admin", readByClient: role === "customer"
    });
    transaction.set(parent, {
      clientId, clientName: client.name, clientEmail: client.email,
      createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(), lastMessagePreview: text, lastSenderRole: role, lastMessageId: record.id,
      lastCustomerMessageAt: role === "customer" ? serverTimestamp() : (old?.lastCustomerMessageAt || epoch),
      lastAdminMessageAt: role === "admin" ? serverTimestamp() : (old?.lastAdminMessageAt || epoch),
      adminReadAt: old?.adminReadAt || epoch, clientReadAt: old?.clientReadAt || epoch
    });
  });
}

export function watchClientMessages(clientId, role, { list, status, onChange = () => {}, isOpen = () => true }) {
  let records = []; let stopped = false; let marking = false; let readFailed = false; let acknowledgedAt = 0;
  const flag = role === "admin" ? "readByAdmin" : "readByClient";
  const readAt = role === "admin" ? "adminReadAt" : "clientReadAt";
  const parent = doc(db, "clientConversations", clientId);
  message(status, "Loading messages...");
  async function markRead() {
    if (stopped || marking || readFailed || !isOpen() || document.visibilityState !== "visible") return;
    const incoming = records.filter(item => item.senderRole !== role && item.createdAt);
    const unread = incoming.filter(item => !item[flag]);
    const latest = incoming.at(-1)?.createdAt;
    if (!latest || (!unread.length && millis(latest) <= acknowledgedAt)) return;
    marking = true;
    try {
      // Small batches keep rule document lookups below the atomic-write budget.
      for (let offset = 0; offset < unread.length && !stopped; offset += 10) {
        const chunk = unread.slice(offset, offset + 10); const batch = writeBatch(db);
        chunk.forEach(item => batch.update(doc(parent, "messages", item.id), { [flag]: true }));
        await batch.commit();
      }
      if (!stopped) await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(parent); if (!snapshot.exists()) return;
        if (millis(latest) > millis(snapshot.data()[readAt])) transaction.update(parent, { [readAt]: latest });
      });
      acknowledgedAt = millis(latest);
    } catch (error) {
      readFailed = true; console.error("Client message read receipt failed:", error);
      message(status, "Messages loaded, but read status could not be saved. Reopen the conversation to retry.", "error");
    } finally { marking = false; if (!readFailed) void markRead(); }
  }
  const stop = onSnapshot(query(collection(parent, "messages"), orderBy("createdAt", "asc")), snapshot => {
    records = snapshot.docs.map(record => ({ ...record.data(), id: record.id }));
    const scroll = list.scrollTop; const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren(); list.dataset.viewer = role;
    for (const item of records) {
      const bubble = element("article", "", `client-message ${item.senderRole === role ? "client-message-own" : "client-message-other"}`);
      const receipt = item.senderRole === role ? (item[role === "admin" ? "readByClient" : "readByAdmin"] ? " · Read" : " · Sent") : "";
      bubble.append(element("strong", item.senderRole === "admin" ? "SilverForge" : item.senderName), element("p", item.message), element("small", `${date(item.createdAt)}${receipt}`));
      list.append(bubble);
    }
    list.scrollTop = nearEnd ? list.scrollHeight : scroll;
    message(status, records.length ? "" : "No messages yet. Start a conversation below.");
    onChange(records); void markRead();
  }, error => {
    console.error("Client conversation failed:", error); records = []; list.replaceChildren(); onChange(records);
    message(status, "Messages could not be loaded. Check your connection and access, then reopen.", "error");
  });
  const refresh = () => { readFailed = false; void markRead(); };
  document.addEventListener("visibilitychange", refresh);
  return { refreshRead: refresh, stop: () => { stopped = true; stop(); document.removeEventListener("visibilitychange", refresh); list.replaceChildren(); } };
}

export function bindClientComposer(clientId, user, role, { form, input, status, getProfile, emailButton, bothButton }) {
  let busy = false; let stopped = false;
  const sendButton = form.querySelector('button[type="submit"]');
  function updateButtons() {
    sendButton.disabled = busy;
    for (const button of [emailButton, bothButton]) if (button) button.disabled = busy || !validClientEmail(getProfile()?.email);
  }
  async function send(mode) {
    if (busy || !form.reportValidity()) return;
    const text = input.value.trim();
    if (!text) { message(status, "Enter a message.", "error"); return; }
    const profile = getProfile(); let href;
    try { if (mode !== "website") href = emailDraft(profile?.email, text, profile?.business); }
    catch (error) { message(status, error.message, "error"); return; }
    busy = true; updateButtons(); message(status, mode === "email" ? "Opening email draft..." : "Saving website message...");
    let saved = false;
    try {
      if (mode !== "email") { await sendClientMessage(clientId, user, role, text); saved = true; }
      if (stopped) return;
      if (href) openEmailDraft(href);
      if (saved && input.value.trim() === text) input.value = "";
      message(status, mode === "website" ? "Website message sent." : `${saved ? "Website message saved. " : ""}Email draft opened. Send it from your email app; email delivery is not tracked here.`, "success");
    } catch (error) {
      console.error("Client message action failed:", error);
      if (!stopped) message(status, saved ? "Website message saved, but the email app could not be opened. Use Send Email to try the email draft again." : "Message could not be sent. Your text is still here; please try again.", "error");
    } finally { busy = false; if (!stopped) updateButtons(); }
  }
  const submit = event => { event.preventDefault(); void send("website"); };
  const email = () => void send("email"); const both = () => void send("both");
  form.addEventListener("submit", submit); emailButton?.addEventListener("click", email); bothButton?.addEventListener("click", both); updateButtons();
  return { updateButtons, stop: () => { stopped = true; form.removeEventListener("submit", submit); emailButton?.removeEventListener("click", email); bothButton?.removeEventListener("click", both); form.reset(); } };
}
