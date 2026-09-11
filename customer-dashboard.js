import { db } from "./firebase-config.js";
import { addDoc, collection, onSnapshot, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { $, conversation, currency, date, element, message, metadata, millis, options, ticketStatuses, ticketTypes } from "./portal-shared.js";

export function startCustomerDashboard(user, profile) {
  const subscriptions = [];
  let tickets = [];
  let selectedId = "";
  let stopConversation = () => {};
  let disposed = false;
  const form = $("newTicketForm");
  const button = form.querySelector('button[type="submit"]');
  $("dashboardAccountStatus").textContent = profile.status || "active";
  $("type").replaceChildren(); options($("type"), ticketTypes);
  message($("myQuotesStatus"), "Loading quotes...");
  message($("myTicketsStatus"), "Loading requests...");

  function closeTicket() {
    selectedId = "";
    stopConversation();
    $("ticketDetail").hidden = true;
  }
  function renderDetail(ticket) {
    $("ticketDetailTitle").textContent = ticket.title;
    $("ticketDetails").textContent = ticket.details;
    $("ticketDetailMeta").replaceChildren(metadata([
      ["Project", ticket.projectName], ["Request type", ticketTypes[ticket.type]],
      ["Status", ticketStatuses[ticket.status]], ["Submitted", date(ticket.createdAt)]
    ]));
  }
  function openTicket(id) {
    const ticket = tickets.find(item => item.id === id);
    if (!ticket) return;
    closeTicket(); selectedId = id;
    renderDetail(ticket); $("ticketDetail").hidden = false;
    stopConversation = conversation(id, user, "customer", { list: $("ticketMessages"), form: $("ticketReplyForm"), input: $("ticketReply"), status: $("ticketMessageStatus") });
    $("ticketDetail").focus();
  }
  subscriptions.push(onSnapshot(query(collection(db, "customerQuotes"), where("customerId", "==", user.uid)), snapshot => {
    $("myQuotes").replaceChildren();
    $("myQuotesCount").textContent = snapshot.size;
    message($("myQuotesStatus"), snapshot.empty ? "No quotes yet. Request a new project quote while signed in to track it here." : "");
    for (const quote of snapshot.docs.map(doc => doc.data()).sort((a, b) => millis(b.createdAt) - millis(a.createdAt))) {
      const card = element("article", "", "portal-record");
      card.append(element("h3", quote.service), metadata([["Business", quote.business], ["Status", quote.status.replaceAll("-", " ")], ["Submitted", date(quote.createdAt)], ["Quote", currency(quote.quoteAmount)]]));
      $("myQuotes").append(card);
    }
  }, () => {
    $("myQuotes").replaceChildren(); $("myQuotesCount").textContent = "—";
    message($("myQuotesStatus"), "Quotes could not be loaded. Check your connection and refresh.", "error");
  }));
  subscriptions.push(onSnapshot(query(collection(db, "supportTickets"), where("ownerId", "==", user.uid)), snapshot => {
    tickets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) => millis(b.lastMessageAt) - millis(a.lastMessageAt));
    $("myTickets").replaceChildren();
    $("openTicketsCount").textContent = tickets.filter(t => ["open", "in-review", "working"].includes(t.status)).length;
    $("resolvedTicketsCount").textContent = tickets.filter(t => t.status === "resolved").length;
    message($("myTicketsStatus"), tickets.length ? "" : "No support requests yet. Use the form to report a bug or request a change.");
    for (const ticket of tickets) {
      const card = element("article", "", "portal-record");
      const open = element("button", "Open Request", "secondary-button");
      open.type = "button"; open.addEventListener("click", () => openTicket(ticket.id));
      card.append(element("h3", ticket.title), metadata([["Project", ticket.projectName], ["Type", ticketTypes[ticket.type]], ["Status", ticketStatuses[ticket.status]], ["Last message", date(ticket.lastMessageAt)]]), open);
      $("myTickets").append(card);
    }
    if (selectedId) {
      const ticket = tickets.find(t => t.id === selectedId);
      if (ticket) renderDetail(ticket); else closeTicket();
    }
  }, () => {
    tickets = []; closeTicket(); $("myTickets").replaceChildren();
    $("openTicketsCount").textContent = "—"; $("resolvedTicketsCount").textContent = "—";
    message($("myTicketsStatus"), "Requests could not be loaded. Check your connection and refresh.", "error");
  }));
  const submit = async event => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    const fields = new FormData(form);
    const data = Object.fromEntries(["type", "projectName", "title", "details"].map(key => [key, String(fields.get(key) || "").trim()]));
    if (Object.values(data).some(value => !value) || !ticketTypes[data.type]) { message($("newTicketStatus"), "Complete every required field.", "error"); return; }
    button.disabled = true;
    message($("newTicketStatus"), "Creating request...");
    try {
      const record = await addDoc(collection(db, "supportTickets"), {
        ...data, ownerId: user.uid, ownerEmail: user.email,
        ownerName: (user.displayName || profile.name || user.email).slice(0, 254),
        status: "open", priority: "normal", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessageAt: serverTimestamp()
      });
      if (!disposed) {
        form.reset(); message($("newTicketStatus"), "Support request created. Open it to send messages and follow progress.", "success");
        openTicket(record.id);
      }
    } catch {
      if (!disposed) message($("newTicketStatus"), "Request could not be created. Your details are still here; please try again.", "error");
    } finally { if (!disposed) button.disabled = false; }
  };
  form.addEventListener("submit", submit);
  $("closeTicket").addEventListener("click", closeTicket);
  return () => {
    disposed = true; subscriptions.forEach(stop => stop()); closeTicket();
    form.removeEventListener("submit", submit); $("closeTicket").removeEventListener("click", closeTicket);
    $("myQuotes").replaceChildren(); $("myTickets").replaceChildren(); button.disabled = false;
  };
}
