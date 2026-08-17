# Cureocity ORBIT — canonical glossary

| Canonical term    | Current compatibility term   | Meaning                                                                             |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Practitioner      | `Psychologist`               | A credentialed clinical user of ORBIT.                                              |
| Patient           | `Client`                     | The person receiving care; organizations may display “client” as copy only.         |
| Encounter         | `Session`                    | A scheduled, live, uploaded, dictated, or manually documented clinical interaction. |
| Organization      | `Clinic`                     | The tenancy and membership boundary for a practice.                                 |
| Clinical document | Note, brief, report, summary | A typed, versioned clinical or patient-facing artefact.                             |
| Workflow pack     | Therapist/doctor vertical    | A set of encounter profiles, documents, prompts, policies, and workspace panels.    |
| Capability        | Vertical-derived access      | A server-enforced permission derived from credentials, policy, and entitlement.     |
| ORBIT Assistant   | Practice Assistant           | The contextual assistant within the unified workspace.                              |

## Naming rules

- New product routes and application services use **patient** and **encounter**.
- Legacy Prisma and API names remain until additive compatibility migrations are proven.
- “Client” may be an organization display preference but never changes storage, authorization, or
  route semantics.
- Profession is identity; capability is authorization. Do not infer regulated authority from a UI
  label alone.
- Cureocity ORBIT is the only product brand. Behavioral Health and Medical Care are workflow packs,
  not sub-products.
