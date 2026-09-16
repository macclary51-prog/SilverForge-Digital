async function isAdminOrigin(event, kind, data, isAdmin) {
  if (['system', 'service_account'].includes(event.authType)) return true;
  if (['clientMessage', 'reply'].includes(kind) && data.senderRole !== 'customer') return true;
  const actors = [event.authId, data.senderId, data.ownerId, data.customerId, kind === 'account' ? event.params.userUid : null];
  for (const actor of new Set(actors.filter(value => typeof value === 'string' && value && !value.includes('/')))) if (await isAdmin(actor)) return true;
  return false;
}
module.exports = { isAdminOrigin };
