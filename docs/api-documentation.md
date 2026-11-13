# API documentation

Base URL in development: `http://localhost:5000/api` (the React dev server proxies `/api`, so the browser uses `http://localhost:5173/api`).

## Conventions
- **Authentication:** `POST /api/auth/login` sets an **HttpOnly cookie** with a JWT. The browser sends it automatically; JavaScript cannot read it.
- **CSRF guard:** every request that changes data must send the header `X-Requested-With: APMMS` (the client does this for you).
- **Success response:** `{ "success": true, "data": ..., "meta": {page, limit, total, pages} }` (`meta` only for paged lists).
- **Error response:** `{ "success": false, "message": "...", "details": {field: "problem"} }`. Status codes: 401 not signed in, 403 role not allowed, 404 not found (also used when you may not see a record), 409 conflict, 415 bad file type, 422 validation.
- **Paging / sorting:** `?page=1&limit=15&q=search&sort=name&dir=asc`.
- **Files:** uploads are `multipart/form-data` (PDF/DOCX, magic bytes checked). Files are never public; they are streamed only by the authorised endpoints below (`.../file`, `.../download`, `.../attachments/:i`).
- **Roles:** `student`, `supervisor`, `coordinator`, `evaluator` (temporary external). Access is checked on the server for every route; "group leader only" actions are checked in `services/access.js`.

## Endpoints
Role requirements are defined in `server/routes/index.js` (look at the middleware before each route: `student`, `staff`, `coordinator`, `internal`, `any`).

| Method | Path |
|---|---|
| `POST` | `/api/academic-terms` |
| `GET` | `/api/academic-terms` |
| `PATCH` | `/api/academic-terms/:id` |
| `GET` | `/api/analytics` |
| `GET` | `/api/analytics/export/analytics.pdf` |
| `GET` | `/api/analytics/export/projects.csv` |
| `POST` | `/api/announcements` |
| `GET` | `/api/announcements` |
| `GET` | `/api/audit-logs` |
| `POST` | `/api/auth/change-password` |
| `POST` | `/api/auth/forgot-password` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |
| `GET` | `/api/auth/me` |
| `PATCH` | `/api/auth/profile` |
| `POST` | `/api/auth/register` |
| `GET` | `/api/auth/registration-options` |
| `POST` | `/api/auth/reset-password` |
| `GET` | `/api/calendar` |
| `GET` | `/api/conversations` |
| `GET` | `/api/conversations/:id/messages` |
| `POST` | `/api/conversations/:id/messages` |
| `GET` | `/api/conversations/:id/messages/:messageId/attachments/:index` |
| `POST` | `/api/conversations/:id/read` |
| `GET` | `/api/dashboard/coordinator` |
| `GET` | `/api/dashboard/student` |
| `GET` | `/api/dashboard/supervisor` |
| `POST` | `/api/departments` |
| `GET` | `/api/departments` |
| `PATCH` | `/api/departments/:id` |
| `POST` | `/api/evaluations/:id/reopen` |
| `GET` | `/api/evaluations/form/:projectId/:rubricId` |
| `PUT` | `/api/evaluations/form/:projectId/:rubricId` |
| `POST` | `/api/evaluations/form/:projectId/:rubricId/submit` |
| `GET` | `/api/evaluations/mine` |
| `GET` | `/api/evaluations/my-results` |
| `GET` | `/api/evaluations/overview` |
| `GET` | `/api/evaluations/results/:projectId` |
| `POST` | `/api/evaluations/results/:projectId/publish` |
| `GET` | `/api/evaluations/results/:projectId/report.pdf` |
| `POST` | `/api/evaluations/rubrics` |
| `GET` | `/api/evaluations/rubrics` |
| `PATCH` | `/api/evaluations/rubrics/:id` |
| `GET` | `/api/external-evaluators` |
| `POST` | `/api/external-evaluators` |
| `PATCH` | `/api/external-evaluators/:id/extend` |
| `POST` | `/api/external-evaluators/:id/revoke` |
| `POST` | `/api/feedback` |
| `GET` | `/api/feedback` |
| `GET` | `/api/feedback/:id` |
| `POST` | `/api/feedback/:id/comments` |
| `PATCH` | `/api/feedback/:id/status` |
| `GET` | `/api/groups` |
| `POST` | `/api/groups` |
| `GET` | `/api/groups/:id` |
| `PATCH` | `/api/groups/:id/admin` |
| `POST` | `/api/groups/:id/invite` |
| `POST` | `/api/groups/:id/leave` |
| `POST` | `/api/groups/:id/remove-member` |
| `POST` | `/api/groups/:id/transfer-leadership` |
| `DELETE` | `/api/groups/invitations/:id` |
| `POST` | `/api/groups/invitations/:id/respond` |
| `POST` | `/api/groups/join` |
| `GET` | `/api/groups/mine` |
| `GET` | `/api/interaction-logs` |
| `POST` | `/api/interaction-logs` |
| `POST` | `/api/interaction-logs/:id/responses` |
| `PATCH` | `/api/interaction-logs/:id/status` |
| `GET` | `/api/meetings` |
| `POST` | `/api/meetings` |
| `PATCH` | `/api/meetings/:id` |
| `POST` | `/api/milestones` |
| `GET` | `/api/milestones` |
| `PATCH` | `/api/milestones/:id` |
| `DELETE` | `/api/milestones/:id` |
| `GET` | `/api/milestones/progress-overview` |
| `GET` | `/api/notifications` |
| `PATCH` | `/api/notifications/:id/read` |
| `POST` | `/api/notifications/read-all` |
| `POST` | `/api/notifications/run-reminders` |
| `GET` | `/api/notifications/unread-count` |
| `GET` | `/api/projects` |
| `GET` | `/api/projects/:id` |
| `PATCH` | `/api/projects/:id` |
| `PATCH` | `/api/projects/:id/status` |
| `PUT` | `/api/projects/:id/supervisor` |
| `GET` | `/api/projects/:id/timeline` |
| `GET` | `/api/projects/mine` |
| `GET` | `/api/proposals` |
| `GET` | `/api/proposals/:id` |
| `POST` | `/api/proposals/:id/review` |
| `POST` | `/api/proposals/:id/start-review` |
| `GET` | `/api/proposals/project/:projectId` |
| `POST` | `/api/proposals/project/:projectId/attachments` |
| `DELETE` | `/api/proposals/project/:projectId/attachments/:index` |
| `PUT` | `/api/proposals/project/:projectId/draft` |
| `GET` | `/api/proposals/project/:projectId/similar` |
| `POST` | `/api/proposals/project/:projectId/submit` |
| `GET` | `/api/proposals/project/:projectId/versions/:version/attachments/:index` |
| `GET` | `/api/reports` |
| `POST` | `/api/reports` |
| `GET` | `/api/reports/:id` |
| `PATCH` | `/api/reports/:id` |
| `POST` | `/api/reports/:id/resubmit` |
| `POST` | `/api/reports/:id/review` |
| `POST` | `/api/reports/:id/start-review` |
| `POST` | `/api/reports/:id/submit` |
| `GET` | `/api/reports/:id/versions/:version/attachments/:index` |
| `GET` | `/api/reports/:id/versions/:version/file` |
| `GET` | `/api/reports/export.csv` |
| `GET` | `/api/reports/final-eligibility/:projectId` |
| `POST` | `/api/repository` |
| `GET` | `/api/repository` |
| `PATCH` | `/api/repository/:id/archive` |
| `GET` | `/api/repository/:id/download` |
| `GET` | `/api/settings` |
| `PUT` | `/api/settings` |
| `GET` | `/api/system/info` |
| `GET` | `/api/users` |
| `POST` | `/api/users` |
| `GET` | `/api/users/:id` |
| `PATCH` | `/api/users/:id` |
| `POST` | `/api/users/:id/approval` |
| `POST` | `/api/users/:id/reset-password` |
| `PATCH` | `/api/users/:id/status` |
| `GET` | `/api/users/lookup-student` |
| `GET` | `/api/users/supervisors` |

## Institutions (multi-institution workspaces)

Every request of a logged-in user is automatically limited to that user's institution (database-level filter, see `server/models/tenantPlugin.js`). Asking for another institution's record returns 404.

| Method & path | Who | Notes |
|---|---|---|
| GET `/auth/registration-options` | public | `{ institutions: [{_id,name,type,allowSelfRegistration,departments[]}], platform: {needsSetup, needsSetupCode, setupCodeConfigured} }` - approved institutions only |
| POST `/auth/register` | public | Student/Supervisor: `institutionId` + `departmentId` required. Coordinator: `institutionName`, optional `institutionType`, `departmentName`; creates a **pending** institution (or, on first-time setup, an approved one plus the platform owner, needing `setupCode`). |
| GET `/institutions?status=` | platform owner | All institutions with coordinators and counts |
| POST `/institutions/:id/decision` `{decision, note?}` | platform owner | `approve`, `reject`, `suspend`, `reactivate`, `restore` (undo a deletion), `purge` (erase for good). Not on your own institution. |
| POST `/institutions/platform-owner` `{userId}` | platform owner | Gives another approved coordinator the same role |
| POST `/institutions/mine/delete` `{password, confirmName, eraseNow?}` | coordinator | Deletes the caller's institution. 422 wrong password/name; 409 `LAST_PLATFORM_OWNER` if it holds the only platform owner. |

Login and every request return 403 with code `INSTITUTION_PENDING`, `INSTITUTION_BLOCKED` (suspended) or `INSTITUTION_DELETED` when the institution is not usable.

## Email verification, account deletion and welcome guide

| Method & path | Who | Notes |
|---|---|---|
| POST `/auth/verify-email` `{token}` | public | 200 verified; 400 `TOKEN_INVALID`; 410 `TOKEN_EXPIRED`; 409 `TOKEN_USED`. Rate limited (40 per 15 min per IP). |
| POST `/auth/resend-verification` `{email}` | public | Always the same 200 answer (does not reveal whether the email exists). Per account: 1 email per 60 s, 5 per hour; 20 per hour per IP. |
| POST `/users/:id/mark-verified` | coordinator | For when email cannot be delivered. Audited. |
| POST `/auth/onboarding-seen` | any logged-in user | Remembers that the welcome guide was shown or skipped. |
| POST `/auth/delete-account` `{password, confirmText:"DELETE"}` | coordinator, own account only | Soft delete. 422 wrong password/confirmation; 409 `LAST_COORDINATOR` when no other active coordinator exists. Ends the session. |

Changed behaviour: `POST /auth/register` for students no longer logs the student in; it returns `verificationRequired: true`. `POST /auth/login` returns 403 `EMAIL_NOT_VERIFIED` for unverified accounts (after the password is correct). Supervisors must verify email and also be approved.

## Real-time (Socket.IO)
Connects to the same origin and uses the same cookie. Rooms: `user:<id>` (notifications) and `conv:<id>` (chat). Events: `notification`, `message`, `message:read`, `typing`.

## Highlights added in this version
- `POST /auth/login` takes `{email, password, role}`. If `role` does not match the account the server answers 403 with a friendly message (only after the password is correct).
- `POST /auth/register` takes `role`: `student` (active at once), `supervisor` (saved as *pending*; response `{pending:true}`), `coordinator` (only while no coordinator exists and `setupCode` equals `COORDINATOR_SETUP_CODE` in `server/.env`).
- `GET /users?approval=pending` and `POST /users/:id/approval {decision:'approve'|'reject', note}` - coordinator decides supervisor requests.
- `GET /proposals/project/:projectId/similar` - similar-project check (students see title/term/score only).
- `GET /calendar?from=&to=` - milestones, meetings, report deadlines and term deadlines the caller may see (max 100 days).
- `GET /evaluations/results/:projectId/report.pdf` - evaluation report (coordinator any time; students/supervisor after publishing).
- `GET /analytics/export/analytics.pdf` - analytics summary PDF.

## Not implemented
- Email delivery (password-reset links are printed to the server console).
