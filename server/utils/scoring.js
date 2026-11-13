// Evaluation maths (pure functions, unit-tested).

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Validates marks against a rubric and calculates totals.
 *  - total       = sum of raw marks
 *  - maxTotal    = sum of the criteria maximum marks
 *  - percentage  = weighted percentage: sum((marks / max) * weight) / sum(weight) * 100
 * With { partial: true } (draft saving) missing marks are allowed, but any mark that
 * IS given must still be valid.
 */
export function computeEvaluation(rubric, scores = [], { partial = false } = {}) {
  const errors = [];
  const criteria = rubric.criteria || [];
  const known = new Set(criteria.map((c) => String(c._id)));
  const byId = new Map();

  for (const s of scores) {
    const id = String(s.criterionId);
    if (!known.has(id)) {
      errors.push('Unknown criterion in submitted marks');
      continue;
    }
    byId.set(id, s);
  }

  let total = 0;
  let maxTotal = 0;
  let weightedNumerator = 0;
  let weightTotal = 0;
  let given = 0;
  const normalized = [];

  for (const c of criteria) {
    maxTotal += c.maxMarks;
    weightTotal += c.weight;
    const s = byId.get(String(c._id));
    const raw = s ? s.marks : undefined;
    const missing = raw === undefined || raw === null || raw === '';
    if (missing) {
      if (!partial) errors.push(`Marks are missing for "${c.name}"`);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > c.maxMarks) {
      errors.push(`Marks for "${c.name}" must be between 0 and ${c.maxMarks}`);
      continue;
    }
    given += 1;
    total += n;
    weightedNumerator += (n / c.maxMarks) * c.weight;
    normalized.push({
      criterionId: c._id,
      marks: n,
      comment: String(s.comment || '').slice(0, 1000),
    });
  }

  return {
    errors,
    scores: normalized,
    given,
    total: round2(total),
    maxTotal: round2(maxTotal),
    percentage: weightTotal > 0 ? round2((weightedNumerator / weightTotal) * 100) : 0,
  };
}

/** Maps a percentage to a grade using bands like [{min: 80, grade: 'A'}]. */
export function gradeFor(percentage, bands = []) {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const hit = sorted.find((b) => percentage >= b.min);
  return hit ? hit.grade : null;
}

/**
 * Combines several submitted evaluations ONLY when the rubric's grading rule says so.
 * With rule "none" we never average silently - each evaluator stays separate.
 */
export function aggregateEvaluations(evaluations, gradingRules = {}) {
  const submitted = evaluations.filter((e) => e.status === 'submitted');
  if (gradingRules.aggregation !== 'average' || submitted.length === 0) {
    return { method: 'none', count: submitted.length, percentage: null, grade: null };
  }
  const percentage = round2(submitted.reduce((s, e) => s + e.percentage, 0) / submitted.length);
  return {
    method: 'average',
    count: submitted.length,
    percentage,
    grade: gradeFor(percentage, gradingRules.bands),
  };
}
