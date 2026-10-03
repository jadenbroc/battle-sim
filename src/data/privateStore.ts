import { parsePrivateData, type PrivateData } from './privateData';

/** Where the private data is kept in the browser. It never leaves this machine. */
const DB_NAME = 'battle-sim-private';
const STORE = 'files';
const KEY = 'private-data';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** The stored private data, or undefined when there is none (or storage is unavailable). */
export async function loadStoredPrivateData(): Promise<PrivateData | undefined> {
  try {
    const text = await run<unknown>('readonly', (s) => s.get(KEY));
    if (typeof text !== 'string') return undefined;
    const parsed = parsePrivateData(text);
    return parsed.ok ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function saveStoredPrivateData(text: string): Promise<void> {
  await run('readwrite', (s) => s.put(text, KEY));
}

export async function clearStoredPrivateData(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing stored */
  }
}

/** Dev server only: the file the private-data build wrote, served by the Vite middleware. */
export async function fetchDevPrivateData(): Promise<PrivateData | undefined> {
  if (!import.meta.env.DEV) return undefined;
  try {
    const res = await fetch('/__private/private-data.json');
    if (!res.ok) return undefined;
    const parsed = parsePrivateData(await res.text());
    return parsed.ok ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
