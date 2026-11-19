export type ViewMode = 'grid' | 'list';

export type ContentTypeKey = 'books' | 'exams' | 'quizbooks';

export const DESIGN_TOKENS = {
  brand: {
    name: 'ExamDash (ed)',
    shortName: 'ExamDash',
    monogram: 'ed',
  },
  views: ['grid', 'list'] as const satisfies readonly ViewMode[],
  surfaces: {
    canvas: 'var(--surface-canvas)',
    subtle: 'var(--surface-subtle)',
    elevated: 'var(--surface-elevated)',
  },
  motion: {
    fastMs: 150,
    standardMs: 200,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;
