# Cureocity ORBIT — product charter

## Product definition

**Cureocity ORBIT is the intelligent workspace for every clinical encounter.** It helps healthcare
professionals prepare, conduct, document, follow up, and measure care around one longitudinal
patient record.

ORBIT is one product. Behavioral health and outpatient medicine are capability-driven workflow
packs inside the same workspace—not separate products, accounts, or records.

## Product principles

1. **The patient is the center.** Encounters, documents, measures, plans, tasks, and shared items
   form one longitudinal record.
2. **One encounter lifecycle.** Specialty workflows adapt the content, not the product shell.
3. **Clinicians make clinical decisions.** AI output is a draft with provenance and explicit review.
4. **Capabilities, not verticals.** Credentials, organization policy, and entitlements determine what
   a practitioner may do.
5. **Safety is part of the workflow.** Confirmation, signatures, auditability, consent, and tenant
   isolation are application invariants.
6. **Specialization without fragmentation.** Behavioral-health and medical document types remain
   clinically specific and strongly typed.

## Initial users

- Psychologists, counsellors, and psychotherapists.
- Physicians and outpatient specialists.
- Psychiatrists and other practitioners who need both behavioral-health and medical capabilities.
- Solo practices and small multidisciplinary clinics in India.

## Canonical experience

The long-term primary navigation is **Today, Patients, Encounters, ORBIT Assistant, Analytics,
Templates, and Settings**. Recording is an encounter action, not a separate product destination.

## Initial workflow packs

### Behavioral Health

Intake and progress notes, formulation, risk, treatment plans, CBT/EMDR, exercises, safety plans,
PHQ-9/GAD-7, goals, progress reports, and pre-session preparation.

### Medical Care

Live encounters, medical notes, differential support, medication and order drafting, interaction
checks, chronic readings, after-visit summaries, FHIR, and ABDM.

## Explicit non-goals for convergence

- A universal nullable clinical note that combines every specialty.
- A rewrite or destructive database rename.
- Clinic-wide access to every patient by default.
- AI-autonomous diagnosis, prescribing, or record mutation.
- A separate product, account, or patient record for each profession.
