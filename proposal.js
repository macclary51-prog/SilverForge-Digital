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
    collection,
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    buildClientContext,
    buildProposalPlainText,
    cleanText,
    formatCurrency,
    formatDateValue,
    proposalStatusLabels,
    splitDeliverables
} from "./crm-utils.js";

const byId = function (id) {
    return document.getElementById(id);
};

const accessGate = byId("proposalAccessGate");
const accessMessage = byId("proposalAccessMessage");
const accessReturn = byId("proposalAccessReturn");
const proposalApp = byId("proposalApp");
const actionStatus = byId("proposalActionStatus");
const printButton = byId("printProposalButton");
const savePdfButton = byId("savePdfButton");
const copyButton = byId("copyProposalButton");
const markSentButton = byId("markProposalSentButton");
const closeButton = byId("closePreviewButton");

const leadId = new URLSearchParams(
    window.location.search
).get("lead") || "";

let authorizedUser = null;
let leadReference = null;
let currentLead = null;
let clientContext = null;


function setActionStatus(message, state = "") {
    actionStatus.textContent = message;
    actionStatus.dataset.state = state;
}


function setAccessError(message) {
    accessMessage.textContent = message;
    accessGate.dataset.state = "error";
    accessReturn.hidden = false;
}


function redirectToLogin(reason = "") {
    const returnPath = leadId
        ? `proposal.html?lead=${encodeURIComponent(leadId)}`
        : "crm.html";
    const parameters = new URLSearchParams({
        return: returnPath
    });

    if (reason) {
        parameters.set("reason", reason);
    }

    window.location.replace(
        `crm-login.html?${parameters.toString()}`
    );
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


function timestampToDate(timestamp) {
    if (
        timestamp &&
        typeof timestamp.toDate === "function"
    ) {
        return timestamp.toDate();
    }

    return null;
}


function formatTimestampDate(timestamp) {
    const date = timestampToDate(timestamp);

    if (!date) {
        return "Pending";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {dateStyle: "long"}
    ).format(date);
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


async function ensureProposalNumber() {
    return runTransaction(
        db,
        async function (transaction) {
            const leadSnapshot =
                await transaction.get(leadReference);

            if (!leadSnapshot.exists()) {
                throw new Error("Lead not found.");
            }

            const lead = leadSnapshot.data();
            const existingNumber =
                cleanText(lead.proposalNumber);

            if (existingNumber) {
                return {
                    proposalNumber: existingNumber,
                    proposalCreatedAt:
                        lead.proposalCreatedAt ||
                        lead.createdAt ||
                        null
                };
            }

            const createdDate =
                timestampToDate(lead.createdAt) ||
                new Date();
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
            const proposalNumber =
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
                    proposalNumber,
                    proposalCreatedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }
            );
            transaction.set(
                activityReference,
                activityData(
                    "proposal-created",
                    `Proposal ${proposalNumber} created.`
                )
            );

            return {
                proposalNumber,
                proposalCreatedAt:
                    lead.createdAt || null
            };
        }
    );
}


function setText(id, value, fallback = "Not set") {
    byId(id).textContent = cleanText(value) || fallback;
}


function renderDeliverables(value) {
    const list = byId("proposalDeliverables");
    const items = splitDeliverables(value);

    list.replaceChildren();

    (items.length ? items : ["To be confirmed."])
        .forEach(function (itemText) {
            const item = document.createElement("li");

            item.textContent = itemText;
            list.appendChild(item);
        });
}


function renderProposal(lead, numberData) {
    const proposalData = {
        projectTitle: lead.projectTitle,
        clientProjectSummary:
            lead.clientProjectSummary,
        scopeOfWork: lead.scopeOfWork,
        deliverables: lead.deliverables,
        officialPrice: lead.officialPrice,
        depositAmount: lead.depositAmount,
        remainingBalance: lead.remainingBalance,
        estimatedTimeline: lead.estimatedTimeline,
        proposedStartDate: lead.proposedStartDate,
        proposedCompletionDate:
            lead.proposedCompletionDate,
        includedRevisions: lead.includedRevisions,
        paymentTerms: lead.paymentTerms,
        additionalTerms: lead.additionalTerms,
        proposalExpirationDate:
            lead.proposalExpirationDate,
        clientMessage: lead.clientMessage,
        proposalStatus: lead.proposalStatus,
        proposalNumber: numberData.proposalNumber
    };

    clientContext = buildClientContext(
        {
            name: lead.name,
            business: lead.business,
            email: lead.email,
            phone: lead.phone,
            service: lead.service,
            message: lead.message
        },
        proposalData
    );

    const status = clientContext.proposalStatus;
    const statusLabel =
        proposalStatusLabels[status] || "Draft";
    const statusBadge = byId("proposalDocumentStatus");
    const clientMessage =
        byId("proposalClientMessage");

    document.title =
        `${clientContext.proposalNumber} | SilverForge Proposal`;
    setText(
        "proposalNumber",
        clientContext.proposalNumber,
        "Pending"
    );
    setText(
        "proposalCreatedDate",
        formatTimestampDate(
            numberData.proposalCreatedAt ||
            lead.proposalCreatedAt ||
            lead.createdAt
        ),
        "Pending"
    );
    setText(
        "proposalExpiration",
        formatDateValue(
            clientContext.proposalExpirationDate
        )
    );
    setText(
        "proposalClientName",
        clientContext.clientName,
        "Client"
    );
    setText(
        "proposalBusinessName",
        clientContext.businessName,
        "Business name not provided"
    );
    setText("proposalClientEmail", clientContext.email, "");
    setText("proposalClientPhone", clientContext.phone, "");
    setText(
        "proposalProjectTitle",
        clientContext.projectTitle,
        "Project Proposal"
    );
    setText(
        "proposalOverview",
        clientContext.projectSummary,
        "To be confirmed."
    );
    setText(
        "proposalScope",
        clientContext.scopeOfWork,
        "To be confirmed."
    );
    setText(
        "proposalTimeline",
        clientContext.estimatedTimeline,
        "To be confirmed"
    );
    setText(
        "proposalStartDate",
        formatDateValue(
            clientContext.proposedStartDate
        )
    );
    setText(
        "proposalCompletionDate",
        formatDateValue(
            clientContext.proposedCompletionDate
        )
    );
    setText(
        "proposalOfficialPrice",
        formatCurrency(clientContext.officialPrice)
    );
    setText(
        "proposalDepositAmount",
        formatCurrency(clientContext.depositAmount)
    );
    setText(
        "proposalRemainingBalance",
        formatCurrency(clientContext.remainingBalance)
    );
    setText(
        "proposalPaymentTerms",
        clientContext.paymentTerms,
        "To be confirmed."
    );
    setText(
        "proposalRevisions",
        clientContext.includedRevisions === null
            ? "To be confirmed"
            : String(clientContext.includedRevisions)
    );
    setText(
        "proposalAdditionalTerms",
        clientContext.additionalTerms,
        "None specified."
    );

    clientMessage.textContent =
        clientContext.clientMessage;
    clientMessage.hidden =
        !clientContext.clientMessage;
    statusBadge.textContent = statusLabel;
    statusBadge.className =
        `proposal-status-badge proposal-status-${status}`;
    markSentButton.disabled = status === "sent";
    markSentButton.textContent =
        status === "sent"
            ? "Proposal Marked as Sent"
            : "Mark Proposal as Sent";
    renderDeliverables(clientContext.deliverables);
}


async function loadProposal() {
    if (!leadId) {
        setAccessError(
            "No lead was selected. Return to the CRM and open a proposal from a lead."
        );
        return;
    }

    leadReference = doc(db, "leads", leadId);

    const initialSnapshot = await getDoc(leadReference);

    if (!initialSnapshot.exists()) {
        setAccessError(
            "This lead no longer exists. Return to the CRM and choose another lead."
        );
        return;
    }

    const numberData = await ensureProposalNumber();
    const refreshedSnapshot = await getDoc(leadReference);

    if (!refreshedSnapshot.exists()) {
        setAccessError(
            "This lead no longer exists."
        );
        return;
    }

    currentLead = refreshedSnapshot.data();
    renderProposal(currentLead, {
        ...numberData,
        proposalCreatedAt:
            currentLead.proposalCreatedAt ||
            numberData.proposalCreatedAt
    });
    accessGate.hidden = true;
    proposalApp.hidden = false;
}


async function copyProposalText() {
    if (!clientContext) {
        setActionStatus(
            "The proposal is not ready to copy.",
            "error"
        );
        return;
    }

    try {
        await navigator.clipboard.writeText(
            buildProposalPlainText(clientContext)
        );
        setActionStatus(
            "Client-safe proposal text copied to the clipboard.",
            "success"
        );
    } catch (error) {
        console.error("Proposal copy failed:", error);
        setActionStatus(
            "The browser could not copy the proposal. Use Print or Save as PDF instead.",
            "error"
        );
    }
}


async function markProposalAsSent() {
    if (!currentLead || !leadReference) {
        setActionStatus(
            "The proposal is not ready.",
            "error"
        );
        return;
    }

    const alreadySent =
        currentLead.proposalStatus === "sent";

    if (alreadySent) {
        setActionStatus(
            "This proposal is already marked as sent."
        );
        return;
    }

    markSentButton.disabled = true;
    markSentButton.textContent = "Recording...";
    setActionStatus("Recording proposal activity...");

    try {
        const batch = writeBatch(db);
        const activityReference = doc(
            collection(
                db,
                "leads",
                leadId,
                "activities"
            )
        );
        const updateData = {
            proposalStatus: "sent",
            proposalSentAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        if (
            currentLead.status === "new" ||
            currentLead.status === "contacted" ||
            currentLead.status === "qualified"
        ) {
            updateData.status = "quote-sent";
        }

        batch.update(leadReference, updateData);
        batch.set(
            activityReference,
            activityData(
                "proposal-sent",
                `Proposal ${clientContext.proposalNumber} marked as sent.`
            )
        );
        await batch.commit();

        currentLead.proposalStatus = "sent";
        currentLead.status =
            updateData.status || currentLead.status;
        clientContext = Object.freeze({
            ...clientContext,
            proposalStatus: "sent"
        });
        byId("proposalDocumentStatus").textContent =
            proposalStatusLabels.sent;
        byId("proposalDocumentStatus").className =
            "proposal-status-badge proposal-status-sent";
        markSentButton.textContent =
            "Proposal Marked as Sent";
        setActionStatus(
            "Proposal marked as sent and added to the activity timeline.",
            "success"
        );
    } catch (error) {
        console.error(
            "Proposal sent activity failed:",
            error
        );
        markSentButton.disabled = false;
        markSentButton.textContent =
            "Mark Proposal as Sent";
        setActionStatus(
            "The proposal could not be marked as sent. Check your connection and administrator access.",
            "error"
        );
    }
}


function openPrintDialog(saveAsPdf = false) {
    setActionStatus(
        saveAsPdf
            ? "In the print window, choose Save as PDF as the destination."
            : "Opening the print window..."
    );

    try {
        window.print();
    } catch (error) {
        console.error("Proposal print failed:", error);
        setActionStatus(
            "The browser could not open the print window. Try the browser's Print command instead.",
            "error"
        );
    }
}


printButton.addEventListener("click", function () {
    openPrintDialog(false);
});

savePdfButton.addEventListener("click", function () {
    openPrintDialog(true);
});

copyButton.addEventListener("click", copyProposalText);
markSentButton.addEventListener(
    "click",
    markProposalAsSent
);
closeButton.addEventListener("click", function () {
    window.close();

    window.setTimeout(function () {
        if (!window.closed) {
            window.location.href = "crm.html";
        }
    }, 150);
});


if (!isFirebaseConfigured || !auth || !db) {
    setAccessError(
        "Firebase is not configured. Update firebase-config.js before opening proposals."
    );
} else {
    onAuthStateChanged(
        auth,
        async function (user) {
            if (!user) {
                redirectToLogin();
                return;
            }

            if (authorizedUser?.uid === user.uid) {
                return;
            }

            try {
                const authorized =
                    await verifyAdministrator(user);

                if (!authorized) {
                    await signOut(auth);
                    redirectToLogin("unauthorized");
                    return;
                }

                authorizedUser = user;
                await loadProposal();
            } catch (error) {
                console.error(
                    "Proposal access failed:",
                    error
                );
                setAccessError(
                    "The proposal could not be loaded. Check your connection and administrator access."
                );
            }
        },
        function (error) {
            console.error(
                "Proposal auth observer failed:",
                error
            );
            redirectToLogin();
        }
    );
}
