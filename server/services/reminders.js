// Deadline & meeting reminders. Runs when the server starts, then every hour,
// and can also be triggered by the Coordinator (POST /api/notifications/run-reminders).
// dedupeKey makes sure the same reminder is never sent twice.
import { Milestone, Meeting, ProgressReport, Project, Institution } from '../models/index.js';
import { currentInstitution, runInInstitution } from '../utils/tenant.js';
import { notify, projectParticipantIds } from './notifications.js';
import { getSettings } from './settings.js';
import { addDays } from '../utils/helpers.js';

async function remindersForCurrentInstitution() {
  const settings = await getSettings();
  const now = new Date();
  const horizon = addDays(now, settings.reminderLeadDays);
  const counts = { milestones: 0, meetings: 0, reports: 0 };

  const milestones = await Milestone.find({ status: { $in: ['pending', 'in_progress'] }, plannedDate: { $gte: now, $lte: horizon } }).lean();
  for (const m of milestones) {
    const project = await Project.findById(m.project).lean();
    if (!project) continue;
    const to = await projectParticipantIds(project, { includeSupervisor: false });
    const made = await notify(to, {
      type: 'deadline',
      title: 'Milestone deadline approaching',
      body: `"${m.title}" is planned for ${new Date(m.plannedDate).toDateString()}.`,
      link: '/student/project',
      dedupeKey: `milestone-due:${m._id}`,
    });
    counts.milestones += made.length;
  }

  const meetings = await Meeting.find({ status: 'scheduled', scheduledAt: { $gte: now, $lte: addDays(now, 1) } }).lean();
  for (const mt of meetings) {
    const to = await projectParticipantIds(mt.project);
    const made = await notify(to, {
      type: 'meeting_reminder',
      title: 'Meeting within 24 hours',
      body: `${mt.title} - ${new Date(mt.scheduledAt).toLocaleString()}`,
      link: '/student/meetings',
      dedupeKey: `meeting-soon:${mt._id}:${new Date(mt.scheduledAt).getTime()}`,
    });
    counts.meetings += made.length;
  }

  const reports = await ProgressReport.find({ status: { $in: ['draft', 'revision_required'] }, deadline: { $gte: now, $lte: horizon } }).lean();
  for (const rp of reports) {
    const to = await projectParticipantIds(rp.project, { includeSupervisor: false });
    const made = await notify(to, {
      type: 'deadline',
      title: 'Report deadline approaching',
      body: `"${rp.title}" is due ${new Date(rp.deadline).toDateString()}.`,
      link: `/student/reports/${rp._id}`,
      dedupeKey: `report-due:${rp._id}:${rp.currentVersion}`,
    });
    counts.reports += made.length;
  }
  return counts;
}

/** Runs the reminders for one institution (called from a logged-in request) or, with no institution, for every approved one. */
export async function runReminders() {
  if (currentInstitution()) return remindersForCurrentInstitution();
  const total = { milestones: 0, meetings: 0, reports: 0 };
  const institutions = await Institution.find({ status: 'approved' }).select('_id').lean();
  for (const inst of institutions) {
    const c = await runInInstitution(inst._id, remindersForCurrentInstitution);
    for (const k of Object.keys(total)) total[k] += c[k];
  }
  return total;
}

export function startReminderTimer() {
  const run = () => runReminders().catch((e) => console.error('[reminders]', e.message));
  setTimeout(run, 15000).unref();
  return setInterval(run, 60 * 60 * 1000).unref();
}
