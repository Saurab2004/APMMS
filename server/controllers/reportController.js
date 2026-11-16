import { ProgressReport, ReportVersion, ReportReview, Project, Milestone, Proposal, ProjectGroup, AcademicTerm } from '../models/index.js';
import { REPORT_TYPES } from '../models/Report.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, escapeRegex, isId, idStr } from '../utils/helpers.js';
import { REPORT_STATUS, REPORT_TRANSITIONS, REPORT_AWAITING_REVIEW, canTransition, isLateSubmission } from '../utils/workflow.js';
import { loadProjectAccess, requireLeader, requireReviewer, scopedProjectIds, isStudentAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify, coordinatorIds } from '../services/notifications.js';
import { postFormalFeedback } from '../services/feedbackService.js';
import { saveUpload, saveMany, removeFile, sendStoredFile } from '../services/storage.js';
import { getSettings } from '../services/settings.js';
import { toCsv } from '../utils/csv.js';
import { validateObject } from '../utils/validate.js';

const META_RULES = {
  project: { type: 'objectId', required: true, label: 'Project' },
  kind: { type: 'enum', values: ['progress', 'final'], default: 'progress' },
  type: { type: 'enum', values: REPORT_TYPES, default: 'weekly' },
  title: { required: true, min: 3, max: 200, label: 'Title' },
  description: { max: 3000 },
  periodStart: { type: 'date', label: 'Period start' },
  periodEnd: { type: 'date', label: 'Period end' },
  milestone: { type: 'objectId' },
  asDraft: { type: 'boolean', default: false },
  note: { max: 2000 },
};

/** Multipart form fields arrive as strings; empty strings are treated as "not provided". */
const clean = (body) => Object.fromEntries(Object.entries(body || {}).filter(([, v]) => v !== ''));

function reportFiles(req) {
  const f = req.files || {};
  return { main: (f.file || [])[0], attachments: f.attachments || [] };
}

async function resolveDeadline(project, { milestone, kind }) {
  if (milestone) {
    const m = await Milestone.findOne({ _id: milestone, project: project._id });
    if (!m) throw new AppError('That milestone does not belong to this project', 422, { milestone: 'Invalid milestone' });
    return m.plannedDate;
  }
  if (kind === 'final') {
    const term = await AcademicTerm.findById(project.term).lean();
    return term?.deadlines?.finalReport || undefined;
  }
  return undefined;
}

/** Rules a group must meet before it may submit its final report. */
export async function finalEligibility(project) {
  const settings = await getSettings();
  const proposal = await Proposal.findOne({ project: project._id }).lean();
  const approvedProgress = await ProgressReport.countDocuments({ project: project._id, kind: 'progress', status: 'approved' });
  const existingFinal = await ProgressReport.findOne({ project: project._id, kind: 'final', status: { $ne: 'rejected' } }).lean();
  const checks = [
    { key: 'proposal', label: 'Proposal approved', passed: proposal?.status === 'approved' },
    {
      key: 'progress',
      label: `At least ${settings.minApprovedProgressReportsForFinal} approved progress report(s) (you have ${approvedProgress})`,
      passed: approvedProgress >= settings.minApprovedProgressReportsForFinal,
    },
    { key: 'supervisor', label: 'A supervisor is assigned', passed: Boolean(project.supervisor) },
    { key: 'single', label: 'No other active final report exists', passed: !existingFinal },
  ];
  return { eligible: checks.every((c) => c.passed), checks, existingFinalId: existingFinal?._id || null };
}

export const getFinalEligibility = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  if (!isStudentAccess(access) && access !== 'coordinator' && access !== 'supervisor') throw new AppError('Project not found', 404);
  ok(res, await finalEligibility(project));
});

function applyProjectStatusOnSubmit(project, report) {
  if (report.kind === 'final' && ['active', 'proposal'].includes(project.status)) project.status = 'final_review';
}

async function notifyReviewers(project, report, version, { resubmitted }) {
  const target = project.supervisor ? [project.supervisor] : await coordinatorIds();
  await notify(target, {
    type: 'report_submitted',
    title: resubmitted ? 'Report resubmitted' : report.kind === 'final' ? 'Final report submitted' : 'New report to review',
    body: `"${report.title}" (version ${version.version})${report.isLate ? ' - submitted late' : ''}`,
    link: project.supervisor ? `/supervisor/reports/${report._id}` : `/coordinator/reports/${report._id}`,
    dedupeKey: `report-submitted:${report._id}:${version.version}`,
  });
}

// ---------------- Create / edit / submit (Group Leader) ----------------
export const createReport = asyncHandler(async (req, res) => {
  const { errors, value } = validateObject(clean(req.body), META_RULES);
  if (Object.keys(errors).length) throw new AppError('Please correct the highlighted fields', 422, errors);
  const { project, access } = await loadProjectAccess(req.user, value.project);
  requireLeader(access);
  if (['proposal', 'forming'].includes(project.status)) throw new AppError('Reports can be submitted after your proposal is approved', 409);
  if (['evaluated', 'completed', 'archived'].includes(project.status)) throw new AppError('This project is closed for new submissions', 409);
  if (value.periodStart && value.periodEnd && value.periodEnd < value.periodStart) {
    throw new AppError('The reporting period must end after it starts', 422, { periodEnd: 'Must be after period start' });
  }
  if (value.kind === 'final') {
    const el = await finalEligibility(project);
    if (!el.eligible) throw new AppError('Your group is not yet eligible to submit the final report', 409, el.checks.filter((c) => !c.passed).map((c) => c.label));
    value.type = 'final';
  }

  const { main, attachments } = reportFiles(req);
  if (!value.asDraft && !main) throw new AppError('Attach the report document (PDF or DOCX)', 422, { file: 'Report file is required' });

  const deadline = await resolveDeadline(project, value);
  const scope = idStr(project._id);
  const saved = [];
  try {
    const file = main ? await saveUpload(main, { category: 'report', scope, folder: 'reports' }) : undefined;
    if (file) saved.push(file);
    const extra = await saveMany(attachments, { category: 'attachment', scope, folder: 'report-attachments' });
    saved.push(...extra);

    const now = new Date();
    const submitting = !value.asDraft;
    const late = submitting && isLateSubmission(deadline, now);
    const report = await ProgressReport.create({
      project: project._id,
      kind: value.kind,
      type: value.type,
      title: value.title,
      description: value.description,
      periodStart: value.periodStart,
      periodEnd: value.periodEnd,
      milestone: value.milestone,
      deadline,
      status: submitting ? 'submitted' : 'draft',
      currentVersion: 1,
      submittedAt: submitting ? now : undefined,
      isLate: late,
      createdBy: req.user._id,
    });
    const version = await ReportVersion.create({
      report: report._id,
      project: project._id,
      version: 1,
      state: submitting ? 'submitted' : 'draft',
      file,
      attachments: extra,
      note: value.note,
      submittedBy: submitting ? req.user._id : undefined,
      submittedAt: submitting ? now : undefined,
      isLate: late,
    });
    if (submitting) {
      applyProjectStatusOnSubmit(project, report);
      await project.save();
      await notifyReviewers(project, report, version, { resubmitted: false });
      await audit(req, { action: 'report.submitted', entityType: 'ProgressReport', entityId: report._id, project: project._id, scope: 'project', summary: `${report.kind === 'final' ? 'Final' : 'Progress'} report "${report.title}" submitted${late ? ' (late)' : ''}` });
    }
    ok(res, { report, version }, 201);
  } catch (err) {
    await Promise.all(saved.map(removeFile));
    throw err;
  }
});

async function loadReport(req, { forStudentEdit = false } = {}) {
  if (!isId(req.params.id)) throw new AppError('Report not found', 404);
  const report = await ProgressReport.findById(req.params.id);
  if (!report) throw new AppError('Report not found', 404);
  const ctx = await loadProjectAccess(req.user, report.project);
  const studentSide = isStudentAccess(ctx.access);
  // Drafts are private to the student group.
  if (report.status === 'draft' && !studentSide) throw new AppError('Report not found', 404);
  // Evaluators may only see an approved final report.
  if (ctx.access === 'evaluator' && !(report.kind === 'final' && report.status === 'approved')) throw new AppError('Report not found', 404);
  if (forStudentEdit) requireLeader(ctx.access);
  return { report, ...ctx };
}

export const updateDraft = asyncHandler(async (req, res) => {
  const { report, project } = await loadReport(req, { forStudentEdit: true });
  if (report.status !== 'draft') throw new AppError('Only draft reports can be edited. Use "Resubmit" for revisions.', 409);
  // No defaults here: a draft edit must never overwrite fields the user did not send.
  const { errors, value } = validateObject(clean(req.body), {
    type: { type: 'enum', values: REPORT_TYPES },
    title: { min: 3, max: 200, label: 'Title' },
    description: { max: 3000 },
    periodStart: { type: 'date', label: 'Period start' },
    periodEnd: { type: 'date', label: 'Period end' },
    milestone: { type: 'objectId' },
    note: { max: 2000 },
  });
  if (Object.keys(errors).length) throw new AppError('Please correct the highlighted fields', 422, errors);
  for (const f of ['type', 'title', 'description', 'periodStart', 'periodEnd']) if (value[f] !== undefined && !(f === 'type' && report.kind === 'final')) report[f] = value[f];
  if (value.milestone) {
    report.milestone = value.milestone;
    report.deadline = await resolveDeadline(project, { milestone: value.milestone, kind: report.kind });
  }
  const draftVersion = await ReportVersion.findOne({ report: report._id, version: report.currentVersion });
  const { main, attachments } = reportFiles(req);
  const scope = idStr(project._id);
  if (main) {
    const file = await saveUpload(main, { category: 'report', scope, folder: 'reports' });
    await removeFile(draftVersion.file);
    draftVersion.file = file;
  }
  if (attachments.length) {
    if (draftVersion.attachments.length + attachments.length > 5) throw new AppError('At most 5 attachments are allowed', 422);
    draftVersion.attachments.push(...(await saveMany(attachments, { category: 'attachment', scope, folder: 'report-attachments' })));
  }
  if (value.note !== undefined) draftVersion.note = value.note;
  await Promise.all([report.save(), draftVersion.save()]);
  ok(res, { report, version: draftVersion });
});

export const submitDraft = asyncHandler(async (req, res) => {
  const { report, project } = await loadReport(req, { forStudentEdit: true });
  if (!canTransition(REPORT_TRANSITIONS, report.status, 'submitted')) throw new AppError(`A report that is "${report.status}" cannot be submitted`, 409);
  const version = await ReportVersion.findOne({ report: report._id, version: report.currentVersion });
  if (!version?.file) throw new AppError('Attach the report document before submitting', 422, { file: 'Report file is required' });
  if (report.kind === 'final') {
    const el = await finalEligibility(project);
    const blockers = el.checks.filter((c) => !c.passed && c.key !== 'single');
    if (blockers.length) throw new AppError('Your group is not yet eligible to submit the final report', 409, blockers.map((c) => c.label));
  }
  const now = new Date();
  const late = isLateSubmission(report.deadline, now);
  Object.assign(version, { state: 'submitted', submittedBy: req.user._id, submittedAt: now, isLate: late });
  Object.assign(report, { status: 'submitted', submittedAt: now, isLate: late });
  await Promise.all([version.save(), report.save()]);
  applyProjectStatusOnSubmit(project, report);
  await project.save();
  await notifyReviewers(project, report, version, { resubmitted: false });
  await audit(req, { action: 'report.submitted', entityType: 'ProgressReport', entityId: report._id, project: project._id, scope: 'project', summary: `Report "${report.title}" submitted${late ? ' (late)' : ''}` });
  ok(res, { report, version });
});

/** After a revision request the leader uploads a corrected file as a NEW version (old ones are kept). */
export const resubmit = asyncHandler(async (req, res) => {
  const { report, project } = await loadReport(req, { forStudentEdit: true });
  if (!canTransition(REPORT_TRANSITIONS, report.status, 'resubmitted')) {
    throw new AppError('Only reports with a revision request can be resubmitted', 409);
  }
  const { main, attachments } = reportFiles(req);
  if (!main) throw new AppError('Attach the corrected report document', 422, { file: 'Report file is required' });
  const note = String(req.body.note || '').trim().slice(0, 2000);
  const scope = idStr(project._id);
  const saved = [];
  try {
    const file = await saveUpload(main, { category: 'report', scope, folder: 'reports' });
    saved.push(file);
    const extra = await saveMany(attachments, { category: 'attachment', scope, folder: 'report-attachments' });
    saved.push(...extra);
    const now = new Date();
    const late = isLateSubmission(report.deadline, now);
    const versionNo = report.currentVersion + 1;
    const version = await ReportVersion.create({
      report: report._id,
      project: project._id,
      version: versionNo,
      state: 'submitted',
      file,
      attachments: extra,
      note,
      submittedBy: req.user._id,
      submittedAt: now,
      isLate: late,
    });
    Object.assign(report, { status: 'resubmitted', currentVersion: versionNo, submittedAt: now, isLate: late });
    await report.save();
    await notifyReviewers(project, report, version, { resubmitted: true });
    await audit(req, { action: 'report.resubmitted', entityType: 'ProgressReport', entityId: report._id, project: project._id, scope: 'project', summary: `Report "${report.title}" resubmitted (v${versionNo})` });
    ok(res, { report, version }, 201);
  } catch (err) {
    await Promise.all(saved.map(removeFile));
    throw err;
  }
});

// ---------------- Lists ----------------
export const listReports = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const ids = await scopedProjectIds(req.user);
  const filter = {};
  let allowed = ids ? ids.map(idStr) : null;

  const projFilter = {};
  if (isId(req.query.department)) projFilter.department = req.query.department;
  if (isId(req.query.term)) projFilter.term = req.query.term;
  if (isId(req.query.batch)) projFilter.batch = req.query.batch;
  if (isId(req.query.supervisor)) projFilter.supervisor = req.query.supervisor;
  if (isId(req.query.group)) projFilter.group = req.query.group;
  if (Object.keys(projFilter).length) {
    const matching = (await Project.find(projFilter).distinct('_id')).map(idStr);
    allowed = allowed ? allowed.filter((x) => matching.includes(x)) : matching;
  }
  if (isId(req.query.project)) allowed = allowed ? allowed.filter((x) => x === req.query.project) : [req.query.project];
  if (allowed) filter.project = { $in: allowed };

  if (req.user.role !== 'student') filter.status = { $ne: 'draft' };
  if (req.user.role === 'evaluator') Object.assign(filter, { kind: 'final', status: 'approved' });
  if (REPORT_STATUS.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.needsReview === '1') filter.status = { $in: REPORT_AWAITING_REVIEW };
  if (['progress', 'final'].includes(req.query.kind)) filter.kind = req.query.kind;
  if (REPORT_TYPES.includes(req.query.type)) filter.type = req.query.type;
  if (req.query.late === '1') filter.isLate = true;
  if (req.query.overdue === '1') {
    filter.deadline = { $lt: new Date() };
    filter.status = { $in: ['draft', 'revision_required'] };
  }
  if (req.query.from || req.query.to) {
    filter.submittedAt = {};
    if (req.query.from && !Number.isNaN(Date.parse(req.query.from))) filter.submittedAt.$gte = new Date(req.query.from);
    if (req.query.to && !Number.isNaN(Date.parse(req.query.to))) filter.submittedAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  if (req.query.q) filter.title = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');

  const sortField = ['submittedAt', 'createdAt', 'deadline', 'title', 'status'].includes(req.query.sort) ? req.query.sort : 'submittedAt';
  const sort = { [sortField]: req.query.dir === 'asc' ? 1 : -1, _id: -1 };

  const [items, total] = await Promise.all([
    ProgressReport.find(filter)
      .populate({
        path: 'project',
        select: 'title group supervisor department',
        populate: [{ path: 'group', select: 'name' }, { path: 'supervisor', select: 'name' }, { path: 'department', select: 'name code' }],
      })
      .populate('milestone', 'title plannedDate')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    ProgressReport.countDocuments(filter),
  ]);
  const now = Date.now();
  const data = items.map((r) => ({ ...r, overdue: Boolean(r.deadline && new Date(r.deadline).getTime() < now && ['draft', 'revision_required'].includes(r.status)) }));
  ok(res, data, 200, pageMeta(page, limit, total));
});

export const exportReportsCsv = asyncHandler(async (req, res) => {
  const filter = {};
  if (['progress', 'final'].includes(req.query.kind)) filter.kind = req.query.kind;
  if (REPORT_STATUS.includes(req.query.status)) filter.status = req.query.status;
  filter.status = filter.status || { $ne: 'draft' };
  const projFilter = {};
  if (isId(req.query.department)) projFilter.department = req.query.department;
  if (isId(req.query.term)) projFilter.term = req.query.term;
  if (isId(req.query.batch)) projFilter.batch = req.query.batch;
  if (isId(req.query.supervisor)) projFilter.supervisor = req.query.supervisor;
  if (Object.keys(projFilter).length) filter.project = { $in: await Project.find(projFilter).distinct('_id') };
  const rows = await ProgressReport.find(filter)
    .populate({ path: 'project', select: 'title group supervisor department', populate: [{ path: 'group', select: 'name' }, { path: 'supervisor', select: 'name' }, { path: 'department', select: 'name' }] })
    .sort({ submittedAt: -1 })
    .limit(5000)
    .lean();
  const csv = toCsv(rows, [
    { header: 'Report', value: (r) => r.title },
    { header: 'Kind', value: (r) => r.kind },
    { header: 'Type', value: (r) => r.type },
    { header: 'Project', value: (r) => r.project?.title },
    { header: 'Group', value: (r) => r.project?.group?.name },
    { header: 'Department', value: (r) => r.project?.department?.name },
    { header: 'Supervisor', value: (r) => r.project?.supervisor?.name },
    { header: 'Status', value: (r) => r.status },
    { header: 'Version', value: (r) => r.currentVersion },
    { header: 'Deadline', value: (r) => r.deadline },
    { header: 'Submitted at', value: (r) => r.submittedAt },
    { header: 'Late', value: (r) => (r.isLate ? 'yes' : 'no') },
  ]);
  await audit(req, { action: 'export.reports', summary: `Exported ${rows.length} reports to CSV` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reports.csv"');
  res.send(csv);
});

// ---------------- Details & review ----------------
export const getReport = asyncHandler(async (req, res) => {
  const { report, project, group, access } = await loadReport(req);
  const studentSide = isStudentAccess(access);
  const vFilter = { report: report._id };
  if (!studentSide) vFilter.state = 'submitted';
  const [versions, reviews] = await Promise.all([
    ReportVersion.find(vFilter).populate('submittedBy', 'name').sort({ version: -1 }).lean(),
    ReportReview.find({ report: report._id }).populate('reviewer', 'name role').sort({ createdAt: -1 }).lean(),
  ]);
  await project.populate([{ path: 'supervisor', select: 'name' }, { path: 'department', select: 'name' }]);
  await report.populate('milestone', 'title plannedDate');
  ok(res, {
    report: report.toJSON(),
    versions,
    reviews,
    project: { _id: project._id, title: project.title, status: project.status, supervisor: project.supervisor, department: project.department },
    group: { _id: group._id, name: group.name },
    access,
    canReview: (access === 'supervisor' || access === 'coordinator') && canTransitionAny(report.status),
    canResubmit: access === 'leader' && report.status === 'revision_required',
    canEditDraft: access === 'leader' && report.status === 'draft',
  });
});

const canTransitionAny = (status) => ['under_review', 'approved', 'rejected', 'revision_required'].some((to) => canTransition(REPORT_TRANSITIONS, status, to));

export const startReportReview = asyncHandler(async (req, res) => {
  const { report, access } = await loadReport(req);
  requireReviewer(access);
  if (!canTransition(REPORT_TRANSITIONS, report.status, 'under_review')) throw new AppError(`Cannot start a review from status "${report.status}"`, 409);
  report.status = 'under_review';
  await report.save();
  ok(res, report);
});

export const reviewReport = asyncHandler(async (req, res) => {
  const { report, project, group, access } = await loadReport(req);
  requireReviewer(access);
  const { decision, comments } = req.body;
  if (!canTransition(REPORT_TRANSITIONS, report.status, decision)) {
    throw new AppError(`A report that is "${report.status}" cannot be given this decision`, 409);
  }
  if (decision !== 'approved' && !comments) throw new AppError('Please explain your decision in the comments', 422, { comments: 'Required for this decision' });

  const version = await ReportVersion.findOne({ report: report._id, version: report.currentVersion });
  if (!version || version.state !== 'submitted') throw new AppError('There is no submitted version to review', 409);

  const review = await ReportReview.create({ report: report._id, project: project._id, version: version.version, reviewer: req.user._id, decision, comments });
  report.status = decision;
  await report.save();

  if (report.kind === 'final') {
    if (decision === 'approved') project.status = 'ready_for_evaluation';
    else project.status = 'final_review';
    await project.save();
  }
  await postFormalFeedback({ project: project._id, kind: 'report', refId: report._id, title: `Review: ${report.title}`, author: req.user, body: comments || 'Approved.', decision });

  const label = { approved: 'approved', rejected: 'rejected', revision_required: 'sent back for revision' }[decision];
  await notify([group.leader()?.user], {
    type: 'report_review',
    title: `Report ${label}`,
    body: `"${report.title}" (v${version.version}): ${comments ? comments.slice(0, 160) : label}`,
    link: `/student/reports/${report._id}`,
    dedupeKey: `report-review:${report._id}:${review._id}`,
  });
  if (report.kind === 'final' && decision === 'approved') {
    await notify(await coordinatorIds(), { type: 'final_report_approved', title: 'Final report approved', body: `${project.title} is ready for evaluation.`, link: `/coordinator/projects/${project._id}` });
  }
  await audit(req, { action: `report.${decision}`, entityType: 'ProgressReport', entityId: report._id, project: project._id, scope: 'project', summary: `Report "${report.title}" v${version.version} ${label}` });
  ok(res, { report, review });
});

// ---------------- Secure file access ----------------
async function fileMeta(req, pick) {
  const { report, access } = await loadReport(req);
  const version = await ReportVersion.findOne({ report: report._id, version: Number(req.params.version) });
  if (!version) throw new AppError('File not found', 404);
  if (version.state === 'draft' && !isStudentAccess(access)) throw new AppError('File not found', 404);
  const meta = pick(version);
  if (!meta) throw new AppError('File not found', 404);
  return meta;
}

export const downloadReportFile = asyncHandler(async (req, res) => {
  const meta = await fileMeta(req, (v) => v.file);
  await sendStoredFile(res, meta, { inline: req.query.disposition === 'inline' });
});

export const downloadReportAttachment = asyncHandler(async (req, res) => {
  const meta = await fileMeta(req, (v) => v.attachments?.[Number(req.params.index)]);
  await sendStoredFile(res, meta, { inline: req.query.disposition === 'inline' });
});

export const _unused = { ProjectGroup };
