import type { ExamAttemptSummary, ExamSessionState } from './engine';

const IDB_NAME = 'examdash_cbt_v1';
const IDB_VERSION = 1;
const STORE_SESSIONS = 'exam_sessions';
const STORE_SUMMARIES = 'exam_summaries';

const LS_SESSION_PREFIX = 'examdash_cbt_session_v1_';
const LS_SUMMARIES_KEY = 'examdash_cbt_summaries_v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openExamDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains(STORE_SUMMARIES)) {
          db.createObjectStore(STORE_SUMMARIES, { keyPath: 'sessionId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function readLocalSessionSync(sessionId: string): ExamSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${LS_SESSION_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExamSessionState;
    return parsed && typeof parsed.sessionId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalSessionSync(session: ExamSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LS_SESSION_PREFIX}${session.sessionId}`, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

function deleteLocalSessionSync(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${LS_SESSION_PREFIX}${sessionId}`);
  } catch {
    // Ignore storage quota errors
  }
}

export function readLocalSummariesSync(): Record<string, ExamAttemptSummary> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_SUMMARIES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ExamAttemptSummary>) : {};
  } catch {
    return {};
  }
}

function writeLocalSummarySync(summary: ExamAttemptSummary): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readLocalSummariesSync();
    existing[summary.sessionId] = summary;
    window.localStorage.setItem(LS_SUMMARIES_KEY, JSON.stringify(existing));
    window.dispatchEvent(new CustomEvent('examdash:attempt-updated', { detail: summary }));
  } catch {
    // Ignore storage quota errors
  }
}

function deleteLocalSummarySync(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readLocalSummariesSync();
    delete existing[sessionId];
    window.localStorage.setItem(LS_SUMMARIES_KEY, JSON.stringify(existing));
    window.dispatchEvent(new CustomEvent('examdash:attempt-updated', { detail: { sessionId, deleted: true } }));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Write-ahead persistence: mirrors immediately to localStorage for instant crash resilience
 * and writes asynchronously to IndexedDB for durable large-session storage.
 */
export async function saveExamSessionLocal(
  session: ExamSessionState,
  summary?: ExamAttemptSummary
): Promise<void> {
  writeLocalSessionSync(session);
  if (summary) {
    writeLocalSummarySync(summary);
  }

  const db = await openExamDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const stores = summary ? [STORE_SESSIONS, STORE_SUMMARIES] : [STORE_SESSIONS];
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(session);
      if (summary) {
        tx.objectStore(STORE_SUMMARIES).put(summary);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadExamSessionLocal(sessionId: string): Promise<ExamSessionState | null> {
  const localCopy = readLocalSessionSync(sessionId);
  const db = await openExamDb();
  if (!db) return localCopy;

  const idbCopy = await new Promise<ExamSessionState | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(sessionId);
      req.onsuccess = () => resolve((req.result as ExamSessionState | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (idbCopy && localCopy) {
    return idbCopy.updatedAtMs >= localCopy.updatedAtMs ? idbCopy : localCopy;
  }
  return idbCopy ?? localCopy;
}

export async function deleteExamSessionLocal(sessionId: string): Promise<void> {
  deleteLocalSessionSync(sessionId);
  deleteLocalSummarySync(sessionId);

  const db = await openExamDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE_SESSIONS, STORE_SUMMARIES], 'readwrite');
      tx.objectStore(STORE_SESSIONS).delete(sessionId);
      tx.objectStore(STORE_SUMMARIES).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadAllExamAttemptSummaries(): Promise<ExamAttemptSummary[]> {
  const localMap = readLocalSummariesSync();
  const db = await openExamDb();
  if (!db) return Object.values(localMap);

  const idbItems = await new Promise<ExamAttemptSummary[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_SUMMARIES, 'readonly');
      const req = tx.objectStore(STORE_SUMMARIES).getAll();
      req.onsuccess = () => resolve((req.result as ExamAttemptSummary[] | undefined) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  const merged = new Map<string, ExamAttemptSummary>();
  for (const item of Object.values(localMap)) {
    merged.set(item.sessionId, item);
  }
  for (const item of idbItems) {
    const existing = merged.get(item.sessionId);
    if (!existing || item.updatedAtMs >= existing.updatedAtMs) {
      merged.set(item.sessionId, item);
    }
  }
  return Array.from(merged.values());
}
