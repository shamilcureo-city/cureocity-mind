/**
 * Doctor-vertical demo dataset — 30 doctors, 386 encounters.
 *
 * WHY THIS IS SYNTHETIC. The obvious shortcut is to scrape a public Indian
 * doctor directory. Don't. Those are real, licensed, identifiable people:
 * seeding them would create practitioner accounts under their names carrying
 * FABRICATED medical registration numbers (a real credential), and hang
 * hundreds of invented clinical encounters off them — in a public repo. Every
 * identity below is invented. The realism comes from getting the SHAPE right:
 * region-matched names, the specialty mix that actually staffs an Indian OPD,
 * and a long-tailed encounter distribution rather than 30 doctors with 13
 * consults each.
 *
 * COLLISION SAFETY. `prisma db seed` was removed from prod deploys because
 * its fixed emails and RCI numbers collided with real signups (CLAUDE.md §7,
 * the 2026-06-20 incident). So this is a SEPARATE, opt-in script — never
 * wired into a build — and every unique field is unmistakably synthetic:
 * `@demo.cureocity.in` emails, `XX-DEMO-nnnnn` registration numbers, and
 * +9199000xxxxx phones. None can collide with a real practitioner.
 *
 * Run:
 *   DATABASE_URL=... pnpm --filter @cureocity/web exec tsx scripts/seed-doctor-demo.ts
 *
 * Flags:
 *   --wipe       remove a previous run of this script first (matched on the
 *                demo email domain), so re-running is clean rather than additive
 *   --not-demo   leave Client.isDemo false, so the seeded patients count
 *                toward dashboard metrics and the trial cap (default: true,
 *                which keeps demo data out of billing and the competency rollups)
 *   --as-bypass  hand the AUTH_BYPASS identity to the busiest seeded doctor,
 *                so `AUTH_BYPASS=true pnpm dev` lands straight in their clinic.
 *                Without this you log in as the seeded THERAPIST and — because
 *                every row here is tenant-scoped — see none of this data. The
 *                previous holder of that uid is parked, not deleted.
 *
 * Idempotent: doctors upsert on firebaseUid; encounters are rebuilt only when
 * --wipe is passed, so a bare re-run is a no-op on the roster.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { DEV_BYPASS_FIREBASE_UID } from '../lib/auth-server';
import { encryptForTenant } from '../lib/tenant-crypto';

const prisma = new PrismaClient();

const DEMO_EMAIL_DOMAIN = 'demo.cureocity.in';
const WIPE = process.argv.includes('--wipe');
const IS_DEMO = !process.argv.includes('--not-demo');
const AS_BYPASS = process.argv.includes('--as-bypass');
/** Where the previous holder of the bypass uid is moved to, so nothing is lost. */
const PARKED_UID = `${DEV_BYPASS_FIREBASE_UID}--parked`;

// ---------------------------------------------------------------------------
// Deterministic RNG. A seeded PRNG (not Math.random) so two runs produce the
// same dataset — a demo you can screenshot, describe, and reproduce.
// ---------------------------------------------------------------------------
let rngState = 0x2f6e2b1;
function rnd(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return ((rngState >>> 0) % 1_000_000) / 1_000_000;
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}
function int(lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// The roster. Names are region-matched to the city — a Kochi paediatrician
// reads Malayali, a Madurai orthopod reads Tamil — because a roster where
// every name could be from anywhere is the tell that data is generated.
// Specialty mix is weighted to what actually staffs Indian OPDs: General
// Medicine and Paediatrics dominate; the super-specialties are the tail.
// ---------------------------------------------------------------------------
interface DoctorSeed {
  fullName: string;
  specialty: string;
  city: string;
  state: string;
  /** State medical council prefix — a real FORMAT with an unmistakably fake number. */
  councilPrefix: string;
  clinicName: string;
  clinicAddress: string;
  languages: string[];
  yearsOfExperience: number;
}

const DOCTORS: DoctorSeed[] = [
  // ── Kerala ────────────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Anil Kuruvilla',
    specialty: 'General Medicine',
    city: 'Kochi',
    state: 'Kerala',
    councilPrefix: 'KL',
    clinicName: 'Marine Drive Polyclinic',
    clinicAddress: 'Shanmugham Road, Marine Drive, Kochi 682031',
    languages: ['English', 'Malayalam'],
    yearsOfExperience: 18,
  },
  {
    fullName: 'Dr. Lakshmi Warrier',
    specialty: 'Paediatrics',
    city: 'Thrissur',
    state: 'Kerala',
    councilPrefix: 'KL',
    clinicName: 'Ammu Child Care Centre',
    clinicAddress: 'Round West, Swaraj Round, Thrissur 680001',
    languages: ['English', 'Malayalam', 'Tamil'],
    yearsOfExperience: 12,
  },
  {
    fullName: 'Dr. Faisal Rahman',
    specialty: 'Cardiology',
    city: 'Kozhikode',
    state: 'Kerala',
    councilPrefix: 'KL',
    clinicName: 'Malabar Heart Clinic',
    clinicAddress: 'Mavoor Road, Kozhikode 673004',
    languages: ['English', 'Malayalam', 'Hindi'],
    yearsOfExperience: 21,
  },
  {
    fullName: 'Dr. Sreelekha Pillai',
    specialty: 'Obstetrics & Gynaecology',
    city: 'Thiruvananthapuram',
    state: 'Kerala',
    councilPrefix: 'KL',
    clinicName: 'Anantha Women’s Clinic',
    clinicAddress: 'Vazhuthacaud, Thiruvananthapuram 695014',
    languages: ['English', 'Malayalam'],
    yearsOfExperience: 15,
  },
  // ── Tamil Nadu ────────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Karthikeyan Subramanian',
    specialty: 'Orthopaedics',
    city: 'Madurai',
    state: 'Tamil Nadu',
    councilPrefix: 'TN',
    clinicName: 'Meenakshi Bone & Joint Clinic',
    clinicAddress: 'West Masi Street, Madurai 625001',
    languages: ['English', 'Tamil'],
    yearsOfExperience: 16,
  },
  {
    fullName: 'Dr. Revathi Balasubramanian',
    specialty: 'Dermatology',
    city: 'Chennai',
    state: 'Tamil Nadu',
    councilPrefix: 'TN',
    clinicName: 'Adyar Skin & Hair Clinic',
    clinicAddress: 'Sardar Patel Road, Adyar, Chennai 600020',
    languages: ['English', 'Tamil', 'Telugu'],
    yearsOfExperience: 9,
  },
  {
    fullName: 'Dr. Senthil Murugan',
    specialty: 'General Medicine',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    councilPrefix: 'TN',
    clinicName: 'Kovai Family Care',
    clinicAddress: 'Avinashi Road, Peelamedu, Coimbatore 641004',
    languages: ['English', 'Tamil'],
    yearsOfExperience: 24,
  },
  // ── Karnataka ─────────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Vinaya Hegde',
    specialty: 'ENT',
    city: 'Bengaluru',
    state: 'Karnataka',
    councilPrefix: 'KA',
    clinicName: 'Jayanagar ENT Centre',
    clinicAddress: '9th Block, Jayanagar, Bengaluru 560069',
    languages: ['English', 'Kannada', 'Hindi'],
    yearsOfExperience: 11,
  },
  {
    fullName: 'Dr. Manjunath Gowda',
    specialty: 'General Surgery',
    city: 'Mysuru',
    state: 'Karnataka',
    councilPrefix: 'KA',
    clinicName: 'Chamundi Surgical Clinic',
    clinicAddress: 'Sayyaji Rao Road, Mysuru 570001',
    languages: ['English', 'Kannada'],
    yearsOfExperience: 19,
  },
  {
    fullName: 'Dr. Deepa Shetty',
    specialty: 'Endocrinology',
    city: 'Mangaluru',
    state: 'Karnataka',
    councilPrefix: 'KA',
    clinicName: 'Coastal Diabetes & Thyroid Centre',
    clinicAddress: 'Balmatta Road, Mangaluru 575002',
    languages: ['English', 'Kannada', 'Tulu'],
    yearsOfExperience: 13,
  },
  // ── Telangana / Andhra ────────────────────────────────────────────────────
  {
    fullName: 'Dr. Srinivas Reddy',
    specialty: 'General Medicine',
    city: 'Hyderabad',
    state: 'Telangana',
    councilPrefix: 'TG',
    clinicName: 'Banjara Family Clinic',
    clinicAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034',
    languages: ['English', 'Telugu', 'Hindi', 'Urdu'],
    yearsOfExperience: 20,
  },
  {
    fullName: 'Dr. Padmaja Rao',
    specialty: 'Paediatrics',
    city: 'Vijayawada',
    state: 'Andhra Pradesh',
    councilPrefix: 'AP',
    clinicName: 'Little Steps Children’s Clinic',
    clinicAddress: 'MG Road, Labbipet, Vijayawada 520010',
    languages: ['English', 'Telugu'],
    yearsOfExperience: 8,
  },
  {
    fullName: 'Dr. Harish Chandra Varma',
    specialty: 'Gastroenterology',
    city: 'Visakhapatnam',
    state: 'Andhra Pradesh',
    councilPrefix: 'AP',
    clinicName: 'Vizag Digestive Care',
    clinicAddress: 'Dwaraka Nagar, Visakhapatnam 530016',
    languages: ['English', 'Telugu', 'Hindi'],
    yearsOfExperience: 14,
  },
  // ── Maharashtra ───────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Aditi Deshpande',
    specialty: 'Psychiatry',
    city: 'Pune',
    state: 'Maharashtra',
    councilPrefix: 'MH',
    clinicName: 'Deccan Mind Care',
    clinicAddress: 'Fergusson College Road, Pune 411004',
    languages: ['English', 'Marathi', 'Hindi'],
    yearsOfExperience: 10,
  },
  {
    fullName: 'Dr. Rajesh Kulkarni',
    specialty: 'Pulmonology',
    city: 'Mumbai',
    state: 'Maharashtra',
    councilPrefix: 'MH',
    clinicName: 'Dadar Chest Clinic',
    clinicAddress: 'Ranade Road, Dadar West, Mumbai 400028',
    languages: ['English', 'Marathi', 'Hindi'],
    yearsOfExperience: 17,
  },
  {
    fullName: 'Dr. Snehal Patil',
    specialty: 'Obstetrics & Gynaecology',
    city: 'Nashik',
    state: 'Maharashtra',
    councilPrefix: 'MH',
    clinicName: 'Godavari Women’s Health',
    clinicAddress: 'College Road, Nashik 422005',
    languages: ['English', 'Marathi', 'Hindi'],
    yearsOfExperience: 12,
  },
  {
    fullName: 'Dr. Prashant Wankhede',
    specialty: 'Orthopaedics',
    city: 'Nagpur',
    state: 'Maharashtra',
    councilPrefix: 'MH',
    clinicName: 'Orange City Ortho',
    clinicAddress: 'Dharampeth, Nagpur 440010',
    languages: ['English', 'Marathi', 'Hindi'],
    yearsOfExperience: 15,
  },
  // ── Gujarat ───────────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Nirav Patel',
    specialty: 'General Medicine',
    city: 'Ahmedabad',
    state: 'Gujarat',
    councilPrefix: 'GJ',
    clinicName: 'Satellite Health Point',
    clinicAddress: 'Jodhpur Cross Road, Satellite, Ahmedabad 380015',
    languages: ['English', 'Gujarati', 'Hindi'],
    yearsOfExperience: 22,
  },
  {
    fullName: 'Dr. Hetal Trivedi',
    specialty: 'Ophthalmology',
    city: 'Surat',
    state: 'Gujarat',
    councilPrefix: 'GJ',
    clinicName: 'Drishti Eye Centre',
    clinicAddress: 'Ghod Dod Road, Surat 395007',
    languages: ['English', 'Gujarati', 'Hindi'],
    yearsOfExperience: 11,
  },
  // ── Rajasthan / MP ────────────────────────────────────────────────────────
  {
    fullName: 'Dr. Vikram Rathore',
    specialty: 'General Surgery',
    city: 'Jaipur',
    state: 'Rajasthan',
    councilPrefix: 'RJ',
    clinicName: 'Pink City Surgical',
    clinicAddress: 'Bapu Nagar, Jaipur 302015',
    languages: ['English', 'Hindi', 'Rajasthani'],
    yearsOfExperience: 16,
  },
  {
    fullName: 'Dr. Meenakshi Chouhan',
    specialty: 'Paediatrics',
    city: 'Indore',
    state: 'Madhya Pradesh',
    councilPrefix: 'MP',
    clinicName: 'Sunshine Kids Clinic',
    clinicAddress: 'Vijay Nagar, Indore 452010',
    languages: ['English', 'Hindi'],
    yearsOfExperience: 7,
  },
  // ── Delhi NCR / Punjab / Haryana ──────────────────────────────────────────
  {
    fullName: 'Dr. Arjun Malhotra',
    specialty: 'Cardiology',
    city: 'New Delhi',
    state: 'Delhi',
    councilPrefix: 'DL',
    clinicName: 'Greater Kailash Heart Care',
    clinicAddress: 'M Block Market, Greater Kailash I, New Delhi 110048',
    languages: ['English', 'Hindi', 'Punjabi'],
    yearsOfExperience: 23,
  },
  {
    fullName: 'Dr. Ritu Chadha',
    specialty: 'Dermatology',
    city: 'Gurugram',
    state: 'Haryana',
    councilPrefix: 'HR',
    clinicName: 'Cyber City Skin Studio',
    clinicAddress: 'Sector 29, Gurugram 122002',
    languages: ['English', 'Hindi'],
    yearsOfExperience: 9,
  },
  {
    fullName: 'Dr. Harpreet Singh Bedi',
    specialty: 'General Medicine',
    city: 'Ludhiana',
    state: 'Punjab',
    councilPrefix: 'PB',
    clinicName: 'Model Town Medical Hall',
    clinicAddress: 'Model Town Extension, Ludhiana 141002',
    languages: ['English', 'Punjabi', 'Hindi'],
    yearsOfExperience: 19,
  },
  {
    fullName: 'Dr. Nikhil Bansal',
    specialty: 'Nephrology',
    city: 'Chandigarh',
    state: 'Chandigarh',
    councilPrefix: 'CH',
    clinicName: 'Sector 17 Kidney Clinic',
    clinicAddress: 'Sector 17-C, Chandigarh 160017',
    languages: ['English', 'Hindi', 'Punjabi'],
    yearsOfExperience: 13,
  },
  // ── UP / Bihar / Jharkhand ────────────────────────────────────────────────
  {
    fullName: 'Dr. Shalini Srivastava',
    specialty: 'Obstetrics & Gynaecology',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    councilPrefix: 'UP',
    clinicName: 'Hazratganj Mother & Child',
    clinicAddress: 'Ashok Marg, Hazratganj, Lucknow 226001',
    languages: ['English', 'Hindi'],
    yearsOfExperience: 14,
  },
  {
    fullName: 'Dr. Abhishek Kumar Jha',
    specialty: 'General Medicine',
    city: 'Patna',
    state: 'Bihar',
    councilPrefix: 'BR',
    clinicName: 'Boring Road Clinic',
    clinicAddress: 'Boring Road, Patna 800001',
    languages: ['English', 'Hindi', 'Bhojpuri'],
    yearsOfExperience: 10,
  },
  // ── East / North-East ─────────────────────────────────────────────────────
  {
    fullName: 'Dr. Sohini Chatterjee',
    specialty: 'Neurology',
    city: 'Kolkata',
    state: 'West Bengal',
    councilPrefix: 'WB',
    clinicName: 'Ballygunge Neuro Clinic',
    clinicAddress: 'Gariahat Road, Ballygunge, Kolkata 700019',
    languages: ['English', 'Bengali', 'Hindi'],
    yearsOfExperience: 18,
  },
  {
    fullName: 'Dr. Debashish Mohanty',
    specialty: 'Urology',
    city: 'Bhubaneswar',
    state: 'Odisha',
    councilPrefix: 'OD',
    clinicName: 'Kalinga Urology Centre',
    clinicAddress: 'Saheed Nagar, Bhubaneswar 751007',
    languages: ['English', 'Odia', 'Hindi'],
    yearsOfExperience: 12,
  },
  {
    fullName: 'Dr. Bhaskar Jyoti Bora',
    specialty: 'Paediatrics',
    city: 'Guwahati',
    state: 'Assam',
    councilPrefix: 'AS',
    clinicName: 'Brahmaputra Child Clinic',
    clinicAddress: 'GS Road, Christian Basti, Guwahati 781005',
    languages: ['English', 'Assamese', 'Hindi', 'Bengali'],
    yearsOfExperience: 6,
  },
];

/**
 * Encounters per doctor. Long-tailed on purpose: a busy general physician in a
 * walk-in clinic sees an order of magnitude more people than a newly-onboarded
 * super-specialist. Thirty doctors with ~13 each would be the giveaway that
 * nobody looked at the data. Sums to exactly 386 (asserted below).
 */
const ENCOUNTERS_PER_DOCTOR = [
  31, 27, 25, 23, 21, 19, 18, 17, 16, 15, 14, 14, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 6, 6,
  5, 4, 3, 2,
] as const;

const TOTAL_ENCOUNTERS = 386;

// ---------------------------------------------------------------------------
// Patient name pools, by region, so a Kochi clinic's roster reads Malayali.
// ---------------------------------------------------------------------------
const GIVEN: Record<string, readonly string[]> = {
  south_kerala: ['Anoop', 'Divya', 'Jithin', 'Neethu', 'Sajan', 'Reshma', 'Vishnu', 'Ancy'],
  south_tamil: ['Murugan', 'Kavitha', 'Praveen', 'Janani', 'Bharath', 'Nandhini', 'Suresh'],
  south_kannada: ['Girish', 'Shwetha', 'Rakesh', 'Ashwini', 'Naveen', 'Pooja', 'Chetan'],
  south_telugu: ['Ravi', 'Sindhu', 'Kiran', 'Anusha', 'Sai', 'Lavanya', 'Naresh'],
  west: ['Sanjay', 'Pallavi', 'Amit', 'Rutuja', 'Mahesh', 'Shraddha', 'Nilesh'],
  north: ['Rahul', 'Neha', 'Gaurav', 'Simran', 'Ankit', 'Pooja', 'Manish', 'Kavya'],
  east: ['Soumen', 'Riya', 'Arnab', 'Moumita', 'Rajib', 'Payel', 'Subrata'],
};
const FAMILY: Record<string, readonly string[]> = {
  south_kerala: ['Nair', 'Menon', 'Thomas', 'Varghese', 'Pillai', 'Kurup', 'Joseph'],
  south_tamil: ['Raman', 'Krishnan', 'Sundaram', 'Natarajan', 'Iyer', 'Selvam'],
  south_kannada: ['Rao', 'Shetty', 'Gowda', 'Hegde', 'Kamath', 'Bhat'],
  south_telugu: ['Reddy', 'Naidu', 'Prasad', 'Chowdary', 'Sharma', 'Varma'],
  west: ['Patil', 'Joshi', 'Desai', 'Shah', 'Kulkarni', 'Mehta', 'Bhosale'],
  north: ['Sharma', 'Verma', 'Gupta', 'Singh', 'Chauhan', 'Aggarwal', 'Yadav'],
  east: ['Das', 'Ghosh', 'Banerjee', 'Mondal', 'Sahoo', 'Bora', 'Dutta'],
};

function poolFor(state: string): string {
  if (state === 'Kerala') return 'south_kerala';
  if (state === 'Tamil Nadu') return 'south_tamil';
  if (state === 'Karnataka') return 'south_kannada';
  if (state === 'Telangana' || state === 'Andhra Pradesh') return 'south_telugu';
  if (state === 'Maharashtra' || state === 'Gujarat') return 'west';
  if (state === 'West Bengal' || state === 'Odisha' || state === 'Assam') return 'east';
  return 'north';
}

/**
 * Recorded drug allergies, in the free-text shape a real chart carries — a
 * bare allergen, a class, or an allergen with the reaction noted. Roughly a
 * quarter of patients get one, which is about right for a general OPD and is
 * enough to make the Rx allergy checker visibly fire in a demo.
 */
const ALLERGIES = [
  ['Penicillin'],
  ['Sulfa drugs'],
  ['NSAIDs'],
  ['Ibuprofen — rash'],
  ['Penicillin — childhood rash'],
  ['Cotrimoxazole'],
  ['Aspirin'],
  ['Amoxicillin — urticaria'],
] as const;

/** Standing medications, so continued-meds + interaction checks have substrate. */
const CHRONIC_MEDS = [
  { drug: 'Metformin', strength: '500 mg', frequency: 'BD' },
  { drug: 'Amlodipine', strength: '5 mg', frequency: 'OD' },
  { drug: 'Telmisartan', strength: '40 mg', frequency: 'OD' },
  { drug: 'Atorvastatin', strength: '10 mg', frequency: 'HS' },
  { drug: 'Levothyroxine', strength: '50 mcg', frequency: 'OD' },
  { drug: 'Ecosprin', strength: '75 mg', frequency: 'OD' },
] as const;

const CAPTURE_MODES = ['LIVE', 'LIVE', 'LIVE', 'DICTATE', 'UPLOAD'] as const;

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  if (ENCOUNTERS_PER_DOCTOR.length !== DOCTORS.length) {
    throw new Error(
      `roster mismatch: ${DOCTORS.length} doctors but ${ENCOUNTERS_PER_DOCTOR.length} encounter counts`,
    );
  }
  const declared = ENCOUNTERS_PER_DOCTOR.reduce((a, b) => a + b, 0);
  if (declared !== TOTAL_ENCOUNTERS) {
    throw new Error(`encounter distribution sums to ${declared}, expected ${TOTAL_ENCOUNTERS}`);
  }

  if (WIPE) {
    const existing = await prisma.psychologist.findMany({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    const ids = existing.map((p) => p.id);
    if (ids.length > 0) {
      // Order matters — sessions reference clients, readings reference both.
      await prisma.clinicalReading.deleteMany({ where: { psychologistId: { in: ids } } });
      await prisma.medicationOrder.deleteMany({ where: { psychologistId: { in: ids } } });
      await prisma.session.deleteMany({ where: { psychologistId: { in: ids } } });
      await prisma.client.deleteMany({ where: { psychologistId: { in: ids } } });
      await prisma.psychologistTenantKey.deleteMany({ where: { psychologistId: { in: ids } } });
      await prisma.psychologist.deleteMany({ where: { id: { in: ids } } });
      console.log(`Wiped ${ids.length} previously-seeded doctor(s) and their data.`);
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let totalSessions = 0;
  let totalPatients = 0;

  for (let d = 0; d < DOCTORS.length; d++) {
    const spec = DOCTORS[d]!;
    const encounters = ENCOUNTERS_PER_DOCTOR[d]!;
    const slug = slugFor(spec.fullName);
    const firebaseUid = `demo-doctor-${slug}`;
    const email = `${slug}@${DEMO_EMAIL_DOMAIN}`;

    const doctor = await prisma.psychologist.upsert({
      // Keyed on EMAIL, not firebaseUid: --as-bypass swaps a doctor's uid, so
      // a uid-keyed upsert would stop finding them on the next run and try to
      // create a duplicate email instead.
      where: { email },
      update: {
        specialty: spec.specialty,
        clinicName: spec.clinicName,
        clinicAddress: spec.clinicAddress,
        clinicPhone: `+9199000${String(10000 + d).slice(-5)}`,
      },
      create: {
        firebaseUid,
        email,
        fullName: spec.fullName,
        // Indian mobile shape, in a block that cannot belong to a real number.
        phone: `+9199000${String(20000 + d).slice(-5)}`,
        // rciNumber is NOT NULL + unique; doctors carry a placeholder because
        // their real credential lives in medicalRegNumber.
        rciNumber: `PENDING-${firebaseUid}`,
        vertical: 'DOCTOR',
        // Real council prefix, unmistakably fake number — cannot collide with
        // a genuine registration.
        medicalRegNumber: `${spec.councilPrefix}-DEMO-${10000 + d * 137}`,
        specialty: spec.specialty,
        languages: spec.languages,
        yearsOfExperience: spec.yearsOfExperience,
        locationCity: spec.city,
        locationProvince: spec.state,
        clinicName: spec.clinicName,
        clinicAddress: spec.clinicAddress,
        clinicPhone: `+9199000${String(10000 + d).slice(-5)}`,
        status: 'ACTIVE',
        defaultCaptureMode: 'LIVE',
        onboardingCompletedAt: new Date(Date.now() - int(120, 900) * DAY_MS),
      },
      select: { id: true, fullName: true },
    });

    // Skip encounter generation on a bare re-run — otherwise a second run
    // would double every doctor's history.
    const already = await prisma.session.count({ where: { psychologistId: doctor.id } });
    if (already > 0) {
      console.log(`  ${doctor.fullName} — ${already} encounters already, skipping`);
      totalSessions += already;
      continue;
    }

    // Patients: fewer than encounters, so follow-ups are real repeat visits
    // rather than every consult being a stranger.
    const patientCount = Math.max(2, Math.round(encounters * 0.68));
    const pool = poolFor(spec.state);
    const patientIds: string[] = [];

    for (let p = 0; p < patientCount; p++) {
      const name = `${pick(GIVEN[pool]!)} ${pick(FAMILY[pool]!)}`;
      const hasAllergy = rnd() < 0.25;
      const client = await prisma.client.create({
        data: {
          psychologistId: doctor.id,
          fullNameEncrypted: await encryptForTenant(doctor.id, name),
          contactPhoneEncrypted: await encryptForTenant(
            doctor.id,
            `+9198${String(int(10000000, 99999999))}`,
          ),
          dateOfBirth: new Date(Date.UTC(int(1945, 2018), int(0, 11), int(1, 28))),
          preferredLanguage: 'en',
          spokenLanguages: spec.languages.slice(0, 2).map(langCode),
          allergies: hasAllergy ? [...pick(ALLERGIES)] : [],
          status: 'ACTIVE',
          isDemo: IS_DEMO,
        },
        select: { id: true },
      });
      patientIds.push(client.id);
      totalPatients += 1;
    }

    // Spread encounters over the last ~5 months of clinic days, newest last.
    // Tokens are per-clinic-day, like the real queue assigns them.
    const tokensByDay = new Map<string, number>();
    for (let e = 0; e < encounters; e++) {
      const daysAgo = Math.floor(((encounters - e) / encounters) * int(120, 150)) + int(0, 3);
      const scheduledAt = new Date(today.getTime() - daysAgo * DAY_MS);
      // OPD hours: 09:00–13:00 or 17:00–20:00 IST.
      const morning = rnd() < 0.65;
      scheduledAt.setUTCHours(
        morning ? int(3, 7) : int(11, 14), // IST 09:00–13:00 / 17:00–20:00
        int(0, 59),
        0,
        0,
      );
      const dayKey = scheduledAt.toISOString().slice(0, 10);
      const token = (tokensByDay.get(dayKey) ?? 0) + 1;
      tokensByDay.set(dayKey, token);

      const clientId = patientIds[int(0, patientIds.length - 1)]!;
      const isToday = daysAgo === 0;
      const status = isToday ? (rnd() < 0.5 ? 'SCHEDULED' : 'COMPLETED') : 'COMPLETED';

      const session = await prisma.session.create({
        data: {
          clientId,
          psychologistId: doctor.id,
          scheduledAt,
          status,
          kind: e === 0 ? 'INTAKE' : rnd() < 0.25 ? 'REVIEW' : 'TREATMENT',
          captureMode: pick(CAPTURE_MODES),
          tokenNumber: token,
          language: 'en',
          ...(status === 'COMPLETED'
            ? {
                startedAt: scheduledAt,
                endedAt: new Date(scheduledAt.getTime() + int(6, 22) * 60_000),
              }
            : {}),
        },
        select: { id: true },
      });
      totalSessions += 1;

      // A slice of completed encounters leave a standing prescription, so the
      // next consult's pad has continued meds to carry (and something for the
      // allergy + interaction engines to chew on).
      if (status === 'COMPLETED' && rnd() < 0.35) {
        const med = pick(CHRONIC_MEDS);
        await prisma.medicationOrder.create({
          data: {
            sessionId: session.id,
            psychologistId: doctor.id,
            status: 'CONFIRMED',
            confirmedAt: scheduledAt,
            content: {
              version: 'V1',
              drug: med.drug,
              strength: med.strength,
              frequency: med.frequency,
              prn: false,
              interactionWarnings: [],
              // Chronic meds are open-ended; the Batch B expiry only drops a
              // course once its durationDays elapses, so these keep carrying.
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // Vitals on roughly half of completed encounters, feeding the chronic
      // trajectory the Journey engine plots.
      if (status === 'COMPLETED' && rnd() < 0.5) {
        await prisma.clinicalReading.create({
          data: {
            clientId,
            psychologistId: doctor.id,
            sessionId: session.id,
            measure: 'BP',
            value: int(110, 165),
            valueSecondary: int(68, 100),
            unit: 'mmHg',
            takenAt: scheduledAt,
            source: 'MANUAL_ENTRY',
          },
        });
      }
    }

    console.log(
      `  ${doctor.fullName.padEnd(30)} ${spec.specialty.padEnd(26)} ${spec.city.padEnd(20)} ${String(encounters).padStart(3)} encounters, ${patientCount} patients`,
    );
  }

  if (AS_BYPASS) await handOverBypassIdentity();

  console.log(
    `\nSeeded ${DOCTORS.length} doctors, ${totalPatients} patients, ${totalSessions} encounters.`,
  );
  if (totalSessions !== TOTAL_ENCOUNTERS) {
    console.warn(
      `NOTE: ${totalSessions} encounters exist, not ${TOTAL_ENCOUNTERS} — some doctors already had history (re-run with --wipe for an exact rebuild).`,
    );
  }
}

/**
 * Give the AUTH_BYPASS identity to the busiest seeded doctor.
 *
 * Every row this script writes is tenant-scoped to its doctor, and
 * AUTH_BYPASS resolves to ONE hardcoded uid (the seeded therapist). So
 * without this, a local bypass session logs in as a therapist and sees an
 * empty app — the 386 encounters are all there, just owned by someone else.
 * The previous holder is parked on an alternate uid rather than deleted, so
 * the therapist fixture survives and this is reversible.
 */
async function handOverBypassIdentity(): Promise<void> {
  const top = DOCTORS[0]!;
  const target = await prisma.psychologist.findUnique({
    // By email for the same reason the upsert is: this doctor's uid may
    // already have been swapped by a previous --as-bypass run.
    where: { email: `${slugFor(top.fullName)}@${DEMO_EMAIL_DOMAIN}` },
    select: { id: true, fullName: true },
  });
  if (!target) {
    console.warn('  --as-bypass: could not find the top seeded doctor; skipping.');
    return;
  }

  const incumbent = await prisma.psychologist.findUnique({
    where: { firebaseUid: DEV_BYPASS_FIREBASE_UID },
    select: { id: true, fullName: true },
  });
  if (incumbent && incumbent.id !== target.id) {
    // Free the uid without losing the row. If a parked row already exists
    // from an earlier run, drop the stale parking slot first.
    await prisma.psychologist.deleteMany({
      where: { firebaseUid: PARKED_UID, id: { not: incumbent.id } },
    });
    await prisma.psychologist.update({
      where: { id: incumbent.id },
      data: { firebaseUid: PARKED_UID },
    });
    console.log(`  --as-bypass: parked ${incumbent.fullName} on ${PARKED_UID}`);
  }

  await prisma.psychologist.update({
    where: { id: target.id },
    data: { firebaseUid: DEV_BYPASS_FIREBASE_UID },
  });
  console.log(
    `  --as-bypass: AUTH_BYPASS=true now signs you in as ${target.fullName} (${top.specialty}, ${top.city}).`,
  );
}

function slugFor(fullName: string): string {
  return fullName
    .replace(/^Dr\.\s*/, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

/** Rough display-language → ISO 639-1, for the Pass-1 transcription hint. */
function langCode(name: string): string {
  const map: Record<string, string> = {
    English: 'en',
    Malayalam: 'ml',
    Tamil: 'ta',
    Kannada: 'kn',
    Telugu: 'te',
    Hindi: 'hi',
    Marathi: 'mr',
    Gujarati: 'gu',
    Punjabi: 'pa',
    Bengali: 'bn',
    Odia: 'or',
    Assamese: 'as',
    Urdu: 'ur',
    Tulu: 'kn',
    Rajasthani: 'hi',
    Bhojpuri: 'hi',
  };
  return map[name] ?? 'en';
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
