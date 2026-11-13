import { User, ExternalEvaluatorAssignment, Evaluation, EvaluationRubric, Project } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, idStr, generateTempPassword } from '../utils/helpers.js';
import { audit } from '../services/audit.js';

const shape = async (assignments) => {
  const ids = assignments.map((a) => a._id);
  const evals = await Evaluation.find({ evaluator: { $in: assignments.map((a) => idStr(a.evaluator?._id ?? a.evaluator)) }, evaluatorType: 'external' }).select('evaluator project rubric status').lean();
  void ids;
  return assignments.map((a) => {
    const obj = a.toJSON ? a.toJSON() : a;
    const submitted = obj.projects.filter((p) =>
      evals.some((e) => idStr(e.evaluator) === idStr(obj.evaluator._id) && idStr(e.project) === idStr(p._id) && idStr(e.rubric) === idStr(obj.rubric._id) && e.status === 'submitted')
    ).length;
    const expired = new Date(obj.expiresAt) < new Date();
    let state = obj.status;
    if (state === 'active' && expired) state = 'expired';
    if (state === 'active' && obj.projects.length && submitted === obj.projects.length) state = 'completed';
    return { ...obj, state, submitted, total: obj.projects.length };
  });
};

export const listAssignments = asyncHandler(async (_req, res) => {
  const items = await ExternalEvaluatorAssignment.find()
    .populate('evaluator', 'name email organization isActive accessExpiresAt')
    .populate('rubric', 'name stage')
    .populate({ path: 'projects', select: 'title group', populate: { path: 'group', select: 'name' } })
    .sort({ createdAt: -1 });
  ok(res, await shape(items));
});

/** Creates (or re-uses) an evaluator account and gives it temporary access to chosen projects. */
export const createAssignment = asyncHandler(async (req, res) => {
  const { name, email, organization, rubricId, projectIds, expiresAt, sessionLabel } = req.body;
  if (expiresAt <= new Date()) throw new AppError('The access expiry must be in the future', 422, { expiresAt: 'Must be in the future' });
  const rubric = await EvaluationRubric.findOne({ _id: rubricId, isActive: true, appliesTo: 'external' });
  if (!rubric) throw new AppError('Choose an active rubric that is enabled for external evaluators', 422, { rubricId: 'Invalid rubric' });
  const uniqueIds = [...new Set(projectIds)];
  const projects = await Project.find({ _id: { $in: uniqueIds } }).select('_id');
  if (projects.length !== uniqueIds.length) throw new AppError('One or more projects were not found', 422, { projectIds: 'Invalid project' });

  let user = await User.findOne({ email });
  let temporaryPassword;
  if (user) {
    if (user.role !== 'evaluator') throw new AppError('This email already belongs to a non-evaluator account', 409, { email: 'Already in use' });
  } else {
    temporaryPassword = generateTempPassword();
    user = new User({ name, email, role: 'evaluator', organization, mustChangePassword: true });
    await user.setPassword(temporaryPassword);
  }
  user.isActive = true;
  if (!user.accessExpiresAt || user.accessExpiresAt < expiresAt) user.accessExpiresAt = expiresAt;
  await user.save();

  const assignment = await ExternalEvaluatorAssignment.create({ evaluator: user._id, rubric: rubric._id, projects: uniqueIds, sessionLabel, expiresAt, createdBy: req.user._id });
  await audit(req, { action: 'evaluator.assigned', entityType: 'ExternalEvaluatorAssignment', entityId: assignment._id, summary: `${user.name} invited to evaluate ${uniqueIds.length} project(s)` });
  ok(res, { assignment, evaluator: user.toJSON(), temporaryPassword }, 201); // temporary password shown once
});

export const revokeAssignment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Assignment not found', 404);
  const assignment = await ExternalEvaluatorAssignment.findById(req.params.id);
  if (!assignment) throw new AppError('Assignment not found', 404);
  if (assignment.status === 'revoked') throw new AppError('Already revoked', 409);
  assignment.status = 'revoked';
  assignment.revokedAt = new Date();
  await assignment.save();

  // If this evaluator has no other live assignment, close their access immediately.
  const stillActive = await ExternalEvaluatorAssignment.exists({ evaluator: assignment.evaluator, status: 'active', expiresAt: { $gt: new Date() } });
  if (!stillActive) {
    await User.updateOne({ _id: assignment.evaluator }, { $set: { accessExpiresAt: new Date() }, $inc: { tokenVersion: 1 } });
  }
  // Submitted evaluations are intentionally kept.
  await audit(req, { action: 'evaluator.revoked', entityType: 'ExternalEvaluatorAssignment', entityId: assignment._id, summary: 'External evaluator access revoked' });
  ok(res, assignment);
});

export const extendAssignment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Assignment not found', 404);
  const assignment = await ExternalEvaluatorAssignment.findById(req.params.id);
  if (!assignment) throw new AppError('Assignment not found', 404);
  if (assignment.status === 'revoked') throw new AppError('A revoked assignment cannot be extended. Create a new one.', 409);
  if (req.body.expiresAt <= new Date()) throw new AppError('The new expiry must be in the future', 422);
  assignment.expiresAt = req.body.expiresAt;
  await assignment.save();
  await User.updateOne({ _id: assignment.evaluator, $or: [{ accessExpiresAt: { $lt: req.body.expiresAt } }, { accessExpiresAt: null }] }, { $set: { accessExpiresAt: req.body.expiresAt } });
  await audit(req, { action: 'evaluator.extended', entityType: 'ExternalEvaluatorAssignment', entityId: assignment._id, summary: 'External evaluator access extended' });
  ok(res, assignment);
});
