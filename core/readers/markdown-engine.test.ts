import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMarkdownScale,
  computeBlockProgressPercent,
  parseMarkdownDocument,
  resolveMarkdownImageUrl,
  stepMarkdownScale,
} from './markdown-engine';

test('parseMarkdownDocument extracts deterministic TOC slugs and strips XSS payloads', () => {
  const md = [
    '# Ancient India',
    'Intro paragraph with <script>alert(1)</script> and <img src="x" onerror="alert(2)">.',
    '## Mauryan Empire',
    '[Click me](javascript:alert(3))',
    '## Mauryan Empire',
    '### Key Dates',
    '| Year | Event |\n| --- | --- |\n| 321 BCE | Chandragupta Maurya |',
    '```ts\nconst score = 100;\n```',
  ].join('\n\n');

  const doc = parseMarkdownDocument(md);
  assert.equal(doc.toc.length, 4);
  assert.deepEqual(
    doc.toc.map((t) => ({ id: t.id, level: t.level })),
    [
      { id: 'ancient-india', level: 1 },
      { id: 'mauryan-empire', level: 2 },
      { id: 'mauryan-empire-1', level: 2 },
      { id: 'key-dates', level: 3 },
    ]
  );

  assert.equal(doc.hasCodeBlocks, true);
  assert.ok(doc.blockCount >= 6);
  assert.equal(doc.html.includes('<script'), false);
  assert.equal(doc.html.includes('onerror='), false);
  assert.equal(doc.html.includes('javascript:'), false);
  assert.equal(doc.html.includes('class="md-block md-table-wrap"'), true);
  assert.equal(doc.html.includes('class="md-block md-code-wrap"'), true);
});

test('clampMarkdownScale and stepMarkdownScale enforce 0.75 to 2.0 bounds', () => {
  assert.equal(clampMarkdownScale(0.1), 0.75);
  assert.equal(clampMarkdownScale(4.5), 2.0);
  assert.equal(stepMarkdownScale(1.0, 1), 1.1);
  assert.equal(stepMarkdownScale(1.0, -3), 0.75);
  assert.equal(stepMarkdownScale(1.95, 2), 2.0);
});

test('resolveMarkdownImageUrl resolves relative paths and rejects javascript URIs', () => {
  assert.equal(
    resolveMarkdownImageUrl('./img/01.png', 'https://cdn.example.com/books/B1/index.md'),
    'https://cdn.example.com/books/B1/img/01.png'
  );
  assert.equal(resolveMarkdownImageUrl('javascript:alert(1)'), '');
});

test('computeBlockProgressPercent calculates accurate anchor progress', () => {
  assert.equal(computeBlockProgressPercent(0, 10), 10);
  assert.equal(computeBlockProgressPercent(9, 10), 100);
  assert.equal(computeBlockProgressPercent(0, 0), 0);
});
