# Cureocity ORBIT — target architecture

## System shape

```text
Cureocity ORBIT
├── Unified shell: Today · Patients · Encounters · Assistant · Analytics
├── Patient workspace: timeline · documents · care · measures · shares
├── Encounter workspace: prepare → capture → document → review → sign → follow up
├── Workflow packs
│   ├── Behavioral Health
│   └── Medical Care
└── Platform core
    ├── identity · tenancy · consent · audit · billing
    └── audio · AI orchestration · crypto · storage · notifications
```

The Next.js application remains the live request path. The live gateway remains a separate runtime
because persistent WebSockets do not belong in serverless route handlers. One product does not mean
one operating-system process.

## Target core model

- **Practitioner:** profession, verified credentials, roles, and effective capabilities.
- **Organization:** membership, policy, modules, and billing boundary.
- **Patient:** one longitudinal record, subject to explicit confidentiality boundaries.
- **Encounter:** workflow profile, capture strategy, lifecycle, and clinical documents.
- **Clinical document:** a discriminated, versioned type with provenance and signature state.

## Migration constraints

1. Additive schema changes precede read or write cutovers.
2. Existing `Psychologist`, `Client`, and `Session` storage names remain behind canonical mappers.
3. Legacy URLs redirect before removal and emit migration telemetry.
4. New functionality must not add direct `vertical === 'DOCTOR'` product branching.
5. Application services own authorization, transactions, audit writes, and domain transitions.
6. Workflow packs register document types, prompts, panels, measures, and safety policies.
7. Specialty differences remain discriminated unions; no universal nullable note.

## Decision record

**Decision:** converge on one capability-driven clinical workspace rather than separate therapist and
doctor products.

**Why:** the compliance-heavy core is already shared, binary verticals cannot represent psychiatry
or multidisciplinary care, and parallel patient/encounter experiences create duplicated behavior.

**Consequence:** `PractitionerVertical` becomes a compatibility input while profession, credentials,
capabilities, and encounter profile become the durable selection and authorization model.
