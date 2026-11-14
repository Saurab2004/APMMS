// Creates a platform admin (or resets the password of an existing one) straight in the database.
// Use it when you cannot use the setup page, or when every admin forgot their password:
//     npm run create-admin -- --email you@example.com --name "Your Name"
// It asks for the password (typing is hidden). It uses the MONGO_URI from server/.env, so run it on your own computer
// with the same Atlas address your hosted site uses.
import readline from 'readline';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { PlatformAdmin, PlatformSetting, User } from '../models/index.js';
import { passwordProblem } from './helpers.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(question); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const email = (arg('email') || '').trim().toLowerCase();
const name = (arg('name') || 'Platform Admin').trim();
if (!email) {
  console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name"');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD || (await askHidden('New password (8+ characters, letters and numbers): '));
const problem = passwordProblem(password);
if (problem) { console.error(problem); process.exit(1); }

await connectDB();
if (await User.exists({ email })) {
  console.error(`${email} already belongs to an institution account (student, supervisor or coordinator). Use a different email for the admin.`);
  await mongoose.disconnect();
  process.exit(1);
}
let admin = await PlatformAdmin.findOne({ email }).select('+passwordHash');
if (admin) {
  await admin.setPassword(password);
  admin.isActive = true;
  admin.mustChangePassword = false;
  admin.tokenVersion += 1;
  admin.failedLogins = 0;
  admin.lockUntil = undefined;
  await admin.save();
  console.log(`Password reset for the existing admin ${email}. You can log in now.`);
} else {
  const first = !(await PlatformAdmin.exists({}));
  admin = new PlatformAdmin({ name, email, isFounder: first });
  await admin.setPassword(password);
  await admin.save();
  await PlatformSetting.updateOne({ key: 'setupDone' }, { $set: { value: true } }, { upsert: true });
  console.log(`Platform admin ${email} created${first ? ' (founding admin)' : ''}. Log in on the Login page > Platform admin.`);
}
await mongoose.disconnect();
