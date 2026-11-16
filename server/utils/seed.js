// DEVELOPMENT SEED DATA - creates demo users, a department, a term and two rubrics.
// It is never run automatically. Run it yourself:   npm run seed
// It refuses to run when NODE_ENV=production.
import mongoose from 'mongoose';
import env from '../config/env.js';
import { connectDB } from '../config/db.js';
import { User, Department, AcademicTerm, Batch, EvaluationRubric, Institution, PlatformAdmin, PlatformSetting } from '../models/index.js';
import { runInInstitution } from './tenant.js';

export const DEMO_PASSWORD = 'Demo@12345';

export async function seed({ log = console.log } = {}) {
  if (!(await PlatformAdmin.exists({ email: 'admin@apmms.test' }))) {
    const admin = new PlatformAdmin({ name: 'Demo Platform Admin', email: 'admin@apmms.test', isFounder: !(await PlatformAdmin.exists({})) });
    await admin.setPassword(DEMO_PASSWORD);
    await admin.save();
    await PlatformSetting.updateOne({ key: 'setupDone' }, { $set: { value: true } }, { upsert: true });
    log('  created platform admin admin@apmms.test (log in on the Login page > Platform admin)');
  }
  let inst = await Institution.findOne({ nameKey: 'demo university' });
  if (!inst) {
    inst = await Institution.create({ name: 'Demo University', nameKey: 'demo university', type: 'university', status: 'approved', decidedAt: new Date() });
    log('  created institution Demo University');
  }
  return runInInstitution(inst._id, () => seedInside({ log, inst }));
}

async function seedInside({ log, inst }) {
  const dep = await Department.findOneAndUpdate({ code: 'CSE' }, { name: 'Computer Science & Engineering', code: 'CSE', description: 'Demo department' }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const year = new Date().getFullYear();
  let term = await AcademicTerm.findOne({ isCurrent: true });
  if (!term) {
    term = await AcademicTerm.create({
      name: `Fall ${year}`,
      academicYear: `${year}-${year + 1}`,
      semester: 'Fall',
      startDate: new Date(`${year}-01-01`),
      endDate: new Date(`${year + 1}-12-31`),
      isCurrent: true,
      deadlines: { proposal: new Date(Date.now() + 30 * 86400000), finalReport: new Date(Date.now() + 120 * 86400000) },
    });
  }

  let batch = await Batch.findOne({ department: dep._id, name: `${year} Batch` });
  if (!batch) batch = await Batch.create({ name: `${year} Batch`, department: dep._id, intakeYear: year, term: term._id });

  const people = [
    { name: 'Dr. Carol Coordinator', email: 'coordinator@apmms.test', role: 'coordinator' },
    { name: 'Prof. Sam Supervisor', email: 'supervisor@apmms.test', role: 'supervisor', designation: 'Associate Professor', department: dep._id },
    { name: 'Prof. Sara Second', email: 'supervisor2@apmms.test', role: 'supervisor', designation: 'Lecturer', department: dep._id },
    { name: 'Alice Student', email: 'alice@apmms.test', role: 'student', studentId: 'CSE-001', department: dep._id, term: term._id, batch: batch._id },
    { name: 'Bob Student', email: 'bob@apmms.test', role: 'student', studentId: 'CSE-002', department: dep._id, term: term._id, batch: batch._id },
    { name: 'Chitra Student', email: 'chitra@apmms.test', role: 'student', studentId: 'CSE-003', department: dep._id, term: term._id, batch: batch._id },
  ];
  for (const p of people) {
    if (await User.exists({ email: p.email })) continue;
    const u = new User(p);
    await u.setPassword(DEMO_PASSWORD);
    await u.save();
    log(`  created ${p.role.padEnd(11)} ${p.email}`);
  }

  if (!(await EvaluationRubric.exists({ name: 'Final Defence - Supervisor' }))) {
    const criteria = [
      { name: 'Problem definition', maxMarks: 10, weight: 1 },
      { name: 'Technical implementation', maxMarks: 30, weight: 1 },
      { name: 'Documentation', maxMarks: 20, weight: 1 },
      { name: 'Progress and consistency', maxMarks: 20, weight: 1 },
      { name: 'Demonstration', maxMarks: 20, weight: 1 },
    ];
    const bands = [{ min: 80, grade: 'A' }, { min: 70, grade: 'B' }, { min: 60, grade: 'C' }, { min: 50, grade: 'D' }, { min: 0, grade: 'F' }];
    await EvaluationRubric.create({ name: 'Final Defence - Supervisor', stage: 'Final defence', criteria, appliesTo: ['supervisor'], gradingRules: { aggregation: 'none', bands } });
    await EvaluationRubric.create({ name: 'Final Defence - External', stage: 'Final defence', criteria, appliesTo: ['external'], gradingRules: { aggregation: 'none', bands } });
    log('  created 2 evaluation rubrics');
  }
  return { dep, term, batch, institution: inst };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  if (env.isProd) {
    console.error('Refusing to seed demo data in production.');
    process.exit(1);
  }
  if (!process.argv.includes('--confirm')) {
    console.error('Run with:  npm run seed   (adds DEMO accounts to the database in MONGO_URI)');
    process.exit(1);
  }
  await connectDB();
  console.log('Seeding demo data...');
  await seed();
  console.log(`Done. All demo accounts use the password: ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}
