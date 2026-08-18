# Patient and Encounter compatibility

This change adds canonical terminology at the HTTP boundary without changing persistence or clinical behavior. `Client` and `Session` remain the authoritative encrypted models and handlers during this compatibility period.

## Canonical routes

| Canonical route                   | Methods                  | Delegates to                   |
| --------------------------------- | ------------------------ | ------------------------------ |
| `/api/v1/patients`                | `GET`, `POST`            | `/api/v1/clients`              |
| `/api/v1/patients/:id`            | `GET`, `PATCH`, `DELETE` | `/api/v1/clients/:id`          |
| `/api/v1/encounters`              | `POST`                   | `/api/v1/sessions`             |
| `/api/v1/encounters/:id`          | `GET`                    | `/api/v1/sessions/:id`         |
| `/api/v1/encounters/:id/start`    | `POST`                   | `/api/v1/sessions/:id/start`   |
| `/api/v1/encounters/:id/complete` | `POST`                   | `/api/v1/sessions/:id/end`     |
| `/api/v1/encounters/:id/no-show`  | `POST`                   | `/api/v1/sessions/:id/no-show` |

The adapters do not query Prisma, perform transactions, write audits, authorize capabilities, or implement lifecycle transitions. They invoke the current production handlers, so authentication, ownership checks, validation, encrypted Client PII, billing, consent, audit, response bodies, and status codes remain unchanged.

## Legacy Client response headers

Every response from the two legacy Client routes, including error responses, adds:

- `Deprecation: @1787011200` — RFC 9745 date form for 18 August 2026 UTC.
- `Sunset: Thu, 12 Aug 2027 00:00:00 GMT` — RFC 8594 HTTP-date.
- `Link: </api/v1/patients...>; rel="successor-version"` — the matching canonical resource.
- `X-ORBIT-Compatibility: legacy-client-resource` — operational compatibility marker.

Existing `Link` values are preserved. Canonical Patient responses remove only these migration headers and their matching successor link; they are not themselves marked deprecated.

## Deliberate non-goals

This layer does **not** add capability authorization, credentials, schema or migrations, medical signing, production authentication changes, lifecycle mutations, an Encounter application service, or a new persistence model. Retirement of Client/Session storage and routes requires separate measured migration work.
