# Cureocity ORBIT — initial capability matrix

This matrix defines product defaults, not final regulatory authorization. Effective capabilities
must be resolved server-side from verified credentials, organization policy, subscription
entitlements, feature flags, and jurisdiction.

| Capability                      | Behavioral-health practitioner |          Physician           |         Psychiatrist         |
| ------------------------------- | :----------------------------: | :--------------------------: | :--------------------------: |
| Ambient capture                 |               ✓                |              ✓               |              ✓               |
| Live encounter                  |            Optional            |              ✓               |              ✓               |
| Behavioral-health documentation |               ✓                |              —               |              ✓               |
| Medical documentation           |               —                |              ✓               |              ✓               |
| Clinical analysis drafts        |               ✓                |              ✓               |              ✓               |
| Therapy workflows               |               ✓                |              —               |           Optional           |
| Measurement-based care          |               ✓                |           Optional           |              ✓               |
| Safety planning                 |               ✓                |           Optional           |              ✓               |
| Prescription drafting           |               —                |              ✓               |              ✓               |
| Prescription signing            |               —                | Verified credential required | Verified credential required |
| Clinical orders                 |               —                |              ✓               |              ✓               |
| Chronic care                    |               —                |              ✓               |              ✓               |
| FHIR/ABDM egress                |            Optional            |           Optional           |           Optional           |
| Patient sharing                 |               ✓                |              ✓               |              ✓               |

## Policy invariants

- UI visibility is not authorization; APIs enforce every regulated capability.
- Drafting and signing are separate capabilities.
- Signed documents retain the capability and credential provenance used at sign time.
- The existing `PractitionerVertical` remains a temporary migration default, not a future policy
  boundary.
