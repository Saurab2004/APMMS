import './tenantPlugin.js';
import mongoose from 'mongoose';
import { PROJECT_STATUS } from '../utils/workflow.js';

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['leader', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'left', 'removed'], default: 'active' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
  },
  { _id: false }
);

const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true }, // lower-case name for uniqueness inside a term
    code: { type: String, required: true, unique: true }, // join code
    term: { type: Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] }, // bounded by the group-size rule
    // Kept in sync automatically (see pre-save hook). Lets us ask "which active group is this user in?" exactly and fast.
    activeMemberIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    status: { type: String, enum: ['active', 'archived', 'dissolved'], default: 'active', index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
  },
  { timestamps: true }
);

groupSchema.index({ term: 1, nameKey: 1 }, { unique: true });
groupSchema.index({ 'members.user': 1 });
groupSchema.pre('save', function syncActiveMembers(next) {
  this.activeMemberIds = this.members.filter((m) => m.status === 'active').map((m) => m.user);
  next();
});

groupSchema.methods.activeMembers = function activeMembers() {
  return this.members.filter((m) => m.status === 'active');
};
groupSchema.methods.activeMember = function activeMember(userId) {
  return this.members.find((m) => m.status === 'active' && String(m.user?._id ?? m.user) === String(userId));
};
groupSchema.methods.leader = function leader() {
  return this.members.find((m) => m.status === 'active' && m.role === 'leader');
};

const invitationSchema = new Schema(
  {
    group: { type: Schema.Types.ObjectId, ref: 'ProjectGroup', required: true },
    invitedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'expired', 'cancelled'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);
// A user can have only one PENDING invitation per group
invitationSchema.index({ group: 1, invitedUser: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

const projectSchema = new Schema(
  {
    group: { type: Schema.Types.ObjectId, ref: 'ProjectGroup', required: true, unique: true },
    term: { type: Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    title: { type: String, trim: true, maxlength: 200, default: 'Untitled project' },
    summary: { type: String, trim: true, maxlength: 2000 },
    technologies: [{ type: String, trim: true, maxlength: 60 }],
    supervisor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    supervisorHistory: [
      new Schema(
        {
          supervisor: { type: Schema.Types.ObjectId, ref: 'User' },
          assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          assignedAt: { type: Date, default: Date.now },
          unassignedAt: { type: Date },
        },
        { _id: false }
      ),
    ],
    status: { type: String, enum: PROJECT_STATUS, default: 'forming', index: true },
    resultsPublished: { type: Boolean, default: false },
    resultsPublishedAt: { type: Date },
    archivedAt: { type: Date },
  },
  { timestamps: true }
);
projectSchema.index({ department: 1, term: 1, status: 1 });

export const ProjectGroup = mongoose.models.ProjectGroup || mongoose.model('ProjectGroup', groupSchema);
export const GroupInvitation = mongoose.models.GroupInvitation || mongoose.model('GroupInvitation', invitationSchema);
export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
