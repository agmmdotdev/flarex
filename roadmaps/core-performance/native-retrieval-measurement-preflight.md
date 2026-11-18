# Paired native Product retrieval measurement

Status: **bounded native scalar/collection measurement complete; runtime redesign
and broader performance acceptance pending.** This is the first evidence gate in
[orchestration reassessment](orchestration-simplification-preflight.md).

The [artifact ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#final-measured-result)
owns the matched quiet, trace and server observations, complete DTO/missing-error
parity, runtime/build identities, setup and limits. The selected native demands
expose extensive protected standalone admission/proof work before native Product
execution. [Read-admission construction](./read-admission-construction-preflight.md)
and fresh Application acceptance are delivered under their separate contracts.
The owner-selected next goal is the
[complete standalone read refactor](./orchestration-target-design.md#next-goal-complete-standalone-read-refactor),
under the [selected first-slice contract](./standalone-read-redesign-preflight.md).
Query-required readiness, bounded immutable reuse and managed installation
integrity now have an accepted target amendment; runtime is not implemented.
The successor preflight selects complete native latency and unrelated-schema
scaling budgets. This historical measurement establishes no new private
finite-profile equivalence, hosted acceptance or implemented runtime change.

## Outcome and scope

Compare genuine `retrieveProduct` demand and complete selected results using the
pinned native MikroORM/PostgreSQL Product module and the promoted Product module
on Flarex's existing standalone CommerceHost. Measure scalar retrieval, selected
collection population and native missing-product errors. Use deterministic public
`createProducts` and `createProductCollections` seeding in both lanes. No mock
repository, handwritten SQL control, DTO projection, timestamp normalization or
private mixed-profile admission extension is permitted.

The measurement files own observations only. Production runtime, proof timing,
source admission, transaction profiles, framework adapters and pinned sources are
outside this slice. Database resources and Git operations remain root-owned.

## Existing owners and native identity

Native construction reuses pinned `medusa-test-utils/src/module-test-runner.ts`,
`module-test-persistence-adapter.ts`, `init-modules.ts` and the real Product module
resolved from its built output. Select the exported MikroORM persistence adapter
explicitly. Its normal module bootstrap constructs native repositories. The
Flarex lane reuses `test/support/logical-product-runner.ts`: native create commands
use its existing atomic writer; retrieval invokes `reader.read(runtime.commands.retrieve,
input)` through CommerceHost. No new test implementation of storage behavior is
needed. The dedicated paired lane selects the existing protected-runtime
PostgreSQL fixture through one optional test-only runner argument, forwarded to
`logicalCurrencyFixture`'s existing `protectedRuntime` option. Ordinary promoted
upstream/PGlite runner defaults remain unchanged. This avoids measuring the
unprotected canonical slow path as though it were the accepted PostgreSQL
performance profile; production proof/admission behavior is unchanged.

The pinned fork is identified by `third_party/medusa/SOURCE.json`. The promoted
and pinned complete Product sources differ in portable imports, repository/type
seams and optional Collection mutation construction. They are different
constructors. `retrieveProduct`, `getProductFindConfig_` and
`buildVariantImagesFromProduct` have unchanged bodies; record source hashes and
method comparison with each evidence set. The comparison is pinned native versus
promoted retrieval with method-source parity, **not identical-constructor proof**.

Native integration witnesses are `product.spec.ts` and
`product-module-service/products.spec.ts` in the pinned Product integration tests.
The dedicated comparison config does not import the admitted-upstream coverage
reporter, whose all-case completion contract is incompatible with this focused
measurement.

## Frozen demand

Seed Product `{ id: "prod_native_compare", title: "Native retrieval", handle:
"native-retrieval", status: "published", discountable: true, is_giftcard: false }`.
Scalar config selects exactly `id`, `title`, `handle`, `status`, `discountable`,
`is_giftcard`, with `relations: []`. The collection case also publicly creates
`{ id: "pcol_native_compare", title: "Native collection", handle:
"native-collection" }`, attaches it with `collection_id`, and selects `id`,
`title`, `handle`, `collection.id`, `collection.title`, with `relations:
["collection"]`. Assert the complete returned shape against both the frozen
expected DTO and the other lane. Native relation loading also retains
`collection_id: "pcol_native_compare"`; include that join field in the complete
expected DTO. Both genuine native and protected Flarex return the same complete
selected collection DTO with this field. Retain it without projection or
normalization; selected fields alone do not justify dropping a native join field.
This establishes the result-shape contract, not a timing conclusion.
Compare native `not_found` type and full message
for the same missing ID. Preserve unexpected failures as failed raw samples.

## Measurement separation

- **Quiet:** serial paired order alternates between lanes, declared warm-up and
  sample counts, warmed database/module process. Native module construction is
  reused; Flarex retains its actual fresh per-read request lifetime. Each interval
  includes the entire service/host call and Promise settlement. Assertions,
  source hashing, serialization for evidence and setup are outside the interval.
  All samples, failures and outliers remain. No spies or query instrumentation.
- **Trace:** separate serial invocations observe real native/promoted retrieval,
  internal retrieve, repository find/serialization and pg client dispatch. Record
  SQL, connection identity, start/end offsets, result rows and JSON result bytes
  where observable. SQL statements carry their actual BEGIN/COMMIT/ROLLBACK and
  autocommit evidence; joins/select-in and dependent phases must follow observed
  order. JSON bytes are not network wire bytes. Inclusive intervals are not
  additive CPU estimates. Unobserved work is unavailable, never zero.
- **Server:** separate diagnostic invocations take selected-database interval
  differences from `pg_stat_statements` with `track=all`. The measured databases
  are root-exclusive; include every executing role, including SECURITY DEFINER
  owners, rather than filtering to runtime login roles. Preserve each statement's
  `userid`, `dbid`, `queryid` and `toplevel`, alongside authenticated runtime role
  identities. Keep top-level and nested rows separate; inclusive parent and nested
  durations must never be summed. No global resets. Capture auto_explain nested
  logging separately when the root enables it. Function/trigger coverage remains
  unavailable unless instrumentation actually observes it. Snapshot queries run
  outside request observation on a privileged diagnostic connection to a third
  database such as `postgres`; reject an observer connected to either measured
  database. No unrelated work may run in the selected databases during intervals.

Native and Flarex share the declared PostgreSQL instance settings, sequential
concurrency and requested demand. Their real pool, ORM/context and request
lifetime settings are recorded, not claimed identical when construction differs.
Setup records fixture provisioning, module construction and deterministic public
seeding independently from retrieval. Native test bootstrap and Flarex fixtures
may prepare/drop their owned schema; run only against root-provided isolated
databases. Preserve environment/source/settings hashes without credentials.

## Validation, retention and completion gates

Retain existing point/handle component artifacts as diagnostic evidence only.
Retain native runner construction. Extend only the Flarex test runner's explicit
fixture-selection argument and forwarding to its existing fixture owner. Add dedicated test support,
config and evidence files under `packages/medusa-adapter`; remove unused new
scaffolding before completion. This measurement introduces no durable format,
runtime compatibility contract or migration obligation.

Before database runs: build missing or stale pinned Product and Link Modules
output and promoted Utils and Product output from their owning sources; check focused
types and test collection; root reviews construction, equality and instrumentation.
The optional harness is isolated in
`packages/medusa-adapter/benchmarks/core-performance/native-retrieval/`, using its
own `tsconfig.json` and `vitest.native-retrieval.config.ts`; ordinary adapter tests
and typechecks do not acquire a pinned-native build/bootstrap prerequisite.
The adapter declares measurement-only `pg` and `@types/pg` development dependencies
at the already installed workspace persistence versions; the benchmark owns its
direct SQL diagnostic dependency rather than importing it through another package.
Use an existing explicitly named native database with schema `native_retrieval`,
preserving the root-installed statistics extension in `public`. Before bootstrap,
configure the native role in that owned database with
`search_path=native_retrieval,public`: the pinned generator qualifies table creation
but emits unqualified index targets. This is native bootstrap configuration, not
a source patch or business-query change. Record `search_path` from each actual
runtime; native and Flarex schema paths differ intentionally and are not included
in shared-setting equality. Record actual
runtime role/database OIDs and settings from the native repository manager and
both Flarex pools outside intervals; compare shared PostgreSQL settings. Capture
settings observable by each ordinary runtime role and mark restricted or unknown
settings unavailable without granting extra privileges. The diagnostic observer
records its own identity and instance settings independently. Select the full
measured database set from the authenticated runtime observations, preserving
statement role identities without excluding SECURITY DEFINER owners.

The dedicated measurement config externalizes promoted `medusa-*/dist/` CommonJS
files to their normal Node module loader. This preserves generated module receivers
and per-tree compiler helpers when pinned bootstrap dependencies also load legacy
helpers; no global helper replacement or business-source patch is admitted.
Record executing promoted Product and internal-service module resolution, source
and built-output hashes, compiler configuration and relevant helper/package
provenance. Include the required pinned Link Modules built entry point and native
bootstrap outputs. Hash source and executing built files before/after measurement
and reject concurrent drift; method-body parity does not make constructors or
build/loading environments identical.
Evidence reports the failed stage explicitly, with observed retrieval count and
parity/measurement completion; a bootstrap failure does not become retrieval evidence.
Then run ordinary-role PostgreSQL scalar/collection parity and native missing
errors before quiet samples. Run trace and nested-server diagnostics separately,
record all failures and setup, and inspect the complete ledger before attributing
amplification. Existing PGlite consumer regressions remain the behavioral lane;
PGlite is not the native MikroORM control. Both project reviewers review the
final measurement diff before root-owned scoped commit. This closes the native
measurement gap only; numerical ceilings and runtime redesign remain gated.
