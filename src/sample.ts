import {
  getSetting,
  listGlossary,
  listProjects,
  listTM,
  putSegments,
  putTerms,
  putTMEntries,
  saveProject,
  setSetting,
} from './db';
import { createSegment } from './lib/segments';
import { newId, type GlossaryTerm, type Project, type SegmentStatus, type TMEntry } from './types';

/**
 * The built-in sample. The Persian source is deliberately "dirty" — Arabic ي/ك, missing
 * half-spaces (ZWNJ), a kashida, stray spaces and Latin digits — so the normalizer has work to do,
 * and some translations contain deliberate mistakes so every QA check reports something.
 */
export const SAMPLE_SOURCE_TEXT = [
  'اطلاعيه كتابخانه مركزي',
  'كتابخانه ي مركزي شهر در سال 1402 بيش از 12,500 عضو جديد پذيرفت. اين كتابخانه هر روز  از ساعت 8 تا 20 باز است و مي تواند به 300 نفر خدمات بدهد. آيا مي دانيد كه بزرگ ترين بخش آن، بخش كتاب هاي ديجيتال است؟ كاربران مي توانند با نرم افزار «Libby» كتاب ها را روي تلفن همراه خود بخوانند. هر عضو ميتواند تا 5 كتاب امانت بگيرد.',
  'عضويت بـراي دانش آموزان رايگان است ، اما ديگران بايد سالانه 150 هزار تومان بپردازند. براي اطلاعات بيشتر به وب سايت www.example.org مراجعه كنيد.',
].join('\n');

interface SampleSegment {
  paragraph: number;
  source: string;
  target: string;
  status: SegmentStatus;
}

export const SAMPLE_SEGMENTS: SampleSegment[] = [
  {
    paragraph: 0,
    source: 'اطلاعيه كتابخانه مركزي',
    target: 'Central Library Notice',
    status: 'confirmed',
  },
  {
    paragraph: 1,
    source: 'كتابخانه ي مركزي شهر در سال 1402 بيش از 12,500 عضو جديد پذيرفت.',
    target: "The city's central library accepted more than 12,500 new members in 1402.",
    status: 'confirmed',
  },
  {
    paragraph: 1,
    source: 'اين كتابخانه هر روز  از ساعت 8 تا 20 باز است و مي تواند به 300 نفر خدمات بدهد.',
    // Deliberate mistake: 22 instead of 20 (number check).
    target: 'This library is open every day from 8 to 22 and can serve 300 people.',
    status: 'draft',
  },
  {
    paragraph: 1,
    source: 'آيا مي دانيد كه بزرگ ترين بخش آن، بخش كتاب هاي ديجيتال است؟',
    target: '',
    status: 'empty',
  },
  {
    paragraph: 1,
    source: 'كاربران مي توانند با نرم افزار «Libby» كتاب ها را روي تلفن همراه خود بخوانند.',
    // Deliberate mistakes: glossary term "software" not used, and an unclosed quotation mark.
    target: 'Users can read books on their mobile phones with the “Libby app.',
    status: 'draft',
  },
  {
    paragraph: 1,
    source: 'هر عضو ميتواند تا 5 كتاب امانت بگيرد.',
    target: '',
    status: 'empty',
  },
  {
    paragraph: 2,
    source: 'عضويت بـراي دانش آموزان رايگان است ، اما ديگران بايد سالانه 150 هزار تومان بپردازند.',
    // Deliberate mistake: double space.
    target: 'Membership is free for students,  but others must pay 150 thousand tomans per year.',
    status: 'draft',
  },
  {
    paragraph: 2,
    source: 'براي اطلاعات بيشتر به وب سايت www.example.org مراجعه كنيد.',
    // Deliberate mistake: source copied into the target unchanged.
    target: 'براي اطلاعات بيشتر به وب سايت www.example.org مراجعه كنيد.',
    status: 'draft',
  },
];

export const SAMPLE_GLOSSARY: { fa: string; en: string; note: string }[] = [
  { fa: 'کتابخانه', en: 'library', note: 'Sample term' },
  { fa: 'عضو', en: 'member', note: 'Sample term' },
  { fa: 'عضویت', en: 'membership', note: 'Sample term' },
  { fa: 'نرم‌افزار', en: 'software', note: 'Sample term — written with a half-space (ZWNJ)' },
  { fa: 'تلفن همراه', en: 'mobile phone', note: 'Sample term' },
  { fa: 'دانش‌آموز', en: 'student', note: 'Sample term' },
  { fa: 'وب‌سایت', en: 'website', note: 'Sample term' },
];

export const SAMPLE_TM: { fa: string; en: string }[] = [
  { fa: 'هر عضو می‌تواند تا ۳ کتاب امانت بگیرد.', en: 'Each member can borrow up to 3 books.' },
  { fa: 'این کتابخانه هر روز از ساعت ۹ تا ۱۷ باز است.', en: 'This library is open every day from 9 to 17.' },
  { fa: 'عضویت برای دانش‌آموزان رایگان است.', en: 'Membership is free for students.' },
];

const SAMPLE_NOTES =
  'Built-in sample. The Persian source deliberately contains Arabic ي/ك, missing half-spaces (ZWNJ), ' +
  'a kashida, stray spaces and Latin digits: open the Normalize tab to clean it up. Some translations ' +
  'contain deliberate mistakes so the QA tab has something to report. Delete this project whenever you like.';

function isoDateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Creates the sample project with its glossary and TM entries. Returns the new project id. */
export async function loadSampleProject(): Promise<string> {
  const now = Date.now();
  const project: Project = {
    id: newId(),
    name: 'Sample — City library notice',
    client: 'Sample Client (demo)',
    direction: 'fa-en',
    deadline: isoDateInDays(7),
    rateUnit: 'word',
    rate: 0.08,
    currency: 'USD',
    digitMode: 'persian',
    status: 'active',
    notes: SAMPLE_NOTES,
    mediaDuration: null,
    mediaName: '',
    isSample: true,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(project);

  const segments = SAMPLE_SEGMENTS.map((item, index) =>
    createSegment(project.id, index, {
      paragraph: item.paragraph,
      source: item.source,
      target: item.target,
      status: item.status,
      confirmedAt: now,
      updatedAt: now,
    }),
  );
  await putSegments(segments);

  const existingTerms = await listGlossary();
  const haveTerm = new Set(existingTerms.map((term) => `${term.fa}\u0000${term.en}`));
  const terms: GlossaryTerm[] = SAMPLE_GLOSSARY.filter((item) => !haveTerm.has(`${item.fa}\u0000${item.en}`)).map(
    (item, index) => ({ id: newId(), fa: item.fa, en: item.en, note: item.note, createdAt: now + index }),
  );
  await putTerms(terms);

  const existingTM = await listTM();
  const haveTM = new Set(existingTM.map((entry) => `${entry.fa}\u0000${entry.en}`));
  const tmEntries: TMEntry[] = [];
  for (const item of SAMPLE_TM) {
    if (haveTM.has(`${item.fa}\u0000${item.en}`)) continue;
    tmEntries.push({
      id: newId(),
      fa: item.fa,
      en: item.en,
      direction: 'fa-en',
      projectId: null,
      segmentId: null,
      origin: 'Sample TM',
      createdAt: now,
      updatedAt: now,
    });
  }
  // Confirmed sample segments belong in the TM too, exactly as if they had been confirmed in the editor.
  for (const segment of segments) {
    if (segment.status !== 'confirmed') continue;
    tmEntries.push({
      id: newId(),
      fa: segment.source,
      en: segment.target,
      direction: 'fa-en',
      projectId: project.id,
      segmentId: segment.id,
      origin: project.name,
      createdAt: now,
      updatedAt: now,
    });
  }
  await putTMEntries(tmEntries);
  return project.id;
}

/** On the very first launch (empty database) the sample project is created automatically. */
export async function ensureSampleOnFirstRun(): Promise<void> {
  const seeded = await getSetting<boolean>('sampleSeeded', false);
  if (seeded) return;
  const projects = await listProjects();
  if (projects.length === 0) await loadSampleProject();
  await setSetting('sampleSeeded', true);
}
