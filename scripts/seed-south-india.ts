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
};

type Vertical = 'THERAPIST' | 'DOCTOR';

interface Row {
  first: string;
  last: string;
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

// 28 practitioners — 16 therapists, 12 doctors — across the four South-India states.
const ROWS: Row[] = [
  // ---- Therapists (16) ----
  { first: 'Ananya', last: 'Iyer', vertical: 'THERAPIST', cityKey: 'chennai', focus: 'Anxiety & perfectionism', modalities: ['CBT', 'ACT'], years: 11, feeInr: 2200 },
  { first: 'Karthik', last: 'Subramanian', vertical: 'THERAPIST', cityKey: 'coimbatore', focus: 'Trauma & grief', modalities: ['EMDR', 'IFS'], years: 9, feeInr: 2000 },
  { first: 'Divya', last: 'Nair', vertical: 'THERAPIST', cityKey: 'kochi', focus: 'Adolescents & mood', modalities: ['CBT', 'DBT-informed'], years: 7, feeInr: 1800 },
  { first: 'Rahul', last: 'Menon', vertical: 'THERAPIST', cityKey: 'tvm', focus: 'Couples & relationships', modalities: ['EFT', 'Gottman Method'], years: 13, feeInr: 2600 },
  { first: 'Meenakshi', last: 'Rao', vertical: 'THERAPIST', cityKey: 'hyderabad', focus: 'Depression & burnout', modalities: ['CBT', 'MBCT'], years: 8, feeInr: 2400 },
  { first: 'Sandeep', last: 'Reddy', vertical: 'THERAPIST', cityKey: 'vizag', focus: 'OCD & anxiety', modalities: ['CBT', 'ERP'], years: 6, feeInr: 1600 },
  { first: 'Lakshmi', last: 'Pillai', vertical: 'THERAPIST', cityKey: 'kozhikode', focus: 'Psychodynamic & identity', modalities: ['Psychodynamic'], years: 15, feeInr: 3000 },
  { first: 'Vignesh', last: 'Raman', vertical: 'THERAPIST', cityKey: 'madurai', focus: 'Addiction & motivation', modalities: ['MI', 'CBT'], years: 10, feeInr: 1500 },
  { first: 'Deepa', last: 'Kamath', vertical: 'THERAPIST', cityKey: 'mangaluru', focus: 'Postpartum & maternal', modalities: ['Supportive', 'CBT'], years: 9, feeInr: 2100 },
  { first: 'Harish', last: 'Gowda', vertical: 'THERAPIST', cityKey: 'bengaluru', focus: 'Workplace stress & ADHD', modalities: ['CBT', 'Coaching'], years: 7, feeInr: 2800 },
  { first: 'Sneha', last: 'Varma', vertical: 'THERAPIST', cityKey: 'tvm', focus: 'Eating & body image', modalities: ['CBT-E', 'ACT'], years: 8, feeInr: 2300 },
  { first: 'Praveen', last: 'Acharya', vertical: 'THERAPIST', cityKey: 'hubballi', focus: 'Anger & impulse', modalities: ['DBT-informed', 'CBT'], years: 6, feeInr: 1400 },
  { first: 'Anjali', last: 'Krishnan', vertical: 'THERAPIST', cityKey: 'kochi', focus: 'LGBTQ+ affirming', modalities: ['Narrative', 'ACT'], years: 5, feeInr: 1900 },
  { first: 'Naveen', last: 'Shetty', vertical: 'THERAPIST', cityKey: 'mysuru', focus: 'Sleep & health anxiety', modalities: ['CBT-I', 'CBT'], years: 12, feeInr: 2500 },
  { first: 'Gayathri', last: 'Prasad', vertical: 'THERAPIST', cityKey: 'vijayawada', focus: 'Grief & life transitions', modalities: ['Existential', 'Supportive'], years: 10, feeInr: 1700 },
  { first: 'Suresh', last: 'Kurup', vertical: 'THERAPIST', cityKey: 'thrissur', focus: 'Men & relationships', modalities: ['CBT', 'EFT'], years: 14, feeInr: 2000 },

  // ---- Doctors (12) ----
  { first: 'Ramesh', last: 'Naidu', vertical: 'DOCTOR', cityKey: 'hyderabad', focus: '', specialty: 'General Medicine', years: 16, feeInr: 600 },
  { first: 'Priyanka', last: 'Hegde', vertical: 'DOCTOR', cityKey: 'bengaluru', focus: '', specialty: 'Pediatrics', years: 11, feeInr: 700 },
  { first: 'Vijay', last: 'Chandran', vertical: 'DOCTOR', cityKey: 'chennai', focus: '', specialty: 'Cardiology', years: 18, feeInr: 900 },
  { first: 'Kavya', last: 'Bhat', vertical: 'DOCTOR', cityKey: 'mangaluru', focus: '', specialty: 'Dermatology', years: 9, feeInr: 800 },
  { first: 'Balaji', last: 'Murthy', vertical: 'DOCTOR', cityKey: 'coimbatore', focus: '', specialty: 'Diabetology', years: 14, feeInr: 650 },
  { first: 'Revathi', last: 'Pillai', vertical: 'DOCTOR', cityKey: 'kochi', focus: '', specialty: 'Gynaecology', years: 13, feeInr: 750 },
  { first: 'Sathish', last: 'Kumar', vertical: 'DOCTOR', cityKey: 'salem', focus: '', specialty: 'Orthopedics', years: 12, feeInr: 700 },
  { first: 'Aishwarya', last: 'Rao', vertical: 'DOCTOR', cityKey: 'vizag', focus: '', specialty: 'ENT', years: 8, feeInr: 550 },
  { first: 'Ganesh', last: 'Iyengar', vertical: 'DOCTOR', cityKey: 'warangal', focus: '', specialty: 'Pulmonology', years: 15, feeInr: 700 },
  { first: 'Nithya', last: 'Menon', vertical: 'DOCTOR', cityKey: 'tvm', focus: '', specialty: 'General Medicine', years: 7, feeInr: 500 },
  { first: 'Manoj', last: 'Reddy', vertical: 'DOCTOR', cityKey: 'guntur', focus: '', specialty: 'Nephrology', years: 17, feeInr: 850 },
  { first: 'Shruti', last: 'Kulkarni', vertical: 'DOCTOR', cityKey: 'hubballi', focus: '', specialty: 'Psychiatry', years: 10, feeInr: 650 },
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

async function purge(): Promise<void> {
  // Remove in FK-safe order. All seed rows share the seed-si-* id convention.
  const psys = await prisma.psychologist.findMany({
    where: { firebaseUid: { startsWith: 'seed-si-' } },
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
  console.log(`Purged ${ids.length} seed-si practitioners + their clients + sessions.`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--purge')) {
    await purge();
    return;
  }

  const now = Date.now();
  let sessionsMade = 0;
  let sessionsLast7d = 0;
  let clientsMade = 0;
  const perVertical = { THERAPIST: 0, DOCTOR: 0 };

  for (let p = 0; p < ROWS.length; p++) {
    const r = ROWS[p]!;
    const spec = CITIES[r.cityKey as string]!;
    const uid = `seed-si-${p}-${slug(r.first)}-${slug(r.last)}`;
    const email = `${slug(r.first)}.${slug(r.last)}${p}@${EMAIL_DOMAINS[p % EMAIL_DOMAINS.length]}`;
    const phone = `+9198${String(40000000 + p * 137).padStart(8, '0')}`;
    const isDoctor = r.vertical === 'DOCTOR';
    // Signups spread over the last ~4 months so funnel cohorts aren't all "this month".
    const createdAt = new Date(now - (14 + p * 4) * DAY_MS);

    const common = {
      fullName: `Dr. ${r.first} ${r.last}`,
      phone,
      status: 'ACTIVE' as const,
      onboardingCompletedAt: createdAt,
      vertical: r.vertical,
      languages: spec.langs,
      locationCity: spec.city,
      locationProvince: spec.province,
      yearsOfExperience: r.years,
      sessionFeeInr: r.feeInr,
      isAcceptingNewClients: p % 5 !== 0,
    };

    const therapistFields = isDoctor
      ? {}
      : {
          rciNumber: `SI-A${1000 + p}`,
          rciVerifiedAt: createdAt,
          headline: `${r.focus} — ${spec.city}.`,
          bio: `${r.years} years of practice in ${spec.city}, working with ${r.focus.toLowerCase()}. Sees clients in ${spec.langs.slice(0, 2).join(' and ')}.`,
          specialties: r.focus.split(' & '),
          modalities: r.modalities ?? [],
        };

    const doctorFields = isDoctor
      ? {
          // rciNumber is NOT NULL + unique; doctors carry a placeholder + a real
          // medical-registration number (mirrors prisma/seed.ts).
          rciNumber: `PENDING-${uid}`,
          medicalRegNumber: `${spec.council}-${20000 + p * 311}`,
          specialty: r.specialty ?? 'General Medicine',
          headline: `${r.specialty} — ${spec.city}.`,
          bio: `${r.specialty} consultant in ${spec.city}, ${r.years} years in practice.`,
        }
      : {};

    const psy = await prisma.psychologist.upsert({
      where: { firebaseUid: uid },
      update: { ...common, ...therapistFields, ...doctorFields },
      create: {
        firebaseUid: uid,
        email,
        createdAt,
        ...common,
        ...therapistFields,
        ...doctorFields,
      },
    });
    perVertical[r.vertical] += 1;

    // --- Client pool for this practitioner ---
    const count = SESSION_COUNTS[p]!;
    const numClients = Math.max(4, Math.min(20, Math.ceil(count / 3)));
    const clientIds: string[] = [];
    for (let c = 0; c < numClients; c++) {
      const cuid = `seed-sic-${p}-${c}`;
      const cli = await prisma.client.upsert({
        where: { clientFirebaseUid: cuid },
        update: {},
        create: {
          psychologistId: psy.id,
          clientFirebaseUid: cuid,
          isDemo: false,
          status: 'ACTIVE',
          preferredLanguage: ISO_BY_LANG[spec.langs[0]!] ?? 'en',
          spokenLanguages: spec.langs.map((l) => ISO_BY_LANG[l] ?? 'en'),
          // Opaque placeholders (no tenant DEK in a seed) — the admin console
          // never renders client PHI, so blank-on-decrypt is fine.
          fullNameEncrypted: `seed:Patient ${p}-${c}`,
          presentingConcerns: isDoctor ? 'OPD follow-up.' : `${r.focus} — ongoing work.`,
          preferredModality: isDoctor ? null : (r.modalities?.[0] ?? 'CBT'),
        },
      });
      clientIds.push(cli.id);
      clientsMade += 1;
    }

    // --- Sessions: `count` COMPLETED consultations across the last 15 days ---
    const rng = makeRng(1000 + p * 7919);
    const lang = ISO_BY_LANG[spec.langs[0]!] ?? 'en';
    for (let j = 0; j < count; j++) {
      const clientIdx = j % numClients;
      const clientId = clientIds[clientIdx]!;
      const dayOffset = Math.floor(rng() * WINDOW_DAYS); // 0..14
      const hour = 9 + Math.floor(rng() * 10); // 9..18
      const minute = Math.floor(rng() * 12) * 5;
      const when = new Date(now - dayOffset * DAY_MS);
      when.setHours(hour, minute, 0, 0);
      const durationMin = 25 + Math.floor(rng() * 30);
      const ended = new Date(when.getTime() + durationMin * 60 * 1000);

      // First visit for a client = INTAKE; occasional REVIEW; else TREATMENT.
      const isFirstForClient = j < numClients;
      const kind = isFirstForClient ? 'INTAKE' : j % 7 === 0 ? 'REVIEW' : 'TREATMENT';

      const sid = `seed-sess-${p}-${j}`;
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
          language: lang,
          spokenLanguages: spec.langs.map((l) => ISO_BY_LANG[l] ?? 'en'),
          ...(isDoctor
            ? { captureMode: j % 2 === 0 ? 'LIVE' : 'DICTATE', tokenNumber: (j % 40) + 1 }
            : { modality: r.modalities?.[0]?.toUpperCase().includes('CBT') ? 'CBT' : 'SUPPORTIVE' }),
        },
      });
      sessionsMade += 1;
      if (now - when.getTime() <= 7 * DAY_MS) sessionsLast7d += 1;
    }

    console.log(
      `  ${String(p + 1).padStart(2)}. ${psy.fullName.padEnd(24)} ${r.vertical.padEnd(9)} ${spec.city.padEnd(20)} ${count} sessions / ${numClients} clients`,
    );
  }

  console.log('\nSeed complete.');
  console.log(`  Practitioners: ${ROWS.length} (${perVertical.THERAPIST} therapist · ${perVertical.DOCTOR} doctor)`);
  console.log(`  Clients:       ${clientsMade}`);
  console.log(`  Sessions:      ${sessionsMade} over ${WINDOW_DAYS} days (${sessionsLast7d} in the last 7d)`);
  console.log(`  Distribution:  [${SESSION_COUNTS.slice().sort((a, b) => b - a).join(', ')}]  (sum ${SESSION_COUNTS.reduce((a, b) => a + b, 0)})`);
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
