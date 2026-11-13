import { EvaluationRubric, Evaluation, ExternalEvaluatorAssignment, Project, ProgressReport, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, idStr, sameId } from '../utils/helpers.js';
import { computeEvaluation, aggregateEvaluations, gradeFor } from '../utils/scoring.js';
import { loadProjectAccess } from '../services/access.js';
import { notify, coordinatorIds, projectParticipantIds } from '../services/notifications.js';
import { audit } from '../services/audit.js';

const SUPERVISOR_OK_STATES = ['active', 'final_review', 'ready_for_evaluation', 'evaluated'];
const EXTERNAL_OK_STATES = ['ready_for_evaluation', 'evaluated'];

// ---------------- Rubrics (Coordinator) ----------------
export const listRubrics = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'coordinator' ? {} : { isActive: true };
  if (req.user.role === 'supervisor') filter.appliesTo = 'supervisor';
  const items = await EvaluationRubric.find(filter).sort({ createdAt: -1 }).lean();
  if (req.user.role === 'coordinator') {
    const used = await Evaluation.aggregate([{ $group: { _id: '$rubric', n: { $sum: 1 } } }]);
    const map = new Map(used.map((u) => [idStr(u._id), u.n]));
    items.forEach((r) => {
      r.evaluationCount = map.get(idStr(r._id)) || 0;
    });
  }
  ok(res, items);
});

export const createRubric = asyncHandler(async (req, res) => {
  const rubric = await EvaluationRubric.create({ ...req.body, createdBy: req.user._id });
  await audit(req, { action: 'rubric.created', entityType: 'EvaluationRubric', entityId: rubric._id, summary: `Rubric "${rubric.name}" created` });
  ok(res, rubric, 201);
});

export const updateRubric = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Rubric not found', 404);
  const rubric = await EvaluationRubric.findById(req.params.id);
  if (!rubric) throw new AppError('Rubric not found', 404);
  const used = await Evaluation.exists({ rubric: rubric._id });
  const { criteria, ...rest } = req.body;
  if (criteria && used) {
    throw new AppError('Marks have already been entered with this rubric, so its criteria are locked. Create a new rubric instead.', 409);
  }
  Object.assign(rubric, rest);
  if (criteria) rubric.criteria = criteria;
  await rubric.save();
  await audit(req, { action: 'rubric.updated', entityType: 'EvaluationRubric', entityId: rubric._id, summary: `Rubric "${rubric.name}" updated` });
  ok(res, rubric);
});

// ---------------- My assignments (supervisor / evaluator) ----------------
export const myAssignments = asyncHandler(async (req, res) => {
  if (req.user.role === 'supervisor') {
    const [projects, rubrics] = await Promise.all([
      Project.find({ supervisor: req.user._id, status: { $in: SUPERVISOR_OK_STATES } }).populate('group', 'name').lean(),
      EvaluationRubric.find({ isActive: true, appliesTo: 'supervisor' }).lean(),
    ]);
    const evals = await Evaluation.find({ evaluator: req.user._id, project: { $in: projects.map((p) => p._id) } }).lean();
    const items = projects.map((p) => ({
      project: { _id: p._id, title: p.title, status: p.status, group: p.group },
      rubrics: rubrics.map((r) => {
        const e = evals.find((x) => sameId(x.project, p._id) && sameId(x.rubric, r._id));
        return { rubric: { _id: r._id, name: r.name, stage: r.stage }, evaluation: e ? { _id: e._id, status: e.status, percentage: e.percentage, total: e.total, maxTotal: e.maxTotal } : null };
      }),
    }));
    return ok(res, items);
  }
  // external evaluator
  const assignments = await ExternalEvaluatorAssignment.find({ evaluator: req.user._id, status: 'active', expiresAt: { $gt: new Date() } }).populate('rubric', 'name stage').lean();
  const projectIds = assignments.flatMap((a) => a.projects);
  const [projects, evals, finals] = await Promise.all([
    Project.find({ _id: { $in: projectIds } }).populate('group', 'name').lean(),
    Evaluation.find({ evaluator: req.user._id, project: { $in: projectIds } }).lean(),
    ProgressReport.find({ project: { $in: projectIds }, kind: 'final', status: 'approved' }).select('project title').lean(),
  ]);
  const items = [];
  for (const a of assignments) {
    for (const pid of a.projects) {
      const p = projects.find((x) => sameId(x._id, pid));
      if (!p) continue;
      const e = evals.find((x) => sameId(x.project, pid) && sameId(x.rubric, a.rubric._id));
      items.push({
        assignmentId: a._id,
        sessionLabel: a.sessionLabel,
        expiresAt: a.expiresAt,
        project: { _id: p._id, title: p.title, status: p.status, group: p.group },
        rubric: a.rubric,
        finalReport: finals.find((f) => sameId(f.project, pid)) || null,
        evaluation: e ? { _id: e._id, status: e.status, percentage: e.percentage, total: e.total, maxTotal: e.maxTotal } : null,
      });
    }
  }
  ok(res, items);
});

/** Works out whether the current user may evaluate this project with this rubric. */
async function resolveEvaluatorContext(req) {
  const { projectId, rubricId } = req.params;
  if (!isId(rubricId)) throw new AppError('Rubric not found', 404);
  const rubric = await EvaluationRubric.findById(rubricId);
  if (!rubric || !rubric.isActive) throw new AppError('Rubric not found', 404);
  const { project, group, access } = await loadProjectAccess(req.user, projectId);

  let evaluatorType;
  if (req.user.role === 'supervisor' && access === 'supervisor') {
    if (!rubric.appliesTo.includes('supervisor')) throw new AppError('This rubric is not used for supervisor evaluation', 403);
    evaluatorType = 'supervisor';
  } else if (req.user.role === 'evaluator' && access === 'evaluator') {
    const assignment = await ExternalEvaluatorAssignment.findOne({ evaluator: req.user._id, projects: project._id, rubric: rubric._id, status: 'active', expiresAt: { $gt: new Date() } });
    if (!assignment) throw new AppError('Project not found', 404);
    evaluatorType = 'external';
  } else {
    throw new AppError('You cannot evaluate this project', 403);
  }
  return { rubric, project, group, evaluatorType };
}

function assertProjectReady(project, evaluatorType) {
  const ok_ = evaluatorType === 'supervisor' ? SUPERVISOR_OK_STATES : EXTERNAL_OK_STATES;
  if (!ok_.includes(project.status)) {
    throw new AppError(evaluatorType === 'external' ? 'The project is not ready for external evaluation yet (final report must be approved)' : 'This project is not far enough along to be evaluated', 409);
  }
}

export const getEvaluationForm = asyncHandler(async (req, res) => {
  const { rubric, project, group, evaluatorType } = await resolveEvaluatorContext(req);
  const evaluation = await Evaluation.findOne({ project: project._id, rubric: rubric._id, evaluator: req.user._id });
  const finalReport = await ProgressReport.findOne({ project: project._id, kind: 'final', status: { $in: ['approved', 'submitted', 'under_review', 'resubmitted'] } }).select('title status currentVersion').lean();
  await group.populate('members.user', 'name');
  ok(res, {
    rubric,
    evaluation,
    evaluatorType,
    finalReport: evaluatorType === 'external' && finalReport?.status !== 'approved' ? null : finalReport,
    project: { _id: project._id, title: project.title, summary: project.summary, status: project.status, technologies: project.technologies },
    group: { name: group.name, members: group.activeMembers().map((m) => m.user.name) },
  });
});

async function upsertScores(req, { submit }) {
  const ctx = await resolveEvaluatorContext(req);
  const { rubric, project, evaluatorType } = ctx;
  assertProjectReady(project, evaluatorType);
  let evaluation = await Evaluation.findOne({ project: project._id, rubric: rubric._id, evaluator: req.user._id });
  if (evaluation?.status === 'submitted') {
    throw new AppError('This evaluation has been submitted and is final. Ask the coordinator to reopen it if a correction is needed.', 409);
  }
  const result = computeEvaluation(rubric, req.body.scores || [], { partial: !submit });
  if (result.errors.length) throw new AppError('Please fix the marks', 422, result.errors);

  if (!evaluation) evaluation = new Evaluation({ project: project._id, rubric: rubric._id, evaluator: req.user._id, evaluatorType });
  evaluation.scores = result.scores;
  evaluation.total = result.total;
  evaluation.maxTotal = result.maxTotal;
  evaluation.percentage = result.percentage;
  if (req.body.remarks !== undefined) evaluation.remarks = req.body.remarks;
  if (submit) {
    evaluation.status = 'submitted';
    evaluation.submittedAt = new Date();
  }
  await evaluation.save();
  return { evaluation, ctx };
}

export const saveEvaluationDraft = asyncHandler(async (req, res) => {
  const { evaluation } = await upsertScores(req, { submit: false });
  ok(res, evaluation);
});

export const submitEvaluation = asyncHandler(async (req, res) => {
  const { evaluation, ctx } = await upsertScores(req, { submit: true });
  await notify(await coordinatorIds(), {
    type: 'evaluation_completed',
    title: 'Evaluation submitted',
    body: `${req.user.name} (${ctx.evaluatorType}) evaluated "${ctx.project.title}": ${evaluation.percentage}%.`,
    link: `/coordinator/evaluations?project=${ctx.project._id}`,
    dedupeKey: `evaluation-submitted:${evaluation._id}:${evaluation.reopenCount}`,
  });
  await audit(req, { action: 'evaluation.submitted', entityType: 'Evaluation', entityId: evaluation._id, project: ctx.project._id, scope: 'system', summary: `${ctx.evaluatorType} evaluation submitted for "${ctx.project.title}"` });
  ok(res, evaluation);
});

// ---------------- Coordinator: results & corrections ----------------
export async function buildResults(projectId) {
  const evaluations = await Evaluation.find({ project: projectId }).populate('evaluator', 'name email role organization').populate('rubric').lean();
  const byRubric = new Map();
  for (const e of evaluations) {
    const k = idStr(e.rubric?._id);
    if (!byRubric.has(k)) byRubric.set(k, { rubric: e.rubric, evaluations: [] });
    byRubric.get(k).evaluations.push(e);
  }
  return [...byRubric.values()].map(({ rubric, evaluations: list }) => ({
    rubric: { _id: rubric._id, name: rubric.name, stage: rubric.stage, criteria: rubric.criteria, gradingRules: rubric.gradingRules },
    evaluations: list.map((e) => ({ ...e, rubric: undefined, grade: gradeFor(e.percentage, rubric.gradingRules?.bands) })),
    aggregate: aggregateEvaluations(list, rubric.gradingRules),
  }));
}

export const projectResults = asyncHandler(async (req, res) => {
  if (!isId(req.params.projectId)) throw new AppError('Project not found', 404);
  const project = await Project.findById(req.params.projectId).populate('group', 'name').lean();
  if (!project) throw new AppError('Project not found', 404);
  ok(res, { project: { _id: project._id, title: project.title, group: project.group, status: project.status, resultsPublished: project.resultsPublished }, results: await buildResults(project._id) });
});

export const resultsOverview = asyncHandler(async (req, res) => {
  const filter = { status: { $in: ['ready_for_evaluation', 'evaluated', 'completed', 'final_review', 'active'] } };
  if (req.query.status) filter.status = req.query.status;
  const projects = await Project.find(filter).populate('group', 'name').populate('supervisor', 'name').sort({ updatedAt: -1 }).limit(200).lean();
  const ids = projects.map((p) => p._id);
  const [evals, assignments] = await Promise.all([
    Evaluation.find({ project: { $in: ids } }).select('project status evaluatorType').lean(),
    ExternalEvaluatorAssignment.find({ projects: { $in: ids }, status: 'active' }).select('projects').lean(),
  ]);
  ok(res, projects.map((p) => {
    const mine = evals.filter((e) => sameId(e.project, p._id));
    return {
      _id: p._id,
      title: p.title,
      group: p.group,
      supervisor: p.supervisor,
      status: p.status,
      resultsPublished: p.resultsPublished,
      supervisorSubmitted: mine.filter((e) => e.evaluatorType === 'supervisor' && e.status === 'submitted').length,
      externalSubmitted: mine.filter((e) => e.evaluatorType === 'external' && e.status === 'submitted').length,
      externalAssigned: assignments.filter((a) => a.projects.some((x) => sameId(x, p._id))).length,
      drafts: mine.filter((e) => e.status === 'draft').length,
    };
  }));
});

export const publishResults = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);
  const { publish } = req.body;
  if (publish && !(await Evaluation.exists({ project: project._id, status: 'submitted' }))) {
    throw new AppError('There are no submitted evaluations to publish', 409);
  }
  project.resultsPublished = publish;
  project.resultsPublishedAt = publish ? new Date() : undefined;
  if (publish && project.status === 'ready_for_evaluation') project.status = 'evaluated';
  await project.save();
  if (publish) {
    await notify(await projectParticipantIds(project, { includeSupervisor: false }), {
      type: 'results_published',
      title: 'Evaluation results published',
      body: `Results for "${project.title}" are now available.`,
      link: '/student/history',
      dedupeKey: `results:${project._id}:${project.resultsPublishedAt.getTime()}`,
    });
  }
  await audit(req, { action: publish ? 'evaluation.results_published' : 'evaluation.results_unpublished', entityType: 'Project', entityId: project._id, project: project._id, scope: 'project', summary: publish ? 'Results published' : 'Results hidden again' });
  ok(res, { resultsPublished: project.resultsPublished, status: project.status });
});

/** Authorised correction process: the coordinator re-opens a finalised evaluation (with a recorded reason). */
export const reopenEvaluation = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Evaluation not found', 404);
  const evaluation = await Evaluation.findById(req.params.id);
  if (!evaluation) throw new AppError('Evaluation not found', 404);
  if (evaluation.status !== 'submitted') throw new AppError('Only submitted evaluations can be re-opened', 409);
  evaluation.status = 'draft';
  evaluation.reopenCount += 1;
  evaluation.reopenReason = req.body.reason;
  await evaluation.save();
  await notify([evaluation.evaluator], {
    type: 'evaluation_reopened',
    title: 'Evaluation re-opened for correction',
    body: req.body.reason,
    link: evaluation.evaluatorType === 'supervisor' ? '/supervisor/evaluation' : '/evaluator',
  });
  await audit(req, { action: 'evaluation.reopened', entityType: 'Evaluation', entityId: evaluation._id, project: evaluation.project, scope: 'system', summary: 'Evaluation re-opened', meta: { reason: req.body.reason } });
  ok(res, evaluation);
});

// ---------------- Student: published results only ----------------
export const myResults = asyncHandler(async (req, res) => {
  const group = await ProjectGroup.findOne({ activeMemberIds: req.user._id, status: 'active' }).lean();
  const project = group && (await Project.findById(group.project).lean());
  if (!project) return ok(res, { published: false, results: [] });
  if (!project.resultsPublished) return ok(res, { published: false, results: [] });
  const results = await buildResults(project._id);
  // Students see marks and comments but not evaluator emails.
  const shaped = results.map((r) => ({
    ...r,
    evaluations: r.evaluations
      .filter((e) => e.status === 'submitted')
      .map((e) => ({
        _id: e._id,
        evaluatorType: e.evaluatorType,
        evaluatorName: e.evaluatorType === 'supervisor' ? e.evaluator?.name : 'External evaluator',
        total: e.total,
        maxTotal: e.maxTotal,
        percentage: e.percentage,
        grade: e.grade,
        remarks: e.remarks,
        scores: e.scores,
      })),
  }));
  ok(res, { published: true, project: { _id: project._id, title: project.title }, results: shaped });
});
