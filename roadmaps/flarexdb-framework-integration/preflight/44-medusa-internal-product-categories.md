# Internal Product Category compatibility

Status: complete, privately admitted on PGlite and ordinary-role PostgreSQL.
Baseline: Record 43, commit 93d75c30. Pinned Medusa:
48d5cc675e4e8bc821e22c20c88a751acc66fb5f.

## Direct-call event decision

The approved slice calls the real request-owned ProductCategoryService through
six named private adapter commands: list, listAndCount, retrieve, create, update
and delete. It does not redirect calls through public module methods, expose a
live manager, or admit Category softDelete/restore.

The pinned Category create/update overrides do not register the generic internal
service subscriber and have no EmitEvents decorator. The public create method
adds handle normalization, serialization and its manual created-event builder;
none of those publication steps belongs to a direct internal call. The pinned
Drizzle dispatcher returns without aggregation when the context has no subscriber
or aggregator. Category delete explicitly supplies its subscriber, whose module
interceptor also returns when no messageAggregator exists. InjectManager and
InjectTransactionManager borrow the request's authenticated manager; neither
creates an event aggregator.

The adapter therefore retains the actual source callbacks and context, without
adding an aggregator or suppressing any callback. Its event policy authenticates
zero emitted messages for precisely the three internal Category write commands.
It allows only Category writes appropriate to that command and the DML-derived
Category/Product membership pivot on create/delete. Every relational fact remains
in the shared outer commit. Lifecycle observations, unrelated rows and fabricated
events fail. Existing public event requirements are unchanged. No shared-core
owner change is needed.

## Implementation and retained boundaries

- Raw internal entity, array, count and delete-ID results use the existing
  Category projection codec before crossing the JSON command boundary. Missing
  retrieve IDs still reach the source's exact quoted productCategoryId error.
- Parent filters accept bounded ID arrays. Exact parent_category and
  category_children relation hints are delegated to the source tree hydrator;
  unsupported relations still fail. No second tree loader was introduced.
- Whole update arrays are validated before service execution. Existing tree
  cycle, reserved/dotted ID, external mpath, rank, scoped-link and resource
  checks remain. Later service/DAL failures roll back earlier members.
- The complete original internal Category file is copied byte-identically.
  Its two duplicate full titles each execute; the coverage reporter now compares
  exact name multiplicities. Missing, excess and unexpected cases fail.
- Narrow wrapper/source aliases and promotion provenance cover the original
  file and authored harness. The historical remaining-case inventory is retained.

## Initial diagnostic evidence

The first PGlite run passed all 31 unchanged originals, including the deep
electronics subtree move and both duplicate-title declarations: 134.97 seconds.
Final regression and completion receipts follow below.

Original SHA-256:
c724ea052769d3ce2969dad377835a603dfb568edb9c7aecea881ee79a83654b
Existing Category fixture SHA-256:
86a83b8341e5aa49f88a509b2a938ec4a3f60bf1146c76ed026738d55ea655b0

The following separate slice is the 23-declaration internal Product file in
Record 43. This Category admission does not establish Product internals,
workflows, Module Link storage, durable event publication, public serving,
broader Payload integration or production readiness.


## Focused validation and review

- PGlite: 34 passed (31 unchanged originals plus three boundary guards), 143.33s.
- Ordinary-role PostgreSQL 18.3: the same 34 passed, 115.84s.
- Seven query/metadata/decoder/projection/coverage unit files: 94 passed.
- Source/promotion guards: 38 passed. The promotion verifier authenticates 360
  files across ten private packages; the source-island boundary check passes.
- All three strict adapter compiler projects pass.
- Main core/diff lint gates pass. Both required reviewers report no findings;
  the TypeScript reviewer independently passed both lint gates. Full regression
  and staged-snapshot receipts follow.

- Browser bundle: 640 inputs, no Node, ORM, database or source-island runtime
  imports. Source verification: 8,496 files, zero symlinks, unchanged pinned fork.

## Regression receipts

| Lane | Ordinary-role PostgreSQL | PGlite |
| --- | --- | --- |
| Internal Category: 31 originals + 3 guards | 34 passed; 115.84s | 34 passed; 143.33s |
| Nine-file combined Product | 182 passed, one upstream skip; 235.81s | 182 passed, one upstream skip; 252.92s |
| Public Categories and boundary guards | 26 passed; 96.29s | 26 passed; 121.05s |
| Local Product transaction regressions | 33 passed; 94.55s | 33 passed; 120.48s |
| Currency regressions | 19 passed, existing driver skip; 39.71s | 20 passed; 58.90s |

Durations are Vitest wall-clock receipts, not performance claims. The expanded
active inventory contains 182 admitted declarations and the original skip across
nine complete source files. The two internal Category declarations with identical
titles each remain present and execute independently.


## Completion

The Product build and strict source-guard JavaScript compiler passed. The
published promotion manifest authenticates the final source and available build
outputs. Both reviewers cleared the final runtime/test diff; subsequent changes
were documentation and receipts only. The exact index diff check and staged Oxlint gate passed immediately before
committing this slice.

The owned PostgreSQL fixture was stopped after its final Currency run; pg_ctl
status confirms no server running. Its ordinary role had superuser, createdb,
createrole and bypassrls all false.

Next: the separate 23-declaration internal Product slice from Record 43, beginning
with its concrete update/query/static-metadata preflight against this baseline.
The Category slice is complete; no broader compatibility or production gate is
implicitly opened.
