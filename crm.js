import {
    auth,
    db,
    isFirebaseConfigured
} from "./firebase-config.js";
import { quoteSummary } from "./quote-summary.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const statusLabels = {
    "new": "New",
    "contacted": "Contacted",
    "qualified": "Qualified",
    "quote-sent": "Quote Sent",
    "accepted": "Accepted",
    "in-progress": "In Progress",
    "completed": "Completed",
    "lost": "Lost"
};

const emailTemplateLabels = {
    "initial-response": "Initial Response",
    "request-information": "Request More Information",
    "send-quote": "Send Quote",
    "follow-up": "Follow Up",
    "quote-accepted": "Quote Accepted",
    "request-content": "Request Project Content",
    "progress-update": "Project Progress Update",
    "project-completed": "Project Completed",
    "custom": "Custom Message"
};

const validStatuses = new Set(Object.keys(statusLabels));
const validEmailTemplates = new Set(Object.keys(emailTemplateLabels));

const businessSignature = [
    "Best regards,",
    "",
    "Michael Macclary",
    "SilverForge Digital Solutions",
    "App Development • Website Development • Digital Services"
].join("\n");

const accessGate = document.getElementById("accessGate");
const accessMessage = document.getElementById("accessMessage");
const crmApp = document.getElementById("crmApp");
const adminEmail = document.getElementById("adminEmail");
const signOutButton = document.getElementById("signOutButton");

const leadSearch = document.getElementById("leadSearch");
const statusFilter = document.getElementById("statusFilter");
const leadResultCount = document.getElementById("leadResultCount");
const leadListStatus = document.getElementById("leadListStatus");
const leadList = document.getElementById("leadList");

const createdAccountsCard = document.getElementById("createdAccountsCard");
const createdAccountsCount = document.getElementById("createdAccountsCount");
const accountsSection = document.getElementById("accountsSection");
const accountSearch = document.getElementById("accountSearch");
const accountRoleFilter = document.getElementById("accountRoleFilter");
const accountResultCount = document.getElementById("accountResultCount");
const accountListStatus = document.getElementById("accountListStatus");
const accountTableBody = document.getElementById("accountTableBody");
const accountCardList = document.getElementById("accountCardList");

const leadDialog = document.getElementById("leadDialog");
const closeLeadDialog = document.getElementById("closeLeadDialog");
const leadDialogTitle = document.getElementById("leadDialogTitle");
const callLead = document.getElementById("callLead");
const emailLead = document.getElementById("emailLead");

const leadForm = document.getElementById("leadForm");
const leadStatus = document.getElementById("leadStatus");
const quoteAmount = document.getElementById("quoteAmount");
const followUpDate = document.getElementById("followUpDate");
const internalNotes = document.getElementById("internalNotes");
const leadFormStatus = document.getElementById("leadFormStatus");
const updateLeadButton = document.getElementById("updateLeadButton");
const deleteLeadButton = document.getElementById("deleteLeadButton");

const customerEmailSection = document.getElementById("customerEmailSection");
const emailRecipient = document.getElementById("emailRecipient");
const emailTemplate = document.getElementById("emailTemplate");
const generateEmailButton = document.getElementById("generateEmailButton");
const emailSubject = document.getElementById("emailSubject");
const emailMessage = document.getElementById("emailMessage");
const emailStatus = document.getElementById("emailStatus");
const copyEmailButton = document.getElementById("copyEmailButton");
const openEmailButton = document.getElementById("openEmailButton");
const markEmailSentButton = document.getElementById("markEmailSentButton");
const communicationHistoryStatus = document.getElementById("communicationHistoryStatus");
const communicationHistory = document.getElementById("communicationHistory");

let leads = [];
let accounts = [];
let selectedLeadId = "";
let unsubscribeLeads = null;
let unsubscribeAccounts = null;
let unsubscribeCommunications = null;
let authorizedUid = "";
let pendingRedirectReason = "";

function redirectToLogin(reason = "") {
    const search = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    window.location.replace(`crm-login.html${search}`);
}

function setAccessMessage(message) {
    accessMessage.textContent = message;
}

function setLeadListStatus(message, state = "") {
    leadListStatus.textContent = message;
    leadListStatus.dataset.state = state;
    leadListStatus.hidden = !message;
}

function setAccountListStatus(message, state = "") {
    accountListStatus.textContent = message;
    accountListStatus.dataset.state = state;
    accountListStatus.hidden = !message;
}

function setLeadFormStatus(message, state = "") {
    leadFormStatus.textContent = message;
    leadFormStatus.dataset.state = state;
}

function setEmailStatus(message, state = "") {
    emailStatus.textContent = message;
    emailStatus.dataset.state = state;
}

function setCommunicationStatus(message, state = "") {
    communicationHistoryStatus.textContent = message;
    communicationHistoryStatus.dataset.state = state;
    communicationHistoryStatus.hidden = !message;
}

function timestampToMillis(timestamp) {
    if (timestamp && typeof timestamp.toMillis === "function") {
        return timestamp.toMillis();
    }
    return 0;
}

function formatDateTime(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") {
        return "Pending";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(timestamp.toDate());
}

function formatAccountDate(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") {
        return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium"
    }).format(timestamp.toDate());
}

function formatCurrency(value) {
    if (value === null || value === undefined || value === "") {
        return "Not set";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "Not set";
    }

    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD"
    }).format(number);
}

function getSelectedLead() {
    return leads.find((lead) => lead.id === selectedLeadId) || null;
}

function getFirstName(name) {
    const cleanedName = String(name || "").trim();
    return cleanedName ? cleanedName.split(/\s+/)[0] : "there";
}

function isValidEmailAddress(value) {
    const email = String(value || "").trim();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setDetailText(id, value) {
    const element = document.getElementById(id);
    element.textContent = String(value || "").trim() || "Not provided";
}

function createMetaItem(label, value) {
    const item = document.createElement("div");
    const itemLabel = document.createElement("span");
    const itemValue = document.createElement("strong");

    itemLabel.textContent = label;
    itemValue.textContent = value;

    item.append(itemLabel, itemValue);
    return item;
}

function normalizeAccountName(account) {
    return String(
        account.displayName ||
        account.name ||
        account.fullName ||
        account.ownerName ||
        ""
    ).trim() || "Name not provided";
}

function normalizeAccountRole(account) {
    return String(account.role || account.accountType || "customer")
        .trim()
        .toLowerCase() || "customer";
}

function normalizeAccountStatus(account) {
    if (account.active === false) return "inactive";

    const value = String(
        account.status ||
        account.accountStatus ||
        account.platformStatus ||
        ""
    ).trim().toLowerCase();

    if (!value) return "active";
    return value;
}

function getFilteredLeads() {
    const searchText = leadSearch.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;

    return leads.filter((lead) => {
        const matchesStatus = selectedStatus === "all" || lead.status === selectedStatus;

        if (!matchesStatus) return false;
        if (!searchText) return true;

        return [
            lead.name,
            lead.business,
            lead.email,
            lead.phone,
            lead.service,
            lead.message
        ]
            .join(" ")
            .toLowerCase()
            .includes(searchText);
    });
}

function updateSummary() {
    const counts = {
        "new": 0,
        "quote-sent": 0,
        "accepted": 0,
        "in-progress": 0,
        "completed": 0
    };

    leads.forEach((lead) => {
        if (Object.prototype.hasOwnProperty.call(counts, lead.status)) {
            counts[lead.status] += 1;
        }
    });

    document.getElementById("totalLeads").textContent = String(leads.length);
    document.getElementById("newLeads").textContent = String(counts["new"]);
    document.getElementById("quotesSent").textContent = String(counts["quote-sent"]);
    document.getElementById("acceptedProjects").textContent = String(counts["accepted"]);
    document.getElementById("inProgressProjects").textContent = String(counts["in-progress"]);
    document.getElementById("completedProjects").textContent = String(counts["completed"]);
}

function renderLeadList() {
    const filteredLeads = getFilteredLeads();

    leadList.replaceChildren();
    leadResultCount.textContent = `${filteredLeads.length} of ${leads.length} leads`;

    if (!filteredLeads.length) {
        setLeadListStatus(
            leads.length
                ? "No leads match the current search and filter."
                : "No quote requests have been submitted yet."
        );
        return;
    }

    setLeadListStatus("");

    filteredLeads.forEach((lead) => {
        const card = document.createElement("article");
        card.className = "crm-lead-card";
        card.setAttribute("role", "listitem");

        const cardHeader = document.createElement("div");
        cardHeader.className = "crm-lead-card-header";

        const identity = document.createElement("div");
        const name = document.createElement("h3");
        const business = document.createElement("p");

        name.textContent = lead.name || "Unnamed lead";
        business.textContent = lead.business || "No business provided";

        identity.append(name, business);

        const badge = document.createElement("span");
        badge.className = `crm-status-badge crm-status-${lead.status}`;
        badge.textContent = statusLabels[lead.status] || "Unknown";

        cardHeader.append(identity, badge);

        const meta = document.createElement("div");
        meta.className = "crm-lead-meta";
        meta.append(
            createMetaItem("Service", lead.service || "Not provided"),
            createMetaItem("Submitted", formatDateTime(lead.createdAt)),
            createMetaItem("Quote", formatCurrency(lead.quoteAmount)),
            createMetaItem("Follow-up", lead.followUpDate || "Not set")
        );

        const contact = document.createElement("p");
        contact.className = "crm-lead-contact";
        contact.textContent = [lead.email, lead.phone].filter(Boolean).join(" • ");

        const viewButton = document.createElement("button");
        viewButton.className = "crm-primary-button crm-view-button";
        viewButton.type = "button";
        viewButton.textContent = "View and manage";
        viewButton.addEventListener("click", () => openLead(lead.id));

        card.append(cardHeader, meta, contact, viewButton);
        leadList.appendChild(card);
    });
}

function populateAccountRoleFilter() {
    const current = accountRoleFilter.value || "all";
    const roles = [...new Set(accounts.map(normalizeAccountRole))].sort();

    accountRoleFilter.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All roles";
    accountRoleFilter.appendChild(allOption);

    roles.forEach((role) => {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = role
            .replaceAll("-", " ")
            .replace(/\b\w/g, (character) => character.toUpperCase());
        accountRoleFilter.appendChild(option);
    });

    accountRoleFilter.value = roles.includes(current) ? current : "all";
}

function getFilteredAccounts() {
    const searchText = accountSearch.value.trim().toLowerCase();
    const selectedRole = accountRoleFilter.value;

    return accounts.filter((account) => {
        const role = normalizeAccountRole(account);

        if (selectedRole !== "all" && role !== selectedRole) {
            return false;
        }

        if (!searchText) return true;

        return [
            normalizeAccountName(account),
            account.email,
            role,
            account.businessId,
            normalizeAccountStatus(account)
        ]
            .join(" ")
            .toLowerCase()
            .includes(searchText);
    });
}

function makeAccountStatusBadge(status) {
    const span = document.createElement("span");
    span.className = "crm-account-status";

    if (["inactive", "disabled", "suspended", "canceled"].includes(status)) {
        span.classList.add("crm-account-status-inactive");
    } else if (["pending", "setup_required", "past_due"].includes(status)) {
        span.classList.add("crm-account-status-warning");
    } else {
        span.classList.add("crm-account-status-active");
    }

    span.textContent = status.replaceAll("_", " ");
    return span;
}

function renderAccounts() {
    const filteredAccounts = getFilteredAccounts();

    createdAccountsCount.textContent = String(accounts.length);
    accountResultCount.textContent = `${filteredAccounts.length} of ${accounts.length} accounts`;

    accountTableBody.replaceChildren();
    accountCardList.replaceChildren();

    if (!filteredAccounts.length) {
        setAccountListStatus(
            accounts.length
                ? "No accounts match the current search and filter."
                : "No account profile documents were found."
        );
        return;
    }

    setAccountListStatus("");

    filteredAccounts.forEach((account) => {
        const name = normalizeAccountName(account);
        const email = String(account.email || "No email");
        const role = normalizeAccountRole(account);
        const status = normalizeAccountStatus(account);
        const businessId = String(account.businessId || "—");
        const created = formatAccountDate(account.createdAt);

        const row = document.createElement("tr");

        const nameCell = document.createElement("td");
        const emailCell = document.createElement("td");
        const roleCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const businessCell = document.createElement("td");
        const createdCell = document.createElement("td");

        nameCell.textContent = name;
        emailCell.textContent = email;
        roleCell.textContent = role.replaceAll("-", " ");
        statusCell.appendChild(makeAccountStatusBadge(status));
        businessCell.textContent = businessId;
        createdCell.textContent = created;

        row.append(
            nameCell,
            emailCell,
            roleCell,
            statusCell,
            businessCell,
            createdCell
        );

        accountTableBody.appendChild(row);

        const card = document.createElement("article");
        card.className = "crm-account-card";
        card.setAttribute("role", "listitem");

        const top = document.createElement("div");
        top.className = "crm-account-card-top";

        const identity = document.createElement("div");
        const heading = document.createElement("h3");
        const emailText = document.createElement("p");

        heading.textContent = name;
        emailText.textContent = email;
        identity.append(heading, emailText);

        top.append(identity, makeAccountStatusBadge(status));

        const meta = document.createElement("div");
        meta.className = "crm-account-card-meta";
        meta.append(
            createMetaItem("Role", role.replaceAll("-", " ")),
            createMetaItem("Business ID", businessId),
            createMetaItem("Created", created)
        );

        card.append(top, meta);
        accountCardList.appendChild(card);
    });
}

function clearEmailEditor() {
    emailTemplate.value = "initial-response";
    emailSubject.value = "";
    emailMessage.value = "";
    emailRecipient.textContent = "No email provided";
    setEmailStatus("");
}

function stopCommunicationSubscription() {
    if (unsubscribeCommunications) {
        unsubscribeCommunications();
        unsubscribeCommunications = null;
    }
}

function closeDialog() {
    selectedLeadId = "";
    stopCommunicationSubscription();
    communicationHistory.replaceChildren();
    setCommunicationStatus("Select a lead to load its email history.");
    setLeadFormStatus("");
    clearEmailEditor();

    if (leadDialog.open) {
        leadDialog.close();
    }
}

function renderCommunicationHistory(snapshot) {
    communicationHistory.replaceChildren();

    if (snapshot.empty) {
        setCommunicationStatus("No customer emails have been marked as sent for this lead.");
        return;
    }

    setCommunicationStatus("");

    snapshot.docs.forEach((communicationDocument) => {
        const communication = communicationDocument.data();

        const item = document.createElement("article");
        item.className = "crm-communication-item";

        const header = document.createElement("div");
        header.className = "crm-communication-header";

        const titleWrap = document.createElement("div");
        const title = document.createElement("h4");
        const recipient = document.createElement("p");

        title.textContent = communication.subject || "Email";
        recipient.textContent = `To: ${communication.recipient || "Unknown recipient"}`;
        titleWrap.append(title, recipient);

        const date = document.createElement("time");
        date.textContent = formatDateTime(communication.markedSentAt);

        header.append(titleWrap, date);

        const template = document.createElement("span");
        template.className = "crm-template-badge";
        template.textContent =
            emailTemplateLabels[communication.template] || "Custom Message";

        const details = document.createElement("details");
        const summary = document.createElement("summary");
        const body = document.createElement("pre");

        summary.textContent = "View email text";
        body.textContent = communication.body || "";

        details.append(summary, body);
        item.append(header, template, details);
        communicationHistory.appendChild(item);
    });
}

function subscribeToCommunications(leadId) {
    stopCommunicationSubscription();
    communicationHistory.replaceChildren();
    setCommunicationStatus("Loading email history...");

    const communicationsQuery = query(
        collection(db, "leads", leadId, "communications"),
        orderBy("markedSentAt", "desc")
    );

    unsubscribeCommunications = onSnapshot(
        communicationsQuery,
        renderCommunicationHistory,
        (error) => {
            console.error("Communication history failed:", error);
            setCommunicationStatus(
                "Email history could not be loaded. Check your connection and administrator access.",
                "error"
            );
        }
    );
}

function openLead(leadId) {
    const lead = leads.find((item) => item.id === leadId);

    if (!lead) return;

    selectedLeadId = lead.id;

    leadDialogTitle.textContent = lead.name || "Lead details";

    setDetailText("detailName", lead.name);
    setDetailText("detailBusiness", lead.business);
    setDetailText("detailEmail", lead.email);
    setDetailText("detailPhone", lead.phone);
    setDetailText("detailService", lead.service);
    setDetailText("detailMessage", lead.message);
    setDetailText("detailCreatedAt", formatDateTime(lead.createdAt));

    leadStatus.value = validStatuses.has(lead.status) ? lead.status : "new";

    quoteAmount.value =
        lead.quoteAmount === null || lead.quoteAmount === undefined
            ? ""
            : String(lead.quoteAmount);

    followUpDate.value = lead.followUpDate || "";
    internalNotes.value = lead.internalNotes || "";

    const telephone = String(lead.phone || "").replace(/[^0-9+]/g, "");
    callLead.hidden = !telephone;
    callLead.href = telephone ? `tel:${telephone}` : "#";

    const customerEmail = String(lead.email || "").trim();

    emailLead.hidden = !isValidEmailAddress(customerEmail);
    emailRecipient.textContent = customerEmail || "No email provided";

    emailTemplate.value = validEmailTemplates.has(lead.lastEmailTemplate)
        ? lead.lastEmailTemplate
        : "initial-response";

    emailSubject.value = String(lead.lastEmailSubject || "");
    emailMessage.value = String(lead.lastEmailBody || "");

    setLeadFormStatus("");
    setEmailStatus("");

    subscribeToCommunications(lead.id);

    if (!leadDialog.open) {
        leadDialog.showModal();
    }
}

async function verifyAdministrator(user) {
    const roleSnapshot = await getDoc(doc(db, "roles", user.uid));

    if (!roleSnapshot.exists()) {
        return false;
    }

    const role = roleSnapshot.data();
    return role.role === "admin" && role.active === true;
}

function subscribeToLeads() {
    if (unsubscribeLeads) {
        unsubscribeLeads();
    }

    setLeadListStatus("Loading leads...");

    unsubscribeLeads = onSnapshot(
        collection(db, "leads"),
        (snapshot) => {
            leads = snapshot.docs
                .map((leadDocument) => ({
                    customerId: null, // Older leads remain valid and visible to administrators.
                    id: leadDocument.id,
                    ...leadDocument.data()
                }))
                .sort(
                    (a, b) =>
                        timestampToMillis(b.createdAt) -
                        timestampToMillis(a.createdAt)
                );

            if (
                selectedLeadId &&
                !leads.some((lead) => lead.id === selectedLeadId)
            ) {
                closeDialog();
            }

            updateSummary();
            renderLeadList();
        },
        async (error) => {
            console.error("Lead subscription failed:", error);

            setLeadListStatus(
                "Lead data could not be loaded. Check your administrator access and connection.",
                "error"
            );

            if (error.code === "permission-denied") {
                await signOut(auth);
                redirectToLogin("unauthorized");
            }
        }
    );
}

function subscribeToAccounts() {
    if (unsubscribeAccounts) {
        unsubscribeAccounts();
    }

    setAccountListStatus("Loading accounts...");

    unsubscribeAccounts = onSnapshot(
        collection(db, "users"),
        (snapshot) => {
            accounts = snapshot.docs
                .map((accountDocument) => ({
                    id: accountDocument.id,
                    ...accountDocument.data()
                }))
                .sort(
                    (a, b) =>
                        timestampToMillis(b.createdAt) -
                        timestampToMillis(a.createdAt)
                );

            populateAccountRoleFilter();
            renderAccounts();
        },
        (error) => {
            console.error("Account subscription failed:", error);

            accounts = [];
            createdAccountsCount.textContent = "—";
            accountResultCount.textContent = "Accounts unavailable";
            accountTableBody.replaceChildren();
            accountCardList.replaceChildren();

            if (error.code === "permission-denied") {
                setAccountListStatus(
                    "Created accounts exist in Firestore only if your site writes user profiles to the users collection. Your current Firestore rules also need to allow active administrators to list that collection.",
                    "error"
                );
            } else {
                setAccountListStatus(
                    "Created accounts could not be loaded. Check the browser console and Firebase connection.",
                    "error"
                );
            }
        }
    );
}

function setLeadFormBusy(isBusy) {
    updateLeadButton.disabled = isBusy;
    deleteLeadButton.disabled = isBusy;
    updateLeadButton.textContent = isBusy ? "Updating..." : "Update lead";
}

function setEmailBusy(isBusy) {
    generateEmailButton.disabled = isBusy;
    copyEmailButton.disabled = isBusy;
    openEmailButton.disabled = isBusy;
    markEmailSentButton.disabled = isBusy;
    markEmailSentButton.textContent = isBusy ? "Saving..." : "Mark as Sent";
}

function getCurrentQuote() {
    const quoteText = quoteAmount.value.trim();

    if (!quoteText) return null;

    const amount = Number(quoteText);

    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
        return null;
    }

    return amount;
}

function getTemplateContent(templateKey, lead) {
    const firstName = getFirstName(lead.name);
    const businessName = String(lead.business || "").trim();
    const service = String(lead.service || "your project").trim();
    const quote = getCurrentQuote();
    const businessReference = businessName ? ` for ${businessName}` : "";

    switch (templateKey) {
        case "initial-response":
            return {
                subject: "Thank You for Contacting SilverForge Digital Solutions",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `Thank you for contacting SilverForge Digital Solutions regarding ${service}${businessReference}. I received your project request and will review the information you provided.`,
                    "",
                    "I may reach out with a few follow-up questions so I can better understand the project and recommend the right next steps.",
                    "",
                    "Thank you for considering SilverForge Digital Solutions.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "request-information":
            return {
                subject: "Additional Information Needed for Your Project",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `Thank you for the information you provided about ${service}${businessReference}. To prepare an accurate plan for the project, I need a few additional details:`,
                    "",
                    "• [Add the first question or detail needed]",
                    "• [Add the second question or detail needed]",
                    "• [Add any other information needed]",
                    "",
                    "You can reply directly to this email with the information when it is convenient.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "send-quote":
            if (quote === null) {
                throw new Error(
                    "Enter a valid quote amount before generating the Send Quote email."
                );
            }

            return {
                subject: "Your SilverForge Project Quote",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `Thank you for the opportunity to discuss ${service}${businessReference}. Based on the project requirements currently discussed, the quoted project price is ${formatCurrency(quote)}.`,
                    "",
                    "This quote is based on the current scope and may be adjusted if the requested features or requirements change.",
                    "",
                    "Please review the amount and let me know if you have any questions or would like to discuss the next steps.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "follow-up":
            return {
                subject: "Following Up on Your SilverForge Project",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `I am following up regarding your request for ${service}${businessReference}. I wanted to see whether you are still interested in moving forward or whether you have any questions I can answer.`,
                    "",
                    "Please feel free to reply whenever you are ready.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "quote-accepted":
            return {
                subject: "SilverForge Project Confirmation",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `Thank you for choosing SilverForge Digital Solutions for ${service}${businessReference}. Your project has been confirmed${quote !== null ? ` at the agreed price of ${formatCurrency(quote)}` : ""}.`,
                    "",
                    "I will follow up with the next steps, required materials, and scheduling information so we can begin the project.",
                    "",
                    "I appreciate the opportunity to work with you.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "request-content":
            return {
                subject: "Content Needed for Your SilverForge Project",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `To continue work on ${service}${businessReference}, please provide the project materials listed below:`,
                    "",
                    "• Final written text or business information",
                    "• Logo and brand materials",
                    "• Photos, videos, or other media",
                    "• Contact information that should appear in the project",
                    "• [Add any other required material]",
                    "",
                    "For your security, please do not send passwords by email. Account access can be handled through a safer method when necessary.",
                    "",
                    "Please let me know if you have questions about any of the requested materials.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "progress-update":
            return {
                subject: "Update on Your SilverForge Project",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `I am writing with an update on ${service}${businessReference}.`,
                    "",
                    "Current progress:",
                    "[Add a clear description of the work completed or currently underway.]",
                    "",
                    "Next steps:",
                    "[Add the next planned work, review, or information needed.]",
                    "",
                    "Please let me know if you have any questions about the update.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "project-completed":
            return {
                subject: "Your SilverForge Project Is Complete",
                body: [
                    `Hi ${firstName},`,
                    "",
                    `I am pleased to let you know that ${service}${businessReference} has been completed.`,
                    "",
                    "Delivery and next steps:",
                    "[Add the delivery link, instructions, launch details, or final steps here.]",
                    "",
                    "Thank you for working with SilverForge Digital Solutions. Please reach out if you need assistance or future support.",
                    "",
                    businessSignature
                ].join("\n")
            };

        case "custom":
            return {
                subject: "Message from SilverForge Digital Solutions",
                body: [
                    `Hi ${firstName},`,
                    "",
                    "[Write your message here.]",
                    "",
                    businessSignature
                ].join("\n")
            };

        default:
            throw new Error("Choose a valid email template.");
    }
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const temporaryTextArea = document.createElement("textarea");

    temporaryTextArea.value = text;
    temporaryTextArea.setAttribute("readonly", "");
    temporaryTextArea.style.position = "fixed";
    temporaryTextArea.style.opacity = "0";

    document.body.appendChild(temporaryTextArea);
    temporaryTextArea.select();

    const copied = document.execCommand("copy");
    temporaryTextArea.remove();

    if (!copied) {
        throw new Error("Clipboard copy failed.");
    }
}

function validatePreparedEmail(requireRecipient = false) {
    const lead = getSelectedLead();

    if (!lead) {
        throw new Error("Select a lead before preparing an email.");
    }

    const subject = emailSubject.value.trim();
    const body = emailMessage.value.trim();
    const recipient = String(lead.email || "").trim();

    if (!subject) {
        throw new Error("Enter an email subject.");
    }

    if (subject.length > 300) {
        throw new Error("The email subject is too long.");
    }

    if (!body) {
        throw new Error("Enter an email message.");
    }

    if (body.length > 20000) {
        throw new Error("The email message is too long.");
    }

    if (requireRecipient && !isValidEmailAddress(recipient)) {
        throw new Error("This lead does not have a valid customer email address.");
    }

    return {
        lead,
        subject,
        body,
        recipient
    };
}

leadSearch.addEventListener("input", renderLeadList);
statusFilter.addEventListener("change", renderLeadList);

accountSearch.addEventListener("input", renderAccounts);
accountRoleFilter.addEventListener("change", renderAccounts);

createdAccountsCard.addEventListener("click", () => {
    accountsSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
});

closeLeadDialog.addEventListener("click", closeDialog);

leadDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
});

leadDialog.addEventListener("click", (event) => {
    if (event.target === leadDialog) {
        closeDialog();
    }
});

emailLead.addEventListener("click", () => {
    customerEmailSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    emailTemplate.focus();
});

generateEmailButton.addEventListener("click", () => {
    const lead = getSelectedLead();

    if (!lead) {
        setEmailStatus("Select a lead before generating an email.", "error");
        return;
    }

    const templateKey = emailTemplate.value;

    if (!validEmailTemplates.has(templateKey)) {
        setEmailStatus("Choose a valid email template.", "error");
        return;
    }

    try {
        const generated = getTemplateContent(templateKey, lead);

        emailSubject.value = generated.subject;
        emailMessage.value = generated.body;

        setEmailStatus(
            "Professional email generated. Review and edit it before opening your email app.",
            "success"
        );
    } catch (error) {
        setEmailStatus(
            error.message || "The email could not be generated.",
            "error"
        );
    }
});

copyEmailButton.addEventListener("click", async () => {
    try {
        const prepared = validatePreparedEmail(false);

        await copyTextToClipboard(
            `Subject: ${prepared.subject}\n\n${prepared.body}`
        );

        setEmailStatus(
            "The email subject and message were copied.",
            "success"
        );
    } catch (error) {
        console.error("Email copy failed:", error);

        setEmailStatus(
            error.message || "The email could not be copied.",
            "error"
        );
    }
});

openEmailButton.addEventListener("click", () => {
    try {
        const prepared = validatePreparedEmail(true);

        const mailLink =
            `mailto:${prepared.recipient}` +
            `?subject=${encodeURIComponent(prepared.subject)}` +
            `&body=${encodeURIComponent(prepared.body)}`;

        setEmailStatus(
            "Opening your email app. Review the message there and press Send manually.",
            "success"
        );

        window.location.href = mailLink;
    } catch (error) {
        setEmailStatus(
            error.message || "The email app could not be opened.",
            "error"
        );
    }
});

markEmailSentButton.addEventListener("click", async () => {
    if (!authorizedUid) {
        setEmailStatus(
            "Administrator access could not be confirmed.",
            "error"
        );
        return;
    }

    let prepared;

    try {
        prepared = validatePreparedEmail(true);
    } catch (error) {
        setEmailStatus(
            error.message || "The email record is incomplete.",
            "error"
        );
        return;
    }

    const templateKey = emailTemplate.value;

    if (!validEmailTemplates.has(templateKey)) {
        setEmailStatus("Choose a valid email template.", "error");
        return;
    }

    const confirmed = window.confirm(
        "Mark this email as sent? Use this only after you have sent it from your email app."
    );

    if (!confirmed) return;

    setEmailBusy(true);
    setEmailStatus("Saving the email record...");

    try {
        const leadReference = doc(db, "leads", prepared.lead.id);

        const communicationReference = doc(
            collection(
                db,
                "leads",
                prepared.lead.id,
                "communications"
            )
        );

        const batch = writeBatch(db);

        batch.update(leadReference, {
            lastEmailTemplate: templateKey,
            lastEmailSubject: prepared.subject,
            lastEmailBody: prepared.body,
            lastEmailMarkedSentAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        batch.set(communicationReference, {
            type: "email",
            template: templateKey,
            subject: prepared.subject,
            body: prepared.body,
            recipient: prepared.recipient,
            markedSentAt: serverTimestamp(),
            createdBy: authorizedUid
        });

        await batch.commit();

        setEmailStatus(
            "Email marked as sent and added to the private history.",
            "success"
        );
    } catch (error) {
        console.error("Mark email as sent failed:", error);

        setEmailStatus(
            "The email record could not be saved. Check your connection and Firestore rules.",
            "error"
        );
    } finally {
        setEmailBusy(false);
    }
});

leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedLeadId) return;

    if (!leadForm.checkValidity()) {
        leadForm.reportValidity();
        return;
    }

    const status = leadStatus.value;
    const quoteText = quoteAmount.value.trim();
    const parsedQuote = quoteText ? Number(quoteText) : null;

    if (!validStatuses.has(status)) {
        setLeadFormStatus("Choose a valid lead status.", "error");
        return;
    }

    if (
        parsedQuote !== null &&
        (
            !Number.isFinite(parsedQuote) ||
            parsedQuote < 0 ||
            parsedQuote > 100000000
        )
    ) {
        setLeadFormStatus(
            "Enter a valid non-negative quote amount.",
            "error"
        );
        return;
    }

    setLeadFormBusy(true);
    setLeadFormStatus("Updating lead...");

    try {
        const lead = getSelectedLead();
        const changes = {
                status,
                quoteAmount: parsedQuote,
                followUpDate: followUpDate.value,
                internalNotes: internalNotes.value.trim(),
                updatedAt: serverTimestamp()
        };
        const batch = writeBatch(db);
        batch.update(doc(db, "leads", selectedLeadId), changes);
        if (lead.customerId) {
            batch.set(doc(db, "customerQuotes", selectedLeadId), quoteSummary({ ...lead, ...changes }));
        }
        await batch.commit();

        setLeadFormStatus(
            "Lead updated successfully.",
            "success"
        );
    } catch (error) {
        console.error("Lead update failed:", error);

        setLeadFormStatus(
            "The lead could not be updated. Check your connection and access.",
            "error"
        );
    } finally {
        setLeadFormBusy(false);
    }
});

deleteLeadButton.addEventListener("click", async () => {
    if (!selectedLeadId) return;

    const lead = getSelectedLead();

    const confirmed = window.confirm(
        `Delete the lead for ${lead?.name || "this customer"} and its email history? This cannot be undone.`
    );

    if (!confirmed) return;

    setLeadFormBusy(true);
    deleteLeadButton.textContent = "Deleting...";
    setLeadFormStatus("Deleting lead...");

    try {
        const communicationSnapshot = await getDocs(
            collection(
                db,
                "leads",
                selectedLeadId,
                "communications"
            )
        );

        const batch = writeBatch(db);

        communicationSnapshot.docs.forEach(
            (communicationDocument) => {
                batch.delete(communicationDocument.ref);
            }
        );

        batch.delete(doc(db, "leads", selectedLeadId));
        if (lead?.customerId) batch.delete(doc(db, "customerQuotes", selectedLeadId));

        await batch.commit();
        closeDialog();
    } catch (error) {
        console.error("Lead deletion failed:", error);

        setLeadFormStatus(
            "The lead could not be deleted. Check your connection and access.",
            "error"
        );
    } finally {
        deleteLeadButton.textContent = "Delete lead";
        setLeadFormBusy(false);
    }
});

signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    signOutButton.textContent = "Signing out...";

    if (unsubscribeLeads) {
        unsubscribeLeads();
        unsubscribeLeads = null;
    }

    if (unsubscribeAccounts) {
        unsubscribeAccounts();
        unsubscribeAccounts = null;
    }

    stopCommunicationSubscription();

    try {
        await signOut(auth);
    } finally {
        redirectToLogin();
    }
});

if (!isFirebaseConfigured || !auth || !db) {
    setAccessMessage(
        "Firebase is not configured. Update firebase-config.js before opening the CRM."
    );
} else {
    onAuthStateChanged(
        auth,
        async (user) => {
            if (!user) {
                redirectToLogin(pendingRedirectReason);
                return;
            }

            if (authorizedUid === user.uid) {
                return;
            }

            setAccessMessage("Verifying administrator access...");

            try {
                const authorized = await verifyAdministrator(user);

                if (!authorized) {
                    pendingRedirectReason = "unauthorized";
                    await signOut(auth);
                    return;
                }

                authorizedUid = user.uid;
                adminEmail.textContent =
                    user.email || "Administrator";

                accessGate.hidden = true;
                crmApp.hidden = false;

                subscribeToLeads();
                subscribeToAccounts();
            } catch (error) {
                console.error("CRM authorization failed:", error);
                pendingRedirectReason = "unauthorized";
                await signOut(auth);
            }
        },
        (error) => {
            console.error("CRM auth observer failed:", error);
            redirectToLogin();
        }
    );
}

window.addEventListener("beforeunload", () => {
    if (unsubscribeLeads) {
        unsubscribeLeads();
    }

    if (unsubscribeAccounts) {
        unsubscribeAccounts();
    }

    stopCommunicationSubscription();
});
