import { ProjectGroup, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, idStr } from '../utils/helpers.js';
import { loadProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { buildResults } from './evaluationController.js';
import { computeAnalytics } from './dashboardController.js';
import { ensureSpace, footer, header, keyValues, section, startPdf, table } from '../utils/pdf.js';

const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const titleCase = (s = '') => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Printable evaluation report. Coordinator any time; students and the supervisor only after results are published. */
export const gradeReportPdf = asyncHandler(async (req, res) => {
  const { project, access } = await loadProjectAccess(req.user, req.params.projectId);
  if (access === 'evaluator') throw new AppError('Project not found', 404);
  if (access !== 'coordinator' && !project.resultsPublished) throw new AppError('The results have not been published yet', 403);
  await project.populate([{ path: 'supervisor', select: 'name' }, { path: 'department', select: 'name' }, { path: 'term', select: 'name' }]);
  const group = await ProjectGroup.findById(project.group).populate('members.user', 'name studentId').lean();
  const results = await buildResults(project._id);
  const submittedOnly = access !== 'coordinator';

  const doc = startPdf(res, `evaluation-report-${idStr(project._id).slice(-6)}.pdf`, { title: `Evaluation report - ${project.title}` });
  header(doc, 'Project Evaluation Report', project.title);
  keyValues(doc, [
    ['Group', group?.name],
    ['Members', (group?.members || []).filter((m) => m.status === 'active').map((m) => `${m.user?.name}${m.user?.studentId ? ` (${m.user.studentId})` : ''}`).join(', ')],
    ['Supervisor', project.supervisor?.name],
    ['Department / term', `${project.department?.name || '-'} / ${project.term?.name || '-'}`],
    ['Project stage', titleCase(project.status)],
    ['Results', project.resultsPublished ? `Published ${date(project.resultsPublishedAt)}` : 'Not published (coordinator copy)'],
  ]);

  if (!results.length) doc.moveDown().font('Helvetica').fontSize(11).text('No evaluations have been recorded for this project.');
  for (const r of results) {
    section(doc, r.rubric.name);
    if (r.aggregate.percentage != null) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#047857').text(`Combined result: ${r.aggregate.percentage}%${r.aggregate.grade ? `  -  Grade ${r.aggregate.grade}` : ''}`).fillColor('#0F172A').moveDown(0.4);
    }
    const evals = r.evaluations.filter((e) => !submittedOnly || e.status === 'submitted');
    for (const e of evals) {
      ensureSpace(doc, 120);
      doc.font('Helvetica-Bold').fontSize(10.5).text(`${e.evaluator?.name || 'Evaluator'} (${e.evaluatorType === 'external' ? 'External evaluator' : 'Supervisor'})${e.status !== 'submitted' ? ' - DRAFT' : ''}`);
      table(doc, [{ label: 'Criterion', width: 270 }, { label: 'Marks', width: 70, align: 'right' }, { label: 'Out of', width: 70, align: 'right' }, { label: 'Comment', width: 85 }],
        r.rubric.criteria.map((c) => { const s = (e.scores || []).find((x) => idStr(x.criterionId) === idStr(c._id)); return [c.name, s ? s.marks : '-', c.maxMarks, s?.comment || '']; }));
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).text(`Total ${e.total}/${e.maxTotal}  (${e.percentage}%)${e.grade ? `  Grade ${e.grade}` : ''}`);
      if (e.remarks) doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(`Remarks: ${e.remarks}`).fillColor('#0F172A');
      doc.moveDown(0.8);
    }
  }
  footer(doc, `Generated on ${date(new Date())}. Marks become official when the coordinator publishes the results.`);
  await audit(req, { action: 'evaluation.report_pdf', entityType: 'Project', entityId: project._id, project: project._id, scope: 'project', summary: 'Evaluation report PDF downloaded' });
  doc.end();
});

/** Same numbers as the Analytics page, as a one-or-two page PDF. */
export const analyticsPdf = asyncHandler(async (req, res) => {
  const d = await computeAnalytics(req);
  const doc = startPdf(res, 'apmms-analytics.pdf', { title: 'APMMS analytics' });
  const filters = Object.entries(req.query).filter(([, v]) => v).map(([k]) => k).join(', ');
  header(doc, 'Analytics summary', `Generated ${date(new Date())}${filters ? ` - filtered by: ${filters}` : ' - all projects'}`);
  keyValues(doc, [
    ['Proposal approval rate', d.proposals.approvalRate == null ? '-' : `${d.proposals.approvalRate}%`],
    ['Reports submitted', `${d.reports.submitted} (${d.reports.late} late, ${d.reports.awaitingReview} awaiting review)`],
    ['Milestones completed', `${d.milestones.completed} of ${d.milestones.total} (${d.milestones.overdue} overdue)`],
    ['Evaluations submitted', d.evaluation.completion == null ? '-' : `${d.evaluation.completion}% (${d.evaluation.submitted} of ${d.evaluation.total})`],
  ]);
  const block = (title, rows, label = 'Item', value = 'Count') => { section(doc, title); if (!rows.length) { doc.font('Helvetica').fontSize(10).fillColor('#64748B').text('No data.').fillColor('#0F172A'); return; } table(doc, [{ label, width: 380 }, { label: value, width: 100, align: 'right' }], rows); };
  block('Projects by stage', d.stages.map((s) => [titleCase(s.status), s.count]));
  block('Proposals by status', d.proposals.byStatus.map((s) => [titleCase(s.status), s.count]));
  block('Reports by status', d.reports.byStatus.map((s) => [titleCase(s.status), s.count]));
  block('Departments', d.departments.map((x) => [x.department, `${x.projects} (${x.active} active)`]), 'Department', 'Projects');
  block('Supervisor workload', d.supervisorWorkload.map((x) => [x.name, x.projects]), 'Supervisor', 'Projects');
  footer(doc, 'Computed live from the APMMS database when this file was generated.');
  doc.end();
});

void User;
