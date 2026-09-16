const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';
export function notificationPath(data = {}) {
  const record = safeId(data.recordId), client = safeId(data.clientId);
  if (data.target === 'quote' && record) return `crm.html?lead=${encodeURIComponent(record)}`;
  if (data.target === 'contact' && record) return `crm-support.html?contact=${encodeURIComponent(record)}`;
  if (['request', 'reply'].includes(data.target) && record) return `crm-support.html?ticket=${encodeURIComponent(record)}`;
  if (data.target === 'account' && (client || record)) return `crm.html?client=${encodeURIComponent(client || record)}`;
  if (data.target === 'clientMessage' && (client || record)) return `crm.html?client=${encodeURIComponent(client || record)}&tab=messages`;
  return 'crm-notifications.html';
}
export function safeAdminReturn(value) {
  try {
    const parsed = new URL(value, location.origin);
    if (parsed.origin !== location.origin || !['/crm.html', '/crm-support.html', '/crm-notifications.html'].includes(parsed.pathname)) return 'crm.html';
    const allowed = ['lead', 'contact', 'ticket', 'client', 'tab'];
    for (const key of [...parsed.searchParams.keys()]) if (!allowed.includes(key) || !safeId(parsed.searchParams.get(key))) parsed.searchParams.delete(key);
    return parsed.pathname.slice(1) + parsed.search;
  } catch { return 'crm.html'; }
}

export function adminLoginPath(reason = "") {
  if (reason) return `crm-login.html?reason=${encodeURIComponent(reason)}`;
  const path = safeAdminReturn(location.pathname + location.search);
  return location.search ? `crm-login.html?return=${encodeURIComponent(path)}` : "crm-login.html";
}
