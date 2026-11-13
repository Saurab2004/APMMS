import { RepositoryResource } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, isId, idStr } from '../utils/helpers.js';
import { saveUpload, removeFile, sendStoredFile } from '../services/storage.js';
import { audit } from '../services/audit.js';
import { validateObject } from '../utils/validate.js';

const RULES = {
  title: { required: true, min: 3, max: 160 },
  description: { max: 1000 },
  category: { type: 'enum', values: ['template', 'guideline', 'rubric', 'sample', 'other'], default: 'other' },
  visibility: { type: 'enum', values: ['all', 'students', 'supervisors'], default: 'all' },
  departmentId: { type: 'objectId' },
};

function visibleFilter(user) {
  if (user.role === 'coordinator') return {};
  const roleVis = user.role === 'student' ? 'students' : 'supervisors';
  return {
    isArchived: false,
    visibility: { $in: ['all', roleVis] },
    $or: [{ department: { $exists: false } }, { department: null }, { department: user.department }],
  };
}

export const listResources = asyncHandler(async (req, res) => {
  const filter = visibleFilter(req.user);
  if (req.user.role === 'coordinator' && req.query.archived !== '1') filter.isArchived = false;
  if (['template', 'guideline', 'rubric', 'sample', 'other'].includes(req.query.category)) filter.category = req.query.category;
  const items = await RepositoryResource.find(filter).populate('uploadedBy', 'name').populate('department', 'name code').sort({ createdAt: -1 }).limit(200).lean();
  ok(res, items);
});

export const createResource = asyncHandler(async (req, res) => {
  const { errors, value } = validateObject(req.body, RULES);
  if (Object.keys(errors).length) throw new AppError('Please correct the highlighted fields', 422, errors);
  if (!req.file) throw new AppError('Attach a file', 422, { file: 'Required' });
  const file = await saveUpload(req.file, { category: 'repository', scope: 'library', folder: 'repository' });
  try {
    const { departmentId, ...rest } = value;
    const doc = await RepositoryResource.create({ ...rest, department: departmentId, file, uploadedBy: req.user._id });
    await audit(req, { action: 'repository.added', entityType: 'RepositoryResource', entityId: doc._id, summary: `Added "${doc.title}" to the repository` });
    ok(res, doc, 201);
  } catch (err) {
    await removeFile(file);
    throw err;
  }
});

export const archiveResource = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Resource not found', 404);
  const doc = await RepositoryResource.findById(req.params.id);
  if (!doc) throw new AppError('Resource not found', 404);
  doc.isArchived = req.body.isArchived;
  await doc.save();
  await audit(req, { action: doc.isArchived ? 'repository.archived' : 'repository.restored', entityType: 'RepositoryResource', entityId: doc._id, summary: `"${doc.title}" ${doc.isArchived ? 'archived' : 'restored'}` });
  ok(res, doc);
});

export const downloadResource = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('Resource not found', 404);
  const doc = await RepositoryResource.findOne({ _id: req.params.id, ...visibleFilter(req.user) });
  if (!doc) throw new AppError('Resource not found', 404);
  void idStr;
  await sendStoredFile(res, doc.file, { inline: req.query.disposition === 'inline' });
});
