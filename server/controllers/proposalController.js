import { Proposal, ProposalVersion, Project, ProjectGroup } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, parsePage, pageMeta, escapeRegex, isId, idStr } from '../utils/helpers.js';
import { PROPOSAL_STATUS, PROPOSAL_TRANSITIONS, canTransition } from '../utils/workflow.js';
import { loadProjectAccess, requireLeader, requireReviewer, scopedProjectIds } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify, coordinatorIds } from '../services/notifications.js';
import { postFormalFeedback } from '../services/feedbackService.js';
import { saveMany, removeFile, sendStoredFile } from '../services/storage.js';
import { getSettings } from '../services/settings.js';
import { validateObject } from '../utils/validate.js';

const CONTENT_FIELDS = ['title', 'abstract', 'problemStatement', 'objectives', 'methodology', 'expectedOutcomes', 'technologyStack'];
const EDITABLE_STATUSES = ['draft', 'revision_required', 'rejected'];

const SUBMIT_RULES = {
  title: { required: true, min: 5, max: 200, label: 'Project title' },
  abstract: { required: true, min: 30, max: 4000, label: 'Abstract' },
  problemStatement: { required: true, min: 30, max: 4000, label: 'Problem statement' },
  objectives: { required: true, min: 20, max: 4000, label: 'Objectives' },
  methodology: { required: true, min: 20, max: 4000, label: 'Methodology' },
  expectedOutcomes: { required: true, min: 10, max: 4000, label: 'Expected outcomes' },
  technologyStack: { required: true, type: 'array', maxItems: 20, label: 'Technology stack' },
};

const pickContent = (doc) => Object.fromEntries(CONTENT_FIELDS.map((f) => [f, doc?.[f]]));

export const listProposals = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const ids = await scopedProjectIds(req.user);
  const filter = {};
  if (ids) filter.project = { $in: ids };
  if (req.user.role !== 'student') filter.status = { $ne: 'draft' }; // reviewers never see unsubmitted drafts
  if (PROPOSAL_STATUS.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.pending === '1') filter.status = { $in: ['submitted', 'under_review'] };

  const projFilter = {};
  if (isId(req.query.department)) projFilter.department = req.query.department;
  if (isId(req.query.supervisor)) projFilter.supervisor = req.query.supervisor;
  if (req.query.q) projFilter.title = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
  if (Object.keys(projFilter).length) {
    const matching = await Project.find(projFilter).distinct('_id');
    filter.project = filter.project ? { $in: matching.filter((m) => ids.map(idStr).includes(idStr(m))) } : { $in: matching };
  }

  const [items, total] = await Promise.all([
    Proposal.find(filter)
      .populate({
        path: 'project',
        select: 'title group supervisor department',
        populate: [
          { path: 'group', select: 'name' },
          { path: 'supervisor', select: 'name' },
          { path: 'department', select: 'name code' },
        ],
      })
      .sort({ submittedAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Proposal.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(page, limit, total));
});

export const getProposal = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  if (access === 'evaluator') throw new AppError('Project not found', 404);
  const proposal = await Proposal.findOne({ project: project._id }).lean();
  let versions = [];
  if (proposal) {
    const vFilter = { proposal: proposal._id };
    if (access === 'supervisor' || access === 'coordinator') vFilter.state = 'submitted';
    versions = await ProposalVersion.find(vFilter)
      .populate('submittedBy', 'name')
      .populate('review.reviewer', 'name')
      .sort({ version: -1 })
      .lean();
  }
  const canEdit = access === 'leader' && (!proposal || EDITABLE_STATUSES.includes(proposal.status));
  ok(res, { proposal, versions, canEdit, access, projectStatus: project.status });
});

export const saveDraft = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  requireLeader(access);
  let proposal = await Proposal.findOne({ project: project._id });
  if (!proposal) proposal = await Proposal.create({ project: project._id, status: 'draft', currentVersion: 1 });
  if (!EDITABLE_STATUSES.includes(proposal.status)) {
    throw new AppError('This proposal can no longer be edited. It is under review or already approved.', 409);
  }

  let draft = await ProposalVersion.findOne({ proposal: proposal._id, state: 'draft' });
  if (!draft) {
    const last = await ProposalVersion.findOne({ proposal: proposal._id }).sort({ version: -1 });
    const version = last ? last.version + 1 : 1;
    draft = new ProposalVersion({ proposal: proposal._id, project: project._id, version, ...(last ? pickContent(last) : {}) });
    proposal.currentVersion = version;
    await proposal.save();
  }
  for (const f of CONTENT_FIELDS) if (req.body[f] !== undefined) draft[f] = req.body[f];
  await draft.save();
  ok(res, { proposal, draft });
});

export const uploadDraftAttachments = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  requireLeader(access);
  const draft = await ProposalVersion.findOne({ project: project._id, state: 'draft' });
  if (!draft) throw new AppError('Save the proposal draft first, then attach documents', 409);
  const files = req.files || [];
  if (!files.length) throw new AppError('Choose at least one file', 422);
  if (draft.attachments.length + files.length > 5) throw new AppError('A proposal can have at most 5 supporting documents', 422);
  const saved = await saveMany(files, { category: 'attachment', scope: idStr(project._id), folder: 'proposals' });
  draft.attachments.push(...saved);
  await draft.save();
  ok(res, draft, 201);
});

export const removeDraftAttachment = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  requireLeader(access);
  const draft = await ProposalVersion.findOne({ project: project._id, state: 'draft' });
  const i = Number(req.params.index);
  if (!draft || !Number.isInteger(i) || !draft.attachments[i]) throw new AppError('Attachment not found', 404);
  const [removed] = draft.attachments.splice(i, 1);
  await draft.save();
  await removeFile(removed);
  ok(res, draft);
});

export const submitProposal = asyncHandler(async (req, res) => {
  const { project, group, access } = await loadProjectAccess(req.user, req.params.projectId);
  requireLeader(access);
  const proposal = await Proposal.findOne({ project: project._id });
  if (!proposal) throw new AppError('Save a draft first', 409);
  if (!canTransition(PROPOSAL_TRANSITIONS, proposal.status, 'submitted')) {
    throw new AppError(`A proposal that is "${proposal.status}" cannot be submitted`, 409);
  }
  const draft = await ProposalVersion.findOne({ proposal: proposal._id, state: 'draft' });
  if (!draft) throw new AppError('There is no draft to submit. Make changes first.', 409);

  const settings = await getSettings();
  if (group.activeMembers().length < settings.minGroupSize) {
    throw new AppError(`Your group needs at least ${settings.minGroupSize} members before submitting`, 409);
  }
  const { errors } = validateObject(pickContent(draft.toObject()), SUBMIT_RULES);
  if (Object.keys(errors).length) throw new AppError('Complete all required proposal fields before submitting', 422, errors);

  const now = new Date();
  draft.state = 'submitted';
  draft.submittedBy = req.user._id;
  draft.submittedAt = now;
  await draft.save();
  const resubmission = draft.version > 1;
  proposal.status = 'submitted';
  proposal.currentVersion = draft.version;
  proposal.submittedAt = now;
  await proposal.save();
  if (project.status === 'forming') {
    project.status = 'proposal';
    await project.save();
  }

  const reviewers = project.supervisor ? [project.supervisor] : await coordinatorIds();
  await notify(reviewers, {
    type: 'proposal_submitted',
    title: resubmission ? 'Proposal resubmitted' : 'New proposal submitted',
    body: `${group.name} submitted version ${draft.version}: "${draft.title}".`,
    link: project.supervisor ? `/supervisor/proposals/${proposal._id}` : '/coordinator/proposals',
    dedupeKey: `proposal-submitted:${proposal._id}:${draft.version}`,
  });
  await audit(req, { action: 'proposal.submitted', entityType: 'Proposal', entityId: proposal._id, project: project._id, scope: 'project', summary: `Proposal v${draft.version} submitted` });
  ok(res, { proposal, version: draft });
});

async function loadProposalForReview(req) {
  if (!isId(req.params.id)) throw new AppError('Proposal not found', 404);
  const proposal = await Proposal.findById(req.params.id);
  if (!proposal) throw new AppError('Proposal not found', 404);
  const ctx = await loadProjectAccess(req.user, proposal.project);
  requireReviewer(ctx.access);
  return { proposal, ...ctx };
}

export const getProposalById = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Proposal not found', 404);
  const proposal = await Proposal.findById(req.params.id).lean();
  if (!proposal) throw new AppError('Proposal not found', 404);
  const { project, group, access } = await loadProjectAccess(req.user, proposal.project);
  if (access === 'evaluator') throw new AppError('Proposal not found', 404);
  const vFilter = { proposal: proposal._id };
  if (access === 'supervisor' || access === 'coordinator') vFilter.state = 'submitted';
  const versions = await ProposalVersion.find(vFilter).populate('submittedBy', 'name').populate('review.reviewer', 'name').sort({ version: -1 }).lean();
  await project.populate([{ path: 'supervisor', select: 'name' }, { path: 'department', select: 'name' }]);
  ok(res, { proposal, versions, project: project.toJSON(), group: { _id: group._id, name: group.name }, access });
});

export const startReview = asyncHandler(async (req, res) => {
  const { proposal } = await loadProposalForReview(req);
  if (!canTransition(PROPOSAL_TRANSITIONS, proposal.status, 'under_review')) throw new AppError(`Cannot start a review from status "${proposal.status}"`, 409);
  proposal.status = 'under_review';
  await proposal.save();
  ok(res, proposal);
});

export const reviewProposal = asyncHandler(async (req, res) => {
  const { proposal, project, group } = await loadProposalForReview(req);
  const { decision, comments } = req.body;
  if (!canTransition(PROPOSAL_TRANSITIONS, proposal.status, decision) || proposal.status === 'rejected') {
    throw new AppError(`A proposal that is "${proposal.status}" cannot be given this decision`, 409);
  }
  if (decision !== 'approved' && !comments) throw new AppError('Please explain your decision in the comments', 422, { comments: 'Required for this decision' });

  const version = await ProposalVersion.findOne({ proposal: proposal._id, state: 'submitted' }).sort({ version: -1 });
  if (!version) throw new AppError('No submitted version to review', 409);
  const now = new Date();
  version.review = { decision, comments, reviewer: req.user._id, reviewedAt: now };
  await version.save();

  proposal.status = decision;
  proposal.decidedAt = now;
  if (decision === 'approved') {
    proposal.approvedVersion = version.version;
    project.title = version.title;
    project.technologies = version.technologyStack;
    if (!project.summary) project.summary = version.abstract.slice(0, 1900);
    project.status = 'active';
    await project.save();
  }
  await proposal.save();

  await postFormalFeedback({
    project: project._id,
    kind: 'proposal',
    refId: proposal._id,
    title: 'Proposal review',
    author: req.user,
    body: comments || 'Approved.',
    decision,
  });
  const leader = group.leader();
  const label = { approved: 'approved', rejected: 'rejected', revision_required: 'sent back for revision' }[decision];
  await notify([leader?.user], {
    type: 'proposal_review',
    title: `Proposal ${label}`,
    body: comments ? comments.slice(0, 200) : `Your proposal version ${version.version} was ${label}.`,
    link: '/student/proposal/status',
    dedupeKey: `proposal-review:${proposal._id}:${version.version}`,
  });
  await audit(req, { action: `proposal.${decision}`, entityType: 'Proposal', entityId: proposal._id, project: project._id, scope: 'project', summary: `Proposal v${version.version} ${label}` });
  ok(res, { proposal, version });
});

export const downloadAttachment = asyncHandler(async (req, res) => {
  const { access } = await loadProjectAccess(req.user, req.params.projectId);
  if (access === 'evaluator') throw new AppError('File not found', 404);
  const proposal = await Proposal.findOne({ project: req.params.projectId });
  const version = proposal && (await ProposalVersion.findOne({ proposal: proposal._id, version: Number(req.params.version) }));
  const meta = version?.attachments?.[Number(req.params.index)];
  const studentSide = access === 'leader' || access === 'member';
  if (!meta || (version.state === 'draft' && !studentSide)) throw new AppError('File not found', 404);
  await sendStoredFile(res, meta, { inline: req.query.disposition === 'inline' });
});

export const _unused = { ProjectGroup };
