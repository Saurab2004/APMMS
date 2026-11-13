# Database design (MongoDB + Mongoose)

All models are in `server/models`. IDs are ObjectIds. Records are **deactivated or archived, never deleted**, so academic history stays intact. Every collection has `createdAt` / `updatedAt`.

| Collection | Purpose | Key fields / relations |
|---|---|---|
| `users` | All accounts | `role`, `email` (unique), `passwordHash`, `studentId`, `department`, `term`, `maxProjects`, `isActive`, `approvalStatus` (approved / pending / rejected - pending and rejected users are also `isActive:false`), `tokenVersion` (changing it signs the user out everywhere), `mustChangePassword`, `accessExpiresAt` (evaluators) |
| `departments`, `academicterms` | Structure | term has `isCurrent`, `deadlines.proposal`, `deadlines.finalReport` |
| `projectgroups` | Student groups | `members[{user, role: leader/member, status}]`, `activeMemberIds` (indexed copy for fast lookup), join `code`, `status` |
| `groupinvitations` | Invitations | group, email, status, `expiresAt` |
| `projects` | One per group | `group`, `supervisor`, `supervisorHistory[]`, `status` (forming → proposal → active → final_review → ready_for_evaluation → evaluated → completed → archived), `resultsPublished` |
| `proposals`, `proposalversions` | Proposal and every submitted version | version history is never overwritten |
| `progressreports`, `reportversions`, `reportreviews` | Progress and final reports | each upload creates a new version; reviews store decision + comments |
| `milestones`, `interactionlogs`, `meetings` | Monitoring | milestone `plannedDate`, `status`, `progress` |
| `feedbackthreads`, `feedbackcomments` | Threaded feedback | linked to project / report / proposal |
| `conversations`, `messages` | Real-time chat | message `readBy[]`, attachments |
| `notifications`, `announcements` | Alerts | notification `dedupeKey` prevents duplicates |
| `evaluationrubrics`, `evaluations`, `externalevaluatorassignments` | Marking | rubric criteria (max marks, weight); evaluation `scores[]`, `total`, `percentage`, `status` draft/submitted |
| `repositoryresources` | Templates and guidelines | file, category, `isArchived` |
| `systemsettings`, `auditlogs` | Rules and history | settings are key/value; audit logs record actor, action, entity |

Indexes: unique email / student ID; `activeMemberIds`; `members.user`; project/supervisor lookups; notification `dedupeKey`.

## Institutions (multi-institution update)

New collection **`institutions`**: `name`, `nameKey` (lower-case, duplicate check), `type`, `status` (`pending`, `approved`, `rejected`, `suspended`, `deleted`), `statusNote`, `decidedAt/By`, `deletedAt`, `purgeAt`.

**Every other collection now has `institution`** (ref to `institutions`, indexed). A Mongoose plugin adds it, stamps it on every new document and adds it to every find/count/update/delete/aggregate made while handling a logged-in request, so controllers cannot forget the filter. `users.isPlatformOwner` marks who approves institutions.

Uniqueness is now **per institution**: department name and code, term name, student ID and the settings key (compound indexes with `institution`). Email stays unique across the whole platform. The server drops the old global indexes and moves old records into "Default Institution" at start-up (`server/services/migration.js`, safe to run repeatedly).

## Changes in the email-verification / deletion update

`users` collection - new optional fields (no migration needed; old documents keep working and count as verified):

| Field | Meaning |
|---|---|
| `emailVerified` (default true) | false for self-registered students/supervisors until the link is opened |
| `emailVerifiedAt` | when it happened |
| `emailVerification.tokenHash / usedHash / expiresAt / sentAt / windowStart / sendCount` | only a SHA-256 hash of the emailed token is stored; hidden from every API response |
| `deletedAt` | set when a coordinator deletes their own account (soft delete: record kept, `isActive=false`, email replaced by `deleted-<id>@deleted.invalid`, phone/bio removed, password made unusable) |
| `onboardingSeenAt` | the welcome guide was shown or skipped |

## Relationship summary
User ─< ProjectGroup (members) ── 1 Project ─< Proposal ─< ProposalVersion
Project ─< ProgressReport ─< ReportVersion ─< ReportReview
Project ─< Milestone, InteractionLog, Meeting, FeedbackThread ─< FeedbackComment
Project ─< Evaluation >─ EvaluationRubric;  ExternalEvaluatorAssignment links evaluator, rubric and projects.
