// Plain-language guidance shown in the welcome guide and in the small "tips" boxes.
// Every sentence here describes a rule the system really enforces - keep it in sync when rules change.

export const WELCOME = {
  student: {
    title: 'Welcome to APMMS',
    purpose: 'Your dashboard shows where your project stands and the one thing to do next.',
    actions: [
      'Create a group, or join one with a code or an invitation',
      'The Group Leader submits the proposal and the reports',
      'Chat, meet and get feedback from your supervisor',
    ],
    next: { label: 'Create or join a group', to: '/student/group' },
  },
  supervisor: {
    title: 'Welcome to APMMS',
    purpose: 'Your dashboard lists the groups assigned to you and what is waiting for your review.',
    actions: [
      'Review proposals: approve, request revision (with comments) or reject',
      'Review progress and final reports, and follow milestones',
      'Meet, chat and give feedback; evaluate with the coordinator\'s rubric',
    ],
    next: { label: 'Open proposals to review', to: '/supervisor/proposals' },
  },
  coordinator: {
    title: 'Welcome, Coordinator',
    purpose: 'You run your institution\'s own workspace. Only people of your institution can see its data. Your dashboard shows your whole programme and what needs action.',
    actions: [
      'Set up first: add your departments and the current academic term (students cannot create groups before that)',
      'Approve supervisor sign-ups and manage users (Users & approvals)',
      'Assign a supervisor to every project and monitor progress',
      'Set up rubrics, collect evaluations and publish results',
      'Administration: roles overview, system settings, backups and audit logs',
    ],
    next: { label: 'Check users and approvals', to: '/coordinator/users' },
  },
  evaluator: {
    title: 'Welcome, External Evaluator',
    purpose: 'You can see only the projects assigned to you, for a limited time.',
    actions: [
      'Open an assigned project and read its approved final report',
      'Score every criterion; save drafts as you go',
      'Submitting is final - the coordinator can re-open it if needed',
    ],
    next: { label: 'Open my assignments', to: '/evaluator' },
  },
};

export const HINTS = {
  'student.dashboard': {
    title: 'What this page shows',
    items: [
      'Your project status, the next step to take, reports and milestones.',
      'No group yet? Create one (you become Group Leader) or join with a code.',
      'Only the Group Leader can submit proposals and reports. Other members can read, chat and prepare drafts.',
      'Proposal path: draft, submitted, supervisor review, then approved, revision requested or rejected.',
    ],
  },
  'student.group': {
    title: 'How groups work',
    items: [
      'Create a group to become its Group Leader, or join with the 6-character code from your leader.',
      'The leader can invite classmates; you can accept or decline invitations under Invitations.',
      'Only the Group Leader submits proposals and reports. A leader who wants to leave must hand over leadership first.',
    ],
  },
  'student.proposal': {
    title: 'Before you submit the proposal',
    items: [
      'Fill in the title, abstract, problem statement, objectives, methodology, expected outcomes and technology stack.',
      'Save drafts anytime. Use the similar-project check, then submit (Group Leader only).',
      'After submitting, your supervisor reviews it and you are notified. It becomes approved, needs revision or is rejected.',
      'If revision is requested: read the comments, edit the proposal and submit again. Earlier versions are kept.',
    ],
  },
  'student.report': {
    title: 'Progress and final reports',
    items: [
      'Progress reports (weekly, bi-weekly, monthly, milestone or mid-term) show your work so far. The final report is your last submission before evaluation.',
      'The final report opens after the required number of progress reports are approved.',
      'Upload a PDF or Word file. The upload box shows the allowed types and the size limit. Only the Group Leader submits.',
      'Your supervisor approves the report or asks for revision with comments. Upload a new version if asked.',
    ],
  },
  'supervisor.dashboard': {
    title: 'Your supervisor workspace',
    items: [
      'Assigned projects lists only the groups the coordinator assigned to you.',
      'Proposals: approve, request revision (comments required) or reject.',
      'Progress monitoring and Reports show late work and what needs review. Use Meetings, Feedback and Chat to stay in touch.',
      'Evaluation: score your groups with the coordinator\'s rubric and add remarks. Submitted evaluations are final.',
    ],
  },
  'supervisor.proposals': {
    title: 'Reviewing proposals',
    items: [
      'Open a proposal, read it and the similar-project check.',
      'Request revision always needs written comments so the group knows what to change.',
    ],
  },
  'supervisor.evaluation': {
    title: 'Evaluation and remarks',
    items: [
      'Score each rubric criterion and add remarks. Save a draft first; submitting is final.',
      'You see only your own evaluation forms. Students see results only after the coordinator publishes them.',
    ],
  },
  'coordinator.dashboard': {
    title: 'Your responsibilities',
    items: [
      'Project monitoring: see every project, report and deadline of your institution that needs attention.',
      'Supervisor assignment: give each project a supervisor (capacity warnings help).',
      'Evaluation results: you see all evaluation results. Supervisors see only their own forms, and students see results only after you publish them.',
      'Administration: approve users, set rules and rubrics, check audit logs and back up the data.',
    ],
  },
  'coordinator.users': {
    title: 'Admin tips: users and roles',
    items: [
      'Supervisors who sign up wait here until you approve them. You can also create accounts yourself.',
      'Accounts are deactivated, never deleted, so project history stays intact.',
      'New sign-ups must verify their email. If an email cannot be delivered, use "Mark email as verified" after checking the person.',
    ],
  },
  'coordinator.settings': {
    title: 'System administration',
    items: [
      'These rules apply to the whole system. Changes are recorded in the audit log.',
      'Back up the database and the uploads folder regularly (see Backup & maintenance).',
    ],
  },
};
