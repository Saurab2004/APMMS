// Proves that Student, Supervisor and Coordinator can be logged in at the same time when each one
// uses its own isolated browser context (like separate browsers / incognito windows), against ONE server and ONE database.
// It uses the demo accounts created by `npm run seed` (password Demo@12345).
import { test, expect } from '@playwright/test';

const PASSWORD = 'Demo@12345';
const USERS = {
  coordinator: { email: 'coordinator@apmms.test', role: 'coordinator', home: /\/coordinator/ },
  supervisor: { email: 'supervisor@apmms.test', role: 'supervisor', home: /\/supervisor/ },
  student: { email: 'alice@apmms.test', role: 'student', home: /\/student/ },
};
const ROLE_CARD = { coordinator: 'Head of department / admin', supervisor: 'Guide and review groups', student: null };
const API_HEADERS = { 'X-Requested-With': 'APMMS' }; // the app's CSRF guard header

async function loginViaUi(page, who) {
  await page.goto('/login');
  const card = ROLE_CARD[who.role];
  if (card) await page.locator(`text=${card}`).first().click();
  await page.fill('input[type=email]', who.email);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(who.home);
  // The first-login welcome dialog appears once per account; dismiss it if it shows.
  await dismissGuide(page);
}

async function dismissGuide(page) {
  const skip = page.locator('button:has-text("Skip for now")');
  if (await skip.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) { await skip.click(); await page.waitForTimeout(900); }
}

const me = async (ctx) => {
  const r = await ctx.request.get('/api/auth/me', { headers: API_HEADERS });
  return { status: r.status(), user: r.ok() ? (await r.json()).data.user : null };
};

test.describe('isolated contexts = independent sessions', () => {
  let browserCtx;
  const ctxs = {};
  const pages = {};

  test.beforeAll(async ({ browser }) => {
    browserCtx = browser;
    for (const key of Object.keys(USERS)) {
      ctxs[key] = await browser.newContext(); // own cookie jar per role
      pages[key] = await ctxs[key].newPage();
      await loginViaUi(pages[key], USERS[key]);
    }
  });
  test.afterAll(async () => { for (const c of Object.values(ctxs)) await c.close().catch(() => {}); });

  test('all three roles stay logged in together, each with its own identity', async () => {
    for (const [key, who] of Object.entries(USERS)) {
      const { status, user } = await me(ctxs[key]);
      expect(status, `${key} session`).toBe(200);
      expect(user.role).toBe(who.role);
      expect(user.email).toBe(who.email);
      await pages[key].reload();
      await expect(pages[key]).toHaveURL(who.home); // still on its own dashboard after reload
    }
    // each context has exactly one auth cookie, and it is HttpOnly (never readable by page scripts)
    const tokens = new Set();
    for (const key of Object.keys(USERS)) {
      const cookies = (await ctxs[key].cookies()).filter((c) => c.name === 'apmms_token');
      expect(cookies).toHaveLength(1);
      expect(cookies[0].httpOnly).toBe(true);
      tokens.add(cookies[0].value);
      expect(await pages[key].evaluate(() => document.cookie.includes('apmms_token'))).toBe(false);
    }
    expect(tokens.size, 'three different sessions').toBe(3);
  });

  test('each role can only use its own features', async () => {
    const get = (key, url) => ctxs[key].request.get(url, { headers: API_HEADERS }).then((r) => r.status());
    // coordinator-only API routes
    expect(await get('coordinator', '/api/users')).toBe(200);
    expect(await get('coordinator', '/api/analytics')).toBe(200);
    for (const key of ['student', 'supervisor']) {
      expect(await get(key, '/api/users'), `${key} /users`).toBe(403);
      expect(await get(key, '/api/analytics'), `${key} /analytics`).toBe(403);
      expect(await get(key, '/api/audit-logs'), `${key} /audit-logs`).toBe(403);
    }
    // staff (supervisor + coordinator) route is closed to students
    expect(await get('supervisor', '/api/projects')).toBe(200);
    expect(await get('coordinator', '/api/projects')).toBe(200);
    expect(await get('student', '/api/projects')).toBe(403);
    // UI: a student or supervisor who types a coordinator address does not get the coordinator page
    for (const key of ['student', 'supervisor']) {
      await pages[key].goto('/coordinator/users');
      await pages[key].waitForTimeout(800);
      expect(pages[key].url(), `${key} blocked from coordinator UI`).not.toMatch(/\/coordinator\/users/);
    }
    // and the coordinator still reaches it
    await pages.coordinator.goto('/coordinator/users');
    await expect(pages.coordinator.getByRole('heading', { name: /user management/i })).toBeVisible();
  });

  test('logging out one user does not log out the others', async () => {
    // Log the student out through the real UI button/menu path is covered elsewhere; here use the real API call.
    const out = await ctxs.student.request.post('/api/auth/logout', { headers: API_HEADERS });
    expect(out.status()).toBe(200);
    expect((await me(ctxs.student)).status).toBe(401);
    expect((await me(ctxs.supervisor)).user.role).toBe('supervisor');
    expect((await me(ctxs.coordinator)).user.role).toBe('coordinator');
    await pages.coordinator.goto('/coordinator');
    await expect(pages.coordinator).toHaveURL(USERS.coordinator.home);
    await pages.supervisor.goto('/supervisor');
    await expect(pages.supervisor).toHaveURL(USERS.supervisor.home);
    // the student can log in again without disturbing anyone
    await loginViaUi(pages.student, USERS.student);
    expect((await me(ctxs.student)).user.role).toBe('student');
    expect((await me(ctxs.coordinator)).user.role).toBe('coordinator');
  });

  test('logging out via the app menu ends only that browser session', async () => {
    await pages.supervisor.goto('/supervisor');
    await dismissGuide(pages.supervisor);
    await pages.supervisor.locator('.user-btn').click();
    await pages.supervisor.locator('button[role=menuitem]:has-text("Log out")').click();
    await pages.supervisor.waitForURL(/\/login/);
    expect((await me(ctxs.supervisor)).status).toBe(401);
    expect((await me(ctxs.coordinator)).status).toBe(200);
    expect((await me(ctxs.student)).status).toBe(200);
  });
});

test('for comparison: two tabs in ONE browser context share one session (this is the browser, not a bug)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const tab1 = await ctx.newPage();
  await loginViaUi(tab1, USERS.coordinator);
  expect((await me(ctx)).user.role).toBe('coordinator');
  // "tab 2" of the same browser logs in as the student: same cookie jar -> replaces the coordinator session
  const login = await ctx.request.post('/api/auth/login', { headers: API_HEADERS, data: { email: USERS.student.email, password: PASSWORD, role: 'student' } });
  expect(login.status()).toBe(200);
  expect((await me(ctx)).user.role).toBe('student');
  expect((await ctx.cookies()).filter((c) => c.name === 'apmms_token')).toHaveLength(1);
  await ctx.close();
});
