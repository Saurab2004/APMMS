# Setup guide (beginner friendly)

## 1. Install the tools
1. **Node.js 18 or newer** - https://nodejs.org (LTS). Check with `node -v`.
2. **MongoDB Community Server** - https://www.mongodb.com/try/download/community (free, runs on your own computer; no Atlas account needed). Install it as a service so it starts automatically.
   - Check it is running: `mongosh` should connect to `mongodb://127.0.0.1:27017`.
   - Windows: Services -> "MongoDB Server" -> Running. macOS: `brew services start mongodb-community`. Linux: `sudo systemctl start mongod`.

## 2. Configure the server
```
cd server
npm install
cp .env.example .env        (Windows: copy .env.example .env)
```
Open `server/.env` and set `JWT_SECRET` to a long random string:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
Also choose a **coordinator setup code** (any secret words) on the line `COORDINATOR_SETUP_CODE=`. It is used once, to create the first coordinator (see step 3).
Other defaults (port 5000, `MONGO_URI=mongodb://127.0.0.1:27017/apmms`, client at 5173) normally need no change.

## 2b. Set up email (needed for email verification)

New students and supervisors must open a link in an email before they can log in. APMMS sends that email through any SMTP service you choose. Put the details in `server/.env` (never in the client):

```
APP_URL=http://localhost:5173        # the address people open (your real website address when hosted)
EMAIL_FROM="APMMS <you@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false                    # true only for port 465
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
EMAIL_VERIFY_HOURS=24
```

- **Gmail (free):** turn on 2-step verification, create an "App password" in your Google account, and use it as `SMTP_PASS`. (Not tested against Gmail itself in the sandbox.)
- Other free options: Brevo, Mailgun, SendGrid, Resend SMTP.
- **Leave `SMTP_HOST` empty while developing:** the verification link is printed in the server window instead of being emailed. In production an empty `SMTP_HOST` sends nothing (and prints no links), so students could not verify - the coordinator can then use "Mark email as verified" on the Users page.
- Accounts created by the coordinator, the seed script and the first coordinator (setup code) need no verification. Accounts that existed before this update also keep working.

## 3. Institutions, coordinators and everyone else
APMMS serves **many institutions** (universities, colleges, schools) from one installation. Each institution is its own **workspace**: its coordinator, supervisors and students can never see another institution's data.

**First time only - the platform owner.** Open the **Register** page, pick **Coordinator** and register your institution. On a brand-new local database (development) nothing else is needed. In production (or when the database already has users) also type the `COORDINATOR_SETUP_CODE` from `server/.env`. You become the *platform owner*: you approve every institution that joins later (sidebar: **Institutions**).

**Another institution joins.** Its head registers as **Coordinator** with the institution name, verifies the email, then waits. You approve or reject on **Institutions** (you can suspend later, or restore/erase a deleted one). After approval they log in, add departments and the current academic term, and invite their people.

**Students and supervisors** sign up on the Register page: choose **institution** first, then **department**.
- **Student** - verifies the email, then logs in.
- **Supervisor** - verifies the email, then waits until *that institution's* coordinator approves on **Users & approvals**.
- **Login** is one page: pick your role, then enter email and password.

**Deleting an institution.** A coordinator can delete their institution (Profile & account > *Delete my institution*, password + institution name required). Everyone is blocked at once and the data is erased for good after `INSTITUTION_PURGE_DAYS` (default 14) unless the platform owner restores it; "erase immediately" is also offered. This is meant for trials: try APMMS, and remove everything if it is not for you. Deleting yourself only: *Delete my account*.

**Existing installations.** When you upgrade, the server moves all existing records into one institution called "Default Institution" (nothing is deleted or changed otherwise) and makes the oldest coordinator the platform owner. Rename it directly in the `institutions` collection if you like.

## 3b. Create demo data (optional, never automatic)
```
npm run seed
```
Creates the institution "Demo University" with a department, a term, rubrics and these accounts (password for all: `Demo@12345`):
`coordinator@apmms.test`, `supervisor@apmms.test`, `supervisor2@apmms.test`, `alice@apmms.test`, `bob@apmms.test`, `chitra@apmms.test`.
**Change or delete these accounts before real use.** For a real installation, create the first coordinator account yourself with the seed script as a starting point, then change its password at first login.

## 4. Start the server and the client (two terminals)
```
cd server && npm run dev        # http://localhost:5000
cd client && npm install && npm run dev   # http://localhost:5173
```
Open http://localhost:5173.

## 5. Production build
`cd client && npm run build` creates `client/dist`. Serve it with any static host and proxy `/api` and `/socket.io` to the server, or keep using the same-origin proxy setup. Set `NODE_ENV=production`, a strong `JWT_SECRET`, and the real `CLIENT_ORIGIN`.

## Troubleshooting
- *"Cannot reach the server"*: the server is not running or the port differs from `vite.config.js` (`VITE_API_TARGET`).
- *Server exits with a database error*: MongoDB is not running or `MONGO_URI` is wrong.
- *Login works but you are sent back to login*: open the site through http://localhost:5173 (not 127.0.0.1:5000) so the cookie is same-origin.
- *Password reset email*: no email service is configured; the reset link is printed in the **server terminal**.
- *Backups*: see Coordinator -> Backup & maintenance (`mongodump` plus the `server/uploads` folder).
