# Multi-user session tests (Playwright)

**Why you cannot be two people in one browser:** APMMS keeps your login in one HttpOnly cookie (`apmms_token`).
Cookies belong to the *browser profile + website address*, so every tab of the same browser shares it.
Logging in as a Student in tab 2 replaces the Coordinator cookie from tab 1. This is how browsers work, it is
also what keeps the login safe, and nothing in APMMS needs changing. To be several people at once, use separate
cookie jars: different browsers, an incognito window, or (what these tests do) separate Playwright browser contexts.

## Run the tests

1. Start the database (MongoDB) and put the demo data in it (only needed once):
   `cd server && npm run seed`
2. Build the client and start the server (serves the site on port 5000):
   `cd client && npm run build` then `cd ../server && npm start`
3. In another terminal:
   ```
   cd e2e
   npm install
   npx playwright install chromium
   npx playwright test
   ```
Use another address with `BASE_URL=http://localhost:5173 npx playwright test` (the Vite dev site).
If a browser is already installed, point at it with `CHROMIUM_PATH=/path/to/chrome`.

The tests use the demo accounts from the seed script (password `Demo@12345`): `coordinator@apmms.test`,
`supervisor@apmms.test`, `alice@apmms.test`. They only log in and out and read pages; they do not change data
(the first-login welcome dialog flag is the only thing stored).
