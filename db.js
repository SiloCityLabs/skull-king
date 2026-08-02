"use strict";

const DB_NAME = "skull-king.db.v1";
const DB_VERSION = 1;
const STORE = "games";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("aborted"));
      })
  );
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function __resetDbPromise() {
  dbPromise = null;
}

export const GameDB = {
  async list() {
    const rows = await tx("readonly", (store) => reqToPromise(store.getAll()));
    return (rows || []).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async get(id) {
    return tx("readonly", (store) => reqToPromise(store.get(id)));
  },

  async put(game) {
    const row = { ...game, updatedAt: Date.now() };
    await tx("readwrite", (store) => {
      store.put(row);
    });
    return row;
  },

  async remove(id) {
    await tx("readwrite", (store) => {
      store.delete(id);
    });
  },
};
