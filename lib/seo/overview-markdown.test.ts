import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCleanMetaDescription,
  normalizeMarkdownNewlines,
  renderOverviewMarkdownToHtml,
  stripMarkdownToPlainText,
} from './overview-markdown';

test('normalizeMarkdownNewlines converts literal \\n and \\r\\n into real newlines', () => {
  const input = '# Heading\\n\\nFirst paragraph.\\r\\nSecond line.\\n---\\n* Bullet';
  const normalized = normalizeMarkdownNewlines(input);
  assert.equal(normalized.includes('\\n'), false);
  assert.equal(normalized.includes('\n\nFirst paragraph.'), true);
  assert.equal(normalized.includes('\n---\n* Bullet'), true);
});

test('renderOverviewMarkdownToHtml compiles Firestore markdown with literal \\n and demotes H1/H2 to preserve single H1', () => {
  const firestoreSample =
    '# Indian History MCQs\\n\\nMaster **Indian History** with structured MCQs.\\n\\n---\\n\\n## Why Choose This?\\n\\n* **Exam-Oriented:** Covers syllabus.\\n* **Clarity:** Clean English.\\n\\n### Subtopic\\n\\n1. Ancient India\\n2. Medieval India';

  const html = renderOverviewMarkdownToHtml(firestoreSample);

  // Strict Single-H1 Guard: zero <h1> or <h2> tags inside Overview markdown
  assert.equal(/<h1[\s>]/i.test(html), false, 'Overview markdown must never emit <h1>');
  assert.equal(/<h2[\s>]/i.test(html), false, 'Overview markdown must never emit <h2>');
  assert.equal(html.includes('<h3>Indian History MCQs</h3>'), true);
  assert.equal(html.includes('<h3>Why Choose This?</h3>'), true);
  assert.equal(html.includes('<h4>Subtopic</h4>'), true);
  assert.equal(html.includes('<strong>Indian History</strong>'), true);
  assert.equal(html.includes('<hr'), true);
  assert.equal(html.includes('<ul>'), true);
  assert.equal(html.includes('<ol>'), true);
  assert.equal(html.includes('\\n'), false);
});

test('renderOverviewMarkdownToHtml sanitizes script, iframe, inline handlers, and javascript URLs', () => {
  const malicious =
    'Safe intro\\n\\n<script>alert(1)</script><iframe src="https://evil.test"></iframe>[Click](javascript:alert(2))';
  const html = renderOverviewMarkdownToHtml(malicious);

  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<iframe'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('Safe intro'), true);
});

test('stripMarkdownToPlainText removes markdown syntax and literal \\n cleanly', () => {
  const plain = stripMarkdownToPlainText(
    '# Title\\n\\nMaster **Indian History** with *high-yield* [MCQs](https://example.com).\\n---\\n* Point 1'
  );
  assert.equal(plain, 'Title Master Indian History with high-yield MCQs. Point 1');
});

test('buildCleanMetaDescription prefers seoDescription and truncates cleanly without breaking words', () => {
  assert.equal(
    buildCleanMetaDescription(
      'Indian History Question Bank (Free Sample Book)',
      '# Long markdown\\n\\nBody',
      'Fallback'
    ),
    'Indian History Question Bank (Free Sample Book)'
  );

  const fallback = buildCleanMetaDescription(
    '',
    '# Detailed Guide\\n\\n**Comprehensive** preparation material for competitive exams across India with structured explanations and practice sets for every major syllabus module.',
    'Guide',
    100
  );
  assert.equal(fallback.length <= 100, true);
  assert.equal(fallback.includes('#'), false);
  assert.equal(fallback.includes('**'), false);
});
