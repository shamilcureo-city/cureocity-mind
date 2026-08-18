# ORBIT brand boundary

`apps/web/lib/brand.ts` is the source of truth for the authenticated clinical workspace name: **Cureocity ORBIT**. The reusable `OrbitLogo` component and static SVG assets implement the shell wordmark, and the web manifest uses the same product name and description.

The authenticated desktop and mobile navigation now uses ORBIT-facing nouns while preserving the existing vertical-specific destinations:

- **Patients** continues to open `/app/clients` for therapists and `/app/patients` for doctors.
- **New encounter** uses `/app/encounters/new`, a UI alias of the existing record page; doctors retain that page's current redirect to the clinic queue.
- **Analytics** and **ORBIT Assistant** are copy changes over the existing dashboard and practice-assistant routes.

This is a presentation and compatibility change only. Stable `@cureocity/*` package scopes, database identifiers, audit target types, storage keys, public product landing pages, and authorization rules remain unchanged. The logo or navigation wording must not be interpreted as enabling a clinical capability.
