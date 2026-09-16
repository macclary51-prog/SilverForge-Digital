// This stores local device opt-in, never registration tokens or private CRM data.
export async function deviceState(value, key = 'device') {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('silverforge-push-state', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('state', value === undefined ? 'readonly' : 'readwrite');
      const request = value === undefined ? transaction.objectStore('state').get(key) : transaction.objectStore('state').put(value, key);
      transaction.oncomplete = () => resolve(value === undefined ? request.result : value);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
