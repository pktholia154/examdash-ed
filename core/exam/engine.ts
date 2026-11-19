import type { ExamQuestion, NormalizedExamSet } from './schema';
import type { PublicExamPackDTO, PurchasedItem } from '@/lib/design-system/types';

export type PaletteStatus =
  | 'not_visited'
  | 'not_answered'
  | 'answered'
  | 'marked'
  | 'answered_marked';

export type ExamAnswerValue = string | string[] | null;

export interface QuestionTelemetry {
  readonly status: PaletteStatus;
  readonly timeSpentMs: number;
  readonly revisitCount: number;
  readonly visitCount: number;
}

export interface QuestionEvaluation {
  readonly questionId: string;
  readonly sectionId: string;
  readonly status: 'UNATTEMPTED' | 'CORRECT' | 'PARTIAL' | 'WRONG';
  readonly marksAwarded: number;
  readonly maxMarks: number;
  readonly ignoredByCap?: boolean;
  readonly timeSpentMs: number;
  readonly revisitCount: number;
  readonly paletteStatus: PaletteStatus;
}

export interface SectionEvaluation {
  readonly sectionId: string;
  readonly title: string;
  readonly score: number;
  readonly maxMarks: number;
  readonly totalQuestions: number;
  readonly attempted: number;
  readonly correct: number;
  readonly partial: number;
  readonly wrong: number;
  readonly unattempted: number;
  readonly accuracy: number;
  readonly timeSpentMs: number;
}

export interface ExamEvaluationReport {
  readonly totalScore: number;
  readonly maxMarks: number;
  readonly percentage: number;
  readonly accuracy: number;
  readonly totalQuestions: number;
  readonly attemptedCount: number;
  readonly correctCount: number;
  readonly partialCount: number;
  readonly wrongCount: number;
  readonly unattemptedCount: number;
  readonly totalTimeSpentMs: number;
  readonly totalRevisits: number;
  readonly sectionResults: Record<string, SectionEvaluation>;
  readonly questionResults: Record<string, QuestionEvaluation>;
}

export interface NegativeMarkingConfig {
  readonly mode: 'default' | 'override';
  /** Absolute penalty applied to wrong answers (e.g. 0, 0.25, 0.33, 0.5, 1). */
  readonly wrongPenaltyAbs?: number;
}

export interface ExamSessionState {
  readonly sessionId: string;
  readonly userId: string;
  readonly examPackId: string;
  readonly examPackSlug: string;
  readonly examSetId: string;
  readonly examSetTitle: string;
  readonly mode: 'sample' | 'full';
  readonly phase: 'instructions' | 'in_progress' | 'submitted';
  readonly startedAtMs: number | null;
  readonly submittedAtMs: number | null;
  readonly lastActiveAtMs: number | null;
  readonly totalDurationMs: number;
  readonly sectionalTiming: boolean;
  readonly sectionDurationMs: Record<string, number>;
  readonly sectionElapsedMs: Record<string, number>;
  readonly completedSectionIds: string[];
  readonly activeSectionIndex: number;
  readonly activeQuestionIndex: number;
  readonly responses: Record<string, ExamAnswerValue>;
  readonly telemetry: Record<string, QuestionTelemetry>;
  readonly updatedAtMs: number;
}

export interface ExamAttemptSummary {
  readonly sessionId: string;
  readonly examPackId: string;
  readonly examSetId: string;
  readonly examSetTitle: string;
  readonly mode: 'sample' | 'full';
  readonly phase: 'instructions' | 'in_progress' | 'submitted';
  readonly answeredCount: number;
  readonly totalQuestions: number;
  readonly remainingMs: number;
  readonly score: number | null;
  readonly maxMarks: number;
  readonly accuracy: number | null;
  readonly updatedAtMs: number;
}

export interface PaletteCounts {
  readonly notVisited: number;
  readonly notAnswered: number;
  readonly answered: number;
  readonly marked: number;
  readonly answeredMarked: number;
  readonly total: number;
}

export interface FlattenedPurchasedExamSet {
  readonly key: string;
  readonly purchaseId: string;
  readonly examPackId: string;
  readonly examPackTitle: string;
  readonly examPackSlug: string;
  readonly examSetId: string;
  readonly setNumber: number;
  readonly setTitle: string;
  readonly duration: number;
  readonly totalQuestions: number;
  readonly totalMarks: number;
  readonly sectionalTiming: boolean;
  readonly calculator: 'scientific' | 'basic' | null;
  readonly purchasedAt: string;
  readonly attemptSummary: ExamAttemptSummary | null;
}

export function buildExamSessionId(
  userId: string,
  examPackId: string,
  examSetId: string,
  mode: 'sample' | 'full'
): string {
  return `${userId}__${examPackId}__${examSetId}__${mode}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ============================================================================
// 1. UNIFIED ATTEMPT CHECKER & GRADING ENGINE (Pillar 3 faithful + Analytics)
// ============================================================================

export function isQuestionAttempted(
  question: { type: string },
  rawAnswer: unknown
): boolean {
  if (rawAnswer === null || rawAnswer === undefined) return false;
  if (question.type === 'MSQ') {
    return Array.isArray(rawAnswer) && rawAnswer.some((v) => String(v).trim() !== '');
  }
  const str = String(rawAnswer).trim();
  if (str === '' || (question.type === 'NAT' && (str === '-' || str === '.' || str === '-.'))) {
    return false;
  }
  return question.type === 'NAT' ? Number.isFinite(Number(str)) : true;
}

export function evaluateQuestion(
  question: Pick<ExamQuestion, 'type' | 'marks' | 'answer'>,
  userAnswer: unknown,
  negativeMarking?: NegativeMarkingConfig
): { status: 'UNATTEMPTED' | 'CORRECT' | 'PARTIAL' | 'WRONG'; marksAwarded: number } {
  const { type, marks, answer } = question;
  const correctMarks = Number(marks?.correct ?? 1);
  const rawPenaltyAbs =
    negativeMarking?.mode === 'override'
      ? Math.abs(Number(negativeMarking.wrongPenaltyAbs ?? 0))
      : Math.abs(Number(marks?.wrong ?? 0));
  const wrongPenalty = rawPenaltyAbs === 0 ? 0 : -rawPenaltyAbs;

  if (!isQuestionAttempted(question, userAnswer)) {
    return { status: 'UNATTEMPTED', marksAwarded: 0 };
  }

  if (type === 'MCQ') {
    const isCorrect = String(userAnswer).trim() === String(answer).trim();
    return {
      status: isCorrect ? 'CORRECT' : 'WRONG',
      marksAwarded: isCorrect ? correctMarks : wrongPenalty,
    };
  }

  if (type === 'NAT') {
    const num = Number(String(userAnswer).trim());
    if (!Number.isFinite(num) || !Array.isArray(answer) || answer.length < 2) {
      return { status: 'WRONG', marksAwarded: wrongPenalty };
    }
    const min = Math.min(Number(answer[0]), Number(answer[1]));
    const max = Math.max(Number(answer[0]), Number(answer[1]));
    const isCorrect = num >= min - 1e-6 && num <= max + 1e-6;
    return {
      status: isCorrect ? 'CORRECT' : 'WRONG',
      marksAwarded: isCorrect ? correctMarks : wrongPenalty,
    };
  }

  if (type === 'MSQ') {
    const correctSet = new Set(
      (Array.isArray(answer) ? answer : []).map((v) => String(v).trim()).filter(Boolean)
    );
    const userSet = new Set(
      (Array.isArray(userAnswer) ? userAnswer : []).map((v) => String(v).trim()).filter(Boolean)
    );

    if (correctSet.size === 0 || userSet.size === 0) {
      return { status: 'UNATTEMPTED', marksAwarded: 0 };
    }

    for (const opt of userSet) {
      if (!correctSet.has(opt)) {
        return { status: 'WRONG', marksAwarded: wrongPenalty };
      }
    }

    if (userSet.size === correctSet.size) {
      return { status: 'CORRECT', marksAwarded: correctMarks };
    }

    const partialRate = Number(marks?.partial ?? 0);
    if (partialRate > 0) {
      return {
        status: 'PARTIAL',
        marksAwarded: Math.min(userSet.size * partialRate, correctMarks),
      };
    }

    return { status: 'WRONG', marksAwarded: wrongPenalty };
  }

  return { status: 'UNATTEMPTED', marksAwarded: 0 };
}

export function evaluateFullExam(
  exam: NormalizedExamSet,
  userResponses: Record<string, ExamAnswerValue>,
  telemetryMap: Record<string, QuestionTelemetry> = {},
  negativeMarking?: NegativeMarkingConfig
): ExamEvaluationReport {
  let totalScore = 0;
  let maxMarks = 0;
  let totalQuestions = 0;
  let attemptedCount = 0;
  let correctCount = 0;
  let partialCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;
  let totalTimeSpentMs = 0;
  let totalRevisits = 0;

  const sectionResults: Record<string, SectionEvaluation> = {};
  const questionResults: Record<string, QuestionEvaluation> = {};

  for (const section of exam.sections || []) {
    let sectionScore = 0;
    let sectionMaxMarks = 0;
    let sectionAttempted = 0;
    let sectionCorrect = 0;
    let sectionPartial = 0;
    let sectionWrong = 0;
    let sectionUnattempted = 0;
    let sectionTimeMs = 0;

    const maxAttempts = section.maxAttempts ? Number(section.maxAttempts) : null;
    const questions = section.questions || [];

    for (const q of questions) {
      totalQuestions++;
      const qMax = Math.max(0, Number(q.marks?.correct ?? 1));
      sectionMaxMarks += qMax;
      maxMarks += qMax;

      const t = telemetryMap[q.id];
      const qTimeMs = Math.max(0, t?.timeSpentMs ?? 0);
      const qRevisits = Math.max(0, t?.revisitCount ?? 0);
      const paletteStatus: PaletteStatus = t?.status ?? 'not_visited';

      sectionTimeMs += qTimeMs;
      totalTimeSpentMs += qTimeMs;
      totalRevisits += qRevisits;

      const rawAnswer = userResponses[q.id];
      const attempted = isQuestionAttempted(q, rawAnswer);

      if (attempted && maxAttempts !== null && sectionAttempted >= maxAttempts) {
        sectionUnattempted++;
        unattemptedCount++;
        questionResults[q.id] = {
          questionId: q.id,
          sectionId: section.id,
          status: 'UNATTEMPTED',
          marksAwarded: 0,
          maxMarks: qMax,
          ignoredByCap: true,
          timeSpentMs: qTimeMs,
          revisitCount: qRevisits,
          paletteStatus,
        };
        continue;
      }

      const res = evaluateQuestion(q, rawAnswer, negativeMarking);

      if (res.status === 'UNATTEMPTED') {
        sectionUnattempted++;
        unattemptedCount++;
      } else {
        sectionAttempted++;
        attemptedCount++;
        if (res.status === 'CORRECT') {
          sectionCorrect++;
          correctCount++;
        } else if (res.status === 'PARTIAL') {
          sectionPartial++;
          partialCount++;
        } else {
          sectionWrong++;
          wrongCount++;
        }
      }

      sectionScore += res.marksAwarded;
      questionResults[q.id] = {
        questionId: q.id,
        sectionId: section.id,
        status: res.status,
        marksAwarded: Number(res.marksAwarded.toFixed(2)),
        maxMarks: qMax,
        timeSpentMs: qTimeMs,
        revisitCount: qRevisits,
        paletteStatus,
      };
    }

    const sectionAccuracy =
      sectionAttempted > 0
        ? Math.round(((sectionCorrect + sectionPartial * 0.5) / sectionAttempted) * 100)
        : 0;

    sectionResults[section.id] = {
      sectionId: section.id,
      title: section.title,
      score: Number(sectionScore.toFixed(2)),
      maxMarks: Number(sectionMaxMarks.toFixed(2)),
      totalQuestions: questions.length,
      attempted: sectionAttempted,
      correct: sectionCorrect,
      partial: sectionPartial,
      wrong: sectionWrong,
      unattempted: sectionUnattempted,
      accuracy: sectionAccuracy,
      timeSpentMs: sectionTimeMs,
    };

    totalScore += sectionScore;
  }

  const finalScore = Number(totalScore.toFixed(2));
  const finalMaxMarks = Number(maxMarks.toFixed(2));
  const percentage = finalMaxMarks > 0 ? Number(((finalScore / finalMaxMarks) * 100).toFixed(1)) : 0;
  const accuracy =
    attemptedCount > 0 ? Math.round(((correctCount + partialCount * 0.5) / attemptedCount) * 100) : 0;

  return {
    totalScore: finalScore,
    maxMarks: finalMaxMarks,
    percentage,
    accuracy,
    totalQuestions,
    attemptedCount,
    correctCount,
    partialCount,
    wrongCount,
    unattemptedCount,
    totalTimeSpentMs,
    totalRevisits,
    sectionResults,
    questionResults,
  };
}

// ============================================================================
// 2. DETERMINISTIC CBT STATE MACHINE & DRIFT-FREE TIMESTAMP TIMER
// ============================================================================

export function computeSectionDurationsMs(exam: NormalizedExamSet): Record<string, number> {
  const totalExamMs = Math.max(1, Math.round(exam.duration * 60 * 1000));
  const map: Record<string, number> = {};
  const sections = exam.sections;

  if (sections.length === 0) return map;

  const specifiedSumMin = sections.reduce(
    (sum, s) => sum + (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 0),
    0
  );

  if (specifiedSumMin > 0) {
    for (const s of sections) {
      map[s.id] =
        typeof s.duration === 'number' && s.duration > 0
          ? Math.round(s.duration * 60 * 1000)
          : Math.round(totalExamMs / sections.length);
    }
  } else {
    const perSection = Math.round(totalExamMs / sections.length);
    for (const s of sections) {
      map[s.id] = perSection;
    }
  }

  return map;
}

export function createInitialExamSession(params: {
  userId: string;
  examPackId: string;
  examPackSlug: string;
  exam: NormalizedExamSet;
  mode: 'sample' | 'full';
  nowMs?: number;
  startImmediately?: boolean;
}): ExamSessionState {
  const now = params.nowMs ?? Date.now();
  const sectionDurationMs = computeSectionDurationsMs(params.exam);
  const sectionElapsedMs: Record<string, number> = {};
  const telemetry: Record<string, QuestionTelemetry> = {};

  for (const sec of params.exam.sections) {
    sectionElapsedMs[sec.id] = 0;
    for (const q of sec.questions) {
      telemetry[q.id] = {
        status: 'not_visited',
        timeSpentMs: 0,
        revisitCount: 0,
        visitCount: 0,
      };
    }
  }

  const firstQuestionId = params.exam.sections[0]?.questions[0]?.id;
  const startNow = Boolean(params.startImmediately);

  if (startNow && firstQuestionId && telemetry[firstQuestionId]) {
    telemetry[firstQuestionId] = {
      status: 'not_answered',
      timeSpentMs: 0,
      revisitCount: 0,
      visitCount: 1,
    };
  }

  return {
    sessionId: buildExamSessionId(params.userId, params.examPackId, params.exam.id, params.mode),
    userId: params.userId,
    examPackId: params.examPackId,
    examPackSlug: params.examPackSlug,
    examSetId: params.exam.id,
    examSetTitle: params.exam.title,
    mode: params.mode,
    phase: startNow ? 'in_progress' : 'instructions',
    startedAtMs: startNow ? now : null,
    submittedAtMs: null,
    lastActiveAtMs: startNow ? now : null,
    totalDurationMs: Math.max(60_000, Math.round(params.exam.duration * 60 * 1000)),
    sectionalTiming: Boolean(params.exam.sectionalTiming),
    sectionDurationMs,
    sectionElapsedMs,
    completedSectionIds: [],
    activeSectionIndex: 0,
    activeQuestionIndex: 0,
    responses: {},
    telemetry,
    updatedAtMs: now,
  };
}

export function startExamSession(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase === 'in_progress' || session.phase === 'submitted') {
    return session;
  }

  const firstQ = exam.sections[0]?.questions[0];
  const nextTelemetry = { ...session.telemetry };
  if (firstQ) {
    const prev = nextTelemetry[firstQ.id] ?? {
      status: 'not_visited' as PaletteStatus,
      timeSpentMs: 0,
      revisitCount: 0,
      visitCount: 0,
    };
    nextTelemetry[firstQ.id] = {
      ...prev,
      status: prev.status === 'not_visited' ? 'not_answered' : prev.status,
      visitCount: Math.max(1, prev.visitCount),
    };
  }

  return {
    ...session,
    phase: 'in_progress',
    startedAtMs: nowMs,
    lastActiveAtMs: nowMs,
    telemetry: nextTelemetry,
    updatedAtMs: nowMs,
  };
}

export interface DriftFreeTimerSnapshot {
  readonly totalRemainingMs: number;
  readonly totalElapsedMs: number;
  readonly activeSectionRemainingMs: number;
  readonly activeSectionElapsedMs: number;
  readonly isExamExpired: boolean;
  readonly isActiveSectionExpired: boolean;
}

/**
 * Pure wall-clock drift-free countdown timer calculation.
 * Never drifts during background tab throttling, sleep, or browser refreshes.
 */
export function computeDriftFreeTimer(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): DriftFreeTimerSnapshot {
  const activeSec = exam.sections[session.activeSectionIndex];
  const activeSecId = activeSec?.id ?? '';
  const activeSecLimitMs = session.sectionDurationMs[activeSecId] ?? session.totalDurationMs;

  if (session.phase === 'instructions' || session.startedAtMs === null) {
    return {
      totalRemainingMs: session.totalDurationMs,
      totalElapsedMs: 0,
      activeSectionRemainingMs: activeSecLimitMs,
      activeSectionElapsedMs: 0,
      isExamExpired: false,
      isActiveSectionExpired: false,
    };
  }

  const referenceNow = session.phase === 'submitted' && session.submittedAtMs ? session.submittedAtMs : nowMs;
  const totalElapsedMs = Math.max(0, referenceNow - session.startedAtMs);
  const totalRemainingMs = Math.max(0, session.totalDurationMs - totalElapsedMs);

  const deltaSinceLastActive =
    session.phase === 'in_progress' && session.lastActiveAtMs !== null
      ? Math.max(0, referenceNow - session.lastActiveAtMs)
      : 0;

  const activeSectionElapsedMs = (session.sectionElapsedMs[activeSecId] ?? 0) + deltaSinceLastActive;
  const activeSectionRemainingMs = session.sectionalTiming
    ? Math.max(0, activeSecLimitMs - activeSectionElapsedMs)
    : totalRemainingMs;

  return {
    totalRemainingMs,
    totalElapsedMs,
    activeSectionRemainingMs,
    activeSectionElapsedMs,
    isExamExpired: totalRemainingMs <= 0,
    isActiveSectionExpired: session.sectionalTiming ? activeSectionRemainingMs <= 0 : totalRemainingMs <= 0,
  };
}

/**
 * Credits elapsed wall-clock time since `lastActiveAtMs` to the currently focused question
 * and section, capping delta safely so an expired exam does not accumulate extra time.
 */
export function flushActiveQuestionTime(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress' || session.lastActiveAtMs === null) {
    return session;
  }

  const activeSec = exam.sections[session.activeSectionIndex];
  const activeQ = activeSec?.questions[session.activeQuestionIndex];
  if (!activeSec || !activeQ) {
    return { ...session, lastActiveAtMs: nowMs, updatedAtMs: nowMs };
  }

  const rawDelta = Math.max(0, nowMs - session.lastActiveAtMs);
  if (rawDelta === 0) return session;

  // Cap accrued time to remaining exam duration so overnight reloads don't inflate question time
  const maxAllowedByTotal =
    session.startedAtMs !== null
      ? Math.max(0, session.totalDurationMs - Math.max(0, session.lastActiveAtMs - session.startedAtMs))
      : rawDelta;
  const maxAllowedBySection = session.sectionalTiming
    ? Math.max(
        0,
        (session.sectionDurationMs[activeSec.id] ?? session.totalDurationMs) -
          (session.sectionElapsedMs[activeSec.id] ?? 0)
      )
    : maxAllowedByTotal;
  const creditedDelta = Math.min(rawDelta, maxAllowedByTotal, maxAllowedBySection);

  const prevTel = session.telemetry[activeQ.id] ?? {
    status: 'not_answered' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 1,
  };

  return {
    ...session,
    lastActiveAtMs: nowMs,
    sectionElapsedMs: {
      ...session.sectionElapsedMs,
      [activeSec.id]: (session.sectionElapsedMs[activeSec.id] ?? 0) + creditedDelta,
    },
    telemetry: {
      ...session.telemetry,
      [activeQ.id]: {
        ...prevTel,
        timeSpentMs: prevTel.timeSpentMs + creditedDelta,
      },
    },
    updatedAtMs: nowMs,
  };
}

export function getSectionAttemptedCount(
  exam: NormalizedExamSet,
  sectionIndex: number,
  responses: Record<string, ExamAnswerValue>
): number {
  const sec = exam.sections[sectionIndex];
  if (!sec) return 0;
  let count = 0;
  for (const q of sec.questions) {
    if (isQuestionAttempted(q, responses[q.id])) count++;
  }
  return count;
}

export function visitQuestion(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  targetSectionIndex: number,
  targetQuestionIndex: number,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;

  const targetSec = exam.sections[targetSectionIndex];
  const targetQ = targetSec?.questions[targetQuestionIndex];
  if (!targetSec || !targetQ) return session;

  // Enforce sectional timing lock: cannot jump to other sections when sectionalTiming is enabled
  if (session.sectionalTiming && targetSectionIndex !== session.activeSectionIndex) {
    return session;
  }

  const isSameQuestion =
    targetSectionIndex === session.activeSectionIndex &&
    targetQuestionIndex === session.activeQuestionIndex;

  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  if (isSameQuestion) return flushed;

  const prevTel = flushed.telemetry[targetQ.id] ?? {
    status: 'not_visited' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 0,
  };

  const nextVisitCount = prevTel.visitCount + 1;
  const nextRevisitCount = prevTel.visitCount >= 1 ? prevTel.revisitCount + 1 : 0;
  const nextStatus: PaletteStatus =
    prevTel.status === 'not_visited' ? 'not_answered' : prevTel.status;

  return {
    ...flushed,
    activeSectionIndex: targetSectionIndex,
    activeQuestionIndex: targetQuestionIndex,
    telemetry: {
      ...flushed.telemetry,
      [targetQ.id]: {
        ...prevTel,
        status: nextStatus,
        visitCount: nextVisitCount,
        revisitCount: nextRevisitCount,
      },
    },
    updatedAtMs: nowMs,
  };
}

export function updateResponse(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  questionId: string,
  rawAnswer: ExamAnswerValue,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;

  const activeSec = exam.sections[session.activeSectionIndex];
  const question = activeSec?.questions.find((q) => q.id === questionId);
  if (!activeSec || !question) return session;

  const prevAnswer = session.responses[questionId];
  const wasAttempted = isQuestionAttempted(question, prevAnswer);
  const willBeAttempted = isQuestionAttempted(question, rawAnswer);

  // Enforce maxAttempts section lock
  if (activeSec.maxAttempts && !wasAttempted && willBeAttempted) {
    const currentAttempted = getSectionAttemptedCount(exam, session.activeSectionIndex, session.responses);
    if (currentAttempted >= activeSec.maxAttempts) {
      return session;
    }
  }

  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  const prevTel = flushed.telemetry[questionId] ?? {
    status: 'not_answered' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 1,
  };

  const isCurrentlyMarked =
    prevTel.status === 'marked' || prevTel.status === 'answered_marked';

  const nextStatus: PaletteStatus = willBeAttempted
    ? isCurrentlyMarked
      ? 'answered_marked'
      : 'answered'
    : isCurrentlyMarked
      ? 'marked'
      : 'not_answered';

  return {
    ...flushed,
    responses: {
      ...flushed.responses,
      [questionId]: rawAnswer,
    },
    telemetry: {
      ...flushed.telemetry,
      [questionId]: {
        ...prevTel,
        status: nextStatus,
      },
    },
    updatedAtMs: nowMs,
  };
}

export function clearQuestionResponse(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  questionId: string,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;

  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  const prevTel = flushed.telemetry[questionId] ?? {
    status: 'not_answered' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 1,
  };

  const nextResponses = { ...flushed.responses };
  delete nextResponses[questionId];

  return {
    ...flushed,
    responses: nextResponses,
    telemetry: {
      ...flushed.telemetry,
      [questionId]: {
        ...prevTel,
        status: 'not_answered',
      },
    },
    updatedAtMs: nowMs,
  };
}

function getNextPosition(
  exam: NormalizedExamSet,
  sectionIndex: number,
  questionIndex: number,
  sectionalTiming: boolean
): { sectionIndex: number; questionIndex: number } {
  const currentSec = exam.sections[sectionIndex];
  if (!currentSec) return { sectionIndex, questionIndex };

  if (questionIndex + 1 < currentSec.questions.length) {
    return { sectionIndex, questionIndex: questionIndex + 1 };
  }

  if (!sectionalTiming && sectionIndex + 1 < exam.sections.length) {
    return { sectionIndex: sectionIndex + 1, questionIndex: 0 };
  }

  // Wrap cleanly to start of current section (classic TCS iON behavior)
  return { sectionIndex, questionIndex: 0 };
}

function getPrevPosition(
  exam: NormalizedExamSet,
  sectionIndex: number,
  questionIndex: number,
  sectionalTiming: boolean
): { sectionIndex: number; questionIndex: number } {
  if (questionIndex > 0) {
    return { sectionIndex, questionIndex: questionIndex - 1 };
  }

  if (!sectionalTiming && sectionIndex > 0) {
    const prevSec = exam.sections[sectionIndex - 1];
    return {
      sectionIndex: sectionIndex - 1,
      questionIndex: Math.max(0, (prevSec?.questions.length ?? 1) - 1),
    };
  }

  return { sectionIndex, questionIndex };
}

export function saveAndNextQuestion(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;

  const activeSec = exam.sections[session.activeSectionIndex];
  const activeQ = activeSec?.questions[session.activeQuestionIndex];
  if (!activeSec || !activeQ) return session;

  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  const attempted = isQuestionAttempted(activeQ, flushed.responses[activeQ.id]);
  const prevTel = flushed.telemetry[activeQ.id] ?? {
    status: 'not_answered' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 1,
  };

  const savedSession: ExamSessionState = {
    ...flushed,
    telemetry: {
      ...flushed.telemetry,
      [activeQ.id]: {
        ...prevTel,
        status: attempted ? 'answered' : 'not_answered',
      },
    },
  };

  const nextPos = getNextPosition(
    exam,
    savedSession.activeSectionIndex,
    savedSession.activeQuestionIndex,
    savedSession.sectionalTiming
  );
  return visitQuestion(savedSession, exam, nextPos.sectionIndex, nextPos.questionIndex, nowMs);
}

export function markForReviewAndNext(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;

  const activeSec = exam.sections[session.activeSectionIndex];
  const activeQ = activeSec?.questions[session.activeQuestionIndex];
  if (!activeSec || !activeQ) return session;

  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  const attempted = isQuestionAttempted(activeQ, flushed.responses[activeQ.id]);
  const prevTel = flushed.telemetry[activeQ.id] ?? {
    status: 'not_answered' as PaletteStatus,
    timeSpentMs: 0,
    revisitCount: 0,
    visitCount: 1,
  };

  const markedSession: ExamSessionState = {
    ...flushed,
    telemetry: {
      ...flushed.telemetry,
      [activeQ.id]: {
        ...prevTel,
        status: attempted ? 'answered_marked' : 'marked',
      },
    },
  };

  const nextPos = getNextPosition(
    exam,
    markedSession.activeSectionIndex,
    markedSession.activeQuestionIndex,
    markedSession.sectionalTiming
  );
  return visitQuestion(markedSession, exam, nextPos.sectionIndex, nextPos.questionIndex, nowMs);
}

export function goToPreviousQuestion(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;
  const prevPos = getPrevPosition(
    exam,
    session.activeSectionIndex,
    session.activeQuestionIndex,
    session.sectionalTiming
  );
  return visitQuestion(session, exam, prevPos.sectionIndex, prevPos.questionIndex, nowMs);
}

export function advanceToNextTimedSection(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase !== 'in_progress') return session;
  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  const currentSec = exam.sections[flushed.activeSectionIndex];
  const completedIds = currentSec
    ? Array.from(new Set([...flushed.completedSectionIds, currentSec.id]))
    : flushed.completedSectionIds;

  const nextSectionIndex = flushed.activeSectionIndex + 1;
  if (nextSectionIndex >= exam.sections.length) {
    return submitExamSession({ ...flushed, completedSectionIds: completedIds }, exam, nowMs);
  }

  const nextSec = exam.sections[nextSectionIndex];
  const nextFirstQ = nextSec?.questions[0];
  const nextTelemetry = { ...flushed.telemetry };
  if (nextFirstQ) {
    const prevTel = nextTelemetry[nextFirstQ.id] ?? {
      status: 'not_visited' as PaletteStatus,
      timeSpentMs: 0,
      revisitCount: 0,
      visitCount: 0,
    };
    nextTelemetry[nextFirstQ.id] = {
      ...prevTel,
      status: prevTel.status === 'not_visited' ? 'not_answered' : prevTel.status,
      visitCount: Math.max(1, prevTel.visitCount + 1),
      revisitCount: prevTel.visitCount >= 1 ? prevTel.revisitCount + 1 : 0,
    };
  }

  return {
    ...flushed,
    completedSectionIds: completedIds,
    activeSectionIndex: nextSectionIndex,
    activeQuestionIndex: 0,
    telemetry: nextTelemetry,
    lastActiveAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function submitExamSession(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamSessionState {
  if (session.phase === 'submitted') return session;
  const flushed = flushActiveQuestionTime(session, exam, nowMs);
  return {
    ...flushed,
    phase: 'submitted',
    submittedAtMs: nowMs,
    lastActiveAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function getPaletteCounts(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  sectionIndex?: number
): PaletteCounts {
  const sections =
    typeof sectionIndex === 'number'
      ? exam.sections[sectionIndex]
        ? [exam.sections[sectionIndex]]
        : []
      : exam.sections;

  let notVisited = 0;
  let notAnswered = 0;
  let answered = 0;
  let marked = 0;
  let answeredMarked = 0;

  for (const sec of sections) {
    for (const q of sec.questions) {
      const status = session.telemetry[q.id]?.status ?? 'not_visited';
      if (status === 'not_visited') notVisited++;
      else if (status === 'not_answered') notAnswered++;
      else if (status === 'answered') answered++;
      else if (status === 'marked') marked++;
      else if (status === 'answered_marked') answeredMarked++;
    }
  }

  return {
    notVisited,
    notAnswered,
    answered,
    marked,
    answeredMarked,
    total: notVisited + notAnswered + answered + marked + answeredMarked,
  };
}

export function buildAttemptSummary(
  session: ExamSessionState,
  exam: NormalizedExamSet,
  nowMs: number = Date.now()
): ExamAttemptSummary {
  const timer = computeDriftFreeTimer(session, exam, nowMs);
  const counts = getPaletteCounts(session, exam);
  const evaluation =
    session.phase === 'submitted'
      ? evaluateFullExam(exam, session.responses, session.telemetry)
      : null;

  return {
    sessionId: session.sessionId,
    examPackId: session.examPackId,
    examSetId: session.examSetId,
    examSetTitle: session.examSetTitle,
    mode: session.mode,
    phase: session.phase,
    answeredCount: counts.answered + counts.answeredMarked,
    totalQuestions: counts.total,
    remainingMs: timer.totalRemainingMs,
    score: evaluation ? evaluation.totalScore : null,
    maxMarks: exam.totalMarks,
    accuracy: evaluation ? evaluation.accuracy : null,
    updatedAtMs: session.updatedAtMs,
  };
}

/**
 * Flattens all purchased exam packs into separate attemptable exam set items.
 * Prefers full multi-set JSON arrays fetched from `fullJsonStoragePath` when available,
 * and falls back cleanly to Firestore `MocktestTitles` metadata while loading.
 */
export function flattenPurchasedExamSets(
  purchasedItems: readonly PurchasedItem[],
  catalogExamMap: ReadonlyMap<string, PublicExamPackDTO>,
  loadedFullSetsByPack: Readonly<Record<string, readonly NormalizedExamSet[]>>,
  attemptSummaryMap: Readonly<Record<string, ExamAttemptSummary>>
): FlattenedPurchasedExamSet[] {
  const rows: FlattenedPurchasedExamSet[] = [];

  for (const purchase of purchasedItems) {
    if (purchase.contentType !== 'exams') continue;
    const pack = catalogExamMap.get(purchase.itemId);
    const loadedSets = loadedFullSetsByPack[purchase.itemId];

    if (loadedSets && loadedSets.length > 0) {
      loadedSets.forEach((set, idx) => {
        const key = `${purchase.itemId}::${set.id}`;
        rows.push({
          key,
          purchaseId: purchase.id,
          examPackId: purchase.itemId,
          examPackTitle: pack?.title ?? purchase.title,
          examPackSlug: pack?.urlSlug ?? purchase.urlSlug,
          examSetId: set.id,
          setNumber: idx + 1,
          setTitle: set.title,
          duration: set.duration,
          totalQuestions: set.totalQuestions,
          totalMarks: set.totalMarks,
          sectionalTiming: Boolean(set.sectionalTiming),
          calculator: set.calculator ?? null,
          purchasedAt: purchase.purchasedAt,
          attemptSummary: attemptSummaryMap[key] ?? null,
        });
      });
    } else if (pack && pack.mocktestTitles.length > 0) {
      pack.mocktestTitles.forEach((mock, idx) => {
        const key = `${purchase.itemId}::${mock.id}`;
        rows.push({
          key,
          purchaseId: purchase.id,
          examPackId: purchase.itemId,
          examPackTitle: pack.title,
          examPackSlug: pack.urlSlug,
          examSetId: mock.id,
          setNumber: idx + 1,
          setTitle: mock.title,
          duration: mock.duration,
          totalQuestions: mock.totalQuestions,
          totalMarks: mock.totalMarks,
          sectionalTiming: false,
          calculator: null,
          purchasedAt: purchase.purchasedAt,
          attemptSummary: attemptSummaryMap[key] ?? null,
        });
      });
    } else {
      const fallbackSetId = 'exam_set_1';
      const key = `${purchase.itemId}::${fallbackSetId}`;
      rows.push({
        key,
        purchaseId: purchase.id,
        examPackId: purchase.itemId,
        examPackTitle: purchase.title,
        examPackSlug: purchase.urlSlug,
        examSetId: fallbackSetId,
        setNumber: 1,
        setTitle: `${purchase.title} — Mock Set 01`,
        duration: 60,
        totalQuestions: 0,
        totalMarks: 0,
        sectionalTiming: false,
        calculator: null,
        purchasedAt: purchase.purchasedAt,
        attemptSummary: attemptSummaryMap[key] ?? null,
      });
    }
  }

  return rows;
}

export function formatDurationClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function formatTimeSpentShort(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
