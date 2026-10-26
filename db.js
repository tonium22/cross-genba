// 端末内データベース（IndexedDB）
// アプリを閉じても消えない。写真もここに保存する。
(function (root) {
  'use strict';
  const DB_NAME = 'cross-app';
  const VERSION = 1;
  const STORES = {
    sites: { indexes: [] },
    cloths: { indexes: ['siteId'] },
    notes: { indexes: ['siteId'] },
    reports: { indexes: ['siteId'] },
    photos: { indexes: ['hash'] }, // { id, blob, hash, createdAt }
    meta: { indexes: [] },
  };

  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, def] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const os = db.createObjectStore(name, { keyPath: 'id' });
          def.indexes.forEach((ix) => os.createIndex(ix, ix));
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  const DB = {
    get: (store, id) => tx(store, 'readonly', (os) => wrap(os.get(id))),
    all: (store) => tx(store, 'readonly', (os) => wrap(os.getAll())),
    by: (store, index, value) => tx(store, 'readonly', (os) => wrap(os.index(index).getAll(value))),
    put: (store, obj) => tx(store, 'readwrite', (os) => { os.put(obj); return obj; }),
    del: (store, id) => tx(store, 'readwrite', (os) => { os.delete(id); }),
    clear: (store) => tx(store, 'readwrite', (os) => { os.clear(); }),
    stores: Object.keys(STORES),
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    // ブラウザに「勝手に消さないで」とお願いする（iPhoneでホーム画面に追加すると効きやすい）
    persist: async () => {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* 非対応 */ }
      return false;
    },
  };
  root.DB = DB;
})(self);
