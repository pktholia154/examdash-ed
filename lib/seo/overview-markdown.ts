import { Marked } from 'marked';

/**
 * Normalizes escaped newline sequences stored in CMS/Firestore strings
 * (e.g. literal two-character `\n` or `\r\n`) into real newline characters
 * while preserving genuine markdown line structure.
 */
export function normalizeMarkdownNewlines(input: string): string {
  if (!input) return '';
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeOverviewHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(['"])\s*(?:javascript|vbscript|data):[^'"]*\2/gi, '$1="#"');
}

/**
 * Compiles editorial `fullDescription` Markdown into clean, semantic server HTML
 * safe for zero-JS first-byte SSR inside a detail page's `<h2>Overview</h2>` section.
 *
 * Heading demotion guarantees strict single-`<h1>` compliance on every page:
 * - Markdown `#`  -> `<h3>`
 * - Markdown `##` -> `<h3>`
 * - Markdown `###` -> `<h4>`
 * - Markdown `####` -> `<h5>`
 * - Markdown `#####`/`######` -> `<h6>`
 */
export function renderOverviewMarkdownToHtml(rawDescription: string): string {
  const normalized = sanitizeOverviewHtml(normalizeMarkdownNewlines(rawDescription)).trim();
  if (!normalized) return '';

  const markedInstance = new Marked({
    gfm: true,
    breaks: true,
  });

  markedInstance.use({
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        // Demote headings so Overview content lives cleanly beneath <h1> (page) and <h2> (Overview)
        const level = token.depth <= 2 ? 3 : Math.min(6, token.depth + 1);
        return `<h${level}>${inner}</h${level}>\n`;
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        const href = (token.href || '').trim();
        if (!href || /^(?:javascript|vbscript|data):/i.test(href)) {
          return `<span>${inner}</span>`;
        }
        const isExternal = /^https?:\/\//i.test(href);
        const titleAttr = token.title ? ` title="${escapeHtmlAttr(token.title)}"` : '';
        const relAttr = isExternal ? ' rel="noopener noreferrer nofollow"' : '';
        return `<a href="${escapeHtmlAttr(href)}"${titleAttr}${relAttr}>${inner}</a>`;
      },
      image(token) {
        const href = (token.href || '').trim();
        if (!href || !/^(?:https?:\/\/|\/)/i.test(href)) {
          return '';
        }
        const alt = escapeHtmlAttr(token.text || '');
        const titleAttr = token.title ? ` title="${escapeHtmlAttr(token.title)}"` : '';
        return `<img src="${escapeHtmlAttr(href)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
      },
      html(token) {
        // Strip raw embedded HTML blocks to prevent XSS or broken tag nesting in editorial markdown
        return token.text ? sanitizeOverviewHtml(token.text) : '';
      },
    },
  });

  const rawHtml = markedInstance.parse(normalized, { async: false }) as string;
  return sanitizeOverviewHtml(rawHtml).trim();
}

/**
 * Strips Markdown formatting and literal `\n` sequences into clean single-line plain text
 * suitable for `<meta name="description">`, Open Graph descriptions, and JSON-LD `description`.
 */
export function stripMarkdownToPlainText(input: string): string {
  const normalized = normalizeMarkdownNewlines(input);
  if (!normalized) return '';

  return normalized
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[*+-]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a deterministic, GSC-compliant meta description strictly from real entity fields.
 * Prefers `seoDescription`; gracefully falls back to stripped `fullDescription` or `title`.
 */
export function buildCleanMetaDescription(
  seoDescription: string | null | undefined,
  fullDescription: string | null | undefined,
  fallbackTitle: string,
  maxLength = 160
): string {
  const cleanSeo = stripMarkdownToPlainText(seoDescription ?? '');
  const cleanFull = stripMarkdownToPlainText(fullDescription ?? '');
  const source = cleanSeo || cleanFull || fallbackTitle.trim();

  if (source.length <= maxLength) {
    return source;
  }

  const sliced = source.slice(0, maxLength - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const trimmed = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${trimmed.replace(/[.,;:!\-\s]+$/, '')}…`;
}
