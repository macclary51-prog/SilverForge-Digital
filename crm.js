import {
    auth,
    db,
    isFirebaseConfigured
} from "./firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    buildClientContext,
    buildEmailTemplate,
    calculateRemainingBalance,
    cleanText,
    emailTemplateLabels,
    formatCurrency,
    proposalDefaults,
    proposalStatusLabels,
    readNullableNumber,
    readNullableWholeNumber,
    validateProposal
} from "./crm-utils.js";

const statusLabels = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    "quote-sent": "Quote Sent",
    accepted: "Accepted",
    "in-progress": "In Progress",
    completed: "Completed",
    lost: "Lost"
};

const validStatuses =
    new Set(Object.keys(statusLabels));

const proposalActivityTypes = {
    ready: "proposal-ready",
    sent: "proposal-sent",
    accepted: "proposal-accepted",
    declined: "proposal-declined",
    expired: "proposal-expired"
};

const proposalFieldNames = [
    "projectTitle",
    "clientProjectSummary",
    "scopeOfWork",
    "deliverables",
    "officialPrice",
    "depositAmount",
    "remainingBalance",
    "estimatedTimeline",
    "proposedStartDate",
    "proposedCompletionDate",
    "includedRevisions",
    "paymentTerms",
    "additionalTerms",
    "proposalExpirationDate",
    "clientMessage",
    "proposalStatus"
];

const byId = function (id) {
    return document.getElementById(id);
};

const accessGate = byId("accessGate");
const accessMessage = byId("accessMessage");
const crmApp = byId("crmApp");
const adminEmail = byId("adminEmail");
const signOutButton = byId("signOutButton");
const leadSearch = byId("leadSearch");
const statusFilter = byId("statusFilter");
const leadResultCount = byId("leadResultCount");
const leadListStatus = byId("leadListStatus");
const leadList = byId("leadList");
const leadDialog = byId("leadDialog");
const closeLeadDialog = byId("closeLeadDialog");
const leadDialogTitle = byId("leadDialogTitle");
const callLead = byId("callLead");
const emailLead = byId("emailLead");
const leadForm = byId("leadForm");
const leadStatus = byId("leadStatus");
const quoteAmount = byId("quoteAmount");
const followUpDate = byId("followUpDate");
const internalNotes = byId("internalNotes");
const projectTitle = byId("projectTitle");
const clientProjectSummary = byId("clientProjectSummary");
const scopeOfWork = byId("scopeOfWork");
const deliverables = byId("deliverables");
const officialPrice = byId("officialPrice");
const depositAmount = byId("depositAmount");
const remainingBalance = byId("remainingBalance");
const estimatedTimeline = byId("estimatedTimeline");
const proposedStartDate = byId("proposedStartDate");
const proposedCompletionDate = byId("proposedCompletionDate");
const includedRevisions = byId("includedRevisions");
const paymentTerms = byId("paymentTerms");
const additionalTerms = byId("additionalTerms");
const proposalExpirationDate = byId("proposalExpirationDate");
const clientMessage = byId("clientMessage");
const proposalStatus = byId("proposalStatus");
const proposalStatusBadge = byId("proposalStatusBadge");
const proposalNumberDisplay = byId("proposalNumberDisplay");
const emailTemplate = byId("emailTemplate");
const emailSubject = byId("emailSubject");
const emailBody = byId("emailBody");
const generateEmailButton = byId("generateEmailButton");
const copyEmailButton = byId("copyEmailButton");
const openEmailButton = byId("openEmailButton");
const markEmailSentButton = byId("markEmailSentButton");
const emailComposerStatus = byId("emailComposerStatus");
const leadFormStatus = byId("leadFormStatus");
const updateLeadButton = byId("updateLeadButton");
const previewProposalButton = byId("previewProposalButton");
const deleteLeadButton = byId("deleteLeadButton");
const activityStatus = byId("activityStatus");
const activityList = byId("activityList");

let leads = [];
let selectedLeadId = "";
let unsubscribeLeads = null;
let unsubscribeActivities = null;
let authorizedUser = null;
let pendingRedirectReason = "";


function redirectToLogin(reason = "") {
    const queryString = reason
        ? `?reason=${encodeURIComponent(reason)}`
        : "";

    window.location.replace(
        `crm-login.html${queryString}`
    );
}


function setStatus(element, message, state = "") {
    element.textContent = message;
    element.dataset.state = state;
}


function setAccessMessage(message) {
    accessMessage.textContent = message;
}


function setLeadListStatus(message, state = "") {
    setStatus(leadListStatus, message, state);
    leadListStatus.hidden = !message;
}


function setLeadFormStatus(message, state = "") {
    setStatus(leadFormStatus, message, state);
}


function setEmailStatus(message, state = "") {
    setStatus(emailComposerStatus, message, state);
}


function timestampToMillis(timestamp) {
    if (
        timestamp &&
        typeof timestamp.toMillis === "function"
    ) {
        return timestamp.toMillis();
    }

    return 0;
}


function formatDateTime(timestamp) {
    if (
        !timestamp ||
        typeof timestamp.toDate !== "function"
    ) {
        return "Pending";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    ).format(timestamp.toDate());
}


function setDetailText(id, value) {
    byId(id).textContent =
        cleanText(value) || "Not provided";
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


function getSelectedLead() {
    return leads.find(function (lead) {
        return lead.id === selectedLeadId;
    }) || null;
}


function getFilteredLeads() {
    const searchValue =
        leadSearch.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;

    return leads.filter(function (lead) {
        const matchesStatus =
            selectedStatus === "all" ||
            lead.status === selectedStatus;

        if (!matchesStatus) {
            return false;
        }

        if (!searchValue) {
            return true;
        }

        const searchableText = [
            lead.name,
            lead.business,
            lead.email,
            lead.phone,
            lead.service,
            lead.message,
            lead.projectTitle,
            lead.proposalNumber
        ].join(" ").toLowerCase();

        return searchableText.includes(searchValue);
    });
}


function updateSummary() {
    const counts = {
        new: 0,
        "quote-sent": 0,
        accepted: 0,
        "in-progress": 0,
        completed: 0
    };

    leads.forEach(function (lead) {
        if (
            Object.prototype.hasOwnProperty.call(
                counts,
                lead.status
            )
        ) {
            counts[lead.status] += 1;
        }
    });

    byId("totalLeads").textContent =
        String(leads.length);
    byId("newLeads").textContent =
        String(counts.new);
    byId("quotesSent").textContent =
        String(counts["quote-sent"]);
    byId("acceptedProjects").textContent =
        String(counts.accepted);
    byId("inProgressProjects").textContent =
        String(counts["in-progress"]);
    byId("completedProjects").textContent =
        String(counts.completed);
}


function updateProposalBadge(statusValue) {
    const normalized = Object.hasOwn(
        proposalStatusLabels,
        statusValue
    )
        ? statusValue
        : "draft";

    proposalStatusBadge.className =
        `crm-proposal-badge crm-proposal-${normalized}`;
    proposalStatusBadge.textContent =
        proposalStatusLabels[normalized];
}


function renderLeadList() {
    const filteredLeads = getFilteredLeads();

    leadList.replaceChildren();
    leadResultCount.textContent =
        `${filteredLeads.length} of ${leads.length} leads`;

    if (!filteredLeads.length) {
        setLeadListStatus(
            leads.length
                ? "No leads match the current search and filter."
                : "No quote requests have been submitted yet."
        );
        return;
    }

    setLeadListStatus("");

    filteredLeads.forEach(function (lead) {
        const card = document.createElement("article");
        const cardHeader = document.createElement("div");
        const identity = document.createElement("div");
        const name = document.createElement("h3");
        const business = document.createElement("p");
        const badge = document.createElement("span");
        const meta = document.createElement("div");
        const contact = document.createElement("p");
        const viewButton = document.createElement("button");

        card.className = "crm-lead-card";
        card.setAttribute("role", "listitem");
        cardHeader.className = "crm-lead-card-header";
        name.textContent = lead.name || "Unnamed lead";
        business.textContent =
            lead.business || "No business provided";
        identity.append(name, business);
        badge.className =
            `crm-status-badge crm-status-${lead.status}`;
        badge.textContent =
            statusLabels[lead.status] || "Unknown";
        cardHeader.append(identity, badge);

        meta.className = "crm-lead-meta";
        meta.append(
            createMetaItem(
                "Service",
                lead.service || "Not provided"
            ),
            createMetaItem(
                "Submitted",
                formatDateTime(lead.createdAt)
            ),
            createMetaItem(
                "Official price",
                formatCurrency(
                    lead.officialPrice ??
                    lead.quoteAmount
                )
            ),
            createMetaItem(
                "Proposal",
                lead.proposalNumber || "Not created"
            )
        );

        contact.className = "crm-lead-contact";
        contact.textContent = [
            lead.email,
            lead.phone
        ].filter(Boolean).join(" | ");

        viewButton.className =
            "crm-primary-button crm-view-button";
        viewButton.type = "button";
        viewButton.textContent = "View and manage";
        viewButton.addEventListener(
            "click",
            function () {
                openLead(lead.id);
            }
        );

        card.append(
            cardHeader,
            meta,
            contact,
            viewButton
        );
        leadList.appendChild(card);
    });
}


function setInputValue(element, value) {
    element.value =
        value === null || value === undefined
            ? ""
            : String(value);
}


function updateRemainingBalance() {
    const balance = calculateRemainingBalance(
        officialPrice.value,
        depositAmount.value
    );

    setInputValue(remainingBalance, balance);
}


function populateProposalFields(lead) {
    const proposal = proposalDefaults(lead);

    setInputValue(projectTitle, proposal.projectTitle);
    setInputValue(
        clientProjectSummary,
        proposal.clientProjectSummary
    );
    setInputValue(scopeOfWork, proposal.scopeOfWork);
    setInputValue(deliverables, proposal.deliverables);
    setInputValue(officialPrice, proposal.officialPrice);
    setInputValue(depositAmount, proposal.depositAmount);
    setInputValue(
        remainingBalance,
        proposal.remainingBalance
    );
    setInputValue(
        estimatedTimeline,
        proposal.estimatedTimeline
    );
    setInputValue(
        proposedStartDate,
        proposal.proposedStartDate
    );
    setInputValue(
        proposedCompletionDate,
        proposal.proposedCompletionDate
    );
    setInputValue(
        includedRevisions,
        proposal.includedRevisions
    );
    setInputValue(paymentTerms, proposal.paymentTerms);
    setInputValue(
        additionalTerms,
        proposal.additionalTerms
    );
    setInputValue(
        proposalExpirationDate,
        proposal.proposalExpirationDate
    );
    setInputValue(clientMessage, proposal.clientMessage);

    proposalStatus.value = proposal.proposalStatus;
    updateProposalBadge(proposal.proposalStatus);
    proposalNumberDisplay.textContent =
        proposal.proposalNumber ||
        "Number assigned on first proposal save";

    setInputValue(
        emailSubject,
        lead.lastClientEmailSubject
    );
    setInputValue(
        emailBody,
        lead.lastClientEmailBody
    );
}


function collectProposalFormData() {
    const price = readNullableNumber(
        officialPrice.value
    );
    const deposit = readNullableNumber(
        depositAmount.value
    );

    return {
        projectTitle: cleanText(projectTitle.value),
        clientProjectSummary:
            cleanText(clientProjectSummary.value),
        scopeOfWork: cleanText(scopeOfWork.value),
        deliverables: cleanText(deliverables.value),
        officialPrice: price,
        depositAmount: deposit,
        remainingBalance: calculateRemainingBalance(
            price,
            deposit
        ),
        estimatedTimeline:
            cleanText(estimatedTimeline.value),
        proposedStartDate:
            cleanText(proposedStartDate.value),
        proposedCompletionDate:
            cleanText(proposedCompletionDate.value),
        includedRevisions:
            readNullableWholeNumber(
                includedRevisions.value
            ),
        paymentTerms: cleanText(paymentTerms.value),
        additionalTerms:
            cleanText(additionalTerms.value),
        proposalExpirationDate:
            cleanText(proposalExpirationDate.value),
        clientMessage: cleanText(clientMessage.value),
        proposalStatus: proposalStatus.value
    };
}


function proposalHasContent(proposal) {
    return (
        proposalFieldNames.some(function (fieldName) {
            if (fieldName === "proposalStatus") {
                return false;
            }

            const value = proposal[fieldName];

            return value !== null && cleanText(value) !== "";
        }) ||
        proposal.proposalStatus !== "draft"
    );
}


function proposalChanged(lead, proposal) {
    return proposalFieldNames.some(function (fieldName) {
        const existing =
            lead[fieldName] === undefined
                ? proposalDefaults({})[fieldName]
                : lead[fieldName];

        return String(existing ?? "") !==
            String(proposal[fieldName] ?? "");
    });
}


function activityData(type, message) {
    return {
        type,
        message,
        createdAt: serverTimestamp(),
        createdBy: authorizedUser.uid,
        createdByEmail:
            authorizedUser.email || ""
    };
}


async function addActivity(type, message) {
    if (!selectedLeadId || !authorizedUser) {
        throw new Error("No authorized lead is selected.");
    }

    await addDoc(
        collection(
            db,
            "leads",
            selectedLeadId,
            "activities"
        ),
        activityData(type, message)
    );
}


async function ensureProposalNumber(leadId) {
    if (!authorizedUser) {
        throw new Error("Administrator access is required.");
    }

    const leadReference = doc(db, "leads", leadId);

    return runTransaction(
        db,
        async function (transaction) {
            const leadSnapshot =
                await transaction.get(leadReference);

            if (!leadSnapshot.exists()) {
                throw new Error("Lead not found.");
            }

            const leadData = leadSnapshot.data();
            const existingNumber =
                cleanText(leadData.proposalNumber);

            if (existingNumber) {
                return existingNumber;
            }

            const createdDate =
                leadData.createdAt &&
                typeof leadData.createdAt.toDate === "function"
                    ? leadData.createdAt.toDate()
                    : new Date();
            const year = createdDate.getFullYear();
            const counterReference = doc(
                db,
                "crmMeta",
                `proposalCounter-${year}`
            );
            const counterSnapshot =
                await transaction.get(counterReference);
            const previousNumber =
                counterSnapshot.exists() &&
                Number.isInteger(
                    counterSnapshot.data().lastNumber
                )
                    ? counterSnapshot.data().lastNumber
                    : 0;
            const nextNumber = previousNumber + 1;
            const assignedNumber =
                `SFD-${year}-${String(nextNumber).padStart(4, "0")}`;
            const activityReference = doc(
                collection(
                    db,
                    "leads",
                    leadId,
                    "activities"
                )
            );

            transaction.set(
                counterReference,
                {
                    year,
                    lastNumber: nextNumber,
                    updatedAt: serverTimestamp(),
                    updatedBy: authorizedUser.uid
                },
                {merge: true}
            );

            transaction.update(
                leadReference,
                {
                    proposalNumber: assignedNumber,
                    proposalCreatedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }
            );

            transaction.set(
                activityReference,
                activityData(
                    "proposal-created",
                    `Proposal ${assignedNumber} created.`
                )
            );

            return assignedNumber;
        }
    );
}


function makeActivityList(
    lead,
    updateData,
    proposal,
    proposalNumber
) {
    const activities = [];

    if (lead.status !== updateData.status) {
        activities.push({
            type: "status-changed",
            message:
                `Lead status changed from ${statusLabels[lead.status] || "Unknown"} to ${statusLabels[updateData.status]}.`
        });
    }

    if (
        String(lead.quoteAmount ?? "") !==
            String(updateData.quoteAmount ?? "") ||
        String(lead.officialPrice ?? "") !==
            String(proposal.officialPrice ?? "")
    ) {
        activities.push({
            type: "quote-changed",
            message:
                `Official project price updated to ${formatCurrency(proposal.officialPrice)}.`
        });
    }

    if (proposalChanged(lead, proposal)) {
        activities.push({
            type: "proposal-updated",
            message:
                `Proposal ${proposalNumber || "draft"} updated.`
        });
    }

    if (
        lead.proposalStatus !==
        proposal.proposalStatus &&
        proposalActivityTypes[proposal.proposalStatus]
    ) {
        activities.push({
            type:
                proposalActivityTypes[
                    proposal.proposalStatus
                ],
            message:
                `Proposal ${proposalNumber || "draft"} marked as ${proposalStatusLabels[proposal.proposalStatus].toLowerCase()}.`
        });
    }

    return activities;
}


async function writeLeadUpdate(
    leadId,
    updateData,
    activities
) {
    const batch = writeBatch(db);

    batch.update(
        doc(db, "leads", leadId),
        updateData
    );

    activities.forEach(function (activity) {
        const reference = doc(
            collection(
                db,
                "leads",
                leadId,
                "activities"
            )
        );

        batch.set(
            reference,
            activityData(
                activity.type,
                activity.message
            )
        );
    });

    await batch.commit();
}


function setLeadFormBusy(isBusy) {
    updateLeadButton.disabled = isBusy;
    previewProposalButton.disabled = isBusy;
    deleteLeadButton.disabled = isBusy;
    updateLeadButton.textContent =
        isBusy ? "Saving..." : "Save Lead";
}


async function saveLead(options = {}) {
    const lead = getSelectedLead();

    if (!lead || !selectedLeadId) {
        setLeadFormStatus(
            "Select a lead before saving.",
            "error"
        );
        return null;
    }

    if (!leadForm.checkValidity()) {
        leadForm.reportValidity();
        return null;
    }

    const statusValue = leadStatus.value;
    const legacyQuote = readNullableNumber(
        quoteAmount.value
    );
    const proposal = collectProposalFormData();
    const proposalErrors = validateProposal(proposal);

    if (!validStatuses.has(statusValue)) {
        setLeadFormStatus(
            "Choose a valid lead status.",
            "error"
        );
        return null;
    }

    if (
        legacyQuote !== null &&
        (
            Number.isNaN(legacyQuote) ||
            legacyQuote < 0 ||
            legacyQuote > 100000000
        )
    ) {
        setLeadFormStatus(
            "Enter a valid non-negative legacy quote amount.",
            "error"
        );
        return null;
    }

    if (proposalErrors.length) {
        setLeadFormStatus(
            proposalErrors[0],
            "error"
        );
        return null;
    }

    setLeadFormBusy(true);
    setLeadFormStatus("Saving lead...");

    try {
        const needsProposalNumber =
            options.requireProposal === true ||
            proposalHasContent(proposal);
        const proposalNumber = needsProposalNumber
            ? await ensureProposalNumber(selectedLeadId)
            : cleanText(lead.proposalNumber);
        const synchronizedQuote =
            proposal.officialPrice !== null
                ? proposal.officialPrice
                : legacyQuote;
        const updateData = {
            status: statusValue,
            quoteAmount: synchronizedQuote,
            followUpDate:
                cleanText(followUpDate.value),
            internalNotes:
                cleanText(internalNotes.value),
            ...proposal,
            proposalNumber,
            updatedAt: serverTimestamp()
        };

        if (
            proposal.proposalStatus === "sent" &&
            lead.proposalStatus !== "sent"
        ) {
            updateData.proposalSentAt =
                serverTimestamp();
        }

        if (
            proposal.proposalStatus === "accepted" &&
            lead.proposalStatus !== "accepted"
        ) {
            updateData.proposalAcceptedAt =
                serverTimestamp();
        }

        const activities = makeActivityList(
            lead,
            updateData,
            proposal,
            proposalNumber
        );

        await writeLeadUpdate(
            selectedLeadId,
            updateData,
            activities
        );

        quoteAmount.value =
            synchronizedQuote === null
                ? ""
                : String(synchronizedQuote);
        proposalNumberDisplay.textContent =
            proposalNumber ||
            "Number assigned on first proposal save";
        updateProposalBadge(
            proposal.proposalStatus
        );
        setLeadFormStatus(
            "Lead and client documents saved successfully.",
            "success"
        );

        return {
            proposal: {
                ...proposal,
                proposalNumber
            },
            proposalNumber
        };
    } catch (error) {
        console.error("Lead update failed:", error);
        setLeadFormStatus(
            "The lead could not be saved. Check your connection and administrator access.",
            "error"
        );
        return null;
    } finally {
        setLeadFormBusy(false);
    }
}


function renderActivities(activityDocuments) {
    activityList.replaceChildren();

    if (!activityDocuments.length) {
        setStatus(
            activityStatus,
            "No proposal or email activity has been recorded yet."
        );
        return;
    }

    setStatus(activityStatus, "");

    activityDocuments.forEach(function (activity) {
        const item = document.createElement("li");
        const marker = document.createElement("span");
        const content = document.createElement("div");
        const message = document.createElement("strong");
        const meta = document.createElement("span");

        item.className = "crm-activity-item";
        marker.className = "crm-activity-marker";
        marker.setAttribute("aria-hidden", "true");
        message.textContent =
            activity.message || "CRM activity recorded.";
        meta.textContent = [
            formatDateTime(activity.createdAt),
            activity.createdByEmail
                ? `by ${activity.createdByEmail}`
                : ""
        ].filter(Boolean).join(" ");
        content.append(message, meta);
        item.append(marker, content);
        activityList.appendChild(item);
    });
}


function subscribeToActivities(leadId) {
    if (unsubscribeActivities) {
        unsubscribeActivities();
    }

    activityList.replaceChildren();
    setStatus(activityStatus, "Loading activity...");

    unsubscribeActivities = onSnapshot(
        query(
            collection(
                db,
                "leads",
                leadId,
                "activities"
            ),
            orderBy("createdAt", "desc")
        ),
        function (snapshot) {
            renderActivities(
                snapshot.docs.map(function (entry) {
                    return entry.data();
                })
            );
        },
        function (error) {
            console.error(
                "Activity subscription failed:",
                error
            );
            setStatus(
                activityStatus,
                "Activity could not be loaded. Check your connection and administrator access.",
                "error"
            );
        }
    );
}


function closeDialog() {
    selectedLeadId = "";
    setLeadFormStatus("");
    setEmailStatus("");
    activityList.replaceChildren();

    if (unsubscribeActivities) {
        unsubscribeActivities();
        unsubscribeActivities = null;
    }

    if (leadDialog.open) {
        leadDialog.close();
    }
}


function openLead(leadId) {
    const lead = leads.find(function (item) {
        return item.id === leadId;
    });

    if (!lead) {
        return;
    }

    selectedLeadId = lead.id;
    leadDialogTitle.textContent =
        lead.name || "Lead details";

    setDetailText("detailName", lead.name);
    setDetailText("detailBusiness", lead.business);
    setDetailText("detailEmail", lead.email);
    setDetailText("detailPhone", lead.phone);
    setDetailText("detailService", lead.service);
    setDetailText("detailMessage", lead.message);
    setDetailText(
        "detailCreatedAt",
        formatDateTime(lead.createdAt)
    );

    leadStatus.value = validStatuses.has(lead.status)
        ? lead.status
        : "new";
    setInputValue(quoteAmount, lead.quoteAmount);
    setInputValue(followUpDate, lead.followUpDate);
    setInputValue(internalNotes, lead.internalNotes);
    populateProposalFields(lead);

    const telephone = cleanText(lead.phone)
        .replace(/[^0-9+]/g, "");
    const clientEmail = cleanText(lead.email);

    callLead.hidden = !telephone;
    callLead.href = telephone
        ? `tel:${telephone}`
        : "#";
    emailLead.hidden = !clientEmail;
    emailLead.href = clientEmail
        ? `mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent("Your SilverForge project request")}`
        : "#";

    setLeadFormStatus("");
    setEmailStatus(
        lead.lastClientEmailBody
            ? "Loaded the last email marked as sent. Edit or generate a new message."
            : "Choose a template to generate a professional message."
    );
    subscribeToActivities(lead.id);

    if (!leadDialog.open) {
        leadDialog.showModal();
    }
}


async function verifyAdministrator(user) {
    const roleSnapshot = await getDoc(
        doc(db, "roles", user.uid)
    );

    if (!roleSnapshot.exists()) {
        return false;
    }

    const role = roleSnapshot.data();

    return (
        role.role === "admin" &&
        role.active === true
    );
}


function subscribeToLeads() {
    if (unsubscribeLeads) {
        unsubscribeLeads();
    }

    setLeadListStatus("Loading leads...");

    unsubscribeLeads = onSnapshot(
        collection(db, "leads"),
        function (snapshot) {
            leads = snapshot.docs
                .map(function (leadDocument) {
                    return {
                        id: leadDocument.id,
                        ...leadDocument.data()
                    };
                })
                .sort(function (first, second) {
                    return (
                        timestampToMillis(second.createdAt) -
                        timestampToMillis(first.createdAt)
                    );
                });

            if (
                selectedLeadId &&
                !leads.some(function (lead) {
                    return lead.id === selectedLeadId;
                })
            ) {
                closeDialog();
            }

            updateSummary();
            renderLeadList();
        },
        async function (error) {
            console.error(
                "Lead subscription failed:",
                error
            );
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


async function generateEmail() {
    const lead = getSelectedLead();

    if (!lead) {
        setEmailStatus(
            "Select a lead before generating an email.",
            "error"
        );
        return;
    }

    const proposal = collectProposalFormData();
    const errors = validateProposal(proposal);

    if (errors.length) {
        setEmailStatus(errors[0], "error");
        return;
    }

    generateEmailButton.disabled = true;
    generateEmailButton.textContent = "Generating...";
    setEmailStatus("Generating email...");

    try {
        const number =
            emailTemplate.value === "send-proposal"
                ? await ensureProposalNumber(
                    selectedLeadId
                )
                : cleanText(lead.proposalNumber);
        const context = buildClientContext(
            lead,
            {
                ...proposal,
                proposalNumber: number
            }
        );
        const generated = buildEmailTemplate(
            emailTemplate.value,
            context
        );

        emailSubject.value = generated.subject;
        emailBody.value = generated.body;
        proposalNumberDisplay.textContent = number;

        await addActivity(
            "email-generated",
            `${emailTemplateLabels[emailTemplate.value]} email generated.`
        );

        setEmailStatus(
            "Professional email generated. Review and edit it before sending.",
            "success"
        );
    } catch (error) {
        console.error("Email generation failed:", error);
        setEmailStatus(
            "The email could not be generated or recorded. Check your connection and try again.",
            "error"
        );
    } finally {
        generateEmailButton.disabled = false;
        generateEmailButton.textContent = "Generate Email";
    }
}


async function copyEmail() {
    const subject = cleanText(emailSubject.value);
    const body = cleanText(emailBody.value);

    if (!subject || !body) {
        setEmailStatus(
            "Generate or enter an email subject and body first.",
            "error"
        );
        return;
    }

    try {
        await navigator.clipboard.writeText(
            `Subject: ${subject}\n\n${body}`
        );
        setEmailStatus(
            "Email copied to the clipboard.",
            "success"
        );
    } catch (error) {
        console.error("Clipboard copy failed:", error);
        setEmailStatus(
            "The browser could not copy the email. Select the text and copy it manually.",
            "error"
        );
    }
}


function openEmailApp() {
    const lead = getSelectedLead();
    const clientEmail = cleanText(lead?.email);
    const subject = cleanText(emailSubject.value);
    const body = cleanText(emailBody.value);

    if (!clientEmail) {
        setEmailStatus(
            "This lead does not have a client email address.",
            "error"
        );
        return;
    }

    if (!subject || !body) {
        setEmailStatus(
            "Generate or enter an email subject and body first.",
            "error"
        );
        return;
    }

    const mailto =
        `mailto:${encodeURIComponent(clientEmail)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;

    try {
        window.location.href = mailto;
        setEmailStatus(
            "The email was opened in your default email app. It has not been marked as sent.",
            "success"
        );
    } catch (error) {
        console.error("Email app failed to open:", error);
        setEmailStatus(
            "The browser could not open an email app. Copy the message instead.",
            "error"
        );
    }
}


async function markEmailAsSent() {
    const lead = getSelectedLead();
    const subject = cleanText(emailSubject.value);
    const body = cleanText(emailBody.value);

    if (!lead?.email) {
        setEmailStatus(
            "This lead does not have a client email address.",
            "error"
        );
        return;
    }

    if (!subject || !body) {
        setEmailStatus(
            "Generate or enter an email subject and body first.",
            "error"
        );
        return;
    }

    markEmailSentButton.disabled = true;
    markEmailSentButton.textContent = "Recording...";
    setEmailStatus("Recording sent email...");

    try {
        await writeLeadUpdate(
            selectedLeadId,
            {
                lastClientEmailSubject: subject,
                lastClientEmailBody: body,
                lastClientEmailSentAt:
                    serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            [{
                type: "email-sent",
                message:
                    `Email marked as sent: ${subject}`
            }]
        );

        setEmailStatus(
            "Email marked as sent and added to the activity timeline.",
            "success"
        );
    } catch (error) {
        console.error(
            "Sent email activity failed:",
            error
        );
        setEmailStatus(
            "The sent email could not be recorded. Check your connection and access.",
            "error"
        );
    } finally {
        markEmailSentButton.disabled = false;
        markEmailSentButton.textContent =
            "Mark Email as Sent";
    }
}


async function openProposalPreview() {
    if (!selectedLeadId) {
        setLeadFormStatus(
            "Select a lead before previewing a proposal.",
            "error"
        );
        return;
    }

    const previewWindow = window.open(
        "about:blank",
        "_blank"
    );

    if (!previewWindow) {
        setLeadFormStatus(
            "The proposal preview was blocked. Allow popups for this site and try again.",
            "error"
        );
        return;
    }

    previewWindow.document.title =
        "Preparing SilverForge proposal...";
    previewWindow.document.body.textContent =
        "Preparing proposal...";

    const saved = await saveLead({
        requireProposal: true
    });

    if (!saved) {
        previewWindow.close();
        return;
    }

    previewWindow.location.replace(
        `proposal.html?lead=${encodeURIComponent(selectedLeadId)}`
    );
    previewWindow.opener = null;
}


async function deleteLeadAndActivities(leadId) {
    const activitiesSnapshot = await getDocs(
        collection(
            db,
            "leads",
            leadId,
            "activities"
        )
    );
    const activityDocuments =
        activitiesSnapshot.docs.slice();

    while (activityDocuments.length > 0) {
        const batch = writeBatch(db);
        const currentBatch =
            activityDocuments.splice(0, 450);

        currentBatch.forEach(function (entry) {
            batch.delete(entry.ref);
        });

        await batch.commit();
    }

    await deleteDoc(doc(db, "leads", leadId));
}


leadSearch.addEventListener("input", renderLeadList);
statusFilter.addEventListener("change", renderLeadList);
closeLeadDialog.addEventListener("click", closeDialog);
officialPrice.addEventListener(
    "input",
    updateRemainingBalance
);
depositAmount.addEventListener(
    "input",
    updateRemainingBalance
);
proposalStatus.addEventListener(
    "change",
    function () {
        updateProposalBadge(proposalStatus.value);
    }
);
generateEmailButton.addEventListener(
    "click",
    generateEmail
);
copyEmailButton.addEventListener("click", copyEmail);
openEmailButton.addEventListener(
    "click",
    openEmailApp
);
markEmailSentButton.addEventListener(
    "click",
    markEmailAsSent
);
previewProposalButton.addEventListener(
    "click",
    openProposalPreview
);

leadDialog.addEventListener(
    "cancel",
    function (event) {
        event.preventDefault();
        closeDialog();
    }
);

leadDialog.addEventListener(
    "click",
    function (event) {
        if (event.target === leadDialog) {
            closeDialog();
        }
    }
);

leadForm.addEventListener(
    "submit",
    async function (event) {
        event.preventDefault();
        await saveLead();
    }
);

deleteLeadButton.addEventListener(
    "click",
    async function () {
        const lead = getSelectedLead();

        if (!lead || !selectedLeadId) {
            return;
        }

        const confirmed = window.confirm(
            `Delete the lead for ${lead.name || "this customer"}, including its activity history? This cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        setLeadFormBusy(true);
        deleteLeadButton.textContent = "Deleting...";
        setLeadFormStatus("Deleting lead...");

        try {
            await deleteLeadAndActivities(
                selectedLeadId
            );
            closeDialog();
        } catch (error) {
            console.error("Lead deletion failed:", error);
            setLeadFormStatus(
                "The lead could not be deleted. Check your connection and access.",
                "error"
            );
        } finally {
            deleteLeadButton.textContent = "Delete Lead";
            setLeadFormBusy(false);
        }
    }
);

signOutButton.addEventListener(
    "click",
    async function () {
        signOutButton.disabled = true;
        signOutButton.textContent = "Signing out...";

        if (unsubscribeLeads) {
            unsubscribeLeads();
            unsubscribeLeads = null;
        }

        if (unsubscribeActivities) {
            unsubscribeActivities();
            unsubscribeActivities = null;
        }

        try {
            await signOut(auth);
        } finally {
            redirectToLogin();
        }
    }
);

if (!isFirebaseConfigured || !auth || !db) {
    setAccessMessage(
        "Firebase is not configured. Update firebase-config.js before opening the CRM."
    );
} else {
    onAuthStateChanged(
        auth,
        async function (user) {
            if (!user) {
                redirectToLogin(
                    pendingRedirectReason
                );
                return;
            }

            if (authorizedUser?.uid === user.uid) {
                return;
            }

            setAccessMessage(
                "Verifying administrator access..."
            );

            try {
                const authorized =
                    await verifyAdministrator(user);

                if (!authorized) {
                    pendingRedirectReason =
                        "unauthorized";
                    await signOut(auth);
                    return;
                }

                authorizedUser = user;
                adminEmail.textContent =
                    user.email || "Administrator";
                accessGate.hidden = true;
                crmApp.hidden = false;
                subscribeToLeads();
            } catch (error) {
                console.error(
                    "CRM authorization failed:",
                    error
                );
                pendingRedirectReason =
                    "unauthorized";
                await signOut(auth);
            }
        },
        function (error) {
            console.error(
                "CRM auth observer failed:",
                error
            );
            redirectToLogin();
        }
    );
}

window.addEventListener(
    "beforeunload",
    function () {
        if (unsubscribeLeads) {
            unsubscribeLeads();
        }

        if (unsubscribeActivities) {
            unsubscribeActivities();
        }
    }
);
