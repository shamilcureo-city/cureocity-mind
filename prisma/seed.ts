/**
 * Cureocity Mind — development seed.
 *
 * Idempotent: re-running this script must not duplicate records or fail.
 * Run with: `pnpm db:seed`. Vercel build re-runs it on every deploy.
 *
 * Creates:
 *   - 5 demo therapists with rich profiles for the public directory
 *   - 1 demo client owned by the first therapist (Dr. Priya Menon)
 *   - 3 sample booking requests for Dr. Priya
 *   - 2 unassigned intake submissions for the open queue
 *
 * IDs are auto-generated cuids. Idempotency is keyed off natural unique
 * fields (Psychologist.firebaseUid, Client.clientFirebaseUid). A
 * one-time cleanup at the top removes legacy non-cuid seed rows from
 * earlier builds so production can converge cleanly.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PSYCHOLOGIST_UID = 'dev-firebase-uid-priya';
const DEMO_CLIENT_UID = 'dev-client-firebase-uid-arjun';
// Sprint DV1 — seeded DOCTOR fixture for the doctor vertical.
const DEMO_DOCTOR_UID = 'dev-firebase-uid-doctor-meera';

interface TherapistSeed {
  firebaseUid: string;
  email: string;
  fullName: string;
  phone: string;
  rciNumber: string;
  headline: string;
  bio: string;
  specialties: string[];
  languages: string[];
  modalities: string[];
  yearsOfExperience: number;
  locationCity: string;
  locationProvince: string;
  sessionFeeInr: number | null;
  isAcceptingNewClients: boolean;
}

const THERAPISTS: TherapistSeed[] = [
  {
    firebaseUid: DEMO_PSYCHOLOGIST_UID,
    email: 'priya.menon@cureocity.mind',
    fullName: 'Dr. Priya Menon',
    phone: '+919876543210',
    rciNumber: 'A12345',
    headline: 'Adult anxiety, perfectionism, and the kind of overthinking that wakes you at 3am.',
    bio: 'I work with adults who look like they have it together on the outside, and feel anything but on the inside. My approach is grounded in cognitive behavioural therapy with strong threads of compassion-focused and ACT work woven in. I am direct, warm, and I will gently push when I see you avoiding the thing that matters. First sessions are usually about figuring out what you want to be different in six months.',
    specialties: ['Anxiety', 'Perfectionism', 'Burnout', 'Workplace stress'],
    languages: ['English', 'Malayalam', 'Hindi'],
    modalities: ['CBT', 'ACT', 'Compassion-focused'],
    yearsOfExperience: 12,
    locationCity: 'Bengaluru',
    locationProvince: 'Karnataka',
    sessionFeeInr: 2500,
    isAcceptingNewClients: true,
  },
  {
    firebaseUid: 'dev-firebase-uid-rohan',
    email: 'rohan.sharma@cureocity.mind',
    fullName: 'Dr. Rohan Sharma',
    phone: '+919811112233',
    rciNumber: 'A23456',
    headline: 'EMDR and trauma-focused work for people who feel stuck in old patterns.',
    bio: 'Most of my clients come to me after years of trying everything else. Together we slow down, notice what your nervous system has been carrying, and build the kind of safety that makes processing possible. I trained in EMDR in 2018 and have integrated parts work since. Sessions are paced for your window of tolerance, never to a clock.',
    specialties: ['Trauma', 'PTSD', 'Grief', 'Identity work'],
    languages: ['English', 'Hindi', 'Punjabi'],
    modalities: ['EMDR', 'IFS', 'Somatic'],
    yearsOfExperience: 9,
    locationCity: 'New Delhi',
    locationProvince: 'Delhi',
    sessionFeeInr: 3000,
    isAcceptingNewClients: true,
  },
  {
    firebaseUid: 'dev-firebase-uid-aisha',
    email: 'aisha.khan@cureocity.mind',
    fullName: 'Aisha Khan',
    phone: '+919844455667',
    rciNumber: 'A34567',
    headline: 'Couples therapy, queer-affirming, and the conversations partners keep avoiding.',
    bio: 'I work with couples and individuals navigating relationships, identity, and the friction between who they are and what their family expects. I run a queer- and trans-affirming practice. Most weeks I see one or two new couples; the rest of my time is split between long-term work and short-form premarital sessions. Sliding scale available for those who need it.',
    specialties: ['Couples', 'LGBTQ+ affirming', 'Family of origin', 'Premarital'],
    languages: ['English', 'Urdu', 'Hindi'],
    modalities: ['Gottman Method', 'EFT', 'Narrative'],
    yearsOfExperience: 7,
    locationCity: 'Mumbai',
    locationProvince: 'Maharashtra',
    sessionFeeInr: null,
    isAcceptingNewClients: true,
  },
  {
    firebaseUid: 'dev-firebase-uid-samuel',
    email: 'samuel.joseph@cureocity.mind',
    fullName: 'Samuel Joseph',
    phone: '+919633344455',
    rciNumber: 'A45678',
    headline: 'Adolescents and young adults. Mood, motivation, and the messy middle of growing up.',
    bio: 'Half my clients are between sixteen and twenty-five. We talk about what is actually going on at school, at home, online — and what you would want different. I keep the room private from parents while staying in honest touch with them. I am playful when that is useful, and steady when it is not.',
    specialties: ['Adolescents', 'Depression', 'Self-harm', 'School avoidance'],
    languages: ['English', 'Tamil', 'Malayalam'],
    modalities: ['CBT', 'DBT-informed', 'Solution-focused'],
    yearsOfExperience: 8,
    locationCity: 'Chennai',
    locationProvince: 'Tamil Nadu',
    sessionFeeInr: 1800,
    isAcceptingNewClients: true,
  },
  {
    firebaseUid: 'dev-firebase-uid-lakshmi',
    email: 'lakshmi.iyer@cureocity.mind',
    fullName: 'Lakshmi Iyer',
    phone: '+919766654321',
    rciNumber: 'A56789',
    headline: 'Long-term psychodynamic work. For clients who want to know themselves more deeply.',
    bio: 'I am a psychodynamic therapist. My clients are usually adults in their thirties and forties who have done some therapy before and are ready to go further. We meet weekly, sometimes twice. The work is slower than CBT. It is also, in my experience, more durable. I am currently full but happy to recommend trusted colleagues.',
    specialties: ['Psychodynamic', 'Existential', 'Midlife', 'Creative blocks'],
    languages: ['English', 'Hindi'],
    modalities: ['Psychodynamic', 'Existential'],
    yearsOfExperience: 16,
    locationCity: 'Hyderabad',
    locationProvince: 'Telangana',
    sessionFeeInr: 3500,
    isAcceptingNewClients: false,
  },
];

const SAMPLE_BOOKINGS: {
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  preferredAt: Date;
  message: string;
}[] = [
  {
    patientName: 'Anika Sharma',
    patientEmail: 'anika.sharma@example.in',
    patientPhone: '+919812345671',
    preferredAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 7.5 * 60 * 60 * 1000),
    message:
      'I have been getting tight in the chest before my Monday standup for weeks now. I want to try CBT.',
  },
  {
    patientName: 'Kabir Patel',
    patientEmail: 'kabir.patel@example.in',
    patientPhone: '+919812345672',
    preferredAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 11 * 60 * 60 * 1000),
    message:
      'Friend recommended you. Going through a breakup and finding it hard to focus at work.',
  },
  {
    patientName: 'Meera Rao',
    patientEmail: 'meera.rao@example.in',
    patientPhone: '+919812345673',
    preferredAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 18 * 60 * 60 * 1000),
    message: '',
  },
];

const SAMPLE_INTAKES: {
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  concerns: string[];
  notes: string;
  preferredModality: string;
  preferredLanguage: string;
  mode: 'IN_PERSON' | 'ONLINE' | 'EITHER';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
}[] = [
  {
    patientName: 'Rhea Iyer',
    patientEmail: 'rhea.iyer@example.in',
    patientPhone: '+919812345674',
    concerns: ['Anxiety or constant worry', 'Sleep difficulties', 'Stress at work or school'],
    notes:
      'I sleep four hours on a good night and I am running on caffeine and dread. I want practical tools, not just talking.',
    preferredModality: 'CBT',
    preferredLanguage: 'English',
    mode: 'ONLINE',
    urgency: 'HIGH',
  },
  {
    patientName: 'Dev Krishnan',
    patientEmail: 'dev.krishnan@example.in',
    patientPhone: '+919812345675',
    concerns: ['Trauma or difficult memories', 'Relationship or family'],
    notes:
      'Childhood stuff is coming up since my father passed. Looking for someone trauma-trained.',
    preferredModality: 'EMDR',
    preferredLanguage: 'Hindi',
    mode: 'EITHER',
    urgency: 'MEDIUM',
  },
];

async function cleanupLegacySeedRows(): Promise<void> {
  const legacyClient = await prisma.client.findUnique({
    where: { id: 'seed-client-arjun' },
    select: { id: true },
  });
  if (legacyClient) {
    await prisma.session.deleteMany({ where: { clientId: 'seed-client-arjun' } });
    await prisma.consent.deleteMany({ where: { clientId: 'seed-client-arjun' } });
    await prisma.client.delete({ where: { id: 'seed-client-arjun' } });
    console.log('Removed legacy non-cuid seed client.');
  }
}

async function main(): Promise<void> {
  await cleanupLegacySeedRows();

  const therapistIdsByEmail = new Map<string, string>();
  for (const t of THERAPISTS) {
    const row = await prisma.psychologist.upsert({
      where: { firebaseUid: t.firebaseUid },
      update: {
        headline: t.headline,
        bio: t.bio,
        specialties: t.specialties,
        languages: t.languages,
        modalities: t.modalities,
        yearsOfExperience: t.yearsOfExperience,
        locationCity: t.locationCity,
        locationProvince: t.locationProvince,
        sessionFeeInr: t.sessionFeeInr,
        isAcceptingNewClients: t.isAcceptingNewClients,
        status: 'ACTIVE',
        // Sprint 31 — seeded fixtures are pre-onboarded so the demo
        // therapist (used in AUTH_BYPASS mode) skips the onboarding gate.
        onboardingCompletedAt: new Date('2024-01-15T00:00:00Z'),
      },
      create: {
        firebaseUid: t.firebaseUid,
        email: t.email,
        fullName: t.fullName,
        phone: t.phone,
        rciNumber: t.rciNumber,
        rciVerifiedAt: new Date('2024-01-15T00:00:00Z'),
        onboardingCompletedAt: new Date('2024-01-15T00:00:00Z'),
        status: 'ACTIVE',
        headline: t.headline,
        bio: t.bio,
        specialties: t.specialties,
        languages: t.languages,
        modalities: t.modalities,
        yearsOfExperience: t.yearsOfExperience,
        locationCity: t.locationCity,
        locationProvince: t.locationProvince,
        sessionFeeInr: t.sessionFeeInr,
        isAcceptingNewClients: t.isAcceptingNewClients,
      },
    });
    therapistIdsByEmail.set(t.email, row.id);
    console.log(`  Therapist: ${row.fullName} (${row.id})`);
  }

  // Sprint DV1 — a seeded DOCTOR fixture. Pre-onboarded (so AUTH_BYPASS
  // can resolve it) but carries vertical=DOCTOR + a medical registration
  // number instead of an RCI number. See docs/DOCTOR_VERTICAL.md.
  const doctor = await prisma.psychologist.upsert({
    where: { firebaseUid: DEMO_DOCTOR_UID },
    update: {
      vertical: 'DOCTOR',
      medicalRegNumber: 'KMC-99001',
      specialty: 'Cardiology',
      status: 'ACTIVE',
      onboardingCompletedAt: new Date('2024-01-15T00:00:00Z'),
    },
    create: {
      firebaseUid: DEMO_DOCTOR_UID,
      email: 'meera.nair@cureocity.mind',
      fullName: 'Dr. Meera Nair',
      phone: '+919876500011',
      // rciNumber is NOT NULL + unique; doctors keep a placeholder (their
      // real credential lives in medicalRegNumber).
      rciNumber: `PENDING-${DEMO_DOCTOR_UID}`,
      vertical: 'DOCTOR',
      medicalRegNumber: 'KMC-99001',
      specialty: 'Cardiology',
      languages: ['English', 'Malayalam'],
      status: 'ACTIVE',
      onboardingCompletedAt: new Date('2024-01-15T00:00:00Z'),
    },
  });
  console.log(`  Doctor: ${doctor.fullName} (${doctor.id})`);

  const priyaId = therapistIdsByEmail.get('priya.menon@cureocity.mind')!;

  const existingClient = await prisma.client.findUnique({
    where: { clientFirebaseUid: DEMO_CLIENT_UID },
  });
  const client =
    existingClient ??
    (await prisma.client.create({
      data: {
        psychologistId: priyaId,
        clientFirebaseUid: DEMO_CLIENT_UID,
        // PII plaintext columns were dropped (Sprint 72 cutover). The seed
        // has no tenant DEK, so we write opaque placeholder ciphertext into
        // the encrypted twins — dev-only fixtures; not real ciphertext.
        fullNameEncrypted: 'seed:Arjun Rao',
        contactPhoneEncrypted: 'seed:+919812345678',
        contactEmailEncrypted: 'seed:arjun.rao@example.in',
        dateOfBirth: new Date('1992-03-14'),
        presentingConcerns:
          'Generalised anxiety; sleep disruption; work-related rumination. Prefers practical, structured approach.',
        preferredModality: 'CBT',
        status: 'ACTIVE',
      },
    }));
  console.log(`  Client: Arjun Rao (${client.id})`);

  const existingBookings = await prisma.booking.count({ where: { therapistId: priyaId } });
  if (existingBookings === 0) {
    for (const b of SAMPLE_BOOKINGS) {
      await prisma.booking.create({
        data: {
          therapistId: priyaId,
          patientName: b.patientName,
          patientEmail: b.patientEmail,
          patientPhone: b.patientPhone,
          preferredAt: b.preferredAt,
          ...(b.message && { message: b.message }),
        },
      });
    }
    console.log(
      `  Seeded ${SAMPLE_BOOKINGS.length} booking rows for Dr. Priya (dormant Booking model — no app surface reads these yet).`,
    );
  }

  const existingIntakes = await prisma.intakeSubmission.count();
  if (existingIntakes === 0) {
    for (const i of SAMPLE_INTAKES) {
      await prisma.intakeSubmission.create({
        data: {
          patientName: i.patientName,
          patientEmail: i.patientEmail,
          patientPhone: i.patientPhone,
          concerns: i.concerns,
          notes: i.notes,
          preferredModality: i.preferredModality,
          preferredLanguage: i.preferredLanguage,
          mode: i.mode,
          urgency: i.urgency,
        },
      });
    }
    console.log(`  Seeded ${SAMPLE_INTAKES.length} intake submissions.`);
  }

  // Cureocity Care — the demo consumer for the /care surface (AC1).
  // The API/page guards also auto-create this row in bypass mode; the
  // seed keeps fresh databases deterministic either way.
  await prisma.careUser.upsert({
    where: { firebaseUid: 'dev-care-firebase-uid-kavya' },
    update: {},
    create: {
      firebaseUid: 'dev-care-firebase-uid-kavya',
      displayName: 'Kavya',
      preferredLanguage: 'en',
      spokenLanguages: ['ml', 'en'],
      personaName: 'Meera',
      voiceName: 'Kore',
      personaStyle: 'gentle',
    },
  });
  console.log('  Seeded demo care user (Kavya).');
}

main()
  .then(async () => {
    console.log('Seed complete.');
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
