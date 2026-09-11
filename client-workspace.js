import { auth, db } from "./firebase-config.js";
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { $, currency, date, element, message, metadata, millis, ticketPriorities, ticketStatuses, ticketTypes } from "./portal-shared.js";
import { bindClientComposer, validClientEmail, watchClientMessages } from "./client-messages.js";
import { quoteSummary } from "./quote-summary.js";

export async function linkProjectToClient(leadId, clientId) {
  await runTransaction(db, async transaction => {
    const ref = doc(db, "leads", leadId); const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("This project no longer exists.");
    if (clientId) {
      const client = await transaction.get(doc(db, "users", clientId));
      if (!client.exists() || client.data().role !== "customer") throw new Error("Select an existing customer account.");
    }
    const changes = { customerId: clientId || null, updatedAt: serverTimestamp() };
    transaction.update(ref, changes);
    const summary = doc(db, "customerQuotes", leadId);
    if (clientId) transaction.set(summary, quoteSummary({ ...snapshot.data(), ...changes }));
    else transaction.delete(summary);
  });
}

const tabs = { overview: "Overview", projects: "Projects", messages: "Messages", support: "Support", notes: "Private Notes", activity: "Activity" };
const byNewest = (a, b) => millis(b.createdAt) - millis(a.createdAt);
const isOpenTicket = ticket => ["open", "in-review", "working"].includes(ticket.status);
const labelStatus = status => String(status || "new").replaceAll("-", " ");

export function createClientWorkspace({ getAccounts, getLeads, openLead, onMetrics }) {
  let tickets = []; let conversations = new Map(); let notes = []; let messages = [];
  let subscriptions = []; let stopNotes = () => {}; let reader; let composer;
  let clientId = ""; let tab = "overview"; let noteId = ""; let noteBusy = false; let generation = 0;
  let ticketsReady = false; let messagesReady = false;
  const supportPreviews = new Map(); const supportReaders = new Map();
  let requestedClient = new URLSearchParams(location.search).get("client");
  const dialog = element("dialog", "", "crm-dialog client-workspace"); dialog.id = "clientWorkspace";
  dialog.setAttribute("aria-labelledby", "clientWorkspaceTitle");
  // Static interface only. Firestore content is always inserted with textContent.
  dialog.innerHTML = `
    <div class="crm-dialog-shell">
      <header class="crm-dialog-header"><div><span class="crm-eyebrow">Client Workspace</span><h2 id="clientWorkspaceTitle"></h2><p id="clientWorkspaceSubtitle"></p></div><button type="button" class="crm-secondary-button" id="closeClientWorkspace">Close Workspace</button></header>
      <div class="client-actions"><button type="button" class="crm-primary-button" data-client-action="message">Message Client</button><button type="button" class="crm-secondary-button" id="clientEmailAction" data-client-action="email">Email Client</button><button type="button" class="crm-secondary-button" id="clientBothAction" data-client-action="both">Website + Email</button><button type="button" class="crm-secondary-button" data-client-action="projects">View Projects</button><button type="button" class="crm-secondary-button" data-client-action="notes">Add Private Note</button></div>
      <p id="clientEmailWarning" class="crm-status" hidden>No valid customer email is available.</p>
      <nav class="client-tabs" role="tablist" aria-label="Client workspace">${Object.entries(tabs).map(([id, name]) => `<button type="button" id="clientTab-${id}" role="tab" aria-controls="clientPanel-${id}" data-tab="${id}">${name}${id === "messages" ? ' <span id="clientTabUnread"></span>' : ""}</button>`).join("")}</nav>
      <p class="crm-status" id="clientWorkspaceStatus" role="status" aria-live="polite"></p>
      ${Object.entries(tabs).map(([id]) => `<section id="clientPanel-${id}" role="tabpanel" aria-labelledby="clientTab-${id}" tabindex="0" hidden></section>`).join("")}
    </div>`;
  document.body.append(dialog);
  $("clientPanel-overview").innerHTML = '<div id="clientProfile"></div><div class="client-summary" id="clientSummary"></div><div class="client-recent" id="clientRecent"></div>';
  $("clientPanel-messages").innerHTML = '<h3>Messages</h3><p>Ongoing client communication with SilverForge.</p><div id="clientMessages" class="client-conversation" aria-label="Client conversation"></div><p id="clientMessagesStatus" class="crm-status" role="status"></p><form id="clientMessageForm" class="crm-form"><label class="crm-field" for="clientMessageText"><span>Message to client</span><textarea id="clientMessageText" maxlength="5000" rows="5" required></textarea></label><div class="client-actions"><button type="submit" class="crm-primary-button">Send Website Message</button><button type="button" class="crm-secondary-button" id="clientSendEmail">Send Email</button><button type="button" class="crm-secondary-button" id="clientSendBoth">Send Website + Email</button></div><p class="crm-status" id="clientSendStatus" role="status" aria-live="polite"></p><p>Email actions open a draft in your email app. Send the draft there to deliver it.</p></form>';
  $("clientPanel-notes").innerHTML = '<h3>Private Notes</h3><p>Only active SilverForge administrators can access these notes.</p><form id="clientNoteForm" class="crm-form"><label class="crm-field" for="clientNoteText"><span>Private note</span><textarea id="clientNoteText" rows="5" maxlength="10000" required></textarea></label><div class="client-actions"><button type="submit" class="crm-primary-button" id="clientSaveNote">Add Note</button><button type="button" class="crm-secondary-button" id="clientCancelNote" hidden>Cancel Edit</button></div><p class="crm-status" id="clientNoteStatus" role="status" aria-live="polite"></p></form><div id="clientNotesList" class="client-records"></div>';
  const profile = () => getAccounts().find(account => account.id === clientId);
  const projects = () => getLeads().filter(lead => lead.customerId === clientId).sort(byNewest);
  const support = () => tickets.filter(ticket => ticket.ownerId === clientId).sort(byNewest);
  function accountMetrics(uid) {
    const conv = conversations.get(uid);
    return { projects: getLeads().filter(lead => lead.customerId === uid).length,
      support: ticketsReady ? tickets.filter(ticket => ticket.ownerId === uid && isOpenTicket(ticket)).length : "—",
      unread: messagesReady ? (conv && millis(conv.lastCustomerMessageAt) > millis(conv.adminReadAt) ? "New" : "0") : "—" };
  }
  function setTab(value) {
    tab = value;
    for (const id of Object.keys(tabs)) {
      $("clientPanel-" + id).hidden = id !== tab; $("clientTab-" + id).setAttribute("aria-selected", String(id === tab)); $("clientTab-" + id).tabIndex = id === tab ? 0 : -1;
    }
    if (tab === "messages") reader?.refreshRead();
  }
  function close() {
    generation++; clientId = ""; stopNotes(); reader?.stop(); composer?.stop(); reader = null; composer = null;
    notes = []; messages = []; resetNote(); dialog.close();
    supportReaders.forEach(stop => stop()); supportReaders.clear(); supportPreviews.clear();
  }
  function syncSupportPreviews() {
    const ids = new Set(support().map(ticket => ticket.id));
    for (const [id, stop] of supportReaders) if (!ids.has(id)) { stop(); supportReaders.delete(id); supportPreviews.delete(id); }
    const current = generation;
    for (const id of ids) if (!supportReaders.has(id)) {
      supportReaders.set(id, onSnapshot(query(collection(db, "supportTickets", id, "messages"), orderBy("createdAt", "desc"), limit(1)), snapshot => {
        if (generation !== current) return;
        supportPreviews.set(id, snapshot.empty ? "No messages yet." : snapshot.docs[0].data().message); render();
      }, error => {
        console.error("Support message preview failed:", error);
        if (generation === current) { supportPreviews.set(id, "Message preview unavailable. Open the request to retry."); render(); }
      }));
    }
  }
  function record(title, entries, text = "") {
    const node = element("article", "", "client-record"); node.append(element("h3", title), metadata(entries));
    if (text) node.append(element("p", text, "client-body")); return node;
  }
  function render() {
    const client = profile(); if (!client) { if (clientId) close(); return; }
    $("clientWorkspaceTitle").textContent = client.name || client.displayName || "Client";
    $("clientWorkspaceSubtitle").textContent = [client.business, client.email].filter(Boolean).join(" · ");
    $("clientProfile").replaceChildren(metadata([["Client", client.name], ["Business", client.business], ["Email", client.email], ["Role", client.role], ["Status", client.status], ["Account created", date(client.createdAt)], ["Firebase UID", client.id]]));
    const noEmail = !validClientEmail(client.email); $("clientEmailWarning").hidden = !noEmail;
    $("clientEmailAction").disabled = noEmail; $("clientBothAction").disabled = noEmail; composer?.updateButtons();
    const work = projects(); const requests = support(); const unread = messages.filter(item => item.senderRole === "customer" && !item.readByAdmin).length;
    $("clientTabUnread").textContent = unread ? `(${unread} unread)` : "";
    $("clientSummary").replaceChildren();
    for (const [name, total] of [["Total Projects", work.length], ["Active Projects", work.filter(item => ["accepted", "in-progress"].includes(item.status)).length], ["Completed Projects", work.filter(item => item.status === "completed").length], ["Open Support Requests", requests.filter(isOpenTicket).length], ["Unread Messages", unread], ["Private Notes", notes.length]]) {
      const card = element("article", ""); card.append(element("span", name), element("strong", String(total))); $("clientSummary").append(card);
    }
    $("clientRecent").replaceChildren();
    for (const [name, text] of [["Recent project", work[0]?.business], ["Recent support request", requests[0]?.title], ["Recent message", messages.at(-1)?.message], ["Recent private note", notes[0]?.text]]) {
      const card = element("article", "", "client-record"); card.append(element("h3", name), element("p", text?.slice(0, 200) || "None yet", "client-body")); $("clientRecent").append(card);
    }
    const projectPanel = $("clientPanel-projects"); projectPanel.replaceChildren(element("h3", "Projects / Quotes"));
    if (!work.length) projectPanel.append(element("p", "No linked projects. Use Link Project to Client in a lead to connect existing work."));
    for (const lead of work) {
      const card = record(lead.business || lead.service, [["Service", lead.service], ["Status", labelStatus(lead.status)], ["Quote", currency(lead.quoteAmount)], ["Created", date(lead.createdAt)], ["Follow-up", lead.followUpDate || "None"], ["Last updated", date(lead.updatedAt)]], lead.message);
      const button = element("button", "Open Project", "crm-secondary-button"); button.type = "button"; button.addEventListener("click", () => openLead(lead.id));
      card.classList.add("client-project"); card.tabIndex = 0; card.setAttribute("aria-label", `Open project: ${lead.business || lead.service}`);
      card.addEventListener("click", event => { if (!event.target.closest("button")) openLead(lead.id); });
      card.addEventListener("keydown", event => { if (event.target === card && ["Enter", " "].includes(event.key)) { event.preventDefault(); openLead(lead.id); } });
      card.append(button); projectPanel.append(card);
    }
    const supportPanel = $("clientPanel-support"); supportPanel.replaceChildren(element("h3", "Support Requests"));
    if (!requests.length) supportPanel.append(element("p", "No support requests for this client."));
    for (const ticket of requests) {
      const card = record(ticket.title, [["Request type", ticketTypes[ticket.type]], ["Project", ticket.projectName], ["Status", ticketStatuses[ticket.status]], ["Priority", ticketPriorities[ticket.priority]], ["Created", date(ticket.createdAt)], ["Last updated", date(ticket.updatedAt)], ["Last message", date(ticket.lastMessageAt)]], (supportPreviews.get(ticket.id) || "Loading last message...").slice(0, 500));
      const link = element("a", "Open Support Conversation", "crm-secondary-button"); link.href = `crm-support.html?ticket=${encodeURIComponent(ticket.id)}&client=${encodeURIComponent(clientId)}`; card.append(link); supportPanel.append(card);
    }
    renderNotes(); renderActivity(client, work, requests);
  }
  function resetNote() { noteId = ""; $("clientNoteForm").reset(); $("clientSaveNote").textContent = "Add Note"; $("clientCancelNote").hidden = true; }
  function renderNotes() {
    $("clientNotesList").replaceChildren();
    if (!notes.length) $("clientNotesList").append(element("p", "No private notes yet."));
    for (const note of notes) {
      const card = record("Private note", [["Created", date(note.createdAt)], ["Updated", date(note.updatedAt)], ["Created by", note.createdByEmail || note.createdBy]], note.text);
      const actions = element("div", "", "client-actions");
      const edit = element("button", "Edit Note", "crm-secondary-button"); edit.type = "button"; edit.disabled = noteBusy;
      edit.addEventListener("click", () => { noteId = note.id; $("clientNoteText").value = note.text; $("clientSaveNote").textContent = "Save Note"; $("clientCancelNote").hidden = false; $("clientNoteText").focus(); });
      const remove = element("button", "Delete Note", "crm-danger-button"); remove.type = "button"; remove.disabled = noteBusy;
      remove.addEventListener("click", async () => {
        if (noteBusy || !confirm("Delete this private note? This cannot be undone.")) return;
        const uid = clientId; const current = generation; noteBusy = true; renderNotes();
        try { await deleteDoc(doc(db, "users", uid, "adminNotes", note.id)); if (current === generation) { if (noteId === note.id) resetNote(); message($("clientNoteStatus"), "Note deleted.", "success"); } }
        catch (error) { console.error("Private note deletion failed:", error); if (current === generation) message($("clientNoteStatus"), "Note could not be deleted.", "error"); }
        finally { noteBusy = false; if (current === generation) renderNotes(); }
      });
      actions.append(edit, remove); card.append(actions); $("clientNotesList").append(card);
    }
  }
  function renderActivity(client, work, requests) {
    const events = [{ at: client.createdAt, text: "Account created" }];
    for (const lead of work) {
      events.push({ at: lead.createdAt, text: `Quote submitted: ${lead.business}` });
      if (millis(lead.updatedAt) > millis(lead.createdAt)) events.push({ at: lead.updatedAt, text: `Project updated — current status: ${labelStatus(lead.status)} · ${lead.business}` });
      if (lead.lastEmailMarkedSentAt) events.push({ at: lead.lastEmailMarkedSentAt, text: `Email marked sent: ${lead.lastEmailSubject}` });
    }
    for (const ticket of requests) { events.push({ at: ticket.createdAt, text: `Support request created: ${ticket.title}` }); if (millis(ticket.updatedAt) > millis(ticket.createdAt)) events.push({ at: ticket.updatedAt, text: `Support updated — current status: ${ticketStatuses[ticket.status]} · ${ticket.title}` }); }
    messages.forEach(item => events.push({ at: item.createdAt, text: `Website message ${item.senderRole === "admin" ? "sent" : "received"}: ${item.message.slice(0, 160)}` }));
    notes.forEach(note => { events.push({ at: note.createdAt, text: `Private note added by ${note.createdByEmail || note.createdBy}` }); if (millis(note.updatedAt) > millis(note.createdAt)) events.push({ at: note.updatedAt, text: "Private note edited" }); });
    const panel = $("clientPanel-activity"); panel.replaceChildren(element("h3", "Activity"), element("p", "Based on available timestamps. Project and support updates show their current status, not a full status-change audit."));
    const list = element("ol", "", "client-timeline");
    events.sort((a, b) => millis(b.at) - millis(a.at)).forEach(event => { const item = element("li", ""); item.append(element("small", date(event.at)), element("p", event.text)); list.append(item); }); panel.append(list);
  }
  function open(uid) {
    close(); const client = getAccounts().find(account => account.id === uid); if (!client || client.role !== "customer") return;
    clientId = uid; const current = generation;
    message($("clientWorkspaceStatus"), ""); message($("clientNoteStatus"), ""); message($("clientSendStatus"), "");
    render(); setTab("overview"); dialog.showModal(); syncSupportPreviews();
    reader = watchClientMessages(uid, "admin", { list: $("clientMessages"), status: $("clientMessagesStatus"), isOpen: () => dialog.open && tab === "messages", onChange: items => { if (current === generation) { messages = items; render(); } } });
    composer = bindClientComposer(uid, auth.currentUser, "admin", { form: $("clientMessageForm"), input: $("clientMessageText"), status: $("clientSendStatus"), getProfile: profile, emailButton: $("clientSendEmail"), bothButton: $("clientSendBoth") });
    stopNotes = onSnapshot(collection(db, "users", uid, "adminNotes"), snapshot => {
      if (current !== generation) return; notes = snapshot.docs.map(item => ({ ...item.data(), id: item.id })).sort(byNewest); render();
    }, error => { console.error("Private notes failed:", error); if (current === generation) { notes = []; render(); message($("clientNoteStatus"), "Private notes could not be loaded. Reopen the workspace to retry.", "error"); } });
  }
  $("clientNoteForm").addEventListener("submit", async event => {
    event.preventDefault(); const text = $("clientNoteText").value.trim();
    if (!clientId || noteBusy || !text || !event.currentTarget.reportValidity()) return;
    const uid = clientId; const current = generation; const editId = noteId;
    noteBusy = true; $("clientSaveNote").disabled = true; renderNotes(); message($("clientNoteStatus"), "Saving note...");
    try {
      if (editId) await updateDoc(doc(db, "users", uid, "adminNotes", editId), { text, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, "users", uid, "adminNotes"), { text, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: auth.currentUser.uid, createdByEmail: auth.currentUser.email });
      if (current === generation) { resetNote(); message($("clientNoteStatus"), "Private note saved.", "success"); }
    } catch (error) { console.error("Private note save failed:", error); if (current === generation) message($("clientNoteStatus"), "Note could not be saved. Your text is still here.", "error"); }
    finally { noteBusy = false; $("clientSaveNote").disabled = false; if (current === generation) renderNotes(); }
  });
  $("clientCancelNote").addEventListener("click", resetNote);
  $("closeClientWorkspace").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
    button.addEventListener("keydown", event => {
      const ids = Object.keys(tabs); let index = ids.indexOf(tab);
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); index = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
      setTab(ids[index]); $("clientTab-" + tab).focus();
    });
  });
  dialog.querySelectorAll("[data-client-action]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.clientAction; setTab(["projects", "notes"].includes(action) ? action : "messages");
    if (action === "notes") { resetNote(); $("clientNoteText").focus(); }
    else if (action !== "projects") { $("clientMessageText").focus(); if (action !== "message") message($("clientSendStatus"), `Write your message, then choose ${action === "email" ? "Send Email" : "Send Website + Email"}.`); }
  }));
  function refresh() { render(); if (requestedClient && getAccounts().length) { const uid = requestedClient; requestedClient = null; open(uid); } }
  function start() {
    if (subscriptions.length) return;
    const fail = error => { console.error("Client workspace summary failed:", error); message($("accountWorkspaceStatus"), "Project, support or unread counts could not be loaded. Refresh to retry.", "error"); };
    subscriptions.push(onSnapshot(collection(db, "supportTickets"), snapshot => { tickets = snapshot.docs.map(item => ({ ...item.data(), id: item.id })); ticketsReady = true; onMetrics(); if (clientId) syncSupportPreviews(); render(); }, fail));
    subscriptions.push(onSnapshot(collection(db, "clientConversations"), snapshot => { conversations = new Map(snapshot.docs.map(item => [item.id, item.data()])); messagesReady = true; onMetrics(); }, fail));
  }
  function stop() { close(); subscriptions.forEach(unsubscribe => unsubscribe()); subscriptions = []; tickets = []; conversations.clear(); ticketsReady = false; messagesReady = false; }
  return { open, refresh, start, stop, accountMetrics };
}
