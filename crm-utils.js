export const proposalStatusLabels = Object.freeze({
    draft: "Draft",
    ready: "Ready to Send",
    sent: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired"
});

export const emailTemplateLabels = Object.freeze({
    "initial-response": "Initial Response",
    "request-information": "Request More Information",
    "send-proposal": "Send Proposal",
    "follow-up": "Follow Up",
    "proposal-accepted": "Proposal Accepted",
    "request-content": "Request Project Content",
    "progress-update": "Project Progress Update",
    "project-completed": "Project Completed",
    custom: "Custom Message"
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;


export function cleanText(value) {
    return String(value ?? "").trim();
}


export function readNullableNumber(value) {
    if (
        value === null ||
        value === undefined ||
        cleanText(value) === ""
    ) {
        return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : Number.NaN;
}


export function readNullableWholeNumber(value) {
    const parsed = readNullableNumber(value);

    if (parsed === null) {
        return null;
    }

    return Number.isInteger(parsed)
        ? parsed
        : Number.NaN;
}


export function calculateRemainingBalance(
    officialPrice,
    depositAmount
) {
    const price = readNullableNumber(officialPrice);
    const deposit = readNullableNumber(depositAmount);

    if (price === null || Number.isNaN(price)) {
        return null;
    }

    const appliedDeposit =
        deposit === null || Number.isNaN(deposit)
            ? 0
            : deposit;

    return Math.round(
        (price - appliedDeposit) * 100
    ) / 100;
}


export function isValidDateValue(value) {
    const dateValue = cleanText(value);

    if (!dateValue) {
        return true;
    }

    if (!datePattern.test(dateValue)) {
        return false;
    }

    const parsed = new Date(`${dateValue}T00:00:00Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === dateValue
    );
}


export function formatCurrency(value) {
    const parsed = readNullableNumber(value);

    if (parsed === null || Number.isNaN(parsed)) {
        return "Not set";
    }

    return new Intl.NumberFormat(
        "en-US",
        {
            style: "currency",
            currency: "USD"
        }
    ).format(parsed);
}


export function formatDateValue(value) {
    const dateValue = cleanText(value);

    if (!isValidDateValue(dateValue) || !dateValue) {
        return "Not set";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            dateStyle: "long",
            timeZone: "UTC"
        }
    ).format(new Date(`${dateValue}T00:00:00Z`));
}


export function proposalDefaults(lead = {}) {
    const officialPrice = readNullableNumber(
        lead.officialPrice
    );

    const depositAmount = readNullableNumber(
        lead.depositAmount
    );

    return {
        projectTitle: cleanText(lead.projectTitle),
        clientProjectSummary:
            cleanText(lead.clientProjectSummary),
        scopeOfWork: cleanText(lead.scopeOfWork),
        deliverables: cleanText(lead.deliverables),
        officialPrice:
            Number.isNaN(officialPrice)
                ? null
                : officialPrice,
        depositAmount:
            Number.isNaN(depositAmount)
                ? null
                : depositAmount,
        remainingBalance: calculateRemainingBalance(
            officialPrice,
            depositAmount
        ),
        estimatedTimeline:
            cleanText(lead.estimatedTimeline),
        proposedStartDate:
            cleanText(lead.proposedStartDate),
        proposedCompletionDate:
            cleanText(lead.proposedCompletionDate),
        includedRevisions:
            Number.isInteger(lead.includedRevisions)
                ? lead.includedRevisions
                : null,
        paymentTerms: cleanText(lead.paymentTerms),
        additionalTerms: cleanText(lead.additionalTerms),
        proposalExpirationDate:
            cleanText(lead.proposalExpirationDate),
        clientMessage: cleanText(lead.clientMessage),
        proposalStatus:
            Object.hasOwn(
                proposalStatusLabels,
                lead.proposalStatus
            )
                ? lead.proposalStatus
                : "draft",
        proposalNumber: cleanText(lead.proposalNumber),
        proposalCreatedAt: lead.proposalCreatedAt || null,
        proposalSentAt: lead.proposalSentAt || null,
        proposalAcceptedAt:
            lead.proposalAcceptedAt || null
    };
}


export function validateProposal(proposal) {
    const errors = [];
    const price = readNullableNumber(
        proposal.officialPrice
    );
    const deposit = readNullableNumber(
        proposal.depositAmount
    );
    const revisions = readNullableWholeNumber(
        proposal.includedRevisions
    );

    if (
        price !== null &&
        (
            Number.isNaN(price) ||
            price < 0 ||
            price > 100000000
        )
    ) {
        errors.push(
            "Official price must be a non-negative number."
        );
    }

    if (
        deposit !== null &&
        (
            Number.isNaN(deposit) ||
            deposit < 0 ||
            deposit > 100000000
        )
    ) {
        errors.push(
            "Deposit must be a non-negative number."
        );
    }

    if (
        price === null &&
        deposit !== null
    ) {
        errors.push(
            "Enter an official price before adding a deposit."
        );
    }

    if (
        price !== null &&
        deposit !== null &&
        !Number.isNaN(price) &&
        !Number.isNaN(deposit) &&
        deposit > price
    ) {
        errors.push(
            "Deposit cannot exceed the official price."
        );
    }

    if (
        revisions !== null &&
        (
            Number.isNaN(revisions) ||
            revisions < 0 ||
            revisions > 1000
        )
    ) {
        errors.push(
            "Included revisions must be a non-negative whole number."
        );
    }

    [
        [proposal.proposedStartDate, "Proposed start date"],
        [proposal.proposedCompletionDate, "Proposed completion date"],
        [proposal.proposalExpirationDate, "Proposal expiration date"]
    ].forEach(function ([value, label]) {
        if (!isValidDateValue(value)) {
            errors.push(
                `${label} must use YYYY-MM-DD.`
            );
        }
    });

    if (
        !Object.hasOwn(
            proposalStatusLabels,
            proposal.proposalStatus
        )
    ) {
        errors.push("Choose a valid proposal status.");
    }

    return errors;
}


export function buildClientContext(
    lead = {},
    proposal = {}
) {
    const safeProposal = proposalDefaults(proposal);
    const clientName = cleanText(lead.name);

    return Object.freeze({
        clientName,
        firstName:
            clientName.split(/\s+/)[0] || "there",
        businessName: cleanText(lead.business),
        email: cleanText(lead.email),
        phone: cleanText(lead.phone),
        requestedService: cleanText(lead.service),
        projectTitle:
            safeProposal.projectTitle ||
            cleanText(lead.service) ||
            "your project",
        projectSummary:
            safeProposal.clientProjectSummary ||
            cleanText(lead.message),
        scopeOfWork: safeProposal.scopeOfWork,
        deliverables: safeProposal.deliverables,
        officialPrice: safeProposal.officialPrice,
        depositAmount: safeProposal.depositAmount,
        remainingBalance:
            safeProposal.remainingBalance,
        estimatedTimeline:
            safeProposal.estimatedTimeline,
        proposedStartDate:
            safeProposal.proposedStartDate,
        proposedCompletionDate:
            safeProposal.proposedCompletionDate,
        includedRevisions:
            safeProposal.includedRevisions,
        paymentTerms: safeProposal.paymentTerms,
        additionalTerms:
            safeProposal.additionalTerms,
        proposalExpirationDate:
            safeProposal.proposalExpirationDate,
        clientMessage: safeProposal.clientMessage,
        proposalStatus:
            safeProposal.proposalStatus,
        proposalNumber:
            safeProposal.proposalNumber
    });
}


function closing() {
    return [
        "Best regards,",
        "",
        "SilverForge Digital Solutions",
        "silverforgedigitalsolutions.com"
    ].join("\n");
}


function proposalPricingLines(context) {
    if (context.officialPrice === null) {
        return [];
    }

    const lines = [
        `Official project price: ${formatCurrency(context.officialPrice)}`,
        `Deposit amount: ${formatCurrency(context.depositAmount)}`,
        `Remaining balance: ${formatCurrency(context.remainingBalance)}`
    ];

    if (context.paymentTerms) {
        lines.push(
            `Payment terms: ${context.paymentTerms}`
        );
    }

    return lines;
}


export function buildEmailTemplate(
    template,
    context
) {
    const greeting = `Hello ${context.firstName},`;
    const projectName = context.projectTitle;
    const proposalNumber =
        context.proposalNumber
            ? ` (${context.proposalNumber})`
            : "";
    let subject = "SilverForge Digital Solutions";
    let paragraphs = [];

    switch (template) {
    case "initial-response":
        subject = `Thank you for contacting SilverForge about ${projectName}`;
        paragraphs = [
            "Thank you for reaching out to SilverForge Digital Solutions. I appreciate the opportunity to learn about your project.",
            context.projectSummary
                ? `Based on your request, the current project overview is: ${context.projectSummary}`
                : `I am reviewing your request for ${context.requestedService || "digital services"}.`,
            "I will follow up with any questions and the recommended next steps."
        ];
        break;

    case "request-information":
        subject = `Additional information needed for ${projectName}`;
        paragraphs = [
            `Thank you for the information you shared about ${projectName}.`,
            "To prepare an accurate recommendation and proposal, please reply with any remaining goals, required features, preferred timing, examples, and content you would like SilverForge to review.",
            "Once I receive those details, I can confirm the scope and next steps."
        ];
        break;

    case "send-proposal":
        subject = `SilverForge proposal${proposalNumber}: ${projectName}`;
        paragraphs = [
            `I prepared a proposal for ${projectName}${proposalNumber}.`,
            context.projectSummary ||
                "The proposal reflects the project information discussed.",
            ...proposalPricingLines(context),
            context.estimatedTimeline
                ? `Estimated timeline: ${context.estimatedTimeline}`
                : "",
            context.proposalExpirationDate
                ? `This proposal is valid through ${formatDateValue(context.proposalExpirationDate)}.`
                : "",
            "Please review the proposal and let me know if you have any questions or would like to move forward."
        ];
        break;

    case "follow-up":
        subject = `Following up on ${projectName}`;
        paragraphs = [
            `I am following up regarding ${projectName}.`,
            "Please let me know if you have questions, need clarification, or would like to discuss the next step.",
            "SilverForge is ready to help when the timing is right for you."
        ];
        break;

    case "proposal-accepted":
        subject = `Next steps for ${projectName}`;
        paragraphs = [
            `Thank you for accepting the SilverForge proposal for ${projectName}.`,
            context.depositAmount !== null
                ? `The initial deposit is ${formatCurrency(context.depositAmount)}.`
                : "I will confirm the payment and scheduling details with you next.",
            context.proposedStartDate
                ? `The proposed start date is ${formatDateValue(context.proposedStartDate)}.`
                : "",
            "I appreciate your business and look forward to building this project with you."
        ];
        break;

    case "request-content":
        subject = `Content needed for ${projectName}`;
        paragraphs = [
            `SilverForge is preparing the next stage of ${projectName}.`,
            "Please send the approved text, logos, photos, account access details, brand guidelines, and any other materials required for the project.",
            "Do not email passwords or other sensitive credentials. I will provide a safer collection method when access is required."
        ];
        break;

    case "progress-update":
        subject = `Project update: ${projectName}`;
        paragraphs = [
            `Here is the latest update for ${projectName}.`,
            context.clientMessage ||
                "Work is progressing, and I will continue to keep you informed as the project moves forward.",
            context.proposedCompletionDate
                ? `The proposed completion date is ${formatDateValue(context.proposedCompletionDate)}.`
                : "",
            "Please reply if you have questions or new information that may affect the project."
        ];
        break;

    case "project-completed":
        subject = `Project completed: ${projectName}`;
        paragraphs = [
            `SilverForge has completed ${projectName}.`,
            context.clientMessage ||
                "Thank you for the opportunity to work on this project.",
            context.remainingBalance !== null &&
            context.remainingBalance > 0
                ? `The remaining balance is ${formatCurrency(context.remainingBalance)}.`
                : "",
            "Please review the completed work and let me know if you need assistance with the handoff."
        ];
        break;

    case "custom":
        subject = `SilverForge update: ${projectName}`;
        paragraphs = [
            context.clientMessage ||
                "I am reaching out with an update regarding your SilverForge project."
        ];
        break;

    default:
        throw new Error("Unknown email template.");
    }

    const body = [
        greeting,
        "",
        ...paragraphs
            .filter(Boolean)
            .flatMap(function (paragraph) {
                return [paragraph, ""];
            }),
        closing()
    ].join("\n");

    return {subject, body};
}


export function splitDeliverables(value) {
    return cleanText(value)
        .split(/\r?\n/)
        .map(cleanText)
        .filter(Boolean);
}


export function buildProposalPlainText(context) {
    const lines = [
        "SILVERFORGE DIGITAL SOLUTIONS",
        "PROJECT PROPOSAL",
        "",
        `Proposal number: ${context.proposalNumber || "Pending"}`,
        `Prepared for: ${context.clientName || "Client"}`,
        `Business: ${context.businessName || "Not provided"}`,
        `Project: ${context.projectTitle}`,
        "",
        "PROJECT OVERVIEW",
        context.projectSummary || "To be confirmed.",
        "",
        "SCOPE OF WORK",
        context.scopeOfWork || "To be confirmed.",
        "",
        "DELIVERABLES",
        ...(splitDeliverables(context.deliverables).length
            ? splitDeliverables(context.deliverables).map(
                (item) => `- ${item}`
            )
            : ["To be confirmed."]),
        "",
        "TIMELINE",
        context.estimatedTimeline || "To be confirmed.",
        context.proposedStartDate
            ? `Proposed start: ${formatDateValue(context.proposedStartDate)}`
            : "",
        context.proposedCompletionDate
            ? `Proposed completion: ${formatDateValue(context.proposedCompletionDate)}`
            : "",
        "",
        "PRICING",
        `Total project price: ${formatCurrency(context.officialPrice)}`,
        `Deposit amount: ${formatCurrency(context.depositAmount)}`,
        `Remaining balance: ${formatCurrency(context.remainingBalance)}`,
        "",
        "PAYMENT TERMS",
        context.paymentTerms || "To be confirmed.",
        "",
        `Included revisions: ${context.includedRevisions ?? "To be confirmed"}`,
        "",
        "ADDITIONAL TERMS",
        context.additionalTerms || "None specified.",
        "",
        "ACCEPTANCE",
        "Client signature: ______________________________",
        "Date: __________________",
        "",
        "Thank you for considering SilverForge Digital Solutions."
    ];

    return lines.filter(function (line, index) {
        return line !== "" || lines[index - 1] !== "";
    }).join("\n");
}
