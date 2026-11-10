// Adaptador de IndexedDB para store.js. Todo local: IndexedDB no usa la red. Si no está disponible
// (ventana privada, datos bloqueados), las operaciones fallan y quien llama lo trata como «no se pudo
// guardar»: la app funciona igual.
export function idbAdapter(name = 'orbicula') {
  let opening = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('sessions', { keyPath: 'id' });
        r.result.createObjectStore('data', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('la base de datos está bloqueada por otra pestaña'));
    }).catch((err) => { opening = null; throw err; });
    return opening;
  };
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transacción cancelada'));
    });
  };
  return {
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    put: (s, v) => run(s, 'readwrite', (st) => st.put(v)),
    delete: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
  };
}
