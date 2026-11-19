import type { ContentTypeKey } from './tokens';

export interface ContentTypeConfig {
  readonly key: ContentTypeKey;
  readonly label: string;
  readonly singularLabel: string;
  readonly collectionName: string;
  readonly routePrefix: string;
  readonly thumbnailBg: string;
  readonly thumbnailInk: string;
  readonly description: string;
  readonly activeInHomeCatalog: boolean;
}

export const CONTENT_TYPE_REGISTRY: Record<ContentTypeKey, ContentTypeConfig> = {
  books: {
    key: 'books',
    label: 'Books',
    singularLabel: 'Book',
    collectionName: 'books',
    routePrefix: '/books',
    thumbnailBg: '#81D44C',
    thumbnailInk: '#0F2407',
    description: 'Curated study books, reference guides, and MCQ question banks.',
    activeInHomeCatalog: true,
  },
  exams: {
    key: 'exams',
    label: 'Exams',
    singularLabel: 'Exam Pack',
    collectionName: 'ExamPackDocument',
    routePrefix: '/exams',
    thumbnailBg: '#4CC2D4',
    thumbnailInk: '#061E24',
    description: 'Structured online exam packs and timed mock test series.',
    activeInHomeCatalog: true,
  },
  quizbooks: {
    key: 'quizbooks',
    label: 'Quizbooks',
    singularLabel: 'Quizbook',
    collectionName: 'quizbooks',
    routePrefix: '/quizbooks',
    thumbnailBg: '#924CD4',
    thumbnailInk: '#FFFFFF',
    description: 'Topic-focused interactive quizbooks for rapid exam practice.',
    activeInHomeCatalog: false,
  },
};

export const ACTIVE_HOME_CONTENT_TYPES: readonly ContentTypeConfig[] = Object.values(
  CONTENT_TYPE_REGISTRY
).filter((entry) => entry.activeInHomeCatalog);

export function getContentTypeConfig(key: ContentTypeKey): ContentTypeConfig {
  return CONTENT_TYPE_REGISTRY[key];
}
