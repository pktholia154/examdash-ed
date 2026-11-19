/**
 * Canonical host normalization & redirect/noindex policy for edge middleware.
 *
 * Ensures:
 * - Production mirrors (e.g. `www.exam-dash.com`, raw Cloud Run hostnames) cleanly 301-redirect
 *   to `https://<canonicalHost>` when `ENFORCE_CANONICAL_HOST="true"` (with zero port leaks).
 * - Local development (`localhost`, `127.0.0.1`) always works without redirects.
 * - AI Studio preview iframes (`ais-dev-*.run.app`, `ais-pre-*.run.app`) stay usable in-iframe
 *   while emitting `X-Robots-Tag: noindex, nofollow` so preview hosts are never indexed by Google.
 */

export type HostPolicyAction = 'canonical' | 'redirect' | 'noindex';

/**
 * Extracts and normalizes a bare lowercase hostname from a Host header,
 * X-Forwarded-Host header, or user-supplied URL/domain env var.
 */
export function normalizeHostname(raw: string | null | undefined): string {
  if (!raw) return '';
  // Handle comma-separated X-Forwarded-Host chains by taking the client-facing first host
  const first = raw.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!first) return '';

  // Strip optional scheme (`https://` or `http://`) and any trailing path/query/hash
  const withoutScheme = first.replace(/^https?:\/\//i, '');
  const hostAndPort = withoutScheme.split(/[/?#]/)[0]?.trim() ?? '';
  if (!hostAndPort) return '';

  // Handle IPv6 bracket notation `[::1]:3000`
  if (hostAndPort.startsWith('[')) {
    const closeIdx = hostAndPort.indexOf(']');
    return closeIdx > 0 ? hostAndPort.slice(0, closeIdx + 1) : hostAndPort;
  }

  // Strip port suffix (`:3000`, `:443`, `:80`)
  return hostAndPort.split(':')[0] ?? '';
}

export function isLocalHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/**
 * Matches AI Studio ephemeral dev/preview origins (`ais-dev-*.run.app`, `ais-pre-*.run.app`)
 * which must remain renderable in preview iframes while never being indexed by search engines.
 */
export function isPreviewHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return /^ais-(?:dev|pre)-[a-z0-9-]+\..+\.run\.app$/i.test(host) || /^ais-(?:dev|pre)-/i.test(host);
}

export interface HostPolicyInput {
  readonly requestHost: string | null | undefined;
  readonly canonicalHost: string | null | undefined;
  readonly enforceCanonicalHost: boolean;
}

export function evaluateHostPolicy(input: HostPolicyInput): HostPolicyAction {
  const reqHost = normalizeHostname(input.requestHost);
  const canonHost = normalizeHostname(input.canonicalHost);

  if (!canonHost || !reqHost) return 'canonical';
  if (reqHost === canonHost) return 'canonical';
  if (isLocalHostname(reqHost)) return 'canonical';

  // Keep preview iframes functional while strictly preventing search indexing
  if (isPreviewHostname(reqHost)) return 'noindex';

  return input.enforceCanonicalHost ? 'redirect' : 'noindex';
}

/**
 * Builds a single-hop HTTPS canonical URL without leaking internal proxy ports (`:3000`).
 */
export function buildCanonicalRedirectUrl(
  canonicalHost: string,
  pathname: string,
  searchParams: URLSearchParams
): string {
  const host = normalizeHostname(canonicalHost);
  const cleanParams = new URLSearchParams(searchParams.toString());

  // Fold `?page=1` normalization into the same redirect hop
  if (cleanParams.get('page') === '1') {
    cleanParams.delete('page');
  }

  // Fold hub route lowercase normalization into the same redirect hop
  let cleanPathname = pathname || '/';
  if (/^\/(?:books|exams)\/?$/i.test(cleanPathname)) {
    cleanPathname = cleanPathname.toLowerCase().replace(/\/+$/, '');
  }

  const query = cleanParams.toString();
  return `https://${host}${cleanPathname}${query ? `?${query}` : ''}`;
}
