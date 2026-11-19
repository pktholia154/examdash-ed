import { Marked } from 'marked';

export interface MarkdownTocItem {
  readonly id: string;
  readonly text: string;
  readonly level: 1 | 2 | 3;
}

export interface ParsedMarkdownDocument {
  readonly html: string;
  readonly toc: readonly MarkdownTocItem[];
  readonly hasCodeBlocks: boolean;
  readonly blockCount: number;
  readonly wordCount: number;
}

export const MD_SCALE_MIN = 0.75;
export const MD_SCALE_MAX = 2.0;
export const MD_SCALE_STEP = 0.1;

export function clampMarkdownScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  const clamped = Math.min(MD_SCALE_MAX, Math.max(MD_SCALE_MIN, scale));
  return Math.round(clamped * 100) / 100;
}

export function stepMarkdownScale(current: number, deltaSteps: number): number {
  return clampMarkdownScale(current + deltaSteps * MD_SCALE_STEP);
}

/**
 * Deterministic heading slug generator matching GitHub-style anchors.
 */
export function slugifyHeading(text: string, usedCounts: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';

  const count = usedCounts.get(base) ?? 0;
  usedCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function detectFencedCodeBlocks(markdown: string): boolean {
  return /(^|\n)```/.test(markdown);
}

export function computeBlockProgressPercent(blockIndex: number, totalBlocks: number): number {
  if (totalBlocks <= 1) return totalBlocks === 1 ? 100 : 0;
  const clamped = Math.max(0, Math.min(totalBlocks - 1, blockIndex));
  return Math.min(100, Math.max(0, Math.round(((clamped + 1) / totalBlocks) * 100)));
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Resolves relative image URLs cleanly against an optional asset base URL.
 */
export function resolveMarkdownImageUrl(href: string, assetBaseUrl?: string): string {
  const trimmed = (href || '').trim();
  if (!trimmed) return '';
  if (/^(https?:\/\/|data:image\/|blob:|\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^javascript:/i.test(trimmed)) {
    return '';
  }
  if (assetBaseUrl) {
    try {
      return new URL(trimmed, assetBaseUrl).toString();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Lightweight defensive sanitizer fallback for non-DOM environments (Node tests / workers).
 * In browser environments, DOMPurify is ALWAYS run on top of this output before mounting.
 */
export function stripDangerousHtmlFallback(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"');
}

/**
 * Parses GFM Markdown into structured HTML with:
 * - Deterministic heading IDs & extracted h1-h3 TOC
 * - Mobile overflow wrappers around <table> and <pre>
 * - Lazy, referrer-safe image hooks ready for lightbox inspection
 * - Block indices (`data-md-block`) for zoom-resilient scroll anchoring
 */
export function parseMarkdownDocument(
  rawMarkdown: string,
  options?: { readonly assetBaseUrl?: string; readonly sanitizer?: (html: string) => string }
): ParsedMarkdownDocument {
  const toc: MarkdownTocItem[] = [];
  const usedSlugs = new Map<string, number>();
  let blockIndex = 0;

  const markedInstance = new Marked({
    gfm: true,
    breaks: false,
  });

  const renderer = {
    heading({ text, depth }: { text: string; depth: number }) {
      const plainText = text.replace(/<[^>]+>/g, '').trim();
      const id = slugifyHeading(plainText, usedSlugs);
      const level = Math.min(6, Math.max(1, depth));
      if (level <= 3) {
        toc.push({ id, text: plainText, level: level as 1 | 2 | 3 });
      }
      const idx = blockIndex++;
      return `<h${level} id="${escapeHtmlAttr(id)}" data-md-block="${idx}" class="md-block md-h${level}">${text}</h${level}>\n`;
    },
    paragraph({ text }: { text: string }) {
      const idx = blockIndex++;
      return `<p data-md-block="${idx}" class="md-block">${text}</p>\n`;
    },
    blockquote({ text }: { text: string }) {
      const idx = blockIndex++;
      return `<blockquote data-md-block="${idx}" class="md-block">${text}</blockquote>\n`;
    },
    list(token: { ordered: boolean; start: number | ''; items: Array<{ text: string }> }) {
      const idx = blockIndex++;
      const tag = token.ordered ? 'ol' : 'ul';
      const startAttr = token.ordered && token.start && token.start !== 1 ? ` start="${token.start}"` : '';
      const body = token.items.map((item) => `<li>${item.text}</li>`).join('\n');
      return `<${tag}${startAttr} data-md-block="${idx}" class="md-block">${body}</${tag}>\n`;
    },
    code({ text, lang }: { text: string; lang?: string }) {
      const idx = blockIndex++;
      const safeLang = (lang || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const langClass = safeLang ? ` language-${safeLang}` : '';
      return `<div data-md-block="${idx}" class="md-block md-code-wrap"><pre><code class="md-code${langClass}">${escaped}</code></pre></div>\n`;
    },
    table(token: {
      header: Array<{ text: string; align: 'center' | 'left' | 'right' | null }>;
      rows: Array<Array<{ text: string; align: 'center' | 'left' | 'right' | null }>>;
    }) {
      const idx = blockIndex++;
      const headerCells = token.header
        .map((cell) => `<th${cell.align ? ` style="text-align:${cell.align}"` : ''}>${cell.text}</th>`)
        .join('');
      const bodyRows = token.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td${cell.align ? ` style="text-align:${cell.align}"` : ''}>${cell.text}</td>`)
              .join('')}</tr>`
        )
        .join('\n');
      return `<div data-md-block="${idx}" class="md-block md-table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>\n`;
    },
    image({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const resolved = resolveMarkdownImageUrl(href, options?.assetBaseUrl);
      if (!resolved) return '';
      const safeAlt = escapeHtmlAttr(text || 'Illustration');
      const safeTitle = title ? ` title="${escapeHtmlAttr(title)}"` : '';
      return `<img src="${escapeHtmlAttr(resolved)}" alt="${safeAlt}"${safeTitle} loading="lazy" decoding="async" referrerpolicy="no-referrer" data-md-lightbox="true" class="md-figure-img" />`;
    },
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const trimmed = (href || '').trim();
      if (/^javascript:/i.test(trimmed)) {
        return `<span>${text}</span>`;
      }
      const isExternal = /^https?:\/\//i.test(trimmed);
      const safeHref = escapeHtmlAttr(trimmed || '#');
      const safeTitle = title ? ` title="${escapeHtmlAttr(title)}"` : '';
      const relAttr = isExternal ? ' rel="noopener noreferrer" data-md-external="true"' : '';
      return `<a href="${safeHref}"${safeTitle}${relAttr}>${text}</a>`;
    },
  };

  // Use marked.use with inline token rendering inside custom renderer
  markedInstance.use({
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        return renderer.heading({ text: inner, depth: token.depth });
      },
      paragraph(token) {
        const inner = this.parser.parseInline(token.tokens);
        return renderer.paragraph({ text: inner });
      },
      blockquote(token) {
        const inner = this.parser.parse(token.tokens);
        return renderer.blockquote({ text: inner });
      },
      list(token) {
        const items = token.items.map((item) => ({
          text: this.parser.parse(item.tokens),
        }));
        return renderer.list({ ordered: token.ordered, start: token.start, items });
      },
      code(token) {
        return renderer.code({ text: token.text, lang: token.lang });
      },
      table(token) {
        const header = token.header.map((cell) => ({
          text: this.parser.parseInline(cell.tokens),
          align: cell.align,
        }));
        const rows = token.rows.map((row) =>
          row.map((cell) => ({
            text: this.parser.parseInline(cell.tokens),
            align: cell.align,
          }))
        );
        return renderer.table({ header, rows });
      },
      image(token) {
        return renderer.image({ href: token.href, title: token.title, text: token.text });
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        return renderer.link({ href: token.href, title: token.title, text: inner });
      },
    },
  });

  const rawHtml = markedInstance.parse(rawMarkdown || '', { async: false }) as string;
  const fallbackClean = stripDangerousHtmlFallback(rawHtml);
  const sanitized = options?.sanitizer ? options.sanitizer(fallbackClean) : fallbackClean;
  const wordCount = (rawMarkdown || '').trim().split(/\s+/).filter(Boolean).length;

  return {
    html: sanitized,
    toc,
    hasCodeBlocks: detectFencedCodeBlocks(rawMarkdown || ''),
    blockCount: blockIndex,
    wordCount,
  };
}
