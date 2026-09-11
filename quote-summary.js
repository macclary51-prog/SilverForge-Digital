// Explicit allowlist: never copy private notes, drafts or email history.
export function quoteSummary(lead) {
  return {
    customerId: lead.customerId, service: lead.service, business: lead.business,
    status: lead.status, quoteAmount: lead.quoteAmount,
    createdAt: lead.createdAt
  };
}
