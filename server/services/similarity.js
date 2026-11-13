import { ProposalVersion } from '../models/index.js';

// Plain-word overlap check between proposals. It is NOT a plagiarism detector for copied text from the internet;
// it only warns when two projects in this system are about the same idea.
const STOP = new Set('the and for with that this from into using based system project application develop developing development build building will can are was were has have had not but all any our their its your you they them his her who what which when where how why about over under more most such than then also able make makes made use used uses user users web app new via per each other these those one two'.split(' '));

const words = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));

/** Set of single words plus word pairs (pairs make "online voting" differ from "voting machine"). */
export function features(text) {
  const w = words(text);
  const set = new Set(w);
  for (let i = 0; i < w.length - 1; i++) set.add(`${w[i]}_${w[i + 1]}`);
  return set;
}

const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return (2 * common) / (a.size + b.size);
};

export const fingerprint = (v) => ({
  title: features(v.title),
  body: features([v.abstract, v.problemStatement, v.objectives, (v.technologyStack || []).join(' ')].join(' ')),
});

/** 0-100. A matching title counts a lot, but the body text decides the rest. */
export function similarityScore(a, b) {
  const t = dice(a.title, b.title);
  const body = dice(a.body, b.body);
  return Math.round(100 * Math.max(t * 0.8, 0.35 * t + 0.65 * body, body));
}

export const levelFor = (score) => (score >= 60 ? 'high' : score >= 40 ? 'medium' : 'low');

/** Newest proposal text of one project, compared with the newest text of every other project. */
export async function findSimilar(projectId, { min = 30, limit = 5 } = {}) {
  const mine = await ProposalVersion.findOne({ project: projectId }).sort({ version: -1 }).lean();
  if (!mine || !(mine.title || mine.abstract)) return { checked: false, matches: [] };
  const mineFp = fingerprint(mine);
  const others = await ProposalVersion.find({ project: { $ne: projectId } })
    .select('project version title abstract problemStatement objectives technologyStack state')
    .populate({ path: 'project', select: 'title status group term', populate: [{ path: 'group', select: 'name' }, { path: 'term', select: 'name' }] })
    .limit(5000)
    .lean();
  const newest = new Map();
  for (const v of others) {
    if (!v.project) continue;
    const key = String(v.project._id);
    if (!newest.has(key) || newest.get(key).version < v.version) newest.set(key, v);
  }
  const matches = [];
  for (const v of newest.values()) {
    const score = similarityScore(mineFp, fingerprint(v));
    if (score >= min) matches.push({ projectId: v.project._id, score, level: levelFor(score), title: v.title || v.project.title, group: v.project.group?.name, term: v.project.term?.name, status: v.project.status });
  }
  matches.sort((x, y) => y.score - x.score);
  return { checked: true, matches: matches.slice(0, limit) };
}
