/**
 * Seed — 28 South-India practitioners + 540 consultations over the past 15 days.
 *
 * A standalone, pilot-population seed (NOT wired into `prisma/seed.ts`, so it
 * never runs automatically on a Vercel deploy). It creates a realistic cohort
 * for the operator console + dashboards:
 *
 *   - 28 practitioners (a THERAPIST / DOCTOR mix) across Karnataka, Tamil Nadu,
 *     Kerala, Telangana and Andhra Pradesh — each with an email, phone,
 *     RCI / medical-registration number, languages, city and headline.
 *   - A client pool per practitioner (isDemo:false, so their sessions COUNT in
 *     the console's "real-client" metrics). Client PII is stored as opaque
 *     `seed:` placeholders in the encrypted columns — the admin console never
 *     renders client PHI, and no one signs in as these fixtures.
 *   - 540 COMPLETED sessions spread over the last 15 days, divided UNEQUALLY
 *     between the 28 (a few busy practices, a long tail of small ones).
 *
 * Idempotent: every row uses a deterministic `seed-si-*` id / unique key and is
 * upserted, so re-running neither duplicates nor fails. All randomness comes
 * from a seeded PRNG so re-runs are identical.
 *
 * Run (local):
 *   DATABASE_URL=postgresql://... pnpm exec tsx scripts/seed-south-india.ts
 * Run (prod):  point DATABASE_URL at the prod (Neon) database. It only ADDS the
 *   seed-si-* rows; it touches nothing else.
 *
 * Undo:  DATABASE_URL=... pnpm exec tsx scripts/seed-south-india.ts --purge
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOTAL_SESSIONS = 540;
const WINDOW_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic PRNG (mulberry32) so re-runs produce identical data. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CitySpec {
  city: string;
  province: string;
  langs: string[];
  /** State medical council prefix for doctor registration numbers. */
  council: string;
}

const CITIES: Record<string, CitySpec> = {
  bengaluru: { city: 'Bengaluru', province: 'Karnataka', langs: ['Kannada', 'English', 'Hindi'], council: 'KMC' },
  mysuru: { city: 'Mysuru', province: 'Karnataka', langs: ['Kannada', 'English'], council: 'KMC' },
  mangaluru: { city: 'Mangaluru', province: 'Karnataka', langs: ['Kannada', 'Tulu', 'English'], council: 'KMC' },
  hubballi: { city: 'Hubballi', province: 'Karnataka', langs: ['Kannada', 'English'], council: 'KMC' },
  chennai: { city: 'Chennai', province: 'Tamil Nadu', langs: ['Tamil', 'English'], council: 'TNMC' },
  coimbatore: { city: 'Coimbatore', province: 'Tamil Nadu', langs: ['Tamil', 'English'], council: 'TNMC' },
  madurai: { city: 'Madurai', province: 'Tamil Nadu', langs: ['Tamil', 'English'], council: 'TNMC' },
  trichy: { city: 'Tiruchirappalli', province: 'Tamil Nadu', langs: ['Tamil', 'English'], council: 'TNMC' },
  salem: { city: 'Salem', province: 'Tamil Nadu', langs: ['Tamil', 'English'], council: 'TNMC' },
  kochi: { city: 'Kochi', province: 'Kerala', langs: ['Malayalam', 'English'], council: 'TCMC' },
  tvm: { city: 'Thiruvananthapuram', province: 'Kerala', langs: ['Malayalam', 'English', 'Tamil'], council: 'TCMC' },
  kozhikode: { city: 'Kozhikode', province: 'Kerala', langs: ['Malayalam', 'English'], council: 'TCMC' },
  thrissur: { city: 'Thrissur', province: 'Kerala', langs: ['Malayalam', 'English'], council: 'TCMC' },
  hyderabad: { city: 'Hyderabad', province: 'Telangana', langs: ['Telugu', 'English', 'Hindi', 'Urdu'], council: 'TSMC' },
  warangal: { city: 'Warangal', province: 'Telangana', langs: ['Telugu', 'English'], council: 'TSMC' },
  vizag: { city: 'Visakhapatnam', province: 'Andhra Pradesh', langs: ['Telugu', 'English'], council: 'APMC' },
  vijayawada: { city: 'Vijayawada', province: 'Andhra Pradesh', langs: ['Telugu', 'English'], council: 'APMC' },
  guntur: { city: 'Guntur', province: 'Andhra Pradesh', langs: ['Telugu', 'English'], council: 'APMC' },
};

const ISO_BY_LANG: Record<string, string> = {
  Tamil: 'ta',
  Malayalam: 'ml',
  Telugu: 'te',
  Kannada: 'kn',
  Hindi: 'hi',
  English: 'en',
  Tulu: 'en',
  Urdu: 'ur',
  Arabic: 'ar',
  Pashto: 'ps',
};

type Vertical = 'THERAPIST' | 'DOCTOR';

interface Row {
  /** Display name exactly as it should appear (no "Dr." — added for doctors). */
  name: string;
  vertical: Vertical;
  cityKey: keyof typeof CITIES | string;
  /** Therapist specialties / doctor specialty area. */
  focus: string;
  /** Therapist modalities (ignored for doctors). */
  modalities?: string[];
  /** Doctor clinical specialty (ignored for therapists). */
  specialty?: string;
  years: number;
  feeInr: number | null;
}

// 28 practitioners — 16 therapists, 12 doctors — across the four South-India
// states. Names are real-world Kerala practitioner names; the vertical / city /
// specialty / fee structure is ours.
const ROWS: Row[] = [
  // ---- Therapists / psychologists (16) ----
  { name: 'Ahlam Naseer', vertical: 'THERAPIST', cityKey: 'chennai', focus: 'Anxiety & perfectionism', modalities: ['CBT', 'ACT'], years: 11, feeInr: 2200 },
  { name: 'Haneena Farhath M', vertical: 'THERAPIST', cityKey: 'coimbatore', focus: 'Trauma & grief', modalities: ['EMDR', 'IFS'], years: 9, feeInr: 2000 },
  { name: 'Niyatha Sathy', vertical: 'THERAPIST', cityKey: 'kochi', focus: 'Adolescents & mood', modalities: ['CBT', 'DBT-informed'], years: 7, feeInr: 1800 },
  { name: 'Fathima Thasnim', vertical: 'THERAPIST', cityKey: 'tvm', focus: 'Couples & relationships', modalities: ['EFT', 'Gottman Method'], years: 13, feeInr: 2600 },
  { name: 'Arwa Binth Abeebacker', vertical: 'THERAPIST', cityKey: 'hyderabad', focus: 'Depression & burnout', modalities: ['CBT', 'MBCT'], years: 8, feeInr: 2400 },
  { name: 'Anupama Surendran K', vertical: 'THERAPIST', cityKey: 'vizag', focus: 'OCD & anxiety', modalities: ['CBT', 'ERP'], years: 6, feeInr: 1600 },
  { name: 'Sharika Pramod', vertical: 'THERAPIST', cityKey: 'kozhikode', focus: 'Psychodynamic & identity', modalities: ['Psychodynamic'], years: 15, feeInr: 3000 },
  { name: 'Anshida Sheri C', vertical: 'THERAPIST', cityKey: 'madurai', focus: 'Addiction & motivation', modalities: ['MI', 'CBT'], years: 10, feeInr: 1500 },
  { name: 'Rahsha Shirin V P', vertical: 'THERAPIST', cityKey: 'mangaluru', focus: 'Postpartum & maternal', modalities: ['Supportive', 'CBT'], years: 9, feeInr: 2100 },
  { name: 'Rosemary Babu', vertical: 'THERAPIST', cityKey: 'bengaluru', focus: 'Workplace stress & ADHD', modalities: ['CBT', 'Coaching'], years: 7, feeInr: 2800 },
  { name: 'Muhsina P R', vertical: 'THERAPIST', cityKey: 'tvm', focus: 'Eating & body image', modalities: ['CBT-E', 'ACT'], years: 8, feeInr: 2300 },
  { name: 'Sophiya Babu Rajendran', vertical: 'THERAPIST', cityKey: 'hubballi', focus: 'Anger & impulse', modalities: ['DBT-informed', 'CBT'], years: 6, feeInr: 1400 },
  { name: 'Noor Fareeda', vertical: 'THERAPIST', cityKey: 'kochi', focus: 'LGBTQ+ affirming', modalities: ['Narrative', 'ACT'], years: 5, feeInr: 1900 },
  { name: 'Swaliha Hashik', vertical: 'THERAPIST', cityKey: 'mysuru', focus: 'Sleep & health anxiety', modalities: ['CBT-I', 'CBT'], years: 12, feeInr: 2500 },
  { name: 'Gayatri R', vertical: 'THERAPIST', cityKey: 'vijayawada', focus: 'Grief & life transitions', modalities: ['Existential', 'Supportive'], years: 10, feeInr: 1700 },
  { name: 'Bella Ann Oommen', vertical: 'THERAPIST', cityKey: 'thrissur', focus: 'Men & relationships', modalities: ['CBT', 'EFT'], years: 14, feeInr: 2000 },

  // ---- Doctors (12) — displayed with a "Dr." prefix ----
  { name: 'Jobin Jose Jacob', vertical: 'DOCTOR', cityKey: 'hyderabad', focus: '', specialty: 'General Medicine', years: 16, feeInr: 600 },
  { name: 'Vasudha V C', vertical: 'DOCTOR', cityKey: 'bengaluru', focus: '', specialty: 'Pediatrics', years: 11, feeInr: 700 },
  { name: 'Thasleema Nujumudheen', vertical: 'DOCTOR', cityKey: 'chennai', focus: '', specialty: 'Cardiology', years: 18, feeInr: 900 },
  { name: 'Thejas Elsa George', vertical: 'DOCTOR', cityKey: 'mangaluru', focus: '', specialty: 'Dermatology', years: 9, feeInr: 800 },
  { name: 'Surya P S', vertical: 'DOCTOR', cityKey: 'coimbatore', focus: '', specialty: 'Diabetology', years: 14, feeInr: 650 },
  { name: 'Aneetta Tomy', vertical: 'DOCTOR', cityKey: 'kochi', focus: '', specialty: 'Gynaecology', years: 13, feeInr: 750 },
  { name: 'Sahla Mohammed', vertical: 'DOCTOR', cityKey: 'salem', focus: '', specialty: 'Orthopedics', years: 12, feeInr: 700 },
  { name: 'Irine Saji', vertical: 'DOCTOR', cityKey: 'vizag', focus: '', specialty: 'ENT', years: 8, feeInr: 550 },
  { name: 'Surya Gayathri', vertical: 'DOCTOR', cityKey: 'warangal', focus: '', specialty: 'Pulmonology', years: 15, feeInr: 700 },
  { name: 'Jils P V', vertical: 'DOCTOR', cityKey: 'tvm', focus: '', specialty: 'General Medicine', years: 7, feeInr: 500 },
  { name: 'Athira Satheesh', vertical: 'DOCTOR', cityKey: 'guntur', focus: '', specialty: 'Nephrology', years: 17, feeInr: 850 },
  { name: 'Manju P C', vertical: 'DOCTOR', cityKey: 'hubballi', focus: '', specialty: 'Psychiatry', years: 10, feeInr: 650 },
];

const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.in', 'rediffmail.com'];

/** Largest-remainder split of `total` across `weights` (exact, unequal). */
function splitUnequally(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w * total) / sum);
  const floor = raw.map(Math.floor);
  let rem = total - floor.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floor];
  for (let k = 0; k < order.length && rem > 0; k++, rem--) out[order[k]!.i] += 1;
  return out;
}

// Unequal practice sizes: a few large clinics, a long tail. Scaled to sum 540.
const WEIGHTS = [
  10, 9, 8, 8, 7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2,
];
const SESSION_COUNTS = splitUnequally(WEIGHTS, TOTAL_SESSIONS);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Strip any leading "Dr." so it isn't doubled / leaked into emails. */
function bareName(name: string): string {
  return name.replace(/^dr\.?\s+/i, '').trim();
}

/** Display name: doctors get a "Dr." prefix, therapists keep the name as-is. */
function displayName(name: string, isDoctor: boolean): string {
  return isDoctor ? `Dr. ${bareName(name)}` : name;
}

/** A realistic-looking email: first.last (or just first) + index. */
function emailFor(name: string, p: number): string {
  const words = bareName(name).split(/\s+/).map(slug).filter(Boolean);
  const first = words[0] ?? 'user';
  const last = words.length > 1 ? words[words.length - 1] : '';
  const local = last ? `${first}.${last}` : first;
  return `${local}${p}@${EMAIL_DOMAINS[p % EMAIL_DOMAINS.length]}`;
}

async function purge(): Promise<void> {
  // Remove in FK-safe order. Every seeded practitioner's firebaseUid starts
  // with `seed-` (both the seed-si-* and seed-uae-* cohorts); the demo
  // fixtures use `dev-firebase-uid-*`, so this never touches them.
  const psys = await prisma.psychologist.findMany({
    where: { firebaseUid: { startsWith: 'seed-' } },
    select: { id: true },
  });
  const ids = psys.map((p) => p.id);
  if (ids.length === 0) {
    console.log('Nothing to purge.');
    return;
  }
  await prisma.session.deleteMany({ where: { psychologistId: { in: ids } } });
  await prisma.client.deleteMany({ where: { psychologistId: { in: ids } } });
  await prisma.psychologist.deleteMany({ where: { id: { in: ids } } });
  console.log(`Purged ${ids.length} seed practitioners + their clients + sessions.`);
}

// ---------------------------------------------------------------------------
// Cohort 2 — 20 UAE doctors (Dubai + Abu Dhabi), 240 consultations.
// ---------------------------------------------------------------------------
interface UaeRow {
  name: string;
  city: string;
  province: string;
  council: string; // DHA (Dubai) / DOH (Abu Dhabi) — medical-registration prefix
  specialty: string;
  langs: string[];
  years: number;
  feeInr: number;
}

const UAE_ROWS: UaeRow[] = [
  { name: 'Wael Berro', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Family Medicine', langs: ['English', 'Arabic'], years: 15, feeInr: 2500 },
  { name: 'Mohammed Ansary', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Family Medicine', langs: ['English', 'Arabic', 'Malayalam'], years: 12, feeInr: 2500 },
  { name: 'Chandan Tickoo', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'General Medicine', langs: ['English', 'Hindi', 'Arabic'], years: 18, feeInr: 2200 },
  { name: 'Jamal Khamis', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'General Practice', langs: ['English', 'Arabic'], years: 10, feeInr: 2000 },
  { name: 'Omar Rantho', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Gastroenterology', langs: ['English', 'Arabic'], years: 16, feeInr: 3500 },
  { name: 'Sweeney Johal', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Gastroenterology', langs: ['English', 'Hindi'], years: 14, feeInr: 3500 },
  { name: 'Amir Nisar', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'General Surgery', langs: ['English', 'Urdu', 'Hindi'], years: 17, feeInr: 3800 },
  { name: 'Anu Bhansal', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Gynaecology', langs: ['English', 'Hindi'], years: 13, feeInr: 3000 },
  { name: 'Eman Salah', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Dermatology', langs: ['English', 'Arabic'], years: 11, feeInr: 3200 },
  { name: 'Sudhender Kumar Chawla', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Plastic Surgery', langs: ['English', 'Hindi'], years: 20, feeInr: 5000 },
  { name: 'Ali Aldibbiat', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Endocrinology', langs: ['English', 'Arabic'], years: 15, feeInr: 3400 },
  { name: 'Mohammed Elmussareh', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Urology', langs: ['English', 'Arabic'], years: 12, feeInr: 3600 },
  { name: 'Muhammad Butt', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'General Practice', langs: ['English', 'Urdu'], years: 9, feeInr: 1800 },
  { name: 'Zarghuna', city: 'Dubai', province: 'Dubai', council: 'DHA', specialty: 'Pediatrics', langs: ['English', 'Pashto', 'Urdu'], years: 10, feeInr: 2000 },
  { name: 'Stephen R. Grobmyer', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'Oncology', langs: ['English'], years: 24, feeInr: 5000 },
  { name: 'Gopal Bhatnagar', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'Cardiac Surgery', langs: ['English', 'Hindi'], years: 25, feeInr: 5000 },
  { name: 'Khalid Al Muti', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'Cardiology', langs: ['English', 'Arabic'], years: 19, feeInr: 4200 },
  { name: 'Syed Irteza Hussain', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'Neurology', langs: ['English', 'Urdu'], years: 18, feeInr: 4000 },
  { name: 'Georges-Pascal Haber', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'Urology', langs: ['English', 'Arabic'], years: 22, feeInr: 4600 },
  { name: 'John H. Rodriguez', city: 'Abu Dhabi', province: 'Abu Dhabi', council: 'DOH', specialty: 'General Surgery', langs: ['English'], years: 21, feeInr: 4500 },
];

const UAE_WEIGHTS = [9, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1];
const UAE_SESSION_COUNTS = splitUnequally(UAE_WEIGHTS, 240);

/** Everything one practitioner (+ their clients + sessions) needs — cohort-agnostic. */
interface PSeed {
  uid: string;
  email: string;
  phone: string;
  createdAt: Date;
  fullName: string;
  isDoctor: boolean;
  langs: string[];
  city: string;
  province: string;
  years: number;
  feeInr: number | null;
  acceptingNew: boolean;
  focus: string; // therapist
  modalities: string[]; // therapist
  specialty: string; // doctor
  rciNumber: string; // therapist real / doctor placeholder
  medicalRegNumber: string | null;
  sessionCount: number;
  clientPrefix: string; // e.g. `seed-sic-0`
  sessionPrefix: string; // e.g. `seed-sess-0`
  rngSeed: number;
  now: number;
}

async function seedPractitioner(a: PSeed): Promise<{ sessions: number; last7d: number; clients: number }> {
  const langsIso = a.langs.map((l) => ISO_BY_LANG[l] ?? 'en');
  const firstIso = langsIso[0] ?? 'en';

  const common = {
    fullName: a.fullName,
    phone: a.phone,
    status: 'ACTIVE' as const,
    onboardingCompletedAt: a.createdAt,
    vertical: (a.isDoctor ? 'DOCTOR' : 'THERAPIST') as Vertical,
    languages: a.langs,
    locationCity: a.city,
    locationProvince: a.province,
    yearsOfExperience: a.years,
    sessionFeeInr: a.feeInr,
    isAcceptingNewClients: a.acceptingNew,
  };

  const roleFields = a.isDoctor
    ? {
        // rciNumber is NOT NULL + unique; doctors carry a placeholder + a real
        // medical-registration number (mirrors prisma/seed.ts).
        rciNumber: a.rciNumber,
        medicalRegNumber: a.medicalRegNumber,
        specialty: a.specialty,
        headline: `${a.specialty} — ${a.city}.`,
        bio: `${a.specialty} consultant in ${a.city}, ${a.years} years in practice.`,
      }
    : {
        rciNumber: a.rciNumber,
        rciVerifiedAt: a.createdAt,
        headline: `${a.focus} — ${a.city}.`,
        bio: `${a.years} years of practice in ${a.city}, working with ${a.focus.toLowerCase()}. Sees clients in ${a.langs.slice(0, 2).join(' and ')}.`,
        specialties: a.focus.split(' & '),
        modalities: a.modalities,
      };

  const psy = await prisma.psychologist.upsert({
    where: { firebaseUid: a.uid },
    update: { ...common, ...roleFields },
    create: { firebaseUid: a.uid, email: a.email, createdAt: a.createdAt, ...common, ...roleFields },
  });

  // --- Client pool ---
  const numClients = Math.max(4, Math.min(20, Math.ceil(a.sessionCount / 3)));
  const clientIds: string[] = [];
  for (let c = 0; c < numClients; c++) {
    const cuid = `${a.clientPrefix}-${c}`;
    const cli = await prisma.client.upsert({
      where: { clientFirebaseUid: cuid },
      update: {},
      create: {
        psychologistId: psy.id,
        clientFirebaseUid: cuid,
        isDemo: false,
        status: 'ACTIVE',
        preferredLanguage: firstIso,
        spokenLanguages: langsIso,
        // Opaque placeholders (no tenant DEK in a seed) — the admin console
        // never renders client PHI, so blank-on-decrypt is fine.
        fullNameEncrypted: `seed:Patient ${a.clientPrefix}-${c}`,
        presentingConcerns: a.isDoctor ? 'OPD follow-up.' : `${a.focus} — ongoing work.`,
        preferredModality: a.isDoctor ? null : (a.modalities[0] ?? 'CBT'),
      },
    });
    clientIds.push(cli.id);
  }

  // --- Sessions: COMPLETED consultations across the last 15 days ---
  const rng = makeRng(a.rngSeed);
  let sessions = 0;
  let last7d = 0;
  for (let j = 0; j < a.sessionCount; j++) {
    const clientId = clientIds[j % numClients]!;
    const dayOffset = Math.floor(rng() * WINDOW_DAYS); // 0..14
    const hour = 9 + Math.floor(rng() * 10); // 9..18
    const minute = Math.floor(rng() * 12) * 5;
    const when = new Date(a.now - dayOffset * DAY_MS);
    when.setHours(hour, minute, 0, 0);
    const ended = new Date(when.getTime() + (25 + Math.floor(rng() * 30)) * 60 * 1000);

    const isFirstForClient = j < numClients;
    const kind = isFirstForClient ? 'INTAKE' : j % 7 === 0 ? 'REVIEW' : 'TREATMENT';

    const sid = `${a.sessionPrefix}-${j}`;
    await prisma.session.upsert({
      where: { id: sid },
      update: {},
      create: {
        id: sid,
        clientId,
        psychologistId: psy.id,
        status: 'COMPLETED',
        kind,
        scheduledAt: when,
        startedAt: when,
        endedAt: ended,
        createdAt: when,
        language: firstIso,
        spokenLanguages: langsIso,
        ...(a.isDoctor
          ? { captureMode: j % 2 === 0 ? 'LIVE' : 'DICTATE', tokenNumber: (j % 40) + 1 }
          : { modality: a.modalities[0]?.toUpperCase().includes('CBT') ? 'CBT' : 'SUPPORTIVE' }),
      },
    });
    sessions += 1;
    if (a.now - when.getTime() <= 7 * DAY_MS) last7d += 1;
  }
  return { sessions, last7d, clients: numClients };
}

async function main(): Promise<void> {
  if (process.argv.includes('--purge')) {
    await purge();
    return;
  }

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  let sessionsMade = 0;
  let sessionsLast7d = 0;
  let clientsMade = 0;
  const perVertical = { THERAPIST: 0, DOCTOR: 0 };

  // --- Cohort 1: South-India practitioners (16 therapist + 12 doctor), 540 sessions ---
  for (let p = 0; p < ROWS.length; p++) {
    const r = ROWS[p]!;
    const spec = CITIES[r.cityKey as string]!;
    const isDoctor = r.vertical === 'DOCTOR';
    const res = await seedPractitioner({
      // Index-based id (stable across renames — a rename updates in place).
      uid: `seed-si-${p}`,
      email: emailFor(r.name, p),
      phone: `+9198${String(40000000 + p * 137).padStart(8, '0')}`,
      // Signups spread over the last ~4 months so funnel cohorts aren't all "this month".
      createdAt: new Date(now - (14 + p * 4) * DAY_MS),
      fullName: displayName(r.name, isDoctor),
      isDoctor,
      langs: spec.langs,
      city: spec.city,
      province: spec.province,
      years: r.years,
      feeInr: r.feeInr,
      acceptingNew: p % 5 !== 0,
      focus: r.focus,
      modalities: r.modalities ?? [],
      specialty: r.specialty ?? 'General Medicine',
      rciNumber: isDoctor ? `PENDING-seed-si-${p}` : `SI-A${1000 + p}`,
      medicalRegNumber: isDoctor ? `${spec.council}-${20000 + p * 311}` : null,
      sessionCount: SESSION_COUNTS[p]!,
      clientPrefix: `seed-sic-${p}`,
      sessionPrefix: `seed-sess-${p}`,
      rngSeed: 1000 + p * 7919,
      now,
    });
    sessionsMade += res.sessions;
    sessionsLast7d += res.last7d;
    clientsMade += res.clients;
    perVertical[r.vertical] += 1;
  }

  // --- Cohort 2: UAE doctors (Dubai + Abu Dhabi), 240 sessions. Joined in the
  // last ~2 days (newest = last-listed) so the batch sorts to the TOP of the
  // accounts list (which is createdAt DESC), Dr. John H. Rodriguez first. ---
  for (let u = 0; u < UAE_ROWS.length; u++) {
    const d = UAE_ROWS[u]!;
    const res = await seedPractitioner({
      uid: `seed-uae-${u}`,
      email: emailFor(d.name, 100 + u),
      phone: `+97150${String(1000000 + u * 273).padStart(7, '0')}`,
      createdAt: new Date(now - (UAE_ROWS.length - u) * 2 * HOUR),
      fullName: `Dr. ${bareName(d.name)}`,
      isDoctor: true,
      langs: d.langs,
      city: d.city,
      province: d.province,
      years: d.years,
      feeInr: d.feeInr,
      acceptingNew: u % 4 !== 0,
      focus: '',
      modalities: [],
      specialty: d.specialty,
      rciNumber: `PENDING-seed-uae-${u}`,
      medicalRegNumber: `${d.council}-${50000 + u * 137}`,
      sessionCount: UAE_SESSION_COUNTS[u]!,
      clientPrefix: `seed-uac-${u}`,
      sessionPrefix: `seed-uas-${u}`,
      rngSeed: 5000 + u * 7919,
      now,
    });
    sessionsMade += res.sessions;
    sessionsLast7d += res.last7d;
    clientsMade += res.clients;
    perVertical.DOCTOR += 1;
  }

  const totalPractitioners = ROWS.length + UAE_ROWS.length;
  console.log('\nSeed complete.');
  console.log(`  Practitioners: ${totalPractitioners} (${perVertical.THERAPIST} therapist · ${perVertical.DOCTOR} doctor)`);
  console.log(`  Clients:       ${clientsMade}`);
  console.log(`  Sessions:      ${sessionsMade} over ${WINDOW_DAYS} days (${sessionsLast7d} in the last 7d)`);
  console.log(`    South India: ${SESSION_COUNTS.reduce((a, b) => a + b, 0)} across ${ROWS.length} — [${SESSION_COUNTS.slice().sort((a, b) => b - a).join(', ')}]`);
  console.log(`    UAE:         ${UAE_SESSION_COUNTS.reduce((a, b) => a + b, 0)} across ${UAE_ROWS.length} — [${UAE_SESSION_COUNTS.slice().sort((a, b) => b - a).join(', ')}]`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
