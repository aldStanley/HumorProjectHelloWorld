// Browser-side storage for the POV Joke Maker's cached runs.
//
// This started on localStorage and outgrew it. localStorage has a ~5 MB cap
// shared by the WHOLE origin — every other surface in this app competes for
// the same budget — and it throws QuotaExceededError once that is gone, which
// for this page means an expensive multi-call run cannot be saved at all.
// IndexedDB's quota is a large fraction of free disk instead, and it stores
// structured values without a JSON.stringify round trip.
//
// Errors are deliberately NOT swallowed: the caller reports them on the page,
// because a cache that silently is not caching is indistinguishable from a
// page that was never run.

const DB_NAME = 'pov-jokes'
const STORE_NAME = 'runs'
const DB_VERSION = 1

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the local database.'))
    request.onblocked = () =>
      reject(new Error('The local database is blocked by another open tab.'))
  })

const withStore = async <T,>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> => {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = run(tx.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () =>
        reject(request.error ?? new Error('The local database write failed.'))
      tx.onabort = () =>
        reject(tx.error ?? new Error('The local database transaction aborted.'))
    })
  } finally {
    db.close()
  }
}

export const loadRecord = <T,>(key: string): Promise<T | undefined> =>
  withStore<T | undefined>('readonly', (store) => store.get(key))

export const saveRecord = (key: string, value: unknown): Promise<unknown> =>
  withStore('readwrite', (store) => store.put(value, key))

export const deleteRecord = (key: string): Promise<unknown> =>
  withStore('readwrite', (store) => store.delete(key))

// One-time move of anything already sitting in localStorage under this key,
// then delete it — which also hands its space back to the origin's 5 MB
// budget, since every other surface here is still using localStorage.
export const migrateFromLocalStorage = <T,>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as T
    window.localStorage.removeItem(key)
    return parsed
  } catch {
    // A blob we cannot parse is not worth carrying forward. Drop it so it
    // stops occupying the shared quota.
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Nothing further to do.
    }
    return null
  }
}

// How much room the browser will actually give this origin. Shown on the page
// when a save fails, so "out of space" is a number rather than a guess.
export const describeQuota = async (): Promise<string | null> => {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage, quota } = await navigator.storage.estimate()
    if (usage == null || quota == null) return null
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${mb(usage)} used of about ${mb(quota)} available to this site`
  } catch {
    return null
  }
}
