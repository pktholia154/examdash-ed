export interface IndexNowPayload {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: readonly string[];
}

export interface IndexNowResult {
  readonly submitted: boolean;
  readonly status?: number;
  readonly urlCount: number;
  readonly reason?: string;
}

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Builds a validated IndexNow batch payload strictly constrained to URLs matching the canonical host.
 */
export function buildIndexNowPayload(
  baseUrl: string,
  key: string,
  urls: readonly string[]
): IndexNowPayload | null {
  const cleanKey = key.trim();
  if (!cleanKey || cleanKey.length < 8 || cleanKey.length > 128) {
    return null;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const normalizedSet = new Set<string>();
  for (const raw of urls) {
    if (!raw || typeof raw !== 'string') continue;
    try {
      const resolved = raw.startsWith('/') ? new URL(raw, originUrl) : new URL(raw);
      if (resolved.host !== originUrl.host) continue;
      if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
      normalizedSet.add(resolved.toString());
    } catch {
      // Ignore malformed URLs
    }
  }

  const urlList = Array.from(normalizedSet).slice(0, 10000);
  if (urlList.length === 0) return null;

  return {
    host: originUrl.host,
    key: cleanKey,
    keyLocation: `${originUrl.origin}/${cleanKey}.txt`,
    urlList,
  };
}

/**
 * Dispatches event-driven IndexNow notifications on publish, substantive update, or 404/410 removal.
 */
export async function submitIndexNowUrls(
  baseUrl: string,
  urls: readonly string[]
): Promise<IndexNowResult> {
  const key = process.env.INDEXNOW_KEY?.trim() ?? '';
  if (!key) {
    return { submitted: false, urlCount: 0, reason: 'INDEXNOW_KEY is not configured.' };
  }

  const payload = buildIndexNowPayload(baseUrl, key, urls);
  if (!payload) {
    return { submitted: false, urlCount: 0, reason: 'No valid canonical URLs to notify.' };
  }

  // Never notify search engines for localhost URLs
  if (payload.host.startsWith('localhost') || payload.host.startsWith('127.0.0.1')) {
    return { submitted: false, urlCount: payload.urlList.length, reason: 'Skipped for localhost.' };
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return {
      submitted: response.ok,
      status: response.status,
      urlCount: payload.urlList.length,
      reason: response.ok ? undefined : `IndexNow HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      submitted: false,
      urlCount: payload.urlList.length,
      reason: err instanceof Error ? err.message : 'IndexNow network error',
    };
  }
}
