// IndexedDB belongs to the extension origin. Unlike storage.local, it is not
// shared with content scripts running on store pages or the GG.deals page bridge.
export async function readXboxAuthorization(): Promise<unknown> {
    return transact('readonly', (store) => store.get('authorization'));
}

export async function writeXboxAuthorization(value: unknown): Promise<void> {
    await transact('readwrite', (store) => value === null
        ? store.delete('authorization')
        : store.put(value, 'authorization'));
}

function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('ggdeals-xbox', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('credentials');
        open.onerror = () => reject(new Error('Xbox credential storage could not be opened'));
        open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('credentials', mode);
            const request = operation(transaction.objectStore('credentials'));
            transaction.oncomplete = () => {
                db.close();
                resolve(request.result);
            };
            transaction.onabort = transaction.onerror = () => {
                db.close();
                reject(new Error('Xbox credential storage failed'));
            };
        };
    });
}
