import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractThumbnailMonogram,
  calculateDiscountPercent,
  formatPrice,
  filterCatalogItems,
  computeCartTotals,
  escapeJsonLd,
} from './formatters';
import { projectPublicBook, projectPublicExamPack } from '../firebase/server-catalog';
import { CONTENT_TYPE_REGISTRY } from './content-types';
import type { PublicBookDTO } from './types';

test('extractThumbnailMonogram extracts first letter of first two words', () => {
  assert.equal(extractThumbnailMonogram('Indian History MCQs (Free Sample Book)'), 'IH');
  assert.equal(extractThumbnailMonogram('Online exam IBPS'), 'OE');
  assert.equal(extractThumbnailMonogram('  Quantitative   Aptitude  '), 'QA');
  assert.equal(extractThumbnailMonogram('Physics'), 'PH');
  assert.equal(extractThumbnailMonogram(''), 'ED');
});

test('calculateDiscountPercent computes accurate rounded savings', () => {
  assert.equal(calculateDiscountPercent(120, 100), 17);
  assert.equal(calculateDiscountPercent(300, 200), 33);
  assert.equal(calculateDiscountPercent(100, 100), 0);
  assert.equal(calculateDiscountPercent(0, 0), 0);
  assert.equal(calculateDiscountPercent(100, 150), 0);
});

test('formatPrice renders INR and USD cleanly', () => {
  assert.equal(formatPrice(100, 'INR'), '₹100');
  assert.equal(formatPrice(1250, 'INR'), '₹1,250');
  assert.equal(formatPrice(19.5, 'USD'), '$19.50');
});

test('content type registry preserves mandated single-color thumbnail tokens', () => {
  assert.equal(CONTENT_TYPE_REGISTRY.books.thumbnailBg, '#81D44C');
  assert.equal(CONTENT_TYPE_REGISTRY.exams.thumbnailBg, '#4CC2D4');
  assert.equal(CONTENT_TYPE_REGISTRY.quizbooks.thumbnailBg, '#924CD4');
});

test('filterCatalogItems performs multi-token search across metadata', () => {
  const sampleBooks: PublicBookDTO[] = [
    {
      id: 'B1',
      contentType: 'books',
      title: 'Indian History MCQs (Free Sample Book)',
      urlSlug: 'indian-history-mcqs-free-sample-book-b1',
      seoDescription: 'Indian History Question Bank',
      fullDescription: 'Indian History Question Bank',
      type: 'Question Bank',
      language: 'English',
      publisher: 'MT',
      authorName: 'MT',
      tags: ['Free Book'],
      currency: 'INR',
      listPrice: 120,
      buyPrice: 100,
      sampleMarkdownUrl: null,
      samplePdfUrl: null,
      createdAt: null,
      updatedAt: null,
      publishAt: null,
    },
  ];

  assert.equal(filterCatalogItems(sampleBooks, 'history').length, 1);
  assert.equal(filterCatalogItems(sampleBooks, 'question bank').length, 1);
  assert.equal(filterCatalogItems(sampleBooks, 'ibps').length, 0);
  assert.equal(filterCatalogItems(sampleBooks, '').length, 1);
});

test('computeCartTotals calculates subtotal and savings accurately', () => {
  const totals = computeCartTotals([
    {
      id: 'books__B1',
      itemId: 'B1',
      contentType: 'books',
      title: 'Indian History MCQs',
      urlSlug: 'indian-history-mcqs',
      currency: 'INR',
      buyPrice: 100,
      listPrice: 120,
      quantity: 1,
    },
    {
      id: 'exams__E1',
      itemId: 'E1',
      contentType: 'exams',
      title: 'Online exam IBPS',
      urlSlug: 'online-exam-ibps',
      currency: 'INR',
      buyPrice: 200,
      listPrice: 300,
      quantity: 2,
    },
  ]);

  assert.equal(totals.itemCount, 3);
  assert.equal(totals.subtotal, 500);
  assert.equal(totals.totalListPrice, 720);
  assert.equal(totals.totalSavings, 220);
});

test('server DTO projection strips private storage paths and filters drafts/deleted records', () => {
  const projectedBook = projectPublicBook('B1', {
    id: { stringValue: 'B1' },
    isPublished: { booleanValue: true },
    isDeleted: { booleanValue: false },
    title: { stringValue: 'Indian History MCQs' },
    urlSlug: { stringValue: 'indian-history-mcqs-b1' },
    currency: { stringValue: 'INR' },
    listPrice: { doubleValue: 120 },
    buyPrice: { doubleValue: 100 },
    fullPdfStoragePath: { stringValue: 'private/books/B1_full.pdf' },
    fullMarkdownStoragePath: { stringValue: 'private/books/B1_full.md' },
  });

  assert.ok(projectedBook);
  assert.equal('fullPdfStoragePath' in projectedBook, false);
  assert.equal('fullMarkdownStoragePath' in projectedBook, false);

  const unpublishedBook = projectPublicBook('B2', {
    id: { stringValue: 'B2' },
    isPublished: { booleanValue: false },
    isDeleted: { booleanValue: false },
    title: { stringValue: 'Draft Book' },
  });
  assert.equal(unpublishedBook, null);

  const projectedExam = projectPublicExamPack('E1', {
    id: { stringValue: 'E1' },
    isPublished: { booleanValue: true },
    isDeleted: { booleanValue: false },
    title: { stringValue: 'Online exam IBPS' },
    urlSlug: { stringValue: 'online-exam-ibps-e1' },
    currency: { stringValue: 'INR' },
    listPrice: { doubleValue: 300 },
    buyPrice: { doubleValue: 200 },
    totalMocktest: { integerValue: '2' },
    fullJsonStoragePath: { stringValue: 'private/exams/E1_answers.json' },
  });

  assert.ok(projectedExam);
  assert.equal('fullJsonStoragePath' in projectedExam, false);
});

test('escapeJsonLd prevents script injection characters', () => {
  const escaped = escapeJsonLd({ title: '</script><img src=x>&' });
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
  assert.equal(escaped.includes('&'), false);
});
