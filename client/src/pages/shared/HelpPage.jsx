import { Sparkles } from 'lucide-react';
import { Button, Card, CardBody, CardHead, PageHeader } from '../../components/common/ui.jsx';
import { openGuide } from '../../components/onboarding/WelcomeGuide.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const GUIDE = {
  student: {
    intro: 'Your project goes through a few clear steps. The dashboard always shows what to do next.',
    steps: [
      ['Create or join a group', 'One student creates the group and shares the join code. Others join with the code or accept an invitation. The first person becomes the Group Leader.'],
      ['Wait for a supervisor', 'The coordinator assigns a supervisor to your project. You will get a notification.'],
      ['Write and submit the proposal', 'Only the Group Leader submits. Use "Check for similar projects" first. The supervisor can approve it, ask for changes, or reject it. Old versions are always kept.'],
      ['Send progress reports', 'Upload a PDF or Word file. Late reports are marked. If changes are requested, upload a new version.'],
      ['Work with your supervisor', 'Use meetings, the interaction log, feedback threads and chat. Check the Calendar for deadlines.'],
      ['Submit the final report', 'It opens after enough progress reports are approved. Then evaluation starts and the coordinator publishes the results.'],
    ],
    faq: [
      ['I am not the Group Leader. What can I do?', 'You can read everything, chat, comment and prepare drafts, but only the leader can submit official proposals and reports. The leader can hand over leadership in "My group".'],
      ['Which files are allowed?', 'PDF and Word for reports; some other types for proposal attachments. Files are checked by content, not only by name. Maximum size is shown on the upload box.'],
      ['I forgot my password.', 'Use "Forgot password?" on the login page. In this installation the reset link is shown to the administrator in the server window.'],
    ],
  },
  supervisor: {
    intro: 'You guide the groups assigned to you. Your dashboard lists what is waiting for you.',
    steps: [
      ['Get approved', 'New supervisor accounts are approved by the coordinator before the first login.'],
      ['Review proposals', 'Open a proposal, read the similar-project check, then approve, request revision (comment required) or reject.'],
      ['Set milestones', 'Add milestones with planned dates so progress and deadlines show on the dashboard and the Calendar.'],
      ['Review reports', 'Preview the file, then approve or request a revision with comments. Students resubmit as a new version.'],
      ['Keep in touch', 'Schedule meetings, record minutes and action items, answer feedback threads and chat.'],
      ['Evaluate', 'When the final report is approved, mark each rubric criterion. Save a draft first; submitting is final.'],
    ],
    faq: [
      ['Why can I not see a project?', 'You only see projects assigned to you. Ask the coordinator to assign it.'],
      ['Can I change marks after submitting?', 'No. Ask the coordinator to re-open the evaluation; the reason is recorded.'],
    ],
  },
  coordinator: {
    intro: 'You run your institution\'s own workspace. Nobody outside your institution can see your data.',
    steps: [
      ['First-time setup', 'Your institution was approved by the platform administrator. Add your departments and the current academic term with its deadlines - students cannot create groups before a current term exists.'],
      ['Approve people', 'Supervisors who sign up wait on the Users page until you approve them. You can also create any account yourself.'],
      ['Assign supervisors', 'Use Supervisor assignment. Capacity warnings stop overloading a supervisor.'],
      ['Monitor', 'Dashboard, Project monitoring, Report monitoring and Analytics show where help is needed.'],
      ['Evaluation', 'Create rubrics, invite external evaluators with limited-time access, then publish results. PDF reports can be downloaded per project.'],
      ['Keep it safe', 'Check Audit logs, and back up the database and uploads folder (see Backup & maintenance).'],
    ],
    faq: [
      ['Can there be two coordinators?', 'Yes. Create more coordinator accounts for your institution on the Users page if needed.'],
      ['Can I delete my institution?', 'Yes, from Profile & account > Delete my institution (password and the institution name are required). Everyone is blocked at once and the data is erased for good after a grace period, unless you choose to erase it immediately.'],
      ['What if the coordinator forgets the password?', 'Use "Forgot password?" on the login page. If email is not set up, the reset link is shown in the server window of whoever runs the server.'],
    ],
  },
  evaluator: {
    intro: 'You were invited to evaluate specific projects for a limited time.',
    steps: [
      ['Open your assignments', 'You only see the projects assigned to you.'],
      ['Read the final report', 'It is shown beside the marking form once it has been approved.'],
      ['Mark each criterion', 'Save drafts as you go. Submitting is final; the coordinator can re-open it if needed.'],
    ],
    faq: [['My access ended.', 'Ask the coordinator to extend it. Evaluations you already submitted are kept.']],
  },
};

export default function HelpPage() {
  const { user } = useAuth();
  const g = GUIDE[user.role];
  return (
    <>
      <PageHeader title="Help and guide" subtitle={g.intro} actions={<Button variant="secondary" icon={Sparkles} onClick={openGuide}>Getting started</Button>} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card><CardHead title="How it works" /><CardBody><ol className="help-steps">{g.steps.map(([t, d]) => <li key={t}><strong>{t}</strong><div className="muted">{d}</div></li>)}</ol></CardBody></Card>
        <Card><CardHead title="Common questions" /><CardBody className="stack-sm">{g.faq.map(([q, a]) => <details key={q}><summary><strong>{q}</strong></summary><p className="muted" style={{ margin: '6px 0 0' }}>{a}</p></details>)}</CardBody></Card>
      </div>
    </>
  );
}
