import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID } from './config';
import { CONTENT_TYPE_REGISTRY } from '@/lib/design-system/content-types';
import type {
  HomeCatalogPayload,
  MocktestTitleItem,
  PublicBookDTO,
  PublicExamPackDTO,
} from '@/lib/design-system/types';

interface FirestoreValue {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreListResponse {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
  error?: { message?: string; code?: number };
}

export type EntityLookupResult<T> =
  | { readonly status: 'found'; readonly item: T; readonly needsCanonicalRedirect: boolean }
  | { readonly status: 'gone' }
  | { readonly status: 'not_found' };

export function decodeFirestoreValue(val?: FirestoreValue): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val && val.integerValue !== undefined) {
    const parsed = Number(val.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue?.values ?? []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue?.fields ?? {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function asNullableString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val : null;
}

function asNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

/**
 * Server-enforced public DTO projection for the `books` collection.
 * Strictly whitelists public fields and NEVER returns `fullPdfStoragePath` or `fullMarkdownStoragePath`.
 */
export function projectPublicBook(
  docId: string,
  rawFields: Record<string, FirestoreValue>
): PublicBookDTO | null {
  const isPublished = decodeFirestoreValue(rawFields.isPublished) === true;
  const isDeleted = decodeFirestoreValue(rawFields.isDeleted) === true;
  if (!isPublished || isDeleted) {
    return null;
  }

  const id = asString(decodeFirestoreValue(rawFields.id), docId);
  const title = asString(decodeFirestoreValue(rawFields.title)).trim();
  if (!title) return null;

  const rawSlug = asString(decodeFirestoreValue(rawFields.urlSlug), id.toLowerCase()).trim();
  const urlSlug = rawSlug.toLowerCase();

  return {
    id,
    contentType: 'books',
    title,
    urlSlug,
    seoDescription: asString(decodeFirestoreValue(rawFields.seoDescription)).trim(),
    fullDescription: asString(decodeFirestoreValue(rawFields.fullDescription)),
    type: asString(decodeFirestoreValue(rawFields.type), 'Book'),
    language: asString(decodeFirestoreValue(rawFields.language), 'English'),
    publisher: asString(decodeFirestoreValue(rawFields.publisher)),
    authorName: asString(decodeFirestoreValue(rawFields.authorName)),
    tags: asStringArray(decodeFirestoreValue(rawFields.tags)),
    currency: asString(decodeFirestoreValue(rawFields.currency), 'INR'),
    listPrice: asNumber(decodeFirestoreValue(rawFields.listPrice), 0),
    buyPrice: asNumber(decodeFirestoreValue(rawFields.buyPrice), 0),
    sampleMarkdownUrl: asNullableString(decodeFirestoreValue(rawFields.sampleMarkdownUrl)),
    samplePdfUrl: asNullableString(decodeFirestoreValue(rawFields.samplePdfUrl)),
    hasFullPdf: asNullableString(decodeFirestoreValue(rawFields.fullPdfStoragePath)) !== null,
    hasFullMarkdown: asNullableString(decodeFirestoreValue(rawFields.fullMarkdownStoragePath)) !== null,
    createdAt: asNullableString(decodeFirestoreValue(rawFields.createdAt)),
    updatedAt: asNullableString(decodeFirestoreValue(rawFields.updatedAt)),
    publishAt: asNullableString(decodeFirestoreValue(rawFields.publishAt)),
  };
}

/**
 * Server-enforced public DTO projection for the `ExamPackDocument` collection.
 * Strictly whitelists public fields and NEVER returns `fullJsonStoragePath`.
 */
export function projectPublicExamPack(
  docId: string,
  rawFields: Record<string, FirestoreValue>
): PublicExamPackDTO | null {
  const isPublished = decodeFirestoreValue(rawFields.isPublished) === true;
  const isDeleted = decodeFirestoreValue(rawFields.isDeleted) === true;
  if (!isPublished || isDeleted) {
    return null;
  }

  const id = asString(decodeFirestoreValue(rawFields.id), docId);
  const title = asString(decodeFirestoreValue(rawFields.title)).trim();
  if (!title) return null;

  const rawSlug = asString(decodeFirestoreValue(rawFields.urlSlug), id.toLowerCase()).trim();
  const urlSlug = rawSlug.toLowerCase();
  const rawMocktests = decodeFirestoreValue(rawFields.MocktestTitles);
  const mocktestTitles: MocktestTitleItem[] = Array.isArray(rawMocktests)
    ? rawMocktests
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m, idx) => ({
          id: asString(m.id, `mock_${idx + 1}`),
          title: asString(m.title, `Mock Test ${idx + 1}`),
          duration: asNumber(m.duration, 0),
          totalQuestions: asNumber(m.totalQuestions, 0),
          totalMarks: asNumber(m.totalMarks, 0),
        }))
    : [];

  return {
    id,
    contentType: 'exams',
    title,
    urlSlug,
    seoDescription: asString(decodeFirestoreValue(rawFields.seoDescription)).trim(),
    fullDescription: asString(decodeFirestoreValue(rawFields.fullDescription)),
    type: asString(decodeFirestoreValue(rawFields.type), 'Exam Pack'),
    language: asString(decodeFirestoreValue(rawFields.language), 'English'),
    publisher: asString(decodeFirestoreValue(rawFields.publisher)),
    authorName: asString(decodeFirestoreValue(rawFields.authorName)),
    tags: asStringArray(decodeFirestoreValue(rawFields.tags)),
    currency: asString(decodeFirestoreValue(rawFields.currency), 'INR'),
    listPrice: asNumber(decodeFirestoreValue(rawFields.listPrice), 0),
    buyPrice: asNumber(decodeFirestoreValue(rawFields.buyPrice), 0),
    totalMocktest: asNumber(decodeFirestoreValue(rawFields.totalMocktest), mocktestTitles.length),
    mocktestTitles,
    sampleJsonStoragePath: asNullableString(decodeFirestoreValue(rawFields.sampleJsonStoragePath)),
    createdAt: asNullableString(decodeFirestoreValue(rawFields.createdAt)),
    updatedAt: asNullableString(decodeFirestoreValue(rawFields.updatedAt)),
    publishAt: asNullableString(decodeFirestoreValue(rawFields.publishAt)),
  };
}

const MAX_COLLECTION_PAGES = 50;

async function fetchCollectionRaw(collectionName: string, cacheTag: string): Promise<FirestoreDocument[]> {
  const encodedDb = encodeURIComponent(FIRESTORE_DATABASE_ID);
  const encodedCollection = encodeURIComponent(collectionName);
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${encodedDb}/documents/${encodedCollection}`;

  const allDocs: FirestoreDocument[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
    const params = new URLSearchParams({
      pageSize: '200',
      key: FIREBASE_CONFIG.apiKey,
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      next: { revalidate: 120, tags: [cacheTag, 'sitemap'] },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Firestore fetch failed for ${collectionName} (${response.status}): ${errText}`);
    }

    const payload = (await response.json()) as FirestoreListResponse;
    if (payload.documents && payload.documents.length > 0) {
      allDocs.push(...payload.documents);
    }
    if (!payload.nextPageToken) {
      break;
    }
    pageToken = payload.nextPageToken;
  }

  return allDocs;
}

export async function fetchPublishedBooks(): Promise<PublicBookDTO[]> {
  const docs = await fetchCollectionRaw(CONTENT_TYPE_REGISTRY.books.collectionName, 'catalog-books');
  const results: PublicBookDTO[] = [];
  for (const doc of docs) {
    const docId = doc.name.split('/').pop() ?? '';
    const projected = projectPublicBook(docId, doc.fields ?? {});
    if (projected) results.push(projected);
  }
  return results.sort((a, b) => (b.publishAt ?? '').localeCompare(a.publishAt ?? ''));
}

export async function fetchPublishedExams(): Promise<PublicExamPackDTO[]> {
  const docs = await fetchCollectionRaw(CONTENT_TYPE_REGISTRY.exams.collectionName, 'catalog-exams');
  const results: PublicExamPackDTO[] = [];
  for (const doc of docs) {
    const docId = doc.name.split('/').pop() ?? '';
    const projected = projectPublicExamPack(docId, doc.fields ?? {});
    if (projected) results.push(projected);
  }
  return results.sort((a, b) => (b.publishAt ?? '').localeCompare(a.publishAt ?? ''));
}

/**
 * Resolves tombstone slugs (`isDeleted === true`) for HTTP 410 Gone responses.
 * Note: Firestore public list rules only expose `isPublished == true && isDeleted == false`
 * to anonymous callers, so deleted documents naturally resolve to 404 unless explicitly
 * flagged in a public tombstone record or returned with `isDeleted: true`.
 */
export async function fetchDeletedCatalogSlugs(): Promise<{
  readonly books: ReadonlySet<string>;
  readonly exams: ReadonlySet<string>;
}> {
  const books = new Set<string>();
  const exams = new Set<string>();

  try {
    const [bookDocs, examDocs] = await Promise.all([
      fetchCollectionRaw(CONTENT_TYPE_REGISTRY.books.collectionName, 'catalog-books'),
      fetchCollectionRaw(CONTENT_TYPE_REGISTRY.exams.collectionName, 'catalog-exams'),
    ]);

    for (const doc of bookDocs) {
      const fields = doc.fields ?? {};
      if (decodeFirestoreValue(fields.isDeleted) === true) {
        const docId = (doc.name.split('/').pop() ?? '').toLowerCase();
        const slug = asString(decodeFirestoreValue(fields.urlSlug)).trim().toLowerCase();
        if (docId) books.add(docId);
        if (slug) books.add(slug);
      }
    }

    for (const doc of examDocs) {
      const fields = doc.fields ?? {};
      if (decodeFirestoreValue(fields.isDeleted) === true) {
        const docId = (doc.name.split('/').pop() ?? '').toLowerCase();
        const slug = asString(decodeFirestoreValue(fields.urlSlug)).trim().toLowerCase();
        if (docId) exams.add(docId);
        if (slug) exams.add(slug);
      }
    }
  } catch {
    // Fail open on tombstone scan; detail pages handle 404 deterministically
  }

  return { books, exams };
}

export async function fetchHomeCatalog(): Promise<HomeCatalogPayload> {
  try {
    const [books, exams] = await Promise.all([
      fetchPublishedBooks(),
      fetchPublishedExams(),
    ]);
    return {
      books,
      exams,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      books: [],
      exams: [],
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unable to load catalog from Firebase.',
    };
  }
}

export async function lookupBookBySlug(rawSlug: string): Promise<EntityLookupResult<PublicBookDTO>> {
  const trimmed = rawSlug.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return { status: 'not_found' };

  const books = await fetchPublishedBooks();
  const match = books.find(
    (b) => b.urlSlug.toLowerCase() === normalized || b.id.toLowerCase() === normalized
  );

  if (match) {
    const needsCanonicalRedirect = trimmed !== match.urlSlug;
    return { status: 'found', item: match, needsCanonicalRedirect };
  }

  return { status: 'not_found' };
}

export async function lookupExamBySlug(
  rawSlug: string
): Promise<EntityLookupResult<PublicExamPackDTO>> {
  const trimmed = rawSlug.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return { status: 'not_found' };

  const exams = await fetchPublishedExams();
  const match = exams.find(
    (e) => e.urlSlug.toLowerCase() === normalized || e.id.toLowerCase() === normalized
  );

  if (match) {
    const needsCanonicalRedirect = trimmed !== match.urlSlug;
    return { status: 'found', item: match, needsCanonicalRedirect };
  }

  return { status: 'not_found' };
}

export async function fetchBookBySlug(slug: string): Promise<PublicBookDTO | null> {
  const result = await lookupBookBySlug(slug);
  return result.status === 'found' ? result.item : null;
}

export async function fetchExamBySlug(slug: string): Promise<PublicExamPackDTO | null> {
  const result = await lookupExamBySlug(slug);
  return result.status === 'found' ? result.item : null;
}
