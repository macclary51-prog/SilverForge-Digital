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
    updateDoc
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

let leads = [];
let selectedLeadId = "";
let unsubscribeLeads = null;
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
    selectedLeadId = "";
    setLeadFormStatus("");

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
    }
);
