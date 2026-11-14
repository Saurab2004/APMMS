# Hosting guide (free, step by step)

APMMS runs as **one service**: the Node server also serves the built website, so there are no cross-site cookie problems.
Commands used by hosting services (from the project root, the folder that contains `client`, `server` and `package.json`):

- Build: `npm run build`
- Start: `npm start`

## Where the data lives when it is online
| Data | Locally (now) | Online |
|---|---|---|
| Users, groups, proposals, marks, chat | MongoDB on your computer | A MongoDB the hosted server can reach, e.g. **MongoDB Atlas free (M0)**: 512 MB, free, no time limit, **no automatic backups** |
| Uploaded PDF/Word files | `server/uploads` folder | The hosting server's disk. **Free Render web services lose this folder on every restart/redeploy/sleep**, so uploads vanish. Fine for a demo, not for real use. For permanent files use a small VM (Option B) or a paid persistent disk. |

## Option A - quickest free demo: GitHub + MongoDB Atlas + Render
1. **GitHub:** create a private repository and upload the project (root folder). `.env` and `node_modules` are ignored automatically.
2. **Atlas:** create a free M0 cluster -> Database Access: add a user and password (letters and numbers only) -> Network Access: allow `0.0.0.0/0` -> Connect -> Drivers -> copy the string and put `/apmms` before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/apmms?retryWrites=true&w=majority`
3. **Render:** New -> Web Service -> pick the repository.
   - Build Command: `npm run build`   Start Command: `npm start`   Instance type: Free
   - Environment variables: `NODE_ENV=production`, `MONGO_URI=<Atlas string>`, `JWT_SECRET=<48+ random characters>`, `PLATFORM_SETUP_CODE=<your secret>`, `TRUST_PROXY=1`, `CLIENT_ORIGIN=https://<your-service>.onrender.com`
4. Open `https://<your-service>.onrender.com/platform/setup` -> create the first **platform admin** (enter the setup code). Institutions then register themselves on the Register page and activate when their coordinator verifies the email.
5. Do **not** run `npm run seed` on the live site (it creates demo accounts with a known password).

Free Render limits (checked on render.com/docs/free): the service sleeps after 15 minutes without traffic and takes about a minute to wake; the filesystem is not kept; 750 free instance hours per month.

## Option B - permanent: a small virtual machine
Use a student credit (GitHub Student Developer Pack with your college email lists Azure for Students and DigitalOcean credits; check the current amounts when you apply). On an Ubuntu VM: install Node 20, MongoDB Community (or use Atlas), copy the project, create `server/.env`, `npm run build`, run `npm start` under `pm2`, and put nginx with a free Let's Encrypt HTTPS certificate in front. The disk is permanent, so uploads survive.

## Option C - for a viva or demo with no hosting
Run it on your laptop and share it on the same Wi-Fi, or use a free tunnel (Cloudflare Tunnel or ngrok) pointed at port 5000 after `npm run build` and `npm start` in `server` with `CLIENT_ORIGIN` set to the tunnel address.

## Production checklist
- Strong `JWT_SECRET` and `PLATFORM_SETUP_CODE`; never commit `.env`.
- HTTPS only (Render provides it).
- Remember that email is not configured: password-reset links are printed in the server log.
- Back up Atlas data manually (free tier has no backups): `mongodump --uri="<Atlas string>"`.
