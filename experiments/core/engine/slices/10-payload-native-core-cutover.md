# Managed scalar Payload core cutover

Status: **Bounded fresh scalar replacement implemented; broader native, retained-data, hosting and performance gates open.**

This slice follows the [goal](../GOAL.md), [replacement workflow](../REFACTOR.md)
and [shared installation contract](../../../../design-notes/flarexdb-shared-schema-lifecycle.md).
The independent current-owner, accepted-design and Convex challenges inspected
committed Flarex `6a4dc3c5d83ae285e8779da914a972639ef2832a`, Convex
`db914cf06e2b06ee985646611b9e12ed7a770318` and executing Payload 3.88.0,
then exchanged counterexamples. Main's paused changes are separate evidence.

## Selected connected outcome

Move the existing source-backed CMS-managed scalar consumer to the translated
five-table owners: fresh logical installation, authenticated producer/write
ownership, required-text uniqueness, genuine Payload Local API create/update,
find/findByID/count, request lifetime, durable outcomes and cold reopen.
The [managed-read witness](../../../../packages/medusa-adapter/test/logical-payload-managed-read.postgres.test.ts)
uses `news.title` uniqueness and seeds through the native writer. Its access,
sanitized-query, 403/404, read-only and closed-binding behavior remains required.
A point-only host would silently narrow the existing read interface.

Required-text uniqueness is necessary for this selected consumer, not for every
possible Payload configuration. Nonunique scalar configurations compile, but
that construction alone supplies no existing storage consumer/removal boundary.
Compound, nullable and conditional uniqueness remain named later consumers;
the full compound `payloadUniqueScenario` is not declared migrated by a title-only
replacement. Preserve the necessary concurrent title-key and error witnesses.
Keep the current source delete/preferences refusal and relationship gates.

## Resolved challenges

- Application-owned Payload view metadata already compiles, but
  [read projection](../../../../packages/persistence-postgres/src/storage/documents/logicalReadMetadata.ts)
  deliberately excludes view-only sources from serving authority. No executing
  view reader was established. Adding it first would create a new serving profile.
- Currency is not a scalar shortcut: its executing native model has a natural
  `code` identity and exact `rounding`/`raw_rounding` obligations. Medusa identity,
  exact values and rich relationships retain their own connected migrations.
- Payload's adapter uses opaque text IDs, projects `_id` to native `id` and refuses
  custom/caller-selected IDs. Fresh source IDs need no speculative external-ID
  registry. Named retained IDs/outcomes still require inventory and disposition.
- Ordinary Convex indexes do not declare uniqueness; `v.id` validates identity
  shape/table, not target existence. Keep source mechanisms and add only the
  necessary [native write policy](../divergences/native-write-ownership.md) and
  [native uniqueness](../divergences/native-unique-constraints.md) extensions.

Reuse native collection sanitation, compiler/evidence, Local API access/defaults/
validation/hooks, errors/results and request-local dataloaders. Adapt confined
bindings. Extend existing schema/index/transaction/finalization owners; replace
the selected old catalog, relational session, working-set and publication route.
No native installer, claim-table authority or second execution engine is selected.

## Shared metadata and direct visibility prerequisites

Fresh setup uses the current authenticated publication-frame contract, including
`validatorIdentityEncoding: 2`. Shared evidence verification and retained-ownership
digest reconstruction use that contract and the authoritative V3 frame owner.
Source contracts capture semantic definitions and compare their authoritative wire
projections on both sides. Fixtures likewise distinguish semantic capture from
wire decoding. Keep marker/provenance/malformed-definition refusal coverage;
framework adapter repairs and generic Legacy fallbacks are not selected.

The old command session is READ COMMITTED, but its working set caches first
observed rows and absence; later untouched demands can select newer storage.
The translated CoreTransaction instead starts at one timestamp. Neither the SQL
label nor `maximumAttempts: 1` establishes equivalent native visibility.

The [direct native visibility contract](../divergences/native-direct-read-visibility.md)
is now characterized through actual full-proof and source-backed native bindings.
Touched rows/absence remain stable; untouched committed data can become visible;
pending writes remain visible. A changed observed row causes a final conflict,
while a disjoint untouched-row publication can be observed and the held root still
commits. Both cases execute native bodies once. The same native profiles accept
a unique-key create/rename ABA returning the observed title to absence before
settlement. The three-way mechanism challenge therefore selects qualified source
guards for equivalent point/frontier obligations and exact title-owner equality
after the complete accepted-pending fold. Relevant suffix events refresh pure
validation, not native callbacks or an automatic conflict. Keep the existing
indexed membership vectors, not a SQL isolation label, as evidence.
PGlite pending/replay proof is not ordinary PostgreSQL concurrency proof. Borrowed
Application participation retains its separately selected parent snapshot.

Known/pending duplicates must retain the authenticated native ValidationError
at the document checkpoint. A competing publication may instead cause the existing
late `writeConflict`: the concurrent unique scenario already permits the competitor
to finish while a root is held. Add neither universal callback serialization nor
automatic native body replay to manufacture a different error.

## Installation and authority closure

The existing native gate must reject every unsupported requirement rather than
project it away. Reuse source table mappings, active/staged schema checks,
enabled/pending indexes, bounded progress, pending overlays and ordered acceptance.
The old shared candidate's required Application analysis is not a reason to invent
developer functions for native-only installation or native command identity.
Translate that coupling at the shared owner into genuine producer/command metadata.

Initially admit only proven fresh empty tables and the selected constraints.
Reject populated upgrades, ownership transfers and unsupported resumes while
preserving the previous ready combination. Source implicit table creation makes
a caller's `fresh` flag insufficient: reserve/enforce native ownership throughout
admission/build, track the actual identity/data observations and recheck atomically
at activation. An empty Application-owned table is not a native ownership grant.

Bind exact producer/configuration, scope, table/version and read/write exposure.
Ordinary Application writes to managed tables must refuse, including known-ID and
implicit-create paths. A namespace, digest or profile label is not authority.
Trusted outer ownership alone settles; framework code receives no raw database,
scope clock, transaction or finalizer. Resolve committed outcomes before callbacks
and reconcile uncertainty before any unsafe reexecution.

## Implementation and acceptance gates

### Executing replacement and retained consumers

`core/nativePolicy.ts` derives the native definition from the actual captured
Payload producer and verifies its configuration, provenance, schema, indexes and
required-text constraints. Existing proposal/build/activation owners reserve and
activate policy in logical `_tables` and `_schemas` records. They refuse existing
Application identities, populated changes and unsupported mixed-source
replacement. Identical replay does not rewrite policy or invalidate a held root.

`CoreDatabase.bindNative` issues database-owned capabilities. Registering actual
trusted commands after data exists is independent of table installation. Native
claims, fencing, packed outcomes and recovery share the existing request owner,
with a native discriminant rather than an Application function path.

`core/transaction.ts` and `nativeObservations.ts` own semantic captures, pending
state and finalization. `nativeValidation.ts` and the existing committer own
published preparation, qualified dependencies, complete accepted-pending folds
and acceptance. Cached-key/point/table coherence and immediate owner-revision
refusal follow the [native visibility contract](../divergences/native-direct-read-visibility.md).
Application operations retain their source snapshot and event-conflict rules.

Explicit Payload native bindings reuse the same Local API, command registry,
adapter, sanitation, hooks, errors and request dataloaders.
`frameworks/cmsTransaction/nativeHost.ts` supplies confined document operations
and the existing bounded request lifetime over this core. It constructs no
relational session, old working set, unique claim table or old publisher. Native
Promise completion follows its [lifetime record](../divergences/native-promise-draining.md).
The two selected managed-read/visibility fixtures now install fresh source-backed
data through the five-table owner. No retained store is reset or read as fresh.

| Retained consumer | Remaining replacement gate |
| --- | --- |
| Full-proof scalar/indexed/compound-unique Payload scenarios and `operation-tracing.test.ts` | Complete supported predicates/constraints and migrate framework lifetime assertions. Their old physical inventory remains a control. |
| `logical-currency-fixture.ts` consumers, including Product managed reads, partial/conjunctive access and source-generation refresh | Medusa exact values/natural IDs and shared multi-source installation/readiness. The two selected Payload consumers no longer use this fixture. |
| Payload relationship/many/reverse readers and borrowed mixed participation | References, relation visibility and an authentic translated parent snapshot/lifetime. |

These routes supply no fallback from a new native binding. Their remaining
callers, data and shared constructors retire in their connected slices; this
bounded replacement does not complete the full native migration.

Stored native policy must be derived from its authenticated producer before
bootstrap serving and metadata publication. Matching an identity against a copy
of the same stored policy is insufficient: exact constraints, read exposure,
schema/index declarations and missing/orphan policy closure must agree. Shared
candidate validation stays outside the acceptance mutex; merged publication uses
that authenticated proof.

Consuming accepted-unpublished key transitions also requires the
[native durability dependency](../divergences/native-dependent-save-order.md).
Source pending independence permits arbitrary save subsets; native restoration
introduces prerequisites. Keep their save success distinct from publication ACK,
preserve atomic FIFO batches and independent save capacity, and prove failure
and reopen rather than inferring recovery from a successful pending fold.

### Coordinated runtime contract

The shared schema owner accepts the genuine producer contract, derives and
verifies its schema, policy and configuration, and rejects unimplemented native
requirements. A native-only installation needs no developer Application function
or fabricated program identity. Table reservations and pending schema records
settle together above the existing five physical tables. Build and activation
retain the same reservation; an existing Application-owned table is not fresh
native storage, even when empty. Ordinary implicit creation, known-ID writes and
schema replacement must honor reserved and active native ownership. Unsupported
cross-profile replacement preserves the previous ready state.

The database issues an opaque native binding for the exact installed producer,
namespace, selected table/index generations, policy and exposure. Trusted native
entry points use a genuine tagged native command identity through the existing
claim/outcome owner. The framework callback receives confined document operations
and its request lifetime; the binding does not expose a database, snapshot,
timestamp, claim, commit or finalizer.

The transaction owner retains one semaphore, pending write/index state,
accounting and finalization vault. Its native observation packet carries
timestamp-qualified event dependencies and exact unique-slot owner expectations
separately from writes. Fixed-snapshot native reads retain one capture across the
complete Local API call; direct commands obtain new captures only for uncaptured
demands. Each new capture checks selected policy and metadata before disclosure.
Semantic observations never arise merely from physical cross-index hydration.

The existing committer prevalidates that packet outside its acceptance mutex,
refreshes invalidated pure slot preparation, and folds complete accepted batches
before comparing terminal owners and applying candidate uniqueness. Pending-key
bookkeeping must retain every accepted writer when native removal/reacquisition
can overlap one full key. Publication, save order, fencing and source Application
event conflicts keep their existing owners. Outcome injection and result-only
commands preserve the packet through final validation.

Payload reuses its actual command registry, sanitation, hooks, error mapping,
request-local dataloader and bounded in-memory request lifetime. The selected
binding replaces the relational session/working-set/publication route. Remaining
full-proof, relationship and borrowed consumers may retain their named old route
until their connected migrations; there is no automatic fallback from the new
binding. Reusing framework admission is not permission to retain SQL settlement
under the translated facade. Implementation and activation remain subject to the
proofs below.

With the visibility contract and minimum mechanism selected, coordinate workers for shared
contracts/lifecycle, transaction authority/constraints/outcomes and native caller
migration; exchange contracts before dependent edits. Record exact changed owners,
retained consumers and data disposition. Remove the displaced selected route,
exports and choreography-only fixtures; keep native behavioral assertions.

Prove fresh install/replay and interrupted preparation, unauthorized/stale writes,
implicit-create races, unsupported-change refusal, native results/errors/access,
pending key release/reacquisition, same/disjoint-key races, rollback-only/cancel,
lost acknowledgement recovery without callbacks and reopen. Run PGlite and
ordinary-role PostgreSQL separately, then required host/consumer checks and both
project reviews. Node conformance is not native Worker deployment/capacity proof.
Other native targets, references, exact values, retained-data cutover, general
constraint backfill, hosting and complete-request performance remain goal gates.
