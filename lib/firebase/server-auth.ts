import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID } from './config';
import { decodeFirestoreValue } from './server-catalog';

export interface VerifiedFirebaseUser {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
}

/**
 * Verifies a Firebase Auth ID token using Google Identity Toolkit REST API.
 * Works reliably on all Firebase projects (including Starter Tier) without needing Admin IAM.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  const clean = idToken.trim();
  if (!clean || clean.length > 4096) return null;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: clean }),
        cache: 'no-store',
      }
    );

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };

    const user = payload.users?.[0];
    if (!user?.localId) return null;

    return {
      uid: user.localId,
      email: user.email ?? null,
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName ?? null,
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export interface ServerBookFilePaths {
  readonly id: string;
  readonly title: string;
  readonly samplePdfUrl: string | null;
  readonly sampleMarkdownUrl: string | null;
  readonly fullPdfStoragePath: string | null;
  readonly fullMarkdownStoragePath: string | null;
}

/**
 * Server-only helper that fetches private full storage paths for a published book.
 * NEVER export these paths to public unauthenticated responses.
 */
export async function fetchServerBookFilePaths(bookId: string): Promise<ServerBookFilePaths | null> {
  const cleanId = bookId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return null;

  const encodedDb = encodeURIComponent(FIRESTORE_DATABASE_ID);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${encodedDb}/documents/books/${encodeURIComponent(cleanId)}?key=${FIREBASE_CONFIG.apiKey}`;

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;

  const doc = (await response.json()) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  const fields = doc.fields ?? {};
  const isPublished = decodeFirestoreValue(fields.isPublished) === true;
  const isDeleted = decodeFirestoreValue(fields.isDeleted) === true;
  if (!isPublished || isDeleted) return null;

  const asNullStr = (val: unknown): string | null =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;

  return {
    id: cleanId,
    title: asNullStr(decodeFirestoreValue(fields.title)) ?? cleanId,
    samplePdfUrl: asNullStr(decodeFirestoreValue(fields.samplePdfUrl)),
    sampleMarkdownUrl: asNullStr(decodeFirestoreValue(fields.sampleMarkdownUrl)),
    fullPdfStoragePath: asNullStr(decodeFirestoreValue(fields.fullPdfStoragePath)),
    fullMarkdownStoragePath: asNullStr(decodeFirestoreValue(fields.fullMarkdownStoragePath)),
  };
}

export interface ServerExamFilePaths {
  readonly id: string;
  readonly title: string;
  readonly urlSlug: string;
  readonly sampleJsonStoragePath: string | null;
  readonly fullJsonStoragePath: string | null;
  readonly firstMockTitle: string | null;
}

/**
 * Server-only helper that fetches private fullJsonStoragePath and public sampleJsonStoragePath
 * for a published ExamPackDocument. NEVER return fullJsonStoragePath to unauthenticated clients.
 */
export async function fetchServerExamFilePaths(examId: string): Promise<ServerExamFilePaths | null> {
  const cleanId = examId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return null;

  const encodedDb = encodeURIComponent(FIRESTORE_DATABASE_ID);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${encodedDb}/documents/ExamPackDocument/${encodeURIComponent(cleanId)}?key=${FIREBASE_CONFIG.apiKey}`;

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;

  const doc = (await response.json()) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  const fields = doc.fields ?? {};
  const isPublished = decodeFirestoreValue(fields.isPublished) === true;
  const isDeleted = decodeFirestoreValue(fields.isDeleted) === true;
  if (!isPublished || isDeleted) return null;

  const asNullStr = (val: unknown): string | null =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;

  const rawMocktests = decodeFirestoreValue(fields.MocktestTitles);
  const firstMock =
    Array.isArray(rawMocktests) && rawMocktests.length > 0 && typeof rawMocktests[0] === 'object' && rawMocktests[0] !== null
      ? (rawMocktests[0] as Record<string, unknown>)
      : null;

  return {
    id: cleanId,
    title: asNullStr(decodeFirestoreValue(fields.title)) ?? cleanId,
    urlSlug: asNullStr(decodeFirestoreValue(fields.urlSlug)) ?? cleanId.toLowerCase(),
    sampleJsonStoragePath: asNullStr(decodeFirestoreValue(fields.sampleJsonStoragePath)),
    fullJsonStoragePath: asNullStr(decodeFirestoreValue(fields.fullJsonStoragePath)),
    firstMockTitle: firstMock ? asNullStr(firstMock.title) : null,
  };
}

/**
 * Resolves either a full https:// URL or a Firebase Storage relative path
 * (e.g. `public/pdfs/B1_full.pdf`) into a downloadable Firebase Storage media URL.
 */
export function resolveFirebaseStorageUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalizedPath = pathOrUrl.replace(/^\/+/, '');
  const encodedObject = encodeURIComponent(normalizedPath);
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(FIREBASE_CONFIG.storageBucket)}/o/${encodedObject}?alt=media`;
}
