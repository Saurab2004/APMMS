# Testing guide

## Automated backend tests (53)
```
cd server
npm test
```
- Uses its own database `apmms_test` on the same MongoDB (dropped before and after every run) and a temporary upload folder. Your real data is not touched.
- `tests/unit.test.js` (8): status transitions, late/overdue/progress rules, group-leader rule, password policy and filename cleaning, upload checks (extension, MIME, content), rubric scoring, CSV formula neutralising, similar-project scoring.
- `tests/workflow.test.js` (12): login / CSRF / RBAC, groups and invitations, supervisor assignment, proposal revisions and approval with version history, report upload with file-type and access checks, secure download, milestones, interaction log and meetings, feedback threads, chat access rules, final report, supervisor and external evaluation, result publishing, coordinator dashboards, analytics, exports, settings, repository and announcements, one-login role checks, supervisor approval and the closed coordinator sign-up, calendar scoping, similar-project check and PDF reports (who may download, `%PDF` output).

**What was actually run:** these 20 tests pass against **FerretDB** (a MongoDB-compatible engine) in the development sandbox. They have not been run against a real `mongod`; queries were kept portable, but please run `npm test` on your machine with MongoDB Community Server to confirm.

## Institutions (new)

`server/tests/institutions.test.js` (11 tests): institution sign-up and automatic activation after email verification; platform-owner suspend/reject; students/supervisors joining the chosen institution; **isolation** of users, departments, settings, rubrics, audit logs, analytics, groups, join codes, projects and supervisor assignment between two institutions; suspension blocking existing sessions; institution self-deletion (blocked at once, restore, grace-period purge, erase now, uploaded files removed from disk); first-time platform setup with and without the setup code; migration of an old database into "Default Institution".

## Batches and terms (new)

`server/tests/batches.test.js` (8 tests): two terms active at once; a department with several batches; student sign-up lists the batches of the chosen department and requires one (a batch of another department is refused); two batches in two terms at the same time (groups, projects and deadlines follow each batch, one supervisor works with both and can filter by batch, the workload view and the calendar show both); no joining, inviting or batch switching across batches; moving a whole batch to the next term (students and unfinished groups follow); completed batches (closed for sign-up and new groups, hidden from everyday lists); students without a batch use the default term and get a clear message if none is set; migration of students and groups from before batches into "Existing students".

Browser check (Playwright, done in the sandbox): Batches page (add batch, move term), the Batch dropdown on the sign-up page after choosing a department, group creation, and the batch filters.

## Platform admin console (new)

`server/tests/platform.test.js` (9 tests): first-admin setup (once only; production needs the setup code), admin login separate from institution login (no session crosses over, lock after 5 wrong passwords), adding admins (temporary password, forced change, deactivate/reactivate, founder protected, email cannot clash with an institution account), counts without exposing student data, creating institutions, coordinator help actions (reset password, deactivate, resend/verify email), rename/suspend/restore, platform settings, audit log and health (no secrets), admin forgot-password.

Browser check (Playwright, optional): log in at *Login > Platform admin login*, open every console page, add an institution and an admin, change a temporary password.

## Email verification / deletion / guide (new)

`server/tests/verification.test.js` (7 tests): registration sends an email and does not log in; login blocked until verified; link works once; invalid and expired links; resend cooldown and hourly cap; same answer for unknown emails; coordinator mark-verified; onboarding flag; coordinator soft delete (wrong password, wrong confirmation, last-coordinator guard, other accounts untouched, projects kept, old session dead, cannot be reactivated); real SMTP delivery against a local fake SMTP server. Tests run one file at a time (`--test-concurrency=1`) because they share one test database.

## Browser smoke check (done in the sandbox)
Every page of the Student, Supervisor and Coordinator roles was opened in Chromium with demo data: no JavaScript errors, no failed API calls, no horizontal scrolling at 375, 768, 1024 and 1440 px. Create/edit dialogs and the evaluation form were opened and a draft was saved.

## Manual test checklist
1. Register a student, log in, create a group, share the code; a second student joins; non-leader cannot submit a proposal.
2. Coordinator assigns a supervisor; supervisor requests a revision (comment required), student resubmits, supervisor approves; old versions are still listed.
3. Upload a progress report (try a `.exe` renamed to `.pdf` - must be rejected); supervisor previews, requests revision, approves.
4. Add milestones, interaction log, meeting; chat between two browsers (live message + unread badge).
5. Coordinator: create rubric, invite an external evaluator (temporary password shown once), check the evaluator sees only assigned projects, revoke access.
6. Submit evaluations; coordinator publishes results; student sees them only after publishing.
7. Analytics filters and CSV export; audit log shows each action.
8. Sign up as a supervisor, try to log in (blocked), approve as coordinator, log in again.
9. Open Calendar and the proposal "Check for similar projects"; download the PDF report for a published project.
10. Keyboard only: Tab through the login form and a dialog (Esc closes). Resize to 375 px: sidebar becomes a drawer.

## Also checked in a real browser (sandbox)
Wrong role on login shows the right message; supervisor sign-up shows "Request sent", cannot log in while pending, and can after the coordinator approves; first-coordinator setup code works once and then closes (tested on an empty database); every page of all three roles loads without errors and without sideways scrolling at 375-1440 px.

## Known limits
No email sending, no automated front-end tests. The similar-project check compares only projects inside APMMS; it is not an internet plagiarism checker.
