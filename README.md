# APMMS - Academic Project Management and Monitoring System

A MERN (MongoDB, Express, React, Node.js) web app for managing final-year student projects: groups, proposals, progress and final reports with file versions, milestones, meetings, feedback, real-time chat, notifications, rubric-based evaluation (supervisor and external), analytics and audit logs. JavaScript only; no paid services.

**One login page for everyone:** pick Student, Supervisor or Coordinator, then log in. Sign-up works the same way: you choose your **institution** and department; students verify their email, supervisors also wait for their institution's coordinator, and a new coordinator registers a whole new institution that the platform owner approves.

**Many institutions, one installation:** every institution is a separate workspace (users, departments, projects, rubrics, settings, audit logs). The data is separated automatically in the database layer, so one college can never see another's data.

**Roles:** Student (group leader does official submissions), Supervisor, Coordinator (also the admin), and temporary External Evaluator.

## Quick start
See [docs/setup-guide.md](docs/setup-guide.md). Short version (MongoDB Community Server must be running):
```
cd server && npm install && cp .env.example .env   # set JWT_SECRET and COORDINATOR_SETUP_CODE
npm run seed        # optional demo data, password Demo@12345
npm run dev         # API on :5000
cd ../client && npm install && npm run dev   # app on :5173
```

## Documentation
- [Hosting guide](docs/hosting-guide.md) - [Setup guide](docs/setup-guide.md) - [Testing guide](docs/testing-guide.md) - [API](docs/api-documentation.md) - [Database design](docs/database-design.md)

## Security in brief
JWT in an HttpOnly cookie, CSRF header guard, bcrypt passwords, role checks on every API route, rate limiting, helmet, upload validation (extension, MIME and file content), files served only through authorised endpoints, audit log, sessions ended when an account is deactivated or its password is reset.

## Progress checklist
- [x] Authentication, roles, RBAC, password reset (link printed to server console)
- [x] Groups, invitations, leadership transfer; one active group per student (configurable)
- [x] Proposals with versions, revision and approval flow
- [x] Progress and final reports: upload, versions, preview, review, late detection
- [x] Milestones, interaction logs, meetings, threaded feedback, real-time chat
- [x] Notifications (live), deadline reminders (hourly), announcements
- [x] Rubrics, supervisor and external evaluation, publishing results, re-open with reason
- [x] Coordinator: users, departments, terms, groups, assignment, analytics + CSV, settings, audit, backup info
- [x] One login/register page with role picker; supervisor approval; coordinator setup code
- [x] Similar-project (duplicate idea) warning, calendar, PDF evaluation report and PDF analytics
- [x] "What to do next" checklists, shorter menus and a Help page per role
- [x] Responsive (375-1440 px) and keyboard accessible UI
- [x] Multi-institution workspaces: institution sign-up, platform-owner approval/suspension, automatic data isolation, institution self-deletion with grace period
- [x] 37 automated backend tests; browser smoke check of all Student/Supervisor/Coordinator pages
- [x] Email verification by SMTP (tested with a local fake SMTP server; real providers not tested)
- [x] Coordinator "Delete my account" (soft delete)
- [x] First-login welcome guide and tips for each role
- [ ] Automated front-end tests
- [ ] Verified against a real `mongod` (tested against FerretDB, a MongoDB-compatible engine)
- [ ] External-evaluator pages were built but only the shared evaluation form was exercised in the browser
