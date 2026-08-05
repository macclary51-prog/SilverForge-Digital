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
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
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

const validStatuses =
    new Set(Object.keys(statusLabels));

// Keep the customer-facing business signature easy to update in one place.
const EMAIL_SIGNATURE = [
    "Best regards,",
    "",
    "Michael Macclary",
    "SilverForge Digital Solutions",
    "App Development • Website Development • Digital Services"
].join("\n");

const emailTemplateLabels = {
    "initial-response": "Initial Response",
    "request-more-information": "Request More Information",
    "send-quote": "Send Quote",
    "follow-up": "Follow Up",
    "quote-accepted": "Quote Accepted",
    "request-project-content": "Request Project Content",
    "project-progress-update": "Project Progress Update",
    "project-completed": "Project Completed",
    "custom-message": "Custom Message"
};

const validEmailTemplates =
    new Set(Object.keys(emailTemplateLabels));

const accessGate =
    document.getElementById("accessGate");

const accessMessage =
    document.getElementById("accessMessage");

const crmApp =
    document.getElementById("crmApp");

const adminEmail =
    document.getElementById("adminEmail");

const signOutButton =
    document.getElementById("signOutButton");

const leadSearch =
    document.getElementById("leadSearch");

const statusFilter =
    document.getElementById("statusFilter");

const leadResultCount =
    document.getElementById("leadResultCount");

const leadListStatus =
    document.getElementById("leadListStatus");

const leadList =
    document.getElementById("leadList");

const leadDialog =
    document.getElementById("leadDialog");

const closeLeadDialog =
    document.getElementById("closeLeadDialog");

const leadDialogTitle =
    document.getElementById("leadDialogTitle");

const callLead =
    document.getElementById("callLead");

const emailLead =
    document.getElementById("emailLead");

const leadForm =
    document.getElementById("leadForm");

const leadStatus =
    document.getElementById("leadStatus");

const quoteAmount =
    document.getElementById("quoteAmount");

const followUpDate =
    document.getElementById("followUpDate");

const internalNotes =
    document.getElementById("internalNotes");

const leadFormStatus =
    document.getElementById("leadFormStatus");

const updateLeadButton =
    document.getElementById("updateLeadButton");

const deleteLeadButton =
    document.getElementById("deleteLeadButton");

const emailTemplate =
    document.getElementById("emailTemplate");

const emailSubject =
    document.getElementById("emailSubject");

const emailMessage =
    document.getElementById("emailMessage");

const generateEmailButton =
    document.getElementById("generateEmailButton");

const copyEmailButton =
    document.getElementById("copyEmailButton");

const openEmailButton =
    document.getElementById("openEmailButton");

const markEmailSentButton =
    document.getElementById("markEmailSentButton");

const emailStatus =
    document.getElementById("emailStatus");

const communicationHistoryStatus =
    document.getElementById("communicationHistoryStatus");

const communicationHistoryList =
    document.getElementById("communicationHistoryList");

let leads = [];
let selectedLeadId = "";
let unsubscribeLeads = null;
let unsubscribeCommunications = null;
let authorizedUid = "";
let pendingRedirectReason = "";


function redirectToLogin(reason = "") {
    const query = reason
        ? `?reason=${encodeURIComponent(reason)}`
        : "";

    window.location.replace(
        `crm-login.html${query}`
    );
}


function setAccessMessage(message) {
    accessMessage.textContent = message;
}


function setLeadListStatus(message, state = "") {
    leadListStatus.textContent = message;
    leadListStatus.dataset.state = state;
    leadListStatus.hidden = !message;
}


function setLeadFormStatus(message, state = "") {
    leadFormStatus.textContent = message;
    leadFormStatus.dataset.state = state;
}


function setEmailStatus(message, state = "") {
    emailStatus.textContent = message;
    emailStatus.dataset.state = state;
}


function setCommunicationHistoryStatus(
    message,
    state = ""
) {
    communicationHistoryStatus.textContent = message;
    communicationHistoryStatus.dataset.state = state;
    communicationHistoryStatus.hidden = !message;
}


function getSelectedLead() {
    return leads.find(function (lead) {
        return lead.id === selectedLeadId;
    }) || null;
}


function getFirstName(name) {
    const normalizedName = String(
        name || ""
    ).trim();

    return normalizedName
        ? normalizedName.split(/\s+/)[0]
        : "there";
}


function getProjectSummary(message) {
    const normalizedMessage = String(
        message || ""
    ).replace(/\s+/g, " ").trim();

    if (normalizedMessage.length <= 360) {
        return normalizedMessage;
    }

    return `${normalizedMessage.slice(0, 357).trimEnd()}...`;
}


function formatFollowUpDate(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) {
        return "";
    }

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const date = new Date(year, month - 1, day);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return "";
    }

    return new Intl.DateTimeFormat(
        undefined,
        { dateStyle: "long" }
    ).format(date);
}


function getCurrentQuoteAmount() {
    const value = quoteAmount.value.trim();

    if (!value) {
        return null;
    }

    const amount = Number(value);

    return (
        Number.isFinite(amount) &&
        amount >= 0 &&
        amount <= 100000000
    )
        ? amount
        : null;
}


function isValidEmailAddress(value) {
    const email = String(value || "").trim();

    return (
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );
}


function getEmailDraft() {
    return {
        template: emailTemplate.value,
        subject: emailSubject.value.trim(),
        body: emailMessage.value
    };
}


function validateEmailDraft({ requireRecipient = false } = {}) {
    const lead = getSelectedLead();

    if (!lead) {
        return {
            error: "No lead is selected. Open a lead before working with customer email."
        };
    }

    const draft = getEmailDraft();

    if (!validEmailTemplates.has(draft.template)) {
        return {
            error: "Choose a valid email template."
        };
    }

    if (!draft.subject) {
        return {
            error: "Enter an email subject before continuing."
        };
    }

    if (draft.subject.length > 998) {
        return {
            error: "The email subject is too long."
        };
    }

    if (!draft.body.trim()) {
        return {
            error: "Enter an email message before continuing."
        };
    }

    if (draft.body.length > 20000) {
        return {
            error: "The email message is too long."
        };
    }

    const recipient = String(
        lead.email || ""
    ).trim();

    if (
        requireRecipient &&
        !isValidEmailAddress(recipient)
    ) {
        return {
            error: recipient
                ? "The customer email address is invalid. Update the lead before opening or recording an email."
                : "This lead does not have a customer email address."
        };
    }

    return {
        lead,
        recipient,
        ...draft
    };
}


function describeFirestoreError(error, action) {
    if (error?.code === "permission-denied") {
        return `${action} was blocked by Firestore. Confirm that your administrator role is active and the latest rules are deployed.`;
    }

    if (
        error?.code === "unavailable" ||
        error?.code === "deadline-exceeded"
    ) {
        return `${action} could not be completed because the network is unavailable. Check your connection and try again.`;
    }

    return `${action} could not be completed. Check your connection and administrator access, then try again.`;
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


function formatCurrency(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "Not set";
    }

    return new Intl.NumberFormat(
        undefined,
        {
            style: "currency",
            currency: "USD"
        }
    ).format(Number(value));
}


function addEmailSignature(message) {
    return `${message}\n\n${EMAIL_SIGNATURE}`;
}


function createEmailFromTemplate(template, lead) {
    const firstName = getFirstName(lead.name);
    const business = String(
        lead.business || ""
    ).trim();
    const service = String(
        lead.service || ""
    ).trim() || "your project";
    const projectSummary =
        getProjectSummary(lead.message);
    const businessContext = business
        ? ` for ${business}`
        : "";
    const projectReference = projectSummary
        ? `\n\nProject request: ${projectSummary}`
        : "";
    const quote = getCurrentQuoteAmount();
    const formattedFollowUpDate =
        formatFollowUpDate(followUpDate.value);

    switch (template) {
        case "initial-response":
            return {
                subject: "Thank You for Contacting SilverForge Digital Solutions",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nThank you for contacting SilverForge Digital Solutions about ${service}${businessContext}. We received your project request and will review the details carefully.${projectReference}\n\nAfter our review, we will follow up with the next steps. We may have a few questions to make sure we fully understand what you need.\n\nThank you again for the opportunity to learn about your project.`
                )
            };

        case "request-more-information":
            return {
                subject: "Additional Information Needed for Your Project",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nThank you for sharing the details of your ${service} project${businessContext}. To make sure we understand your requirements and can plan accurately, we need a little more information.${projectReference}\n\nQuestions:\n- [Add question here]\n- [Add question here]\n\nPlease reply whenever it is convenient, and feel free to include any other details that may help us understand the project.`
                )
            };

        case "send-quote":
            if (quote === null) {
                return {
                    error: "Add a valid quote amount to the lead before generating the Send Quote email."
                };
            }

            return {
                subject: "Your SilverForge Project Quote",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nThank you for the opportunity to prepare a quote for your ${service} project${businessContext}. Based on the project requirements we have discussed, the current quote is ${formatCurrency(quote)}.\n\nThis quote reflects the scope and details currently available. If you have questions, would like clarification, or want to discuss changes to the project requirements, please let us know.\n\nWe look forward to hearing from you.`
                )
            };

        case "follow-up":
            return {
                subject: "Following Up on Your SilverForge Project",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nI wanted to follow up${formattedFollowUpDate ? ` as planned for ${formattedFollowUpDate}` : ""} about your ${service} project${businessContext}.${projectReference}\n\nWould you still like to continue with the project? If you have any questions or if your needs have changed, please let us know. We would be happy to help.\n\nWe look forward to hearing from you.`
                )
            };

        case "quote-accepted":
            if (quote === null) {
                return {
                    error: "Add the accepted quote amount to the lead before generating the Quote Accepted email."
                };
            }

            return {
                subject: "SilverForge Project Confirmation",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nThank you for accepting the ${formatCurrency(quote)} quote for your ${service} project${businessContext}. We appreciate the opportunity to work with you.\n\nYour project is confirmed. We will be in touch to discuss the next steps, schedule, and any content or access we need to begin.\n\nWe look forward to bringing your project to life.`
                )
            };

        case "request-project-content":
            return {
                subject: "Content Needed for Your SilverForge Project",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nTo keep your ${service} project moving forward, we need the following content and information from you:\n\nContent checklist:\n- [Add requested text or business information]\n- [Add requested photos, graphics, or logo files]\n- [Add any non-sensitive account details or access instructions]\n- [Add other project-specific items]\n\nYou may send the items that apply to your project when they are ready. For your security, please never send passwords by email. We can arrange a safer way to handle any access that is required.\n\nPlease let us know if you have questions about any item on the list.`
                )
            };

        case "project-progress-update":
            return {
                subject: "Update on Your SilverForge Project",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nHere is the latest update on your ${service} project${businessContext}.\n\nCurrent progress:\n[Add current progress here]\n\nNext steps:\n[Add next steps and any customer action needed here]\n\nPlease let us know if you have any questions about this update.`
                )
            };

        case "project-completed":
            return {
                subject: "Your SilverForge Project Is Complete",
                body: addEmailSignature(
                    `Hi ${firstName},\n\nYour ${service} project${businessContext} is complete. Thank you for choosing SilverForge Digital Solutions and for working with us throughout the project.\n\nDelivery details or next steps:\n[Add delivery information, launch details, or next steps here]\n\nIf you need support or have any questions after delivery, please contact us. We will be glad to help.`
                )
            };

        case "custom-message":
            return {
                subject: "A Message from SilverForge Digital Solutions",
                body: addEmailSignature(
                    `Hi ${firstName},\n\n[Write your customer message here]`
                )
            };

        default:
            return {
                error: "Choose a valid email template."
            };
    }
}


function createCommunicationMetaItem(label, value) {
    const item = document.createElement("div");
    const itemLabel = document.createElement("span");
    const itemValue = document.createElement("strong");

    itemLabel.textContent = label;
    itemValue.textContent = value;
    item.append(itemLabel, itemValue);

    return item;
}


function renderCommunications(communications) {
    communicationHistoryList.replaceChildren();

    if (!communications.length) {
        setCommunicationHistoryStatus(
            "No customer emails have been marked as sent yet."
        );
        return;
    }

    setCommunicationHistoryStatus("");

    communications.forEach(function (communication) {
        const record = document.createElement("article");
        const subject = document.createElement("h5");
        const meta = document.createElement("div");
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        const body = document.createElement("pre");

        record.className = "crm-communication-record";
        subject.textContent = `Subject: ${
            communication.subject || "No subject"
        }`;
        meta.className = "crm-communication-meta";

        meta.append(
            createCommunicationMetaItem(
                "Template",
                emailTemplateLabels[communication.template] ||
                    communication.template ||
                    "Unknown"
            ),
            createCommunicationMetaItem(
                "Recipient",
                communication.recipient || "Not recorded"
            ),
            createCommunicationMetaItem(
                "Marked sent",
                formatDateTime(communication.markedSentAt)
            )
        );

        summary.textContent = "View full email";
        body.textContent = communication.body || "";
        details.append(summary, body);
        record.append(subject, meta, details);
        communicationHistoryList.appendChild(record);
    });
}


function stopCommunicationSubscription() {
    if (unsubscribeCommunications) {
        unsubscribeCommunications();
        unsubscribeCommunications = null;
    }
}


function subscribeToCommunications(leadId) {
    stopCommunicationSubscription();
    communicationHistoryList.replaceChildren();
    setCommunicationHistoryStatus(
        "Loading communication history..."
    );

    unsubscribeCommunications = onSnapshot(
        collection(
            db,
            "leads",
            leadId,
            "communications"
        ),
        function (snapshot) {
            if (selectedLeadId !== leadId) {
                return;
            }

            const communications = snapshot.docs
                .map(function (communicationDocument) {
                    return {
                        id: communicationDocument.id,
                        ...communicationDocument.data()
                    };
                })
                .sort(function (a, b) {
                    return (
                        timestampToMillis(b.markedSentAt) -
                        timestampToMillis(a.markedSentAt)
                    );
                });

            renderCommunications(communications);
        },
        function (error) {
            if (selectedLeadId !== leadId) {
                return;
            }

            console.error(
                "Communication subscription failed:",
                error
            );
            communicationHistoryList.replaceChildren();
            setCommunicationHistoryStatus(
                describeFirestoreError(
                    error,
                    "Communication history"
                ),
                "error"
            );
        }
    );
}


function setDetailText(id, value) {
    const element =
        document.getElementById(id);

    element.textContent =
        String(value || "").trim() || "Not provided";
}


function createMetaItem(label, value) {
    const item =
        document.createElement("div");

    const itemLabel =
        document.createElement("span");

    const itemValue =
        document.createElement("strong");

    itemLabel.textContent = label;
    itemValue.textContent = value;

    item.append(itemLabel, itemValue);

    return item;
}


function getFilteredLeads() {
    const query =
        leadSearch.value.trim().toLowerCase();

    const selectedStatus =
        statusFilter.value;

    return leads.filter(function (lead) {
        const matchesStatus =
            selectedStatus === "all" ||
            lead.status === selectedStatus;

        if (!matchesStatus) {
            return false;
        }

        if (!query) {
            return true;
        }

        const searchableText = [
            lead.name,
            lead.business,
            lead.email,
            lead.phone,
            lead.service,
            lead.message
        ].join(" ").toLowerCase();

        return searchableText.includes(query);
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

    document.getElementById("totalLeads").textContent =
        String(leads.length);

    document.getElementById("newLeads").textContent =
        String(counts["new"]);

    document.getElementById("quotesSent").textContent =
        String(counts["quote-sent"]);

    document.getElementById("acceptedProjects").textContent =
        String(counts["accepted"]);

    document.getElementById("inProgressProjects").textContent =
        String(counts["in-progress"]);

    document.getElementById("completedProjects").textContent =
        String(counts["completed"]);
}


function renderLeadList() {
    const filteredLeads =
        getFilteredLeads();

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
        const card =
            document.createElement("article");

        card.className = "crm-lead-card";
        card.setAttribute("role", "listitem");

        const cardHeader =
            document.createElement("div");

        cardHeader.className =
            "crm-lead-card-header";

        const identity =
            document.createElement("div");

        const name =
            document.createElement("h3");

        const business =
            document.createElement("p");

        name.textContent =
            lead.name || "Unnamed lead";

        business.textContent =
            lead.business || "No business provided";

        identity.append(name, business);

        const badge =
            document.createElement("span");

        badge.className =
            `crm-status-badge crm-status-${lead.status}`;

        badge.textContent =
            statusLabels[lead.status] || "Unknown";

        cardHeader.append(identity, badge);

        const meta =
            document.createElement("div");

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
                "Quote",
                formatCurrency(lead.quoteAmount)
            ),
            createMetaItem(
                "Follow-up",
                lead.followUpDate || "Not set"
            )
        );

        const contact =
            document.createElement("p");

        contact.className =
            "crm-lead-contact";

        contact.textContent = [
            lead.email,
            lead.phone
        ].filter(Boolean).join(" • ");

        const viewButton =
            document.createElement("button");

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


function closeDialog() {
    stopCommunicationSubscription();
    selectedLeadId = "";
    setLeadFormStatus("");
    setEmailStatus("");
    emailTemplate.value = "initial-response";
    emailSubject.value = "";
    emailMessage.value = "";
    communicationHistoryList.replaceChildren();
    setCommunicationHistoryStatus(
        "Select a lead to load customer communications."
    );

    if (leadDialog.open) {
        leadDialog.close();
    }
}


function openLead(leadId) {
    const lead =
        leads.find(function (item) {
            return item.id === leadId;
        });

    if (!lead) {
        return;
    }

    stopCommunicationSubscription();
    selectedLeadId = lead.id;

    emailTemplate.value = "initial-response";
    emailSubject.value = "";
    emailMessage.value = "";
    setEmailStatus("");

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

    leadStatus.value =
        validStatuses.has(lead.status)
            ? lead.status
            : "new";

    quoteAmount.value =
        lead.quoteAmount === null ||
        lead.quoteAmount === undefined
            ? ""
            : String(lead.quoteAmount);

    followUpDate.value =
        lead.followUpDate || "";

    internalNotes.value =
        lead.internalNotes || "";

    const telephone = String(
        lead.phone || ""
    ).replace(/[^0-9+]/g, "");

    callLead.hidden = !telephone;
    callLead.href =
        telephone ? `tel:${telephone}` : "#";

    const email = String(
        lead.email || ""
    ).trim();

    emailLead.hidden = !email;
    emailLead.href = email
        ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your SilverForge project request")}`
        : "#";

    setLeadFormStatus("");
    subscribeToCommunications(lead.id);

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
                .sort(function (a, b) {
                    return (
                        timestampToMillis(b.createdAt) -
                        timestampToMillis(a.createdAt)
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


function setLeadFormBusy(isBusy) {
    updateLeadButton.disabled = isBusy;
    deleteLeadButton.disabled = isBusy;
    updateLeadButton.textContent =
        isBusy ? "Updating..." : "Update lead";
}


function setEmailActionsBusy(isBusy) {
    generateEmailButton.disabled = isBusy;
    copyEmailButton.disabled = isBusy;
    openEmailButton.disabled = isBusy;
    markEmailSentButton.disabled = isBusy;
    markEmailSentButton.textContent = isBusy
        ? "Marking..."
        : "Mark as Sent";
}


generateEmailButton.addEventListener(
    "click",
    function () {
        const lead = getSelectedLead();

        if (!lead) {
            setEmailStatus(
                "No lead is selected. Open a lead before generating an email.",
                "error"
            );
            return;
        }

        const template = emailTemplate.value;

        if (!validEmailTemplates.has(template)) {
            setEmailStatus(
                "Choose a valid email template.",
                "error"
            );
            return;
        }

        const generatedEmail =
            createEmailFromTemplate(template, lead);

        if (generatedEmail.error) {
            setEmailStatus(
                generatedEmail.error,
                "error"
            );
            return;
        }

        emailSubject.value = generatedEmail.subject;
        emailMessage.value = generatedEmail.body;

        setEmailStatus(
            `${emailTemplateLabels[template]} email generated. Review and edit it before opening your email application.`,
            "success"
        );
    }
);


copyEmailButton.addEventListener(
    "click",
    async function () {
        const draft = validateEmailDraft();

        if (draft.error) {
            setEmailStatus(draft.error, "error");
            return;
        }

        if (
            !navigator.clipboard ||
            typeof navigator.clipboard.writeText !== "function"
        ) {
            setEmailStatus(
                "Clipboard access is not available in this browser. Use a secure connection or copy the subject and message manually.",
                "error"
            );
            return;
        }

        copyEmailButton.disabled = true;
        copyEmailButton.textContent = "Copying...";

        try {
            await navigator.clipboard.writeText(
                `Subject: ${draft.subject}\n\n${draft.body}`
            );

            setEmailStatus(
                "The email subject and message were copied to the clipboard.",
                "success"
            );
        } catch (error) {
            console.error("Email copy failed:", error);
            setEmailStatus(
                "The email could not be copied. Allow clipboard access or copy the fields manually.",
                "error"
            );
        } finally {
            copyEmailButton.disabled = false;
            copyEmailButton.textContent = "Copy Email";
        }
    }
);


openEmailButton.addEventListener(
    "click",
    function () {
        const draft = validateEmailDraft({
            requireRecipient: true
        });

        if (draft.error) {
            setEmailStatus(draft.error, "error");
            return;
        }

        const mailtoLink =
            `mailto:${encodeURIComponent(draft.recipient)}` +
            `?subject=${encodeURIComponent(draft.subject)}` +
            `&body=${encodeURIComponent(draft.body)}`;

        try {
            const link = document.createElement("a");

            link.href = mailtoLink;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();

            setEmailStatus(
                "Your email application should open with the message filled in. The CRM has not sent it; review it and press Send in your email application. If no application opens, use Copy Email instead.",
                "success"
            );
        } catch (error) {
            console.error("Email application failed to open:", error);
            setEmailStatus(
                "The email application could not be opened. Use Copy Email and paste the message into your email application.",
                "error"
            );
        }
    }
);


markEmailSentButton.addEventListener(
    "click",
    async function () {
        const draft = validateEmailDraft({
            requireRecipient: true
        });

        if (draft.error) {
            setEmailStatus(draft.error, "error");
            return;
        }

        if (!authorizedUid) {
            setEmailStatus(
                "Your administrator session could not be verified. Sign in again before recording this email.",
                "error"
            );
            return;
        }

        setEmailActionsBusy(true);
        setEmailStatus(
            "Recording the email as sent..."
        );

        try {
            const leadReference =
                doc(db, "leads", draft.lead.id);
            const communicationReference = doc(
                collection(
                    db,
                    "leads",
                    draft.lead.id,
                    "communications"
                )
            );
            const batch = writeBatch(db);

            batch.update(leadReference, {
                lastEmailTemplate: draft.template,
                lastEmailSubject: draft.subject,
                lastEmailBody: draft.body,
                lastEmailMarkedSentAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            batch.set(communicationReference, {
                type: "email",
                template: draft.template,
                subject: draft.subject,
                body: draft.body,
                recipient: draft.recipient,
                markedSentAt: serverTimestamp(),
                createdBy: authorizedUid
            });

            await batch.commit();

            setEmailStatus(
                "Email marked as sent and added to communication history. This action recorded the email; it did not send it.",
                "success"
            );
        } catch (error) {
            console.error(
                "Email sent-status update failed:",
                error
            );
            setEmailStatus(
                describeFirestoreError(
                    error,
                    "Mark as Sent"
                ),
                "error"
            );
        } finally {
            setEmailActionsBusy(false);
        }
    }
);


leadSearch.addEventListener(
    "input",
    renderLeadList
);


statusFilter.addEventListener(
    "change",
    renderLeadList
);


closeLeadDialog.addEventListener(
    "click",
    closeDialog
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

        if (!selectedLeadId) {
            return;
        }

        if (!leadForm.checkValidity()) {
            leadForm.reportValidity();
            return;
        }

        const status =
            leadStatus.value;

        const quoteText =
            quoteAmount.value.trim();

        const parsedQuote =
            quoteText ? Number(quoteText) : null;

        if (!validStatuses.has(status)) {
            setLeadFormStatus(
                "Choose a valid lead status.",
                "error"
            );

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
            await updateDoc(
                doc(db, "leads", selectedLeadId),
                {
                    status,
                    quoteAmount: parsedQuote,
                    followUpDate:
                        followUpDate.value,
                    internalNotes:
                        internalNotes.value.trim(),
                    updatedAt: serverTimestamp()
                }
            );

            setLeadFormStatus(
                "Lead updated successfully.",
                "success"
            );
        } catch (error) {
            console.error(
                "Lead update failed:",
                error
            );

            setLeadFormStatus(
                "The lead could not be updated. Check your connection and access.",
                "error"
            );
        } finally {
            setLeadFormBusy(false);
        }
    }
);


deleteLeadButton.addEventListener(
    "click",
    async function () {
        if (!selectedLeadId) {
            return;
        }

        const lead =
            leads.find(function (item) {
                return item.id === selectedLeadId;
            });

        const confirmed = window.confirm(
            `Delete the lead for ${lead?.name || "this customer"}? This cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        setLeadFormBusy(true);
        deleteLeadButton.textContent = "Deleting...";
        setLeadFormStatus("Deleting lead...");

        try {
            await deleteDoc(
                doc(db, "leads", selectedLeadId)
            );

            closeDialog();
        } catch (error) {
            console.error(
                "Lead deletion failed:",
                error
            );

            setLeadFormStatus(
                "The lead could not be deleted. Check your connection and access.",
                "error"
            );
        } finally {
            deleteLeadButton.textContent =
                "Delete lead";

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

        stopCommunicationSubscription();

        try {
            await signOut(auth);
        } finally {
            redirectToLogin();
        }
    }
);


if (
    !isFirebaseConfigured ||
    !auth ||
    !db
) {
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

            if (authorizedUid === user.uid) {
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

                authorizedUid = user.uid;
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

        stopCommunicationSubscription();
    }
);
