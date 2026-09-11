import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { $, conversation, date, element, message, metadata, millis, options, ticketPriorities, ticketStatuses, ticketTypes } from "./portal-shared.js";

let user = null;
let tickets = [];
let contacts = [];
let selectedId = "";
let contactId = "";
let subscriptions = [];
let stopRole = () => {};
let stopConversation = () => {};
let adminDirty = false;
let adminBusy = false;
let redirecting = false;
options($("ticketFilter"), ticketStatuses); options($("ticketStatus"), ticketStatuses); options($("ticketPriority"), ticketPriorities);

function closeTicket() { selectedId = ""; stopConversation(); $("ticketDetail").hidden = true; }
function closeContact() { contactId = ""; $("contactDetail").hidden = true; }
function clearAccess() {
  subscriptions.forEach(stop => stop()); subscriptions = [];
  closeTicket(); closeContact(); tickets = []; contacts = [];
  $("supportList").replaceChildren(); $("contactList").replaceChildren();
  $("supportApp").hidden = true; $("accessGate").hidden = false;
}
function deny() {
  if (redirecting) return;
  redirecting = true;
  clearAccess();
  window.location.replace("crm-login.html?reason=unauthorized");
}
function detail(ticket) {
  $("ticketDetailTitle").textContent = ticket.title; $("ticketDetails").textContent = ticket.details;
  $("ticketDetailMeta").replaceChildren(ticketMeta(ticket));
  if (!adminDirty && !adminBusy) { $("ticketStatus").value = ticket.status; $("ticketPriority").value = ticket.priority; }
}
function ticketMeta(ticket) {
  return metadata([["Client", ticket.ownerName], ["Email", ticket.ownerEmail], ["Project", ticket.projectName], ["Type", ticketTypes[ticket.type]], ["Status", ticketStatuses[ticket.status]], ["Priority", ticketPriorities[ticket.priority]], ["Created", date(ticket.createdAt)], ["Last message", date(ticket.lastMessageAt)]]);
}
function openTicket(id) {
  const ticket = tickets.find(item => item.id === id); if (!ticket) return;
  closeTicket(); selectedId = id; adminDirty = false;
  detail(ticket); message($("ticketAdminStatus"), ""); $("ticketDetail").hidden = false;
  stopConversation = conversation(id, user, "admin", { list: $("ticketMessages"), form: $("ticketReplyForm"), input: $("ticketReply"), status: $("ticketMessageStatus") });
  $("ticketDetail").focus();
}
function renderTickets() {
  const search = $("ticketSearch").value.trim().toLowerCase(); const filter = $("ticketFilter").value;
  const filtered = tickets.filter(ticket => (filter === "all" || ticket.status === filter) && [ticket.ownerName, ticket.ownerEmail, ticket.projectName, ticket.title, ticketTypes[ticket.type]].join(" ").toLowerCase().includes(search));
  $("supportList").replaceChildren();
  message($("supportListStatus"), filtered.length ? `${filtered.length} support request(s)` : "No support requests match.");
  for (const ticket of filtered) {
    const card = element("article", "", "portal-record"); const open = element("button", "Open Request", "secondary-button");
    open.type = "button"; open.addEventListener("click", () => openTicket(ticket.id));
    card.append(element("h3", ticket.title), ticketMeta(ticket), open); $("supportList").append(card);
  }
}
function contactDetail(contact) {
  $("contactTitle").textContent = contact.subject; $("contactBody").textContent = contact.message;
  $("contactMeta").replaceChildren(metadata([["Name", contact.name], ["Email", contact.email], ["Message type", contact.category], ["Status", contact.status], ["Received", date(contact.createdAt)]]));
  $("contactEmail").href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Re: ${contact.subject}`)}`;
  $("closeContactMessage").disabled = contact.status === "closed";
}
function renderContacts() {
  $("contactList").replaceChildren();
  message($("contactListStatus"), contacts.length ? "" : "No general contact messages yet.");
  for (const contact of contacts) {
    const card = element("article", "", "portal-record"); const open = element("button", "Read Message", "secondary-button");
    open.type = "button";
    open.addEventListener("click", () => { contactId = contact.id; contactDetail(contact); message($("contactActionStatus"), ""); $("contactDetail").hidden = false; $("contactDetail").focus(); });
    card.append(element("h3", contact.subject), metadata([["From", `${contact.name} (${contact.email})`], ["Type", contact.category], ["Status", contact.status], ["Received", date(contact.createdAt)]]), open);
    $("contactList").append(card);
  }
}
function subscribe() {
  message($("supportListStatus"), "Loading requests..."); message($("contactListStatus"), "Loading messages...");
  subscriptions.push(onSnapshot(collection(db, "supportTickets"), snapshot => {
    tickets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) => millis(b.lastMessageAt) - millis(a.lastMessageAt));
    $("openSupportCount").textContent = tickets.filter(t => ["open", "in-review"].includes(t.status)).length;
    $("workingCount").textContent = tickets.filter(t => t.status === "working").length;
    $("resolvedCount").textContent = tickets.filter(t => t.status === "resolved").length;
    renderTickets();
    if (selectedId) { const ticket = tickets.find(t => t.id === selectedId); if (ticket) detail(ticket); else closeTicket(); }
  }, error => { if (error.code === "permission-denied") deny(); else message($("supportListStatus"), "Support requests could not be loaded. Refresh to retry.", "error"); }));
  subscriptions.push(onSnapshot(collection(db, "contactMessages"), snapshot => {
    contacts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    $("contactCount").textContent = contacts.length; renderContacts();
    if (contactId) { const contact = contacts.find(c => c.id === contactId); if (contact) contactDetail(contact); else closeContact(); }
  }, error => { if (error.code === "permission-denied") deny(); else message($("contactListStatus"), "General messages could not be loaded. Refresh to retry.", "error"); }));
}
$("ticketSearch").addEventListener("input", renderTickets); $("ticketFilter").addEventListener("change", renderTickets);
$("closeTicket").addEventListener("click", closeTicket); $("closeContact").addEventListener("click", closeContact);
$("ticketAdminForm").addEventListener("input", () => { adminDirty = true; });
$("ticketAdminForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!selectedId || adminBusy) return;
  const id = selectedId; const button = event.currentTarget.querySelector('button[type="submit"]');
  const status = $("ticketStatus").value; const priority = $("ticketPriority").value;
  if (!ticketStatuses[status] || !ticketPriorities[priority]) return;
  adminBusy = true; button.disabled = true; message($("ticketAdminStatus"), "Saving...");
  try {
    await updateDoc(doc(db, "supportTickets", id), { status, priority, updatedAt: serverTimestamp() });
    if (selectedId === id) { adminDirty = false; message($("ticketAdminStatus"), "Request updated.", "success"); }
  } catch { if (selectedId === id) message($("ticketAdminStatus"), "The update could not be saved. Please try again.", "error"); }
  finally { adminBusy = false; button.disabled = false; }
});
$("closeContactMessage").addEventListener("click", async () => {
  if (!contactId) return; const id = contactId; $("closeContactMessage").disabled = true;
  try {
    await updateDoc(doc(db, "contactMessages", id), { status: "closed", updatedAt: serverTimestamp() });
    if (contactId === id) message($("contactActionStatus"), "Message marked closed.", "success");
  } catch { if (contactId === id) { $("closeContactMessage").disabled = false; message($("contactActionStatus"), "Message could not be closed. Please try again.", "error"); } }
});
$("signOutButton").addEventListener("click", async () => {
  try { await signOut(auth); } catch { message($("accessMessage"), "Sign out failed. Please try again.", "error"); }
});
if (!isFirebaseConfigured || !auth || !db) {
  $("accessMessage").textContent = "Support inbox is temporarily unavailable.";
} else {
  onAuthStateChanged(auth, current => {
    stopRole(); clearAccess(); user = current;
    if (!user) { window.location.replace("crm-login.html"); return; }
    const uid = user.uid;
    // Observe the same roles/{uid} admin + active fields used by the Lead CRM.
    stopRole = onSnapshot(doc(db, "roles", uid), snapshot => {
      if (auth.currentUser?.uid !== uid) return;
      const role = snapshot.exists() ? snapshot.data() : null;
      if (role?.role !== "admin" || role?.active !== true) { deny(); return; }
      $("adminEmail").textContent = user.email || "Administrator";
      $("accessGate").hidden = true; $("supportApp").hidden = false;
      if (!subscriptions.length) subscribe();
    }, deny);
  });
}
window.addEventListener("beforeunload", () => { stopRole(); clearAccess(); });
