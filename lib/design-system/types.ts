import type { ContentTypeKey } from './tokens';

export interface MocktestTitleItem {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly totalQuestions: number;
  readonly totalMarks: number;
}

/**
 * Base public SEO & catalog fields strictly projected on the server.
 * Private storage paths (fullPdfStoragePath, fullMarkdownStoragePath, fullJsonStoragePath)
 * are deliberately excluded from all public DTOs.
 */
export interface PublicCatalogBaseDTO {
  readonly id: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly seoDescription: string;
  readonly fullDescription: string;
  readonly type: string;
  readonly language: string;
  readonly publisher: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  readonly currency: string;
  readonly listPrice: number;
  readonly buyPrice: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly publishAt: string | null;
}

export interface PublicBookDTO extends PublicCatalogBaseDTO {
  readonly contentType: 'books';
  readonly sampleMarkdownUrl: string | null;
  readonly samplePdfUrl: string | null;
  readonly hasFullPdf?: boolean;
  readonly hasFullMarkdown?: boolean;
}

export interface PublicExamPackDTO extends PublicCatalogBaseDTO {
  readonly contentType: 'exams';
  readonly totalMocktest: number;
  readonly mocktestTitles: readonly MocktestTitleItem[];
  readonly sampleJsonStoragePath: string | null;
}

export type PublicCatalogItem = PublicBookDTO | PublicExamPackDTO;

export interface HomeCatalogPayload {
  readonly books: readonly PublicBookDTO[];
  readonly exams: readonly PublicExamPackDTO[];
  readonly fetchedAt: string;
  readonly error: string | null;
}

export interface CartItem {
  readonly id: string;
  readonly itemId: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly currency: string;
  readonly buyPrice: number;
  readonly listPrice: number;
  readonly quantity: number;
}

export interface PurchasedItem {
  readonly id: string;
  readonly itemId: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly currency: string;
  readonly amountPaid: number;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly entitlementProof: string;
  readonly status: 'completed';
  readonly purchasedAt: string;
}

export type ReaderFormat = 'pdf' | 'markdown';
export type ReaderMode = 'sample' | 'full';
export type ReadingTheme = 'light' | 'sepia' | 'dark';

export interface ReadingProgressRecord {
  readonly id: string;
  readonly bookId: string;
  readonly format: ReaderFormat;
  readonly mode: ReaderMode;
  readonly pageIndex: number;
  readonly totalPages: number;
  readonly offsetRatio: number;
  readonly blockIndex: number;
  readonly zoomScale: number;
  readonly progressPercent: number;
  readonly updatedAt: string;
}

export interface UserAnalyticsSummary {
  readonly testsAttempted: number;
  readonly booksOwned: number;
  readonly examsOwned: number;
  readonly averageAccuracy: number;
  readonly studyStreakDays: number;
}
