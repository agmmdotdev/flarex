# Database schema declarations

These modules own the physical Drizzle declarations. Each physical table has
one table object; foreign keys import that object from its declaration owner.
Declaration modules do not import the schema aggregates.

Three surfaces have different responsibilities:

- `../schema.ts` exports the existing declaration names and constructs the
  explicit `flarexSchema` used by database drivers and physical sessions. Its
  82 keys are a selected relational-query surface, not every physical table.
- `../drizzleSchema.ts` selects the live declaration exports consumed by Drizzle
  Kit. Its 140 exports include companion domain schemas and exclude retained
  Declarative declarations. Its selection differs from the driver surface.
- The checked-in `drizzle/` migrations and migration journal own installation
  order and durable structural changes. Moving a declaration does not generate
  a migration or change the selected tables.

The 117 central table declarations remain importable through `../schema.ts`.
Companion schemas remain with their Application, installation, commit and
framework owners and import these declaration modules directly.

## Declaration owners

| Modules | Responsibility and table dependencies |
| --- | --- |
| `primitives` | `bytea`, nonblank text and canonical-frame SQL checks. No tables. |
| `catalogIdentity` | Deployments, schema artifacts and stable table identities. |
| `catalogIndexes`, `catalogUniqueConstraints`, `catalogRelations` | Definitions and schema bindings over catalog identities. |
| `catalogApplicationBindings` | Bound Application schemas, manifest bindings and publication authority over deployment/schema identity. |
| `catalogLogicalReads` | Read source, table and access projections, in that dependency order. |
| `controlScopes` | Control-plane scope placement and provisioning over deployments. |
| `scope` | Target scope clocks, execution authority and metadata observations. |
| `installation` | Installation admission, runtime identity and prepared metadata epoch. |
| `commitHeaders` | Committed headers, idempotency and wake delivery over scope clocks. |
| `commitFacts` | Document/relation change facts over headers and row revisions. |
| `transactionSessions` | Execution sessions over clocks and snapshot leases over sessions. |
| `transactionJournals` | Journals over sessions, then claims, receipts, points, ranges, relation dependencies and writes. |
| `documents` | Authoritative row revisions and current pointers into those revisions. |
| `documentIndexes` | Index/search/JSON/unique projections over row revisions or current pointers. |
| `relations` | Physical current edges and adjacency versions over clocks. |
| `relationReadiness` | Physical builds/readiness, followed by semantic validation/readiness. |
| `buildReadiness` | Index/search/unique/candidate build state, maintenance obligations and physical-definition lifecycle. |
| `applicationRevisions` | Candidate, analysis and revision provenance over clocks. |
| `applicationLegacyPublications` | Retained publication, function, task-catalog, schema and readiness contracts over revisions. |
| `applicationEffects` | Action invocations and external-effect attempts over clocks. |
| `taskRuns` | Task definitions, runs, requests, attempt identities, requested effects and repair state. Runs retain their exact Application revision-schema dependency. |
| `taskCompute` | Pending compute, dispatch and cancellation over runs/requested effects/definitions. |
| `executionRecovery`, `retainedHistory` | Distinct mutation-redelivery and retained-history scheduler contracts. |
| `legacyPersistence` | Retained persistence families used by package/document/index/commit/outbox repositories. |
| `sync` | Existing freshness and live-query connection/subscription/delivery storage. |
| `legacyInvokeSessions` | Retained invocation session and dependency/write storage. |

Retained Declarative storage has a separate dependency chain:

1. `legacyDeclarativeCandidate` owns candidates over scope clocks.
2. `legacyDeclarativeRuntime` owns projections and function-group metadata;
   `legacyDeclarativeVerifier` owns verifier attempts, commands and evidence.
   Both depend on candidates.
3. `legacyApplicationRevision` owns the exact verifier/catalog-backed revision
   and request contracts consumed by retained revision readers.
4. `legacyDeclarativeActivation` owns verdicts and activation history/heads over
   those candidates, verifier facts and revisions.

Retained declarations preserve their named migration-drain, verifier/revision,
activation and task consumers. Their presence in declaration exports does not
add them to the generator's live-schema selection or authorize retirement.

## Foreign keys and initialization

Dependencies point from child declarations to their actual parent modules.
Application task catalogs stay beside publication metadata: readiness references
the catalog, while task runs separately reference the revision schema. Moving
catalogs into the task-run module would introduce a publication/task cycle.

Keep lazy inline-reference and extra-configuration callbacks intact. The
semantic-readiness origin and retained Declarative previous-activation foreign
keys refer to their own table inside the callback. Companion Application read
bindings also refer to a later activation declaration through a lazy callback.

`transactionJournalPointDependencyCheck` remains with the journal declarations.
Installation writer protection consumes that same SQL expression to verify the
durable CHECK; a second expression would create a competing contract.

Companion commit facts/events depend on headers and document revisions.
Framework artifacts depend on deployments; framework installation depends on
migration coordination; plan bases depend on both; data binding depends on
installation and clocks. Current relation-aware Application publication depends
on revision provenance and relation readiness, activation depends on readiness,
and write ownership depends on activation.
