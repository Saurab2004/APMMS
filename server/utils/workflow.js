// Pure business rules (no database) so they are easy to unit-test.

export const PROPOSAL_STATUS = ['draft', 'submitted', 'under_review', 'revision_required', 'approved', 'rejected'];

/** A proposal may only move along these arrows. */
export const PROPOSAL_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['under_review', 'approved', 'rejected', 'revision_required'],
  under_review: ['approved', 'rejected', 'revision_required'],
  revision_required: ['submitted'],
  // A rejected proposal may be replaced by a brand-new submission (new version).
  rejected: ['submitted'],
  approved: [],
};

export const REPORT_STATUS = ['draft', 'submitted', 'under_review', 'revision_required', 'resubmitted', 'approved', 'rejected'];

export const REPORT_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['under_review', 'approved', 'rejected', 'revision_required'],
  resubmitted: ['under_review', 'approved', 'rejected', 'revision_required'],
  under_review: ['approved', 'rejected', 'revision_required'],
  revision_required: ['resubmitted'],
  approved: [],
  rejected: [],
};

export const REVIEW_DECISIONS = ['approved', 'rejected', 'revision_required'];
export const REPORT_AWAITING_REVIEW = ['submitted', 'resubmitted', 'under_review'];

export const PROJECT_STATUS = [
  'forming',
  'proposal',
  'active',
  'final_review',
  'ready_for_evaluation',
  'evaluated',
  'completed',
  'archived',
];

export const canTransition = (map, from, to) => Boolean(map[from] && map[from].includes(to));

/** A submission is late if it arrives after the deadline. */
export function isLateSubmission(deadline, submittedAt) {
  if (!deadline || !submittedAt) return false;
  return new Date(submittedAt).getTime() > new Date(deadline).getTime();
}

/** A milestone is overdue if its planned date has passed and it is not completed/skipped. */
export function isMilestoneOverdue(milestone, now = new Date()) {
  if (!milestone || ['completed', 'skipped'].includes(milestone.status)) return false;
  return new Date(milestone.plannedDate).getTime() < new Date(now).getTime();
}

/** Overall project progress = average milestone progress (completed counts as 100). */
export function computeProgress(milestones) {
  const active = (milestones || []).filter((m) => m.status !== 'skipped');
  if (!active.length) return 0;
  const sum = active.reduce((acc, m) => acc + (m.status === 'completed' ? 100 : Number(m.progress) || 0), 0);
  return Math.round(sum / active.length);
}

/** Group Leader-only actions. */
export const LEADER_ACTIONS = ['submit_proposal', 'submit_report', 'submit_final_report', 'edit_project', 'upload_submission'];
export const canPerformGroupAction = (access, action) => access === 'leader' && LEADER_ACTIONS.includes(action);
