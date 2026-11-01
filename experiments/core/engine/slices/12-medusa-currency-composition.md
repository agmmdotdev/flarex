# Currency and three-source composition replacement

Status: **Bounded replacement implemented after independent current/source/design
challenge, peer exchange and existing-consumer characterization. Shared source,
value, transaction and host owners execute the selected genuine consumer through
five-table persistence. Broader native, hosting, retained-data, performance and
named Legacy retirement gates remain open.**

The [full goal](../GOAL.md) selects the existing genuine Currency service plus
the native Payload/hooks announcement as the next connected replacement. The
selected profile combines Currency, Payload Local API and a trusted Application
insert in one explicit private command. This does not activate general developer
Application/native composition, arbitrary Medusa methods or all branches of the
large logical Currency fixture.

## Existing consumer and required behavior

The executing Medusa fork is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`,
package baseline 2.13.4. Default Currency model/service resolution selects the
promoted `dist` exports. Reuse the genuine service, repository seam, normalization,
DTO conversion and selected query policy. Preserve the native list/listAndCount/
retrieve surface and the trusted internal upsert used by the announcement and
123-row initializer. A native model does not authorize all of its exported API.

The later genuine Local API case in
[currency-announcement.test.ts](../../../../packages/medusa-adapter/test/currency-announcement.test.ts)
is the principal mixed consumer. Its earlier direct CMS-document case does not
by itself prove Payload lifecycle behavior. The genuine case covers hooks,
replay, caught failures, invalid/unresolved transaction IDs and cancellation.

The outer owner uses one bounded lifetime projected into Commerce, CMS and
Application children, then one seal and publication/outcome. Currency runs
before CMS, then the trusted Application insert/pending read. Events, CMS
relations and preferences are not admitted by this particular profile. Preserve
these refusals and callback-free replay. Replace the long SQL transaction and
old materialize/publication assembly; no database transaction may span hooks.

Application participation executes a trusted schema-validated insert, not a
developer handler. The old fixture directly settles a constructed manifest into
the analysis repository. Its authenticated source record does not establish
analyzer or `users:create` execution. Install an authentic schema-only Application
source through the responsible producer with zero published programs; do not
carry unused fabricated function identities into the replacement.

## Resolved visibility challenge

The existing root uses `runRelationalSession(..., "command")` and READ COMMITTED.
Currency/CMS working sets omit `snapshotCommitSeq`. Current-row reads capture
a clock at least as new as the entry clock, then cache first bodies, absences
and selected memberships. The entry KEY SHARE protects lifecycle while ordinary
publication's NO KEY UPDATE can proceed. A common clock does not freeze data.

The decisive owners are
[cross-domain host](../../../../packages/persistence-postgres/src/frameworks/crossDomainCommand/host.ts),
[relational session](../../../../packages/persistence-postgres/src/database/relationalTransaction/session.ts),
[working set](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts),
[current row reader](../../../../packages/persistence-postgres/src/storage/documents/appRows.ts)
and [scope clock](../../../../packages/persistence-postgres/src/scope/scopeClock.ts).

Preserve Native11 first-observation/current-demand semantics for this private
native root: touched A stays remembered after a competitor changes it, while a
later untouched B can observe that competitor's publication. The three child
views share pending writes, observations and budget. Ordinary Application OCC,
standalone snapshot reads and future borrowed developer-function profiles remain
separate. The initial fixed-S suggestion was rejected during peer challenge.

## Identity and exact-value findings

Currency `code` is a native logical primary key. Old internal IDs are random;
native retrieve lowers to repository find/code uniqueness, not a deterministic
missing document ID. Keep generated Source IDs and resolve `code` through an
ordinary shared index and primary uniqueness. Code stays reserved through soft
deletion. Hard delete/recreate can allocate another internal ID.

An empty code query records empty owner membership; create/hard-delete ABA can
restore it. A repeated code lookup returns its remembered body and validates
that revision at settlement. Actual code-array membership expands into scalar
selections and prefers each unique slot. Its later scalar retrieval repeats a
slot already captured. In contrast, the default empty-selector ASC list uses
`window.page`, reads the code index and hydrates bodies without capturing their
unique slots. After a competitor updates a captured body, its first scalar code
lookup fails immediately at the owner/body revision check. That ordinary page
does not set the old working set's semantic complete-table `scanned` flag.
Preserve complete-table, ordinary range/page, first unique and repeated unique
captures separately. The earlier assumption that Currency IN required ordinary
interval unions was rejected by the executing query planner and race witness.
Do not invent a stronger primary-absence event mode because a column is called
a primary key, or silently turn the native ordinary page into a table capture.

The selected query policy uses only code predicates/sets/Boolean combinations,
code ordering, deletion visibility, projection, windows and counts. Exact
`rounding`/`raw_rounding` storage, defaults, timestamps and declared numeric rules
are required. Decimal range/ordering indexes are not selected by this consumer.
The executing `decimal_digits` declaration lowers to `doublePrecision`; do not
tighten it to int32. Integer bounds apply to actual integer columns. Raw numeric
precision 20 is the native default, not the only accepted precision.
Reuse existing shared exact-value/relational validation helpers after a dependency
audit; native metadata selects these rules. A Currency-specific Core exception
or adapter-local integrity repair is not the destination.

## Core translation and coordinated ownership

- Compose authentic per-source definitions before the existing Source schema
  proposal/build/validation/activation. Keep one complete schema per real Source
  namespace. `ByComponent` identifies a component, not a producer label; no
  separate CoreDatabase or fake component namespace per framework is introduced.
- Reuse `LogicalSchemaSourceSchema`, including document/relational definitions,
  bindings and source identities directly. Keep the existing mandatory-
  Application candidate v2 with its named retained consumers; the new Core
  bundle does not require fabricated Application analysis for native-only use.
- Lower qualified names such as `commerce.currency/currency` to legal Core
  identifiers through one stable authenticated mapping. Bind original logical
  identities to real table records. Do not derive table identity from mutable
  whole-bundle/configuration hashes or add per-module physical catalogs.
- Keep each producer and native command/outcome identity independent of unrelated
  bundle contents. The selected composite execution closure supplies its own
  request identity. Preserve Native10/11 single-source cold metadata and replay.
- Translate Source's same-transaction child ownership through confined views
  over the existing semaphore, writes map, index state and finalizer. Do not
  widen one native grant to every source. Application tables retain Application
  ownership; the trusted insert child receives only its admitted capability.
- Reuse shared native observation, primary/unique, row/default/exact-value and
  final acceptance owners. Native query-set lowering remains bounded and owned
  by Core; native service adapters translate arguments/results and lifecycle.
- Reuse the native Promise/full-Cause bridge and bounded lifetime projections.
  Inspect Medusa's executing foreign boundaries before claiming equivalent
  cancellation/rejection behavior. A caught failed nested command poisons this
  root; Source catchable child rollback is not imported implicitly.

Pinned owners are `database/src/bootstrap_model/schema/mod.rs`,
`common/src/schemas/mod.rs`, `value/src/table_mapping.rs`,
`value/src/table_name.rs`, `database/src/transaction.rs` and
`isolate/src/environment/udf/async_syscall.rs` at `db914cf06`. The existing
[nested-failure divergence](../divergences/application-nested-failure.md)
records the current Source checkpoint and retained failure distinction.

The selected API/file ownership and necessary native mechanism records have been
handed to coordinated workers. Existing-profile races establish the distinctions
above before the new runtime is used. Implementation and bounded owner proofs do
not themselves establish genuine consumer cutover or full-goal completion.

## Selected implementation contract

The [schema composition](../divergences/native-schema-composition.md),
[root participation](../divergences/native-root-participation.md) and
[relational values](../divergences/native-relational-row-values.md) records own
the necessary native differences. Coordinated workers implement these through
the existing owners; they are not permission to change ordinary Application
semantics or introduce another persistence engine.

- Analysis issues an opaque schema-only Application source by invoking the real
  analyzer with the actual schema definition and empty execution modules/maps.
  Reuse its projection; do not accept a caller-authored manifest/hash as proof.
  The selected bundle publishes `programs: []`.
- `CoreSchemaBundle` seals genuine native definitions plus optional authentic
  Application source, complete derived schema and stable table bindings. Fresh
  installation/identical retry use existing proposal/build/validation/activation.
  Non-App qualified coordinates use the versioned full-SHA256/lowercase-base32
  mapping in the schema record. Existing App/Payload names and source identities
  stay exact, including their target `scopeUuid` and `epochUuid`.
- `CoreDatabaseOptions.schemaBundles` supplies the expected opaque construction
  proofs before cold bootstrap. New tagged bundle metadata requires full source,
  policy, validator, binding and index closure authentication. Thread proof into
  candidate authentication; keep the old untagged Payload reader unchanged.
  The ordering mutex folds already authenticated maps without hashing or I/O.
- Add explicit `nativeRoot` identity to the existing request owner. A sealed root
  selects native bindings/commands and one table-bound Application insert grant.
  One `beginNativeRoot` creates the kernel; immutable child closures share writes,
  pending indexes, observations, semaphore, root time and finalization. No child
  begins, claims, settles or independently recovers an outcome.
- Preserve captured identity caps per source: Payload 256, Currency 128, trusted
  App insert 1, with a finite aggregate bound 385. Share the existing 64-call,
  1 MiB retained-byte and original 10-second lifetime; each source document cap
  remains 64 KiB. The old joint final materialization limit counts at most 128
  final changed user identities, including equal-body attempted updates and
  existing-row tombstones, excluding new insert-then-delete and system records.
  Check the existing coalesced writes at finalization; per-stage Source write
  accounting is not an equivalent substitute.
- Retain automatic scalar/unique selection. Currency's ordinary index page
  requires bounded native page observations through the existing index snapshot
  and observation owners. Preserve the actual examined windows, cursor and EOF
  obligations, including physical minimum batch 16 and successor examination;
  a complete range followed by slicing overcaptures small pages. Validate the
  declared index and preserve remembered membership/body coherence. Count is a
  separate same-root observation, as in the executing native owner. Do not use
  the ordinary Source snapshot scanner or invent a new query AST for this seam.
  The [native page record](../divergences/native-index-page-observations.md)
  owns the examined-window versus physical-guard distinction.
- Commerce supplies a Core-backed row store and its existing native command
  context. Medusa's Promise owner and Payload's full-Cause/Exit bridge drain their
  foreign continuations and project failures into one root lifetime. The outer
  cross-domain host alone claims, invokes, drains, seals, finalizes and commits.
  Replay returns before callbacks; uncertain settlement stays with Core recovery.
- Genuine default Currency initialization uses the existing native Core request
  owner with its actual producer descriptor/dataset and source-ordered batches.
  The [initialization record](../divergences/native-source-initialization.md)
  specifies callback-free replay, bounded key-presence emptiness, readiness,
  explicit matching-failure reclaim and durable claim-revision fencing. Ordinary
  failed-request behavior is unchanged by that selected capability.

Ownership is split between schema/analysis/database identity, shared row values,
the transaction kernel, and the native host/consumer cutover. Workers reserve
overlaps and exchange exact APIs before dependent edits. Root owns this plan,
divergence records, PostgreSQL lifecycle and final integration/preservation.

## Executing replacement and retained consumers

The selected producer path is analysis's `prepareApplicationSchemaSource`,
Payload's existing compiler and Medusa's `compileCurrencyCoreDefinition`, followed
by `makeCoreSchemaBundle` and the existing Core schema lifecycle. Runtime uses
`commerceTransaction/nativeHost.ts`, `nativeStore.ts` and the current
`crossDomainCommand/host.ts`/`nativeParticipants.ts`. The real Currency service,
Payload Local API/hooks and limited App insert borrow one kernel; they do not
construct the old relational session or settle contributions independently.

`core-currency-fixture.ts` reuses existing five-table physical fixture owners.
The selected announcement and observation tests use it. They retain genuine
native behavior and replace old physical claim/fact/clock layout assumptions
with user documents/revisions, exact outcomes and atomic publication. Stored
exact/raw corruption cannot be hidden by a code-only projection. Cold replay
and initialization retry retain source identity and one durable outcome owner.

`makeLegacyCurrencyAnnouncementHost` remains only for
`logical-cross-source-admission.test.ts`, whose whole installation includes
Product/strong-reference extensions. The
[optional-one continuation](./14-native-reference-integrity.md) migrates
`jointApplicationRelationsScenario.ts` and its two driver wrappers to the current
native root. Product/strong-reference migration now owns removal of the remaining
Legacy host, participant, publication and materialization/projection closure.
The current host has no fallback to it.

The existing broad `commerce-adapter` barrel remains with named borrowed/atomic/
workflow consumers. Current selected hosts execute no old SQL session/admission/
contribution/materializer route, but this does not establish a clean native
Cloudflare bundle or hosting proof. Retire that broad implementation export
closure with its remaining consumers and native hosting gate. General Medusa
modules, relations/events and ordinary developer-function/native composition
remain outside this selected activation.

## Proof, cutover and retained paths

Prove the real Currency service and genuine Local API mixed command on PGlite
and ordinary PostgreSQL separately. Preserve exact companions/defaults and
corruption refusal, code uniqueness through soft deletion, seed replay, hard
delete/recreate, output/projection and failure classification. Cover shared
pending reads, untouched-later visibility versus stable originals, cached code
membership, first unique coherence, wrong-source capabilities, same-key races,
sticky failure, unresolved native work, cancellation, lost acknowledgement,
cold replay without callbacks and one atomic result/publication. Verify no SQL
transaction is held over the controlled native hook.

Replace old physical claim/fact/table-count and preparation-count assertions with
semantic rows/indexes/outcomes/history and selectivity on the five-table owner.
Fresh multi-source installation includes idempotency, interruption/reopen and
authority/readiness refusal. Unsupported source changes preserve the prior ready
combination; this does not implement general populated-data evolution.

The generic `logical-currency-fixture.ts` has 172 import consumers spanning
Product, Pricing, Inventory, Links and other profiles. Do not globally swap it.
The old announcement host also serves `logical-cross-source-admission.test.ts`
and `jointApplicationRelationsScenario.ts`. Migrate matching admission assertions;
retain Product/strong-reference/relation consumers explicitly under their later
gates, naming the displaced host Legacy where it remains. No fallback from the
new bound host to that implementation is allowed.

Native Cloudflare hosting, broader Medusa/mixed profiles, retained external data
and complete-request performance remain goal gates. Source ID-generator parity
is tracked separately in [Q11](../OPEN-QUESTIONS.md#q11---transaction-scoped-source-id-generation).
