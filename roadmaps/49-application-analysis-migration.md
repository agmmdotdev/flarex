# Application Analysis Migration

## Status And Scope

**Status:** Accepted focused execution plan. The docs-first preflight is
complete and self-reviewed. Implementation is authorized through `AA-R8` and
must stop before `AA-R9` production cutover.

This plan owns the ordered replacement of the private Declarative V2 static
verifier with Application Analysis. It coordinates the existing analysis,
artifact, Standard Application, persistence, readiness, activation, runtime,
and test owners. It does not create a new analysis package, a new transaction
or commit path, a public route, a production binding, or a second authority for
one candidate.

Roadmap 17 remains the domain authority. This file owns the challenged
inventory, accepted contract cut, migration sequence, and exit criteria.

## Current Sources Of Truth

- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  owns the Application Analysis direction and `AA-R0` through `AA-R9`.
- [`../packages/analysis/src/index.ts`](../packages/analysis/src/index.ts)
  contains the portable runtime-registration inspection that the replacement
  should reuse.
- [`../packages/flarex-dev/src/executionArtifact.ts`](../packages/flarex-dev/src/executionArtifact.ts)
  proves cold module evaluation, import-time capability restriction, and
  repeated-analysis comparison locally, but does not provide hosted authority.
- [`../packages/flarex-backend/src/sourceArtifactV2/FinalizedContentReader.ts`](../packages/flarex-backend/src/sourceArtifactV2/FinalizedContentReader.ts)
  reads authenticated finalized Source Artifact V2 module bytes.
- [`../packages/standard-application-analysis/src/v1.ts`](../packages/standard-application-analysis/src/v1.ts)
  exposes the current historical static-verifier result. It must not be
  reinterpreted as the replacement result.
- [`../packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts`](../packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts),
  [`../packages/persistence-postgres/src/applicationRevisionReadinessV1.ts`](../packages/persistence-postgres/src/applicationRevisionReadinessV1.ts),
  and
  [`../packages/persistence-postgres/src/applicationRevisionActivationV1.ts`](../packages/persistence-postgres/src/applicationRevisionActivationV1.ts)
  own the current persisted registration, readiness, and activation contracts.
- [`43-first-flarexdb-system-api-vertical.md`](./43-first-flarexdb-system-api-vertical.md)
  and roadmaps 44 through 48 own the private runtime consumers that must be
  reproven after migration.
- [`durable-task-engine/preflight/08-application-revision-and-runtime-binding.md`](./durable-task-engine/preflight/08-application-revision-and-runtime-binding.md)
  owns the current task binding. Its V1 contract embeds old candidate,
  artifact, source-root, and semantic-root identities and therefore cannot be
  silently reused.

When these sources disagree, roadmap 17 and this accepted replacement plan own
the target. Existing code and exact V1/V2 codecs remain authoritative for the
old generation until their consumers and preservation duties are removed.

## Preflight Findings

### Reusable implementation

`@flarex/analysis` already has a small useful core. Given loaded execution
module namespaces and an optional loaded schema definition, it identifies
registered Flarex functions from runtime markers, treats handlers as opaque,
normalizes function and schema metadata, sorts deterministically, and returns
typed semantic failures.

The local Miniflare adapter already evaluates a fresh exact source package,
restricts import-time effects, disposes the isolate, and runs analysis twice to
detect registration nondeterminism. These are implementation references, not
new contracts or hosted evidence.

### Displaced implementation

The old generation spans substantially more than one analyzer file:

- `@flarex/analysis` private grammar, parser, linker, ABI, call-graph,
  progress, evidence, release, and verifier ports;
- the analyzer app's verifier HTTP and restart host;
- backend source/semantic read sessions, command production, dispatch, and
  evidence collection;
- executor HTTP verifier transports;
- Standard Application Analysis's exact registration-complete alias;
- Postgres verifier attempt, command, authority, evidence, candidate,
  application-revision, verdict, runtime-publication, readiness, and activation
  relationships; and
- system tests and private runtime target codecs that bind the old digests.

Removal is therefore a consumer migration, not deletion of
`declarativeV2VerifierV1.contract.ts` in isolation.

### Source Artifact V2

Source Artifact V2 already records immutable module source bytes, module path,
role bits, source digest, and the unique execution/schema/auth paths. The
replacement may reuse that exact generation without changing its codec or root
identity. The first manifest does not require source-map content or source
positions.

The existing finalized-content reader is coupled to old verifier budget handle
types. `AA-R4` must give the reader an analysis-neutral bounded-read interface
or a narrow adapter. Reusing Source Artifact V2 does not authorize reusing the
verifier's progress or budget protocol.

### Semantic Artifact V1 is not yet orphaned

Semantic Artifact V1 is the old verifier's declaration stream, but its root is
also embedded in current candidate-bound mutation, query, internal-call, and
edge-action runtime-target contracts. `TaskDefinitionRuntimeBindingV1` and its
durable Postgres rows also commit the semantic root.

Consequently `AA-R8` may stop producing Semantic Artifact V1 only after new
runtime-target and task-binding contract generations are active for the new
application revision generation. Old V1 bytes and rows must remain decodable
until their preservation inventory is empty. A new field with the same spelling
but a manifest digest is forbidden; that would reinterpret a concrete digest.

### Current Standard definitions are not cold-load authoritative

The current Standard definition separates canonical declared metadata from a
prebuilt module graph. Several private fixtures contain plain handler exports
or placeholder values, and the materializer rejects schema and auth modules.
Cold-loading those JavaScript bytes cannot discover the declared function
kind, visibility, validators, schema, or indexes.

The replacement must therefore migrate the private Standard producer and
fixtures to an executable registration bundle. Its execution module must export
the real registered function map, and its optional schema module must export
the real schema definition. The analyzer observes those loaded values. It must
not consult Canonical Declarative Program V1 or Semantic Artifact V1 as a hidden
second metadata authority.

Canonical Declarative Program V1 and the old materializer remain readable
compatibility contracts during migration. Their broader retirement is outside
this plan unless `AA-R8` proves they have no consumer after the analysis
migration.

### Persistence is a new generation

The current `fx_system_application_revision_v1` row and readiness receipt bind
the verifier attempt, verifier receipt, registration frames, and static-derived
runtime publication. Current verdict and activation rows also bind those
identities. They cannot be renamed or populated with new meanings.

The replacement needs additive application-named persisted contracts. Exact
DDL is owned by `AA-R5`, but the following are mandatory:

- a backend-issued application candidate identity bound to one Source Artifact
  V2 root;
- one analysis row with `pending -> analyzed | rejected` terminal settlement;
- exact canonical manifest and receipt bytes plus their SHA-256 digests;
- an application revision generation that references the new candidate and
  accepted analysis rather than an old verifier attempt;
- application-named runtime publication, readiness, and activation generations
  wherever the old row identity or canonical receipt changes; and
- no foreign key from a new generation to an old verifier, Semantic Artifact,
  declarative candidate, verdict, or activation table.

The repository currently has no configured PostgreSQL URL for named-environment
row inspection. Repository ownership describes these paths as private and
unshipped, but that does not prove every external database is empty. Additive
implementation may proceed. Destructive `AA-R8` migrations must refuse
nonempty or referenced old state, and `AA-R8` cannot complete its genuine
PostgreSQL retirement proof until an explicit test database is available.

### Runtime publication becomes whole-bundle publication

The static verifier currently derives minimal execution groups from a static
call graph. Application Analysis will not reproduce that graph. The first
replacement publishes the admitted immutable application module graph for each
required runtime group and selects a function entry by manifest path. Function
kind determines the group; the runtime host still determines capabilities.

Transaction and edge-action workers may therefore receive the same code graph
while receiving different bindings, outbound policy, syscalls, and execution
lifetimes. This is simpler and predictable. If the whole-bundle form exceeds a
measured Worker Loader or R2 ceiling, the implementation stops with evidence;
it does not restore static JavaScript analysis inside `AA-R6`.

## Accepted Contracts

### `ApplicationManifestV1`

`ApplicationManifestV1` is canonical UTF-8 JSON with a single exact field set:

```ts
interface ApplicationManifestV1 {
  readonly format: "flarex.application-manifest";
  readonly version: 1;
  readonly sourceArtifact: {
    readonly rootSha256: LowercaseSha256;
    readonly executionModulePath: string;
    readonly schemaModulePath: string | null;
    readonly modules: ReadonlyArray<{
      readonly path: string;
      readonly roles: number;
      readonly sourceSha256: LowercaseSha256;
      readonly sourceByteLength: number;
    }>;
  };
  readonly schema: ApplicationSchemaManifestV1;
  readonly functions: ReadonlyArray<{
    readonly path: string;
    readonly moduleName: string;
    readonly exportName: string;
    readonly kind: "query" | "mutation" | "workflowMutation" | "action";
    readonly visibility: "public" | "internal";
    readonly args: ValidatorJsonV1;
    readonly returns: ValidatorJsonV1 | null;
    readonly partition: ApplicationFunctionPartitionV1 | null;
  }>;
}
```

The schema and partition shapes reuse the already accepted Flarex deployment
semantics through analysis-owned types; they do not import the old verifier or
Semantic Artifact codecs. Modules sort by canonical path. Tables, indexes, and
functions use the existing deterministic analyzer order. Object keys have one
encoder-owned order. Duplicate function paths, duplicate module paths, missing
runtime entries, invalid registration markers, invalid validators, and invalid
schema relationships fail before encoding.

The exact first runtime entry is the manifest's execution module path plus the
function's module name and export name. The runtime loads that execution
module's default registration map and selects the same nested entry inspected
by analysis. It does not infer which dependency module originally defined the
handler.

Source positions, diagnostics, auth configuration, static references, call
edges, ABI sites, verifier arenas, progress cursors, parser state, and runtime
capabilities are not manifest fields. Auth remains unsupported in the private
replacement and is an explicit `AA-R9` production-cutover prerequisite.

### `ApplicationAnalysisReceiptV1`

The backend, not evaluated application code, creates the receipt. It is a
canonical tagged union with common fields:

- format `flarex.application-analysis-receipt`, version `1`;
- backend-issued analysis ID and candidate ID;
- trusted scope ID and Source Artifact V2 root;
- exact analyzer identity and policy identity;
- terminal status `analyzed` or `rejected`; and
- backend completion timestamp.

An analyzed receipt includes `manifestSha256`. A rejected receipt includes one
bounded stable failure code and bounded redacted detail. Receipt and manifest
bytes are stored by digest. A replay returns the first terminal settlement;
it does not mint a different receipt timestamp.

No persisted or transported `ApplicationAnalysisRequestV1` is needed for the
first private implementation. Host-neutral code uses an ordinary internal
input type. If a later service boundary needs a wire request, it receives its
own preflight and V1 codec rather than freezing an incidental function
parameter now.

### Error family and defect boundary

The first typed recoverable variants are invalid or stale authenticated source
input, import or module-link failure, invalid registration or schema metadata,
admitted-limit exhaustion, timeout or interruption, nondeterministic
registration, and retryable host or persistence integration failure.

Unexpected analyzer defects remain defects at the package boundary and become
redacted internal failures only at the trusted host. Application exception
objects, stacks, secrets, response bodies, and arbitrary logged values never
enter the receipt.

### First admitted profile

The first private profile is intentionally small:

- at most 128 source modules;
- at most 2,000,000 total source bytes and 1,048,576 bytes in one module;
- at most 1,024 registered functions;
- at most 256 tables and 1,024 indexes;
- at most 1,048,576 canonical manifest bytes;
- at most 100 diagnostics and 65,536 total diagnostic UTF-8 bytes; and
- a 30,000 millisecond whole-attempt deadline.

Every accepted run performs two fresh cold loads from the same authenticated
bytes. Equal canonical manifest bytes are required. A success/failure mismatch,
different stable failure classifications, or different manifest bytes is
`nondeterministic_registration`. Diagnostics are bounded observations and do
not participate in manifest equality.

The hosted policy supplies no application bindings or environment values and
sets outbound to `null`. Fetch, random bytes, wall clock, high-resolution time,
database, executor, R2 mutation, deployment, activation, and secret access are
absent or rejected during import. Deterministic substitutes may be installed
only by the host policy and are part of the analyzer policy identity.

## Migration Invariants

1. One candidate has exactly one analysis authority.
2. New candidates never fall back to the old verifier, compare acceptance with
   it, or dual-write its evidence.
3. Old candidates never become valid inputs to the new readiness or activation
   generation merely because their fields look similar.
4. The manifest digest is not a semantic-root, verifier-receipt, registration-
   root, package, artifact, or runtime-projection digest.
5. Whole-bundle publication changes code selection only. Runtime capabilities,
   OCC, commit compilation/execution, journals, idempotency, feeds, outbox, and
   authoritative application-row semantics remain with their current owners.
6. Temporary source-code coexistence is compile-time migration structure only;
   there is no request-time fallback or two accepted authorities.
7. Every new persisted or wire shape uses a new concrete contract generation.
   Historical V1/V2 decoders remain exact until their removal gate passes.
8. Destructive migrations are additive migration files with explicit nonempty
   and reference guards. Migration history is never rewritten.

## Challenged Roadmap Gates

### `AA-R1` — inventory accepted for additive work

The repository consumer and persistence inventory above is sufficient to begin
additive contract work. The original wording was too broad to require access to
every external database before writing pure code. Named-environment row proof
is instead a mandatory destructive subgate of `AA-R8`.

Exit evidence still required before removal includes no production consumer of
old analyzer or semantic authority, no old row referenced by a new generation,
and explicit zero-row or guarded-refusal evidence from genuine PostgreSQL.

### `AA-R2` — contract preflight accepted

The manifest, receipt, error boundary, determinism rule, admitted profile, and
new-generation rule above are accepted. The preflight rejects a request wire
contract, source positions, auth, static references, and resumable analysis for
the first migration.

### `AA-R3` — host-neutral core

**Completed by `15beb1fc`.** The final reviewed slice implements:

- analysis-owned V1 model, decoder, canonical encoder, digest input, and tests;
- pure lowering from the existing loaded-source analysis result plus exact
  source-module identity to `ApplicationManifestV1`; and
- no dependency on old verifier, canonical program, materializer, Semantic
  Artifact, backend, persistence, Worker Loader, or clock APIs.

Focused analyzer and contract tests, package typecheck, and the workspace
Effect-boundary check pass. Both required reviewers accepted the exact final
diff. The full package suite exceeded repeated bounded test windows without
emitting a failure and is recorded as timed out, not as passing evidence.

The root package may retain old exports during migration. New code uses plain
Application Analysis names; old exported contracts keep their exact names.

### `AA-R4` — trusted cold-load host

Implement one cohesive hosted slice:

- an analysis-neutral bounded Source Artifact V2 read adapter;
- analyzer-app Worker Loader configuration with no route or public binding;
- fresh module graph load, real execution/schema module inspection, two-load
  comparison, deadline/cancellation, bounded diagnostics, and cleanup proof;
- exact artifact-root and analyzer-policy correlation; and
- failure and defect redaction at the host boundary.

Worker Loader must prove fresh isolation and import-time restrictions. If its
actual lifecycle cannot prove interruption or release within the admitted
profile, stop and amend the host design; do not claim Miniflare disposal proves
the hosted behavior.

#### Live challenge and accepted amendment — 2026-08-11

Current code changes the implementation detail but not this gate's authority:

- `SourceArtifactV2FinalizedContentReader` authenticates exact R2 bytes but
  exposes old verifier budget/path handles. Application Analysis receives a
  narrow analysis-neutral reader that owns fixed admitted ceilings and projects
  only root identity, canonical paths, roles, source digests, and owned source
  bytes/text. No old budget, progress, or path handle crosses that adapter.
- The reader currently rejects every artifact with source maps. Application
  Analysis does not consume source maps, so the shared reader may gain an
  opt-in mode that validates source-map metadata and root totals without
  materializing source-map bodies. The existing default remains rejection, so
  old verifier behavior does not change.
- The installed Worker Loader contract provides fresh `load`, per-worker CPU
  limits, `globalOutbound: null`, and request-owned entrypoint capabilities,
  but no API that proves direct isolate destruction. The host therefore proves
  two uncached `load` calls, bounded CPU, outer Effect interruption, and
  disposal of every returned RPC capability. It must not describe this as
  explicit isolate disposal.
- The analyzer app gains only `ARTIFACTS` and `LOADER` resource bindings plus a
  named private RPC entrypoint. `workers_dev`, preview URLs, routes, and the
  default HTTP surface remain closed. The exact deployment posture and analyzer
  configuration identity must be regenerated rather than silently accepting
  the added bindings.
- Analyzer identity is the generated dynamic-core digest. Policy identity is
  an exact application-analysis policy contract covering compatibility date,
  CPU/deadline/diagnostic limits, import restrictions, and two-load byte
  comparison. Both are checked before source reads or worker loads.

**Decision: accepted for implementation.** Hosted workerd proof must show
fresh-load comparison, import-time outbound rejection, deadline behavior, and
RPC capability disposal. Local Miniflare may provide development parity only;
it cannot close those hosted lifecycle claims.

#### Implementation checkpoint and failed hosted lifecycle gate — 2026-08-11

Commit `55105371` implements the reviewed local AA-R4 candidate: the bounded
analysis-neutral Source Artifact V2 reader, exact generated dynamic core and
policy identities, two uncached Worker Loader loads, deterministic import
policy, deadline/interruption adapter, exact per-directory framework shims,
private analyzer RPC entrypoint, and failure redaction. The final local receipt
is:

- generated core `949b5cf2809b12dfa6f6000280e40b617640114e1b6b091bae912e24ea26fedd`
  from two byte-identical 319,369-byte builds;
- private analyzer identity
  `60404b4c64c9227fce6bde9badffc82d882252b59b9f33701df7143594a0364e`;
- 24 focused analyzer tests and 10 finalized-source-reader tests passing;
- `flarex-backend` typecheck and the workspace Effect-boundary check passing;
  analyzer-app typecheck blocked only by the separately owned concurrent error
  at `packages/persistence-postgres/src/appRows.ts:434`;
- the complete analyzer suite at 61 of 62 tests, with the unchanged legacy
  Declarative V2 long-path nested-cause assertion failing; and
- both required final staged-diff reviewers approving with no findings.

The hosted challenge did not accept the lifecycle assumption:

- a uniquely named remote preview running the real host returned `analyzed`
  after two fresh loads in 85 milliseconds, returned
  `forbidden_import_effect` for a caught import-time fetch in 62 milliseconds,
  returned `timeout` at the requested 10-millisecond deadline while the child
  computation remained outstanding, and then completed a fresh recovery
  analysis in 72 milliseconds;
- the first preview using the accepted analyzer configuration was rejected by
  Cloudflare with code `10085` because the configured `flarex-artifacts` R2
  bucket does not exist in the authenticated account; no bucket or production
  resource was created; and
- a separate hosted Worker Loader probe successfully obtained and called the
  entrypoint stub, but the subsequent release operation failed with Cloudflare
  `1101` and `TypeError: stub[Symbol.dispose] is not a function`. This differs
  from the local Miniflare/fake capability surface and means the current host
  cannot prove release of the request-owned entrypoint capability.

Expected behavior was a callable, observable release operation on the hosted
entrypoint capability. Actual behavior provides no such operation through the
tested Worker Loader surface. The affected owner is the Cloudflare Worker
Loader/RPC lifecycle boundary and the Application Analysis host policy that
depends on it; this evidence does not authorize any OCC, commit, executor,
persistence, or authoritative-row change.

**Disposition: AA-R4 remains incomplete and AA-R5 must not start.** The local
implementation commit is retained as an inert candidate, but the gate needs a
new explicit preflight that either identifies a documented hosted lifetime
primitive with observable release, proves a platform-owned request-lifetime
guarantee and deliberately amends the release claim, or replaces Worker Loader
for this host. Deployment also needs a separately named real R2 bucket before
the accepted analyzer configuration can be uploaded. Do not infer either
decision, create the missing bucket, deploy the analyzer, or weaken the hosted
proof from this checkpoint.

#### Replacement lifecycle preflight and accepted amendment — 2026-08-11

The failed release assumption is now resolved from the installed contract and
the current hosted platform documentation, without inventing an isolate
destructor:

- In the installed `@cloudflare/workers-types@4.20260613.1`,
  `WorkerStub.getEntrypoint()` returns `Fetcher<T>`. Neither `WorkerStub` nor
  that entrypoint `Fetcher<T>` is `Disposable`. An object returned by an RPC
  method is augmented with `Disposable`; that returned object is the capability
  the caller may and should explicitly release.
- Cloudflare's [Workers RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
  contract makes entrypoint-stub lifetime execution-context-owned. Stubs made
  during an event are automatically disposed when its handler returns; an RPC
  execution context ends when the RPC returns if it did not pass or return
  capabilities, and a disconnected client cancels the server context.
- The [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/)
  still guarantees a fresh worker for each `load()` call, but exposes no direct
  isolate-destruction operation. The hosted `TypeError` from attempting
  `stub[Symbol.dispose]()` therefore demonstrated a false local model, not a
  missing supported cleanup call.

There are three distinct lifetimes and they must not be collapsed:

1. The Worker Loader worker and its entrypoint `Fetcher` are owned by the
   Cloudflare event/RPC execution context. The host must not wrap that fetcher
   in synthetic Effect acquisition/release or claim direct isolate disposal.
2. A data object returned by `analyze()` is a caller-owned RPC result
   capability. The host detaches its admitted data and explicitly disposes the
   original result, including a result that wins a deadline race after Effect
   interruption.
3. The outer deadline interrupts the local Effect wait. Returning the terminal
   timeout from the named host RPC then ends its parent execution context, so
   the platform owns cancellation and automatic stub disposal. This is the
   release claim; Effect interruption alone is not presented as remote isolate
   destruction.

The correction slice removes the unsupported entrypoint disposer, makes the
fake and Miniflare harnesses match the installed non-disposable fetcher
surface, and retains explicit result disposal. Hosted proof must show a real
returned object has a callable disposer, explicit result release succeeds, a
timed-out call is followed by a successful fresh analysis, and two uncached
loads still agree. It must not claim that a direct isolate destructor was
observed.

The security and artifact-reader challenge was also replayed against the
retained candidate. Sticky forbidden-attempt detection, deterministic ambient
policy through lazy registration inspection, framework-path collision
rejection and exact subpath exports, deterministic corruption classification,
and function-role/root correlation all have focused regressions. Those earlier
findings are fixed in `55105371`; they are not new hosted evidence and do not
replace the lifecycle proof above.

The missing `flarex-artifacts` account bucket remains a deployment prerequisite,
not authority to create infrastructure and not a reason to keep the private,
inert migration behind AA-R4. If the corrected host passes the required hosted
Worker Loader/RPC proof and final review, AA-R4 may close and AA-R5 may begin
while analyzer deployment stays fail-closed. A real, explicitly approved R2
binding remains mandatory before any later deployment or AA-R9 cutover.

**Self-review decision: accepted for the bounded AA-R4 correction.** This
amendment uses the platform's documented lifetime owner, narrows the explicit
release claim to the capability that actually implements it, preserves the
deadline and two-load policy, creates no alternate runtime or persistence
authority, and authorizes no bucket creation, route, preview URL, deployment,
OCC, commit, executor, or authoritative-row change.

#### Completed lifecycle correction and hosted receipt — 2026-08-11

**AA-R4 is completed by `d6883020`.** The correction removes the unsupported
entrypoint-stub release attempt and leaves that non-disposable fetcher's
lifetime with the Cloudflare execution context. Returned RPC objects are still
detached and explicitly disposed, including results arriving after local
deadline interruption. The fake and Miniflare harnesses now model that same
ownership, and each acquired Miniflare result has its own partial-failure-safe
finalizer.

The final proof receipt is:

- a temporary, uniquely named remote Worker Loader preview returned two equal
  results from two uncached loads; both returned objects exposed callable
  `Symbol.dispose` operations, and both explicit releases completed;
- a separate request returned `timeout` after 10 milliseconds while its child
  RPC was still slow, followed immediately by a successful fresh two-load
  request with both result disposers present;
- no direct isolate destructor was called or claimed, and all temporary proof
  processes, source, logs, Wrangler cache, and port `8811` were removed;
- 24 focused host/core/Miniflare/identity tests pass, generated-core verification
  remains `949b5cf2809b12dfa6f6000280e40b617640114e1b6b091bae912e24ea26fedd`,
  and the regenerated private analyzer identity is
  `9fd549d245a42ef119e0dbf7c56c11449a9f5faed86323fd45fed5458d2c92c2`;
- the workspace Effect-boundary check passes; analyzer typecheck still reaches
  only the separately owned concurrent error at
  `packages/persistence-postgres/src/appRows.ts:434`; and
- the complete analyzer suite is 62 of 63 tests, with the unchanged legacy
  Declarative V2 long-path nested-cause assertion failing. Both required final
  reviewers approved the exact corrected five-file diff after the Miniflare
  partial-failure cleanup was added.

The absent account R2 bucket still prevents uploading the accepted analyzer
configuration. No bucket, route, preview URL, or production deployment was
created. That operational prerequisite remains fail-closed for later deployment
and AA-R9; it does not reopen this private host implementation gate. AA-R5 may
now begin from the then-current migration and persistence head.

### `AA-R5` — durable analysis and inactive registration generation

Implement one cohesive persistence slice after rechecking the then-current
migration head and concurrent worktree:

- additive candidate, analysis, and application-revision generation;
- backend-issued IDs, scope-clock fencing, immutable source-root correlation,
  pending/terminal idempotency, exact receipt/manifest bytes and hashes;
- rejected-terminal replay and safe retry of integration failures; and
- inactive registration derived only from an analyzed receipt and decoded
  manifest.

Do not modify old row meanings, write both generations, or add activation in
the same transaction merely for test convenience.

#### AA-R5 persistence preflight and accepted cut — 2026-08-11

The preflight re-read the current schema and migration journal at committed
head `0053_sleepy_morgan_stark`. Concurrent managed-schema work modifies package
metadata and its own code but does not currently add a Postgres table or
migration. The main thread must recheck that head immediately before generation
and must not hand-write a conflicting journal entry.

The new persisted generation is deliberately three tables:

1. `fx_system_application_candidate_v1` owns a backend-issued candidate ID and
   request key, one immutable Source Artifact V2 root, and the exact trusted
   scope storage generation, fence, and epoch observed when it was admitted.
2. `fx_system_application_analysis_v1` owns one backend-issued analysis ID per
   candidate. It starts `pending` and settles once to `analyzed` or `rejected`.
   Terminal rows store exact canonical receipt bytes and digest. Analyzed rows
   additionally store exact canonical manifest bytes and digest; rejected rows
   store only the bounded stable failure and detail carried by their receipt.
3. `fx_system_application_revision_v2` is the new inactive revision generation.
   It has a backend-issued revision ID and a composite foreign key to the same
   analyzed application-analysis row, Source Artifact root, and manifest digest.
   It has no readiness or activation fields and no relationship to an old
   candidate, verifier attempt, Semantic Artifact, verdict, revision, or
   activation table.

One scope-clock-locked admission transaction makes request-key replay exact.
The same key with the same source root and analyzer identities returns the
existing candidate/analysis; reuse with different input is a conflict. The host
runs outside that transaction. A retryable host or transport failure leaves the
analysis pending, so retry invokes the same candidate rather than recording a
false rejection or minting a second authority.

One scope-clock-locked settlement transaction accepts only a terminal host
result whose Source Artifact root and analyzer identities match the pending
row. It decodes and re-canonicalizes an analyzed manifest, requires byte-for-byte
agreement with the host canonical text, constructs the backend-owned canonical
receipt using database time, hashes both through the existing package-owned
SHA-256 boundary, settles the row, and inserts the inactive revision only for an
analyzed receipt. If a terminal row already exists, the operation validates and
returns the first durable receipt and revision projection; it never overwrites
the terminal timestamp, turns a rejection into success, or mints another
revision.

Stored replay re-decodes canonical receipt and manifest bytes and verifies their
digests and cross-row identities before returning them. Database/driver/resource
failures remain retryable integration failures; invalid terminal input,
request-key reuse, stale scope authority, and durable correlation failures are
typed and distinct. Unexpected decoder or platform defects are not converted
to ordinary rejection receipts.

**Self-review decision: accepted for implementation.** The cut is additive,
transactionally fenced, first-terminal-wins, and smaller than adapting the old
registration pipeline. It preserves one authority per candidate, gives rejected
analysis a durable replay without creating a revision, and creates no dual
write, fallback, runtime publication, readiness, activation, OCC, commit, row,
feed, outbox, route, binding, or deployment behavior.

#### AA-R5 implementation checkpoint — 2026-08-11

**Migration-portability correction complete.** A genuine-PostgreSQL M03-A
upgrade probe against the repository-standard isolated non-public `search_path`
found hard-coded `public` parent references in migrations `0054` through
`0056`. Their bounded unshipped-history repair is committed: the seven foreign
keys retain their exact names, column tuples, actions, and ordering while parent
lookup is now search-path-relative. Fresh and upgrade migration lanes can
therefore create the same schema outside `public`; the new M03-A migration also
uses an unqualified parent reference.

**Completed by `d119d756`.** Migration `0054_material_la_nuit` adds exactly the
three accepted Application Analysis tables on committed head
`0053_sleepy_morgan_stark`. Its generated snapshot points to the exact `0053`
snapshot identity and differs only by those three tables; no concurrent schema
work entered the migration.

The package-local repository now owns scope-clock-locked `begin`, `settle`, and
`inspect` operations. It enforces the candidate's captured storage generation,
fence, and epoch on every replay and settlement; exact request, source-root,
analyzer, and policy correlation; one immutable terminal; canonical stored
receipt and manifest bytes plus recomputed SHA-256; rejected replay without a
revision; and analyzed-only creation of one inactive V2 revision. It writes no
old Declarative V2 candidate, verifier, verdict, readiness, activation, or V1
revision row.

The final review challenge found and corrected four substantive boundary risks:
fresh authority could initially settle a stale-fence candidate, caller-owned
terminal input could change after validation, interruption cleanup could hide an
unexpected settlement failure, and a failing cleanup initially replaced rather
than combined the interruption cause. Direct regressions now prove captured
input, concurrent request and terminal serialization, post-update rollback and
retry, stale-candidate rejection by a fresh caller, interruption plus settlement
defect preservation, and correlated rollback-sentinel handling.

Validation receipts are persistence typecheck, Drizzle migration check, the
workspace Effect-boundary check, staged diff check, and 36 focused PGlite
migration/repository tests. Both required final reviewers approved the exact
committed diff with no findings. This is deliberately PGlite evidence only;
zero-skip genuine PostgreSQL concurrency and migration proof remains mandatory
at `AA-R7`. The repository remains package-local until the first cross-package
consumer is introduced by `AA-R6`.

### `AA-R6` — executable producer, publication, and authority migration

This gate is larger than a receipt-table change and is divided into three
medium slices after the post-publication owner audit below.

#### AA-R6 executable-authority preflight and accepted cut — 2026-08-11

The source and consumer inventory challenges two unnecessarily complex readings
of the original gate. First, whole-bundle publication does not require copying
the authenticated module bodies into a second R2 namespace. Source Artifact V2
already owns immutable content-addressed module bytes and Application Analysis
already authenticates their root and per-module identities. A second runtime
blob store would create two byte authorities, another settlement protocol, and
another corruption surface without changing the executable graph. Second,
point mutation, point query, internal calls, and edge action do not require four
new descriptions of the same selected application function. Their hosts differ
in capabilities and invocation envelopes, not in application-revision
authority.

The first medium slice is therefore accepted with this exact cut:

1. The Standard Application definition owner adds a private executable-source
   producer. During migration it may consume the decoded Canonical Declarative
   Program V1 and prebuilt source graph as code-generation input, but it emits
   real handler imports, real Flarex registrations, and a real schema module.
   The generated execution and schema paths are reserved, collisions fail, raw
   handler modules remain byte-exact, and the output is an inert Source Artifact
   V2 upload input. Once uploaded, only the cold-loaded source registrations are
   analyzer authority. The analyzer never receives the Canonical Declarative
   Program or Semantic Artifact as a second acceptance input.
2. The Standard Application Analysis owner adds one plain, unversioned current
   facade whose exact success contains `ApplicationManifestV1` and
   `ApplicationAnalysisReceiptV1`. Its injected context owns host and durable
   registration composition. The existing `./v1` API remains an exact legacy
   compatibility surface until its consumers are removed; it is not renamed or
   reinterpreted.
3. Persistence adds `fx_system_application_publication_v1` and
   `fx_system_application_function_v1`. One publication row is correlated by
   foreign key to the exact inactive Application Revision V2 and analyzed
   Application Analysis V1 identities. It stores canonical schema and function
   catalog bytes plus their SHA-256 digests and one publication commitment.
   Function rows are derived only from the accepted manifest and bind their
   exact canonical entry digest. Publication is idempotent for byte-identical
   input and rejects conflicting replay. It does not write old candidate,
   projection, function-group, revision, readiness, or activation tables.
4. Runtime code reuses Source Artifact V2 as the only module-body store. The
   publication commitment binds scope, revision, candidate, analysis, source
   root, manifest digest, schema digest, and function-catalog digest. A single
   `ApplicationRuntimeTargetV1` contract binds that publication, the manifest
   execution path, and one exact function entry. Point mutation, query,
   internal-call, and edge-action adapters must later narrow the function kind
   and visibility required by their own envelope; they must not fork the
   application authority contract.
5. This slice remains private and inactive. It proves producer output by real
   cold analysis, proves canonical publication and conflicting-replay behavior
   in PGlite, and proves runtime-target encode/decode and identity changes. It
   does not select an active revision, adapt a production runtime, change an
   OCC or commit owner, deploy the analyzer, or claim genuine PostgreSQL proof.

The remaining gate consumes these exact outputs through two medium slices. The
first adds private whole-bundle runtime materialization and a genuinely new task
binding without a semantic root. The second adds new readiness and activation
generations, an active-selection generation, and private consumer migration.
Readiness proves the stored schema and function catalog, every manifest module's
authenticated Source Artifact V2 identity, cold materialization through the new
runtime host, and existing index readiness. It does not introduce a second
bundle object or static call graph.

Preflight self-review found no owner-boundary exception requiring wider
approval. The implementation is additive, keeps Source Artifact V2 and the
existing runtime hosts in their current ownership, and reduces rather than
duplicates authority. The accepted stop conditions are any need to reinterpret
an old persisted row, copy runtime module bytes into a new store, infer a static
dependency graph, change transaction or executor semantics, or repair a shared
runtime defect discovered by the new proof.

#### AA-R6 first-slice implementation checkpoint — 2026-08-11

Commit `1c4fd455` completes the accepted executable-producer and publication
slice. The Standard definition owner now generates one real registration
module and one real schema module while preserving owned copies of handler
bytes. Generated-path and analyzer framework-shim collisions fail through one
analysis-owned path policy. A genuine Miniflare cold load proves that the
analyzer observes the generated registrations rather than a second decoded
program input. The unversioned Standard Analysis facade returns only the exact
Application Manifest V1 or rejected Analysis Receipt V1 result; the existing
`./v1` compatibility surface is unchanged.

Migration `0055_familiar_jasper_sitwell` adds only the application publication
and function catalog tables plus the exact inactive-revision key required by
their foreign key. Publication derives canonical schema, catalog, entry, and
commitment bytes from the accepted manifest, locks the current scope/candidate
authority, serializes exact replays, and rejects corrupt or conflicting state.
It persists no module body: Source Artifact V2 remains the sole immutable byte
owner. Before any transaction opens, every derived function must canonicalize
as a complete `ApplicationRuntimeTargetV1`, so a durable publication cannot
contain a function that its runtime contract rejects.

The runtime target is one concrete publication-and-function contract shared by
the later host adapters. Its sole public decoding authority captures hostile
plain data without invoking accessors, bounds and admits both validator graphs,
enforces ordinary and default-export path spelling, snapshots ownership, and
checks the complete canonical-byte budget. The raw structural Schema remains
private. Default-export spelling is identical in the manifest, runtime target,
Drizzle schema, migration SQL, and generated snapshot.

Final review challenged and corrected six material gaps: changing-accessor and
cyclic validator input, publication/target byte and multibyte-name disagreement,
framework-shim path collisions, duplicated Promise/Effect transaction
settlement logic, default-export database disagreement, and a public structural
Schema that was weaker than the named decoder. Both required reviewers approved
the corrected committed diff with no findings.

Validation receipts are protocol typecheck and 65 files/505 tests, Standard
definition typecheck and 4 files/32 tests, Standard Analysis typecheck and 5
tests, analysis package typecheck plus the focused path-policy tests, persistence
typecheck and 42 focused PGlite repository/migration tests, Drizzle migration
check, 19 analyzer host/core/Miniflare tests, the workspace Effect-boundary
check, and two clean reproductions of private analyzer identity
`449d27278611b6750797356f1f983a7211352d7281e5693503edc382656669ff`.
The broad analysis test command did not finish within the five-minute validation
ceiling and reported no assertion failure; the directly affected owner test and
typecheck passed. Analyzer package typecheck remains blocked only by the
pre-existing untouched `packages/persistence-postgres/src/appRows.ts:434`
`noUncheckedIndexedAccess` error.

This checkpoint is still private and inactive. Its database evidence is PGlite
only; genuine PostgreSQL concurrency and migration proof remains mandatory at
`AA-R7`. It selects no active revision, exports no persistence repository,
adapts no production runtime, and changes no OCC, commit, executor, or task
authority. The next authorized work is the second AA-R6 medium slice only.

#### AA-R6 remaining-authority preflight and accepted amendment — 2026-08-11

The post-publication owner inventory rejects the earlier readiness-first order.
The old readiness operation proves cold materialization of candidate-derived
runtime projections. Application publication intentionally has no such
projection and Source Artifact V2 is now the only module-body owner. A new
readiness row created before a whole-bundle runtime host exists could prove only
that bytes were readable or that analysis could run again; neither proves that
the selected application can execute. Readiness therefore follows runtime
materialization rather than preceding it.

The inventory also rejects reuse of the current durable-task binding. Its wire
contract, persistence row, run-creation authority, and compute-delivery evidence
all commit the displaced candidate digest, package/artifact identities, and
`semanticRootSha256`, and its foreign key selects Application Revision V1.
Removing one field or pointing that row at Application Revision V2 would
reinterpret shipped evidence. Application Manifest V1 deliberately contains
only analyzed source, schema, and function registrations; a task catalog remains
a separate Standard definition input and must be correlated to the accepted
source/publication explicitly.

The next medium slice is accepted with this cut:

1. Add one private Application Runtime materialization owner. It receives a
   canonical `ApplicationRuntimeTargetV1`, the exact stored Application Manifest
   V1, and an authenticated Source Artifact V2 reader. It rereads the complete
   source graph, compares the root, execution/schema paths, ordered module
   paths, roles, byte lengths, and source digests with the manifest, and builds
   Worker Loader code from those bytes. It does not store or republish a module
   body.
2. Do not feed the application target into an existing exact-runtime worker
   core. Those concrete request contracts require an `artifactId`,
   `sourcePackageHash`, and artifact execution identity; deriving those names
   from the source or publication digest would create semantically false
   evidence. Add one application transaction worker contract for query,
   mutation, workflow mutation, and internal calls, and one application action
   worker contract for action plus its callback capabilities. Reuse the existing
   lower-level Function API, syscall, validation, transaction, and action-host
   capability owners only where their inputs retain the same meaning. Both new
   workers accept the one application target and reject the wrong kind or
   visibility. They must not manufacture candidate, semantic, projection,
   package, artifact, or static-call-graph evidence.
3. Cold proof means Worker Loader evaluates the authenticated whole bundle with
   outbound networking disabled and resolves the exact registered function from
   the generated execution module. It is not a second analysis pass and does
   not invoke a database mutation. The receipt binds runtime-host identity,
   compatibility date, source root, manifest/publication digests, and the exact
   target digest.
4. Add a new concrete Application task-binding generation rather than mutate
   the existing task-definition contracts. Its Standard producer correlates a
   canonical task catalog and handler module/export with the prepared source
   mapping. Its commitment binds scope, Application Revision V2, candidate and
   analysis identities, publication digest, Source Artifact V2 root, task
   catalog/manifest identity, exact handler module/export, and runtime-host
   policy. It contains no semantic root, package/artifact digest, candidate
   frame, or runtime projection object.
5. The new task definition persistence generation is private and inactive. It
   does not dual-write or reinterpret `fx_system_durable_task_definition_revision_v1`.
   Existing run creation and compute delivery remain unchanged until their
   bounded migration in the following slice; no task run may select the new row
   early.

The final AA-R6 medium slice then adds Application Revision V2 readiness,
activation revision/head, and issuer-backed active selection generations plus
the bounded runtime and Task System consumer migrations. The revision row stays
immutable with its registered `inactive` status; activation is separate
scope-clock-locked head history, not a status mutation. The selection retains
only the exact authority, manifest, publication, and optional new task binding
needed by consumers. It must not copy the old active metadata's semantic,
projection, package, or candidate-frame fields.

Readiness in that final slice must prove exact publication replay, authenticated
source/manifest agreement, a successful cold receipt for every published
function target under the same runtime-host policy, the separately bound task
catalog when present, and existing index readiness through an injected narrow
index-readiness port. It may not claim index readiness from manifest bytes
alone. Activation locks the scope clock before its new head, validates the
readiness receipt again in the same transaction, uses an explicit compare-and-
swap token, and never writes the displaced activation or verdict tables.

Self-review accepts this amendment because it removes two false shortcuts:
analysis replay as runtime proof and field-deleted reuse of the old task row.
The stop conditions are any need to change an exact runtime worker's invocation
semantics, modify OCC/commit authority, weaken Source Artifact V2 authentication,
write both task generations, infer a dependency graph, or treat an old
readiness/activation/selection/task value as new evidence. A defect exposed in
one of those shared owners is recorded and stopped at its boundary under the
repository rule.

The subsequent exact-runtime ABI trace strengthens that decision. Existing
worker-definition builders do accept caller-supplied source modules, but their
configuration and request decoders still pin the displaced artifact reference.
Therefore "reuse the worker cores through adapters" is rejected; only the
lower-level capability mechanics may be reused. This correction does not widen
runtime or transaction authority. It prevents a source-root or publication
digest from being relabeled as a source-package hash merely to satisfy an old
type.

#### AA-R6 runtime-materialization checkpoint — 2026-08-11

Commit `1eaa5f4b` completes the runtime-materialization portion of the accepted
second slice. A private Application Runtime materializer now authenticates and
rereads the complete Source Artifact V2 graph, verifies its exact ordered
agreement with the stored Application Manifest V1, replays the canonical
schema, catalog, function-entry, and whole-publication commitments, and asks
Worker Loader to cold-resolve the exact Application Runtime Target V1. It stores
no module body and changes no OCC, commit, readiness, activation, or active
selection authority.

Analyzer admission and cold runtime loading now share one deterministic, sticky
import policy. The generated runtime core evaluates application modules inside
that policy and compares the registered kind, visibility, arguments, return
validator, and partition metadata with the accepted target. The cold receipt
binds the runtime-host identity, compatibility date, source root, manifest and
publication digests, and exact target digest. Framework shims expose only their
owned export surfaces, application paths cannot overwrite them, outbound
networking is disabled, and interrupted Worker Loader RPC results are disposed
exactly once even when they settle late.

Focused validation passed all four affected package typechecks, 25 analyzer
tests, seven backend materializer tests, two protocol receipt tests, six
persistence publication tests, both deterministic generated-core checks, the
private analyzer identity check, and the Effect runtime-boundary check. The
generated Application Runtime core identity is
`87592eba2b544223f59312d64f5d42847ca1dc5e4f1ca95015fdf0874fc076ae`.
Both required final reviewers approved the exact committed diff with no
actionable findings. The broader backend build reached and passed the new
runtime-core check, then stopped at an unrelated pre-existing stale
edge-action runtime-kernel check; this checkpoint did not regenerate or modify
that displaced owner.

This does not close the second slice. The new application transaction and
action worker contracts plus the separate Application task-binding generation
and private persistence remain required. No new task row may be selected and no
old task binding may be reinterpreted while that work is incomplete.

#### AA-R6 Application task-binding implementation preflight — 2026-08-11

The concrete producer and storage trace rejects adapting
`TaskDefinitionRuntimeBindingV1`. That contract is not merely an inconvenient
container: its canonical bytes commit the displaced Application Revision V1,
candidate digest, semantic root, package/artifact identities, runtime
projection objects, and activation authority. Field deletion, placeholder
digests, or an adapter that silently supplies those fields would create false
evidence. The existing Canonical Task Catalog V1 and Canonical Task Manifest V1
remain reusable because they own task intent, validators, attempt policy,
compute profile, queue, and the logical/source handler mapping rather than
application activation or artifact authority.

The accepted implementation cut is:

1. Add new versioned Application task-catalog and task-definition binding
   contracts beside, not inside, the displaced runtime-binding contract. The
   catalog binding commits scope, inactive Application Revision V2,
   candidate/analysis identities, publication digest, Source Artifact V2 root,
   canonical task-catalog digest and count, runtime-host identity, and
   compatibility date. Each definition binding commits that catalog-binding
   digest and additionally commits its task identity, canonical manifest
   digest, and exact logical module, authenticated source module, and export
   name; it does not repeat authority fields that the catalog digest already
   binds.
2. The Standard producer accepts an already canonical hashed task catalog and
   a prepared Standard Application definition. For every task it proves that
   the logical-to-source module pair exactly matches
   `artifactIngressPlan.source.functionEntries`, that the source module exists,
   and that task IDs remain unique and canonically ordered. It does not infer a
   dependency graph or claim that an export executed successfully; final
   readiness owns cold runtime proof.
3. Persist one immutable catalog header and immutable child definition rows.
   The header is required even for an empty catalog, avoiding an absence that
   could mean either "no tasks" or "tasks not generated." Child rows reference
   the exact header and retain canonical manifest and binding bytes for later
   verified decoding. Both generations foreign-key to the exact inactive
   Application Revision/publication authority and contain no module body.
4. Keep the repository private and registration-only. It supports idempotent
   exact replay and rejects conflicting replay. It does not export a public task
   API, write `fx_system_durable_task_definition_revision_v1`, create a task
   run, publish compute-delivery evidence, select an active revision, or add a
   fallback between task generations.

Self-review accepts this cut because the catalog header makes empty intent
explicit, the child rows keep lookup simple, and the canonical commitments are
smaller than the displaced runtime-projection model while retaining every
authority needed by later readiness and selection. The stop conditions are any
need to reinterpret an old task digest, manufacture artifact or semantic
identity, inspect user code statically to prove an export, dual-write task
generations, or change current run-creation/compute-delivery semantics.

#### AA-R6 Application task-binding producer checkpoint — 2026-08-11

Commit `243616dd` completes the contract and Standard-producer half of the
accepted task-binding cut. The private Application task-catalog binding commits
the exact inactive revision, candidate/analysis identities,
publication/source authority, canonical task catalog, and runtime-host policy.
Each ordered task definition commits the catalog-binding digest, canonical task
manifest digest, and correlated logical/source module and export. The producer
rehashes the supplied catalog and every manifest, rejects any digest mismatch,
and proves the logical-to-source module mapping against the prepared Standard
Application graph without inspecting or executing user code.

The final diff also rejects symbol keys, accessors, hostile Proxy reflection,
and conflicting extra fields through the typed decoder channel without
invoking caller code. Impossible internally constructed SHA input failures are
named defects; actual SHA resource failures remain recoverable. Typecheck, all
39 Standard Application tests, the Effect boundary check, and both required
final reviews passed. The package export remains private and no persistence,
run creation, compute delivery, activation, selection, OCC, or commit owner was
changed.

This checkpoint does not complete the task-binding cut. The immutable catalog
header and definition persistence generation plus idempotent exact registration
remain next; current task rows and consumers are still unchanged.

#### AA-R6 Application task-binding persistence checkpoint — 2026-08-11

Commit `79e8b818` completes the private persistence half of the accepted
Application task-binding cut. Migration `0056_lively_yellowjacket` adds one
immutable catalog header per scope/revision and immutable child definition rows.
The header exists for both populated and explicitly empty catalogs and foreign
keys to the exact inactive Application publication authority. Registration
locks the scope clock, candidate, and publication in owner-compatible order,
then inserts the header and all children in one transaction. Exact concurrent
replay converges; competing replay is rejected; a child failure rolls back the
header.

The final admission boundary re-decodes and owns every binding and manifest
before asynchronous work, rejects non-exact or accessor-backed wrapper arrays,
NUL or non-scalar persisted text, detached, resizable, growable, or shared byte
views, and enforces the shared 32 MiB aggregate evidence budget before copying,
SHA, or database work. Replay compares children by exact task identity rather
than database collation order. These checks preserve agreement between retained
canonical bytes, digests, scalar columns, and the returned projection.

Both required final reviews approved the staged checkpoint. Standard Application
typecheck and all 40 tests passed; persistence typecheck, all 15 focused
task-binding tests, all 27 PGlite migration tests, Drizzle schema check, targeted
strict compilation, the Effect boundary check, and the staged diff check passed.
Follow-up commit `231eb769` corrected the complete Application migration chain
from `0054` through `0056` so all seven foreign keys follow the migration
session's selected schema instead of hard-coding `public`. The exact staged
chain passed its dedicated PGlite upgrade, failed-migration rollback, recovery,
and replay lane plus an independent non-public-search-path migration probe; both
required reviewers approved the correction. Genuine PostgreSQL execution was
not available because `FLAREX_POSTGRES_DATABASE_URL` was unset and remains a
mandatory `AA-R7` acceptance proof rather than an implied pass here.
The repository remains private and registration-only: it does not write the old
durable-task definition generation, create or select task runs, publish compute
delivery, activate a revision, or change OCC/commit authority.

The second AA-R6 medium slice remains open for the new Application transaction
and action worker contracts. No current task consumer may read this generation,
and no old task binding may be reinterpreted before final readiness and selection
migration.

#### AA-R6 Application worker-contract implementation preflight — 2026-08-11

The current exact-runtime request families are not reusable contracts for the
Application runtime. Their artifact and function members require an
`artifactId`, `sourcePackageHash`, artifact execution module, and, in several
cases, a public-only function shape. The separately named internal-call profiles
still reuse those same root envelopes. Replacing those fields with a source root
or publication digest would not be an adapter; it would relabel different
authority as shipped artifact evidence. The existing Standard invocation
services also still select the displaced active generation and are consumers,
not protocol owners for this slice.

The accepted implementation is one private transaction-worker wire contract
and one private action-worker wire contract in `flarex-protocol`. Both carry one
owned canonical `ApplicationRuntimeTargetV1` and never carry an artifact
reference, candidate frame, semantic root, projection, stored module body, or a
second function definition. The transaction contract admits query and mutation
or workflow-mutation targets at public or internal visibility and rejects
action targets. Its context is an exact discriminated query-versus-write union:
query retains snapshot execution context, while mutation and workflow mutation
retain transaction execution context. Internal query/mutation calls are
capabilities of the eventual transaction worker, not new target kinds or a
reason to duplicate the root request contract.

The action contract admits only public or internal action targets. It retains
the action invocation generation, time/deadline, random seed, authenticated
caller, canonical arguments, and host-policy commitment needed by the existing
action authority. The callback capability remains a separate Worker RPC
capability supplied by the trusted host; it is not serialized into the wire
value and the protocol package does not import Cloudflare runtime types.
The two operation families share one private normalized worker-result envelope
because its complete meaning is exactly the validated returned Flarex value;
action lifecycle and transaction commit disposition remain outside the worker.

Both decoders must establish ownership at the unknown-input boundary, enforce
exact own-data shapes and byte/value budgets, canonicalize arguments and the
embedded target, and verify argument semantic size. Structural decoding proves
only a well-formed operation-family request. A backend-owned target claim must
separately compare the canonical target and its path, kind, and visibility with
the trusted selected authority before Worker Loader evaluation. This avoids the
false claim that an untrusted request authorizes itself merely by repeating a
valid target. Result envelopes normalize only the returned Flarex value.

This checkpoint is contract-only and inert. It may add protocol exports, pure
claim helpers, and focused tests, but no Worker Loader call, route, dispatcher,
Standard invocation consumer, persistence write, readiness row, activation,
task run, callback execution, OCC behavior, or commit behavior. The following
bounded host slice may build the two worker definitions from authenticated
whole-bundle bytes and reuse lower-level Function API, syscall, validation,
transaction, and action-host mechanics without widening their authority.
Workflow mutation remains a contract kind only until its separately accepted
execution semantics exist; this slice does not reinterpret ordinary mutation
execution as workflow execution.

Self-review accepts this cut because it produces two predictable operation
families rather than cloning the five artifact-era exact-runtime envelopes, and
because it keeps wire validation, trusted authority comparison, host
capabilities, and production selection as separate owners. Stop and amend the
roadmap if implementation needs an artifact identity, treats internal calls as
new authority, serializes a callback, executes workflow mutation through the
ordinary mutation path, reads old active/task state, or changes an OCC, commit,
action-lifecycle, or Worker Loader owner.

#### AA-R6 Application worker-contract implementation checkpoint — 2026-08-11

**Completed by `9da527b5`.** `flarex-protocol` now exposes one private
transaction-worker request, one private action-worker request, and one shared
worker-result envelope. The requests carry only the canonical Application
runtime target, owned auth and arguments, exact operation context, and the
transaction table catalog where applicable. They reject the wrong function
family and do not carry artifact-era identity, source modules, callbacks,
runtime selection, or commit disposition.

The challenged decoder now rejects over-advertised transaction arguments before
context traversal, establishes an owned snapshot before canonicalization, and
bounds all operation work: query and action arguments are limited to 1 MiB,
write arguments retain the existing mutation ceiling, results are limited to
8 MiB, auth is limited to 64 KiB, and one request may visit at most 65,536 value
nodes and inspect 131,072 container members. Those independent ceilings close
large-buffer copying, repeated-alias expansion, undefined-member traversal,
late descriptor reflection, and caller-mutation gaps without changing the
shared Value Codec or any generated runtime identity. Expected codec failures
remain typed; unexpected codec or platform failures remain defects.

Protocol typecheck, all 26 focused contract tests, all 533 protocol tests, the
Effect boundary check, and the byte-identical Application Runtime core check
passed. Both required reviewers approved the final staged snapshot after the
resource and hostile-reflection regressions were added. The contract remains
inert: it loads no Worker, claims no trusted target, invokes no callback, opens
no transaction, writes no persistence, and changes no OCC, commit, readiness,
activation, task-run, route, or production-selection owner.

The next bounded AA-R6 host slice may consume these contracts only after its own
preflight identifies the existing lower-level Function API, syscall,
validation, transaction, action-host, and Worker Loader capabilities it will
reuse. Workflow mutation remains contract-only until separately accepted
execution semantics exist.

#### AA-R6 Application function-runtime implementation preflight — 2026-08-11

The lower-level runtime audit rejects direct composition of the existing point
query, point mutation, and edge-action kernels. The public point roots require
`visibility: "public"`; the internal-call kernels still require a public root
plus their artifact-era ordinal, static catalog, call-budget, and execution
envelopes. Wrapping an internal Application target as public or inventing those
missing envelope fields would be false authority. The exact worker cores also
remain unusable because their configuration and request decoders pin artifact
and source-package identities. None may be changed or regenerated in this
slice.

The reusable seam is lower. `pointRuntimeCore` already owns canonical runtime
value capture, validator admission, table-aware validator execution, and
document-ID policy. `functionApiCore` owns auth, database, indexed writer,
`runQuery`, and `runMutation` context construction. The existing read, journal,
callback, and application-error capabilities retain their meaning when supplied
by the later Application worker host. Reusing those contracts does not require
reusing an artifact-era root executor.

The accepted medium prerequisite is one new private Application function-runtime
module in `@flarex/function-runtime`, not a fork of each exact runtime. It accepts
one trusted catalog supplied out of band by the eventual worker definition and
executes query, mutation, or action registrations at their exact public or
internal visibility. Query contexts expose the existing read database and
bounded internal `runQuery`; mutation contexts expose the existing journal
database plus bounded internal `runQuery` and `runMutation`; action contexts use
the existing callback bridge and limits. Internal callees must be exact catalog
members with internal visibility and matching kind, validators, and registration
markers. Calls are bounded by total count, depth, argument bytes, and result
bytes, and active ordinals prevent cycles. No dependency graph is inferred.

Workflow mutation remains fail-closed with a specific runtime contract failure.
This prerequisite does not reinterpret it as mutation and does not authorize a
new executor lifecycle. The module returns only a normalized Flarex value and
classifies contract, user-code, read/journal, callback, application-error, and
terminal internal-call failures without owning host transport or persistence.
It uses plain Promise boundaries where user handlers and the Function API
require them; it introduces no service, Layer, Worker Loader, or runtime bridge.

Focused tests must cover public and internal root registration, exact
kind/visibility mismatch, validator and table-aware ID checks, query and
mutation boundary closure/drain, internal call success and wrong-kind/cycle/
budget failures, action callback closure/drain, workflow fail-closed behavior,
and user-versus-boundary error classification. Existing exact-runtime generated
identities and their checks must remain byte-identical.

Self-review accepts this prerequisite because one visibility-aware Application
kernel is simpler than six adapters over incompatible roots and keeps trusted
catalog authority outside the wire request. Stop if implementation needs an
artifact/package identity, changes an exact runtime kernel, invents call-graph
evidence, lets the request supply a second function definition, executes
workflow mutation, or moves read, journal, callback, OCC, commit, or action
lifecycle authority into `@flarex/function-runtime`. The following backend
preflight must still own whole-bundle module construction, exact target/catalog
comparison, Worker Loader lifecycle, RPC capability settlement, timeouts, and
host result decoding.

#### AA-R6 Application function-runtime checkpoint — 2026-08-11

Commit `cf817812` adds one private
`@flarex/function-runtime/internal/application-function-runtime-v1` module.
It executes exact public or internal query, mutation, and action registrations
from one trusted root definition and one out-of-band internal catalog. Query and
mutation calls reuse the existing Function API read, indexed-read, journal, auth,
validator, table-aware document-ID, and application-error capabilities; actions
reuse the existing bounded callback bridge. Workflow mutation fails closed with
its own contract reason.

The review challenge rejected observation-aware Promise tracking. JavaScript
does not expose enough authority to follow a rejected internal call through
arbitrary `Promise.all`, `Promise.resolve`, detached async work, borrowed
intrinsics, and continuation fan-out without adding another unbounded runtime
graph. The accepted simpler rule is therefore invocation-sticky failure: every
rejected admitted internal call fails the root invocation even when Application
code catches or assimilates its native Promise. Code may catch a call to finish
local cleanup, but it cannot turn a failed child write into a successful commit.
This matches the action callback boundary's fail-closed settlement rule and
leaves rollback with the existing journal/transaction owner.

The runtime records one settlement per admitted call, bounded by the trusted
call-count budget, drains dynamically spawned calls to quiescence, then closes
call admission before the read or journal boundary closes and drains. A retained
context cannot start registry or user code during shutdown. Internal count,
depth, aggregate argument bytes, aggregate child-result bytes, and per-call
ancestry are deterministic; concurrent siblings do not create false cycles.
Root worker-result size remains owned by the worker-result protocol boundary and
is not double-charged into the internal-call aggregate.

Focused validation passes 25 cases, the complete Function Runtime package passes
85 tests, and package plus backend typechecks pass. Application Runtime,
Function API, point query, point mutation, and every point internal-call kernel
and exact core remained byte-identical. The broad backend build still encounters
the pre-existing stale edge-action generated-kernel check; this checkpoint did
not change or regenerate that owner. Both required final reviewers approved the
exact staged implementation without findings.

#### AA-R6 Application worker-host preflight — 2026-08-11

The backend audit rejects the artifact-era `HostKit` worker graph and every
exact query, mutation, internal-call, and edge-action worker core. Those owners
pin Source Package or artifact identities, public-root assumptions, generated
configuration envelopes, and compatibility profiles that the Application
target does not carry. Reusing them would either manufacture authority or make
the new runtime depend on the displaced system. The reusable owner is the
Application Runtime materializer's whole-bundle module graph: canonical source
modules are remapped under `__flarex_application_modules`, framework shims are
sticky to each importing module, trusted modules are derived from the Source
Artifact root, and source/framework collisions fail before Worker Loader use.

The accepted backend slice first extracts that pure Application module-graph
mechanic behind one Application-owned helper and makes the existing cold
materializer delegate to it without changing its definition bytes or receipt.
The same helper then builds one new private executable worker definition with
two explicit entrypoints, transaction and action, and one generated self-
contained core. It receives canonical target, manifest, Source Artifact bytes,
and host policy from trusted backend inputs; no manifest, catalog, module body,
or policy is accepted from the worker request. The definition is pure code and
configuration: it never stores an RPC capability or outbound gateway.

Target authority is checked twice at distinct boundaries. Before definition
construction, the backend reuses the current Application publication proof:
canonical manifest digest, schema and function-catalog frames, exact function
entry, publication commitment, Source Artifact identity, module list, and
source bytes must all agree with the request target. Inside the worker, the
decoded request target must equal the single embedded canonical target before
module import or capability use. The runtime root ordinal is its zero-based
position in the already-canonical manifest function array. The internal catalog
uses the same positions and contains only exact internal query or mutation
members; it is not inferred from calls and is not supplied over RPC.

Each invocation uses `WorkerLoader.load()` and a fresh entrypoint stub; cached
`get()` is forbidden. The transaction entrypoint accepts exactly one decoded
Application transaction request plus one query-read or mutation-journal RPC
capability chosen from the target kind. The action entrypoint accepts exactly
one decoded action request plus the existing callback capability and an out-of-
band host policy whose digest must equal `context.hostPolicySha256`. Query and
mutation internal calls use the private fixed budget of 64 calls, depth 8,
8 MiB aggregate arguments, and 8 MiB aggregate child results. Action limits,
CPU, wall time, callback sizes, and cleanup drain remain owned by the existing
action host-policy contract. Workflow mutation reaches the worker only to return
the function-runtime's explicit unsupported contract failure.

The outer host converts the pure definition to invocation-owned Worker Loader
code. Transaction and workflow invocations set `globalOutbound: null`. Action
invocations receive only the trusted outbound gateway already claimed by the
existing action coordinator, exactly as the current exact action host does;
ambient `fetch` therefore cannot manufacture or widen network authority. The
first private Worker proof may use `null` or a bounded fake gateway, but the
production action adapter must preserve this gateway and its host-policy limits
instead of silently denying or bypassing an already-authorized outbound call.

The generated core may bridge the Effect protocol decoders at its Worker
entrypoint, but Function API handlers and RPC capabilities remain native
Promises. This is one deliberate runtime bridge, not a service or Layer.
Expected request/result and runtime failures are translated once into the
Application host's typed error family. Unexpected protocol or core defects
remain defects. Query read, mutation journal, and action callback capabilities
retain their current close, drain, sticky-failure, and exactly-once disposal
semantics; the worker must not implement OCC, commit, transaction retry,
idempotency, or action scheduling.

The outer host owns interruption and transport settlement. It applies Worker
Loader CPU/subrequest limits, a bounded wall deadline, and the action request's
deadline constrained by the trusted host policy. On interruption it rejects the
Effect, still observes the detached RPC promise, disposes any late RPC result,
and never lets a capability outlive its request owner. On success it detaches
and disposes the RPC value, then decodes the Application worker-result contract
before returning the canonical value. No raw RPC object crosses the host
boundary.

The first medium implementation checkpoint covers the shared Application graph,
generated executable core, definition builder, unit proof, and Miniflare proof
with fake read, journal, and callback capabilities. It remains private and
unwired; its action case uses either denied outbound or an explicit bounded fake
gateway. A following medium checkpoint owns the outer execution host, the
invocation-scoped Worker Loader code, and its real capability adapters. Neither
checkpoint changes production selection, readiness, activation, persistence,
transaction execution, or action lifecycle.

Self-review accepts this split because module construction plus a real Worker
execution proof is independently substantial, while combining it immediately
with OCC/journal/callback production adapters would hide ownership mistakes.
Stop if implementation changes the cold materializer's emitted graph, needs an
artifact/package identity, accepts a second catalog from RPC, caches a Worker
stub, widens outbound/subrequest authority, executes workflow mutation, or
moves read, journal, callback, OCC, commit, retry, or scheduling authority into
the new host.

#### AA-R6 Application worker-host checkpoint — 2026-08-12

Commit `d16f49ae` completes the first worker-host checkpoint accepted above. The
cold materializer and executable definition now share one Application-owned
module-graph builder and one complete source/manifest authority comparison. The
cold Application Runtime core remains byte-identical. The new private
Application worker definition embeds one canonical target, its ordered internal
query/mutation catalog, and the trusted action host policy; it exposes separate
transaction and action entrypoints and stores no RPC or outbound capability.

The generated self-contained core installs the request time and seeded random
state before application module evaluation. It preserves ordinary `Date`
constructor and static behavior, fixes `performance`, denies or gates ambient
capabilities, and hardens the named and hidden intrinsic prototypes used by
runtime authority, including iterator, typed-array, `WeakMap`, and `WeakSet`
state. Import-time or handler-time attempts cannot change pending-operation
drain, call settlement, failure inspection, or capability classification.
Forbidden import attempts remain sticky even when application code catches the
immediate error.

Transaction reads, index pages, and inserted document IDs are normalized by
their protocol owners before reaching the Function API. Capability methods are
snapshotted once, query mode never inspects journal members, and foreign errors
cannot spoof the worker's private error families by changing `name`. Read,
journal, callback, internal-call, and post-close failures remain invocation-
sticky. Duplicate entrypoint admission, early request rejection, ordinary
success, and boundary failure all release the received capability through the
same `finally`; a local-in-Worker regression proves the explicit disposal path
without relying on Cloudflare's automatic RPC-parameter lifecycle.

Root transaction results now have an independent 8 MiB Application worker wire
ceiling, so they are not double-charged into the internal-call aggregate and
cannot produce a statically typed result that the protocol decoder rejects.
Action results use the smaller of the trusted host-policy limit and that wire
ceiling. Resource exhaustion caused by application output is classified as
user-code failure rather than immutable definition corruption. The simpler
sticky-failure rule remains deliberate: catching a failed child or callback may
finish local cleanup but cannot convert its effects into a successful root.

Validation passed the complete backend build, including every deterministic
generated core and kernel check, both affected package typechecks, 22 focused
backend Miniflare/materializer tests, all eight Function Runtime files and 88
tests, the Effect runtime-boundary check, and staged diff hygiene. The executable
Application worker core identity is
`bd7aa2651f95f5af3f98e7e30bf37e79adea538432ec0bc5a19f9b936f9973e1`;
the unchanged cold core identity is
`87592eba2b544223f59312d64f5d42847ca1dc5e4f1ca95015fdf0874fc076ae`.
Both required final reviewers approved the exact committed implementation with
no actionable findings.

This checkpoint remains private and unwired. It does not load a production
Worker, construct a real read/journal/callback adapter, provide the trusted
action outbound gateway, select a revision, create readiness or activation
evidence, or alter persistence, OCC, commit, retry, idempotency, task-run, or
action-scheduling authority. The next authorized medium checkpoint is the
outer Application execution host and its invocation-scoped capability adapters
only. Readiness, activation, selection, and consumer migration remain the final
AA-R6 slice after that host proof.

#### AA-R6 Application execution-host preflight and accepted amendment — 2026-08-12

The production-seam audit corrects one ordering assumption in the preceding
checkpoint. Cloudflare Worker Loader execution is owned by
`apps/artifact-runtime`, but the real query snapshot, mutation journal, and
action callback/outbound capabilities are issued by the executor and Standard
Application invocation owners only after they have claimed a selected active
revision. No Application active-publication reader or selection claim exists
yet. Constructing those adapters in this checkpoint would therefore have to
reuse a displaced candidate-bound target, accept caller-supplied authority, or
prematurely implement the final readiness/activation/selection slice. All three
options are rejected.

The accepted medium checkpoint is the route-independent Application execution
host itself. It receives an already authenticated pure
`ApplicationWorkerDefinition`, one Application worker request, and one
invocation-owned capability through private structural ports. Transaction and
action execution are separate operations over one shared transport mechanism;
there is no universal capability union and no request-controlled Worker
definition. The transaction operation accepts only the read/journal capability
required by its decoded mode and always sets `globalOutbound: null`. The action
operation accepts only the callback capability plus an explicitly trusted
outbound gateway and sets Worker Loader CPU, subrequest, and wall limits from
the embedded host policy and the request deadline. Workflow mutation remains
the worker runtime's explicit unsupported failure.

The host validates and owns the transport boundary. It decodes the request
before loading code, verifies the request family against the definition target,
uses `WorkerLoader.load()` exactly once per invocation, obtains only the named
transaction or action entrypoint, and never calls `get()` or caches a stub. It
settles the RPC call under interruption and the bounded wall deadline, observes
late settlement, registers an owned RPC-result lease before the wait, disposes
a late or consumed RPC result, detaches the result into owned data, and decodes
the shared Application worker-result contract before returning its canonical
value. Expected named
worker failures map once into an Application execution-host error family;
unknown remote rejections remain defects because Workers RPC cannot
authenticate arbitrary error names beyond this private generated entrypoint.

Capability lifecycle stays with its existing owner. The host neither opens nor
seals a transaction journal, closes a query snapshot, commits or retries an OCC
attempt, settles an action invocation, nor closes/drains the callback and
outbound pair. Its caller must keep the capability lease alive until host
settlement and then perform the existing uninterruptible close/drain protocol.
The worker still disposes its received RPC endpoint exactly once. This split
prevents double ownership while making late-result disposal the host's explicit
responsibility. Worker Loader entrypoint handles remain execution-context-owned
under the installed Cloudflare contract and are not treated as Disposable.

Focused proof must cover both Worker Loader definitions, fresh load and exact
entrypoint selection, query/mutation/action success, request-family rejection
before load, target and host-policy mismatch, named worker failure projection,
unknown rejection as defect, invalid detached result, interruption/timeout with
late-result disposal and timer/listener cleanup, transaction outbound denial,
and action outbound identity plus CPU/subrequest limits. A local fake Worker Loader
proves settlement mechanics; Miniflare already proves the generated worker and
capability behavior and need not be duplicated unless the host implementation
changes that graph.

Self-review accepts this amendment because it creates one concrete Worker
Loader host without manufacturing the not-yet-existing active-selection claim.
The final AA-R6 readiness/activation/selection checkpoint must compose this host
with the existing executor journal session and Standard action capability
bundle, or replace those displaced adapters with Application-owned equivalents
under its own preflight. Stop if this checkpoint adds a hosted route or binding,
reads persistence, claims a revision, reuses a candidate-bound target, stores a
capability in a definition, caches a Worker, changes journal/callback/outbound
close-and-drain semantics, or alters OCC, commit, retry, action settlement, or
scheduling authority.

#### AA-R6 Application execution-host checkpoint — 2026-08-12

Commit `42f64445` completes the accepted route-independent execution-host
checkpoint. `ApplicationExecutionHost` now validates and binds transaction and
action requests to an owned worker definition before loading code, performs one
fresh `WorkerLoader.load()` per invocation, installs the exact transaction or
action outbound policy and limits, and maps the private generated worker's
named failures into one typed host error family. Effect clock and timeout
authority bound action deadlines and wall execution without an ambient timer.

The RPC settlement adapter registers its owned result lease before waiting, so
normal completion, timeout, interruption, and late settlement all have one
disposal owner. It detaches and decodes the shared worker-result contract before
returning the value. Installed Worker Loader entrypoints remain
execution-context-owned and are not given an invented disposal contract. The
fresh-load regression invokes the same host twice and proves distinct Worker
stubs and entrypoints rather than merely counting requested names.

Validation passed 40 focused tests across the execution host, generated worker,
and runtime materializer; the complete `flarex-backend` build; the Effect
runtime-boundary check; and staged diff hygiene. The generated Application
Runtime core remains
`87592eba2b544223f59312d64f5d42847ca1dc5e4f1ca95015fdf0874fc076ae`
and the generated Application Worker core remains
`bd7aa2651f95f5af3f98e7e30bf37e79adea538432ec0bc5a19f9b936f9973e1`.
Both required final reviewers approved the exact committed checkpoint with no
findings.

This checkpoint remains private and unwired. It does not issue a query
snapshot, mutation journal, action callback or outbound capability; read
persistence; select or claim a revision; create readiness or activation
evidence; install a route; or alter close/drain, OCC, commit, retry,
idempotency, action-settlement, or scheduling authority. The next authorized
medium checkpoint is the final AA-R6 readiness, activation, active-selection,
capability-composition, and private-consumer migration preflight.

#### AA-R6 final-authority preflight and accepted decomposition — 2026-08-12

The post-host source audit rejects implementing the remaining authority as one
code checkpoint. Application Revision V2 currently stores no
`schemaVersionId`, and Application publication stores canonical analyzed schema
bytes without publishing them through the existing app-schema catalog. The
physical-index readiness owner is keyed by an immutable app-schema version and
its bound table/index definitions. Consequently, a readiness implementation
that checks only `schemaSha256`, trusts a caller-supplied index verdict, or
declares an empty physical set would not prove that the analyzed schema can run.
This is a missing authority bridge, not a reason to add another index system.

The remaining AA-R6 slice is therefore decomposed into three medium,
individually committed checkpoints while preserving one-way migration:

1. **Schema authority and readiness.** Deterministically lower the accepted
   Application Manifest schema into the existing app-schema publication input,
   derive its immutable schema-version identity from the canonical Application
   schema digest, publish or replay it through the existing schema catalog, and
   verify that the resulting bound schema is a complete semantic projection of
   the analyzed manifest. Add a new Application readiness receipt and tables
   that correlate Application Revision V2, analysis, whole-bundle publication,
   the bound app-schema artifact, current scope clock, an explicit Application
   task catalog, every published function's cold materialization receipt, and
   the existing physical-index/unique-constraint readiness owner. This
   checkpoint remains inert and creates no active head.
2. **Activation and active selection.** Add new Application activation-history
   and head tables plus a process-local issuer-backed selection. Activation
   locks the scope clock before the Application head, validates the exact new
   readiness evidence again inside the transaction, applies an explicit CAS
   token, and writes no displaced Declarative V2 activation or verdict row. The
   selection carries only current scope authority, Application manifest and
   publication identity, bound app-schema identity, and the explicit task
   catalog authority required by later consumers.
3. **Capability composition and private consumers.** Compose the selected
   Application target with the existing query snapshot, mutation journal/OCC,
   and action callback/outbound owners through their narrow ports and the
   committed `ApplicationExecutionHost`. Migrate the private Standard
   invocation and Task System consumers without dual selection or fallback.
   Old V1 systems become `Legacy...` only within this bounded consumer cut and
   remain solely where historical evidence still requires their exact
   contracts.

The managed-schema `M03-D` multi-revision cooking scenario follows checkpoint
3, not the displaced Standard runner. Its accepted matrix requires real
analysis, schema publication, readiness, activation, Workerd execution, and
journal/OCC/commit evidence for several revisions. Until private Standard
invocation selects only the new Application authority, implementing that matrix
would either bless Application Revision V1 again or introduce a forbidden
test-owned/dual lifecycle adapter. The earlier single-revision cooking suite
remains regression evidence only and is not a fallback or comparison authority.

The schema bridge is deliberately a caller of the existing app-schema
publication and build owners. It may derive a stable PostgreSQL-safe
schema-version identifier from the canonical Application schema digest, but it
may not relabel that digest as a readiness verdict. After publication it must
compare the resulting manifest's table names, validators, index declarations,
and relationships with the analyzed schema before any readiness work. The
catalog's numeric schema `version` is a separate deployment-local monotonic
identity: reserve it under the deployment row lock after comparing the active,
published, and already-reserved maxima. Never truncate the schema digest into
that integer, and never reuse the Application Manifest's `schema.version = 1`,
which is only the analyzed schema codec version. Exhausting the existing
catalog range fails closed without publishing a partial binding.

The analyzer's numeric table and index IDs are dense canonical ordinals within the
Application Manifest, not deployment-stable storage IDs. The bridge must record
their complete name-based mapping to the bound catalog IDs and commit the bound
schema-manifest digest; it must not require the two numeric domains to be equal
or expose analyzer ordinals to execution. The existing catalog remains the sole
stable table, index-definition, build-state, and unique-constraint authority.

Placement follows the existing control/target split rather than assuming one
database. Schema-version reservation, publication, and immutable physical
requirements remain on the control database. Revision-to-schema binding,
function receipts, and the readiness verdict remain on the located target under
its scope-clock lock. A target row may commit the immutable control artifact's
identity and digest, but no target foreign key or transaction may pretend to
span databases. Shared-database PGlite proof is insufficient by itself; the
same composition must accept the existing located target capability.

Readiness also consumes the existing candidate-schema validation capability and
the point-commit owner's unique-constraint eligibility capability. It loads
their issuer-backed evidence before the target transaction and revalidates that
evidence while holding the exact scope-clock lock. It does not read their tables
to reproduce either verdict. `not_required` remains the existing unique owner’s
meaning; the Application layer does not manufacture an empty closure/build row.

Readiness requires exactly one Application task-catalog row for every revision,
including an explicitly empty catalog. This closes an ambiguity in the earlier
wording: absence means incomplete publication, never "no tasks." The readiness
receipt commits the task-catalog binding digest and the ordered set of function
target/cold-receipt digests. It stores no module body and does not rerun
analysis. Cold proof uses the committed Application Runtime materializer over
authenticated Source Artifact V2 bytes. A changed function catalog, source
root, runtime-host policy, schema binding, task binding, scope fence, or build
state must fail closed.

Self-review accepts this decomposition because each checkpoint ends in a
durable authority boundary and removes a previously hidden assumption. It does
not authorize a second schema/index planner, mutation of Application Revision
V2's immutable `inactive` row, old/new dual writes, caller-authored readiness,
route installation, OCC or commit changes, action lifecycle changes, or task
run reinterpretation. Stop and record an owner issue if exact schema lowering
cannot preserve the analyzed logical schema and produce a complete ordinal-to-
stable binding, if existing readiness cannot expose a narrow authenticated
snapshot, or if consumer composition requires changing an existing journal,
commit, callback, outbound, scheduler, or run-evidence contract.

#### AA-R6 schema-authority and readiness checkpoint — 2026-08-12

The first final-authority checkpoint now implements the accepted control/target
split without introducing another schema or index owner. The Application schema
bridge canonicalizes the analyzed manifest, reserves a deployment-monotonic
catalog version under the deployment lock, publishes through the existing
app-schema owner, and records the complete analyzer-ordinal-to-catalog binding.
The publisher is an opaque process-local composition over the exact control
database repository; a structural or foreign-control publisher is rejected.
Returned artifact deployment, schema-version identity, numeric version,
canonical manifest bytes, and digest are verified before projection. The
control artifact and physical requirements are reloaded from that same database.
Numeric-version reservation and prepared schema publication share the existing
deployment-locked transaction, so a failed publication leaves neither a
reservation nor false durable authority, and a competing retained publisher
cannot strand an Application version between those two steps.
The located target stores only the immutable revision/schema binding, readiness
receipt, and per-function cold evidence; it stores no user-code or module body.

Readiness is production-inert and creates no active head. It requires the exact
Application Revision V2 analysis, whole-bundle publication, explicit task
catalog including the empty catalog, authenticated candidate-validation and
unique-set evidence, current scope authority, enabled physical requirements,
and runtime materialization policy. The candidate and unique evidence are
loaded before the target transaction and revalidated while holding the scope
clock. The task catalog's runtime-host identity and compatibility date must
equal the cold materializer policy even when the function set is empty.
The task-binding owner now issues the only accepted task-catalog snapshot port.
It reconstructs and canonicalizes the parent binding, every non-empty child
binding and manifest, all parent/child digests, the catalog root, and the exact
child count. Readiness reuses that owner under the scope-clock transaction, so
an orphaned, incomplete, or altered task catalog cannot become ready.

Focused PGlite proof covers the legitimate two-phase lifecycle: the first call
publishes schema authority and reports missing candidate validation, the
existing validation and unique-closure owners then settle, and readiness inserts
once and replays exactly. A table-bearing case advances the existing intrinsic
index-build owner to `enabled`; readiness rejects enabled build evidence whose
start frontier is ahead of the locked scope clock. Migration proof covers
fresh/upgrade, injected failure rollback, replay, preservation of existing rows,
and non-public schema installation in PGlite.

Zero-skip PostgreSQL 18 proof now runs the same split control/target,
table-bearing lifecycle against isolated schemas. It proves real schema
publication, candidate and unique closure, physical build enablement,
future-frontier rejection with no readiness row, and deterministic lock
contention: two readiness settlements are observed blocked behind a held target
scope-clock lock, then produce exactly one insert and one replay after release.
The first PostgreSQL run exposed a driver-specific byte-ownership defect:
hashing `Buffer.slice().buffer` included pooled backing-array capacity although
PGlite's plain `Uint8Array` passed. The readiness hash boundary now uses the
shared exact detached-byte conversion; the genuine-PostgreSQL lifecycle and
migration suites pass after that correction. The package-wide migration
inventory includes the new tables and migration receipt. This checkpoint does
not change OCC, commit, action, task-run, or scheduler ownership.

#### AA-R6 Application activation and active-selection checkpoint — 2026-08-12

The second final-authority checkpoint now adds a distinct Application
activation generation without mutating inactive Application Revision V2 rows
or writing the displaced Declarative V2 activation/verdict owner. Migration
`0059_pretty_toad_men` adds one immutable activation-history table and one
scope-local active-head table. The history binds the exact AA-R6 readiness
receipt and canonical activation request; the head references that immutable
history and changes only through an explicit `(activationSequence, headSha256)`
compare-and-swap token.

Activation resolves the same located target as readiness, locks the scope clock
before the Application head, and asks the readiness issuer to replay and
revalidate its complete candidate-validation, unique-constraint, physical
index, schema, task-catalog, publication, manifest, and cold-materialization
evidence inside that transaction. Exact command replay returns its immutable
historical outcome. The CAS token is an explicit detached value token, not an
issuer capability: a different revision requires its exact current
`(activationSequence, headSha256)` value, while malformed or stale values fail
closed. History and head updates roll back atomically after a late failure.

Active reads use the schema/readiness owners' read-only projections, take only
shared scope-clock, readiness, history, and head locks on the located target,
verify the canonical head and activation evidence, revalidate the exact
readiness receipt without replaying publication writes, and issue an opaque
process-local selection. Its hidden basis contains only current scope
authority, Application manifest/publication identities, bound schema identity,
explicit task-catalog/runtime-host authority, readiness identity, and the
active history/head identities. Structural copies are unauthenticated, and an
issued selection is rejected after the head or scope authority moves.

The proof covers migration rollback/replay/non-public-schema behavior,
activation replay, stale CAS, multi-revision head movement, late rollback,
decision uncertainty followed by exact cold replay, stored-head corruption,
selection authenticity and invalidation, plus genuine
PostgreSQL split-store migration, deterministic scope-clock contention, and a
held-share-lock proof that rejects any hidden active-read lock upgrade. The
new task-catalog snapshot proof also exposed a precise stored-codec defect: it
hex-encoded a 32-byte task-catalog digest before calling the existing decoder
whose contract requires bytes. The snapshot owner now preserves the stored
byte contract without a compatibility branch.

This checkpoint remains private and production-inert. It adds no consumer,
route, runtime dispatch, task-run selection, OCC/commit behavior, fallback, or
dual active source. The next authorized checkpoint is capability composition
and private consumer migration only.

#### AA-R6 consumer-authority audit and accepted decomposition — 2026-08-12

The post-activation source audit rejects the earlier implication that query,
mutation, action, and Task System migration are one adapter checkpoint. Only
the query path has all required underlying capabilities without inventing
legacy evidence. The remaining cut is therefore four medium checkpoints, each
with its own preflight and commit:

1. **Query-first active Application composition.** Add an active Application
   execution projection, a query snapshot that validates the issued selection
   in its transaction, point-read and index-range capabilities over the bound
   schema, authenticated Source Artifact loading, exact Application Worker
   definition construction, and `ApplicationExecutionHost` invocation. Replace
   only the private Standard point-query consumer. No old selection, candidate
   runtime target, fallback, route, OCC, or commit change is allowed.
2. **Mutation authority bridge.** The retained transaction-grant and
   point-mutation-start contracts require `packageId`, `artifactId`, and
   `sourcePackageHash`, which Application Analysis does not own. Preflight an
   honest Application transaction-start/grant/stored-authority generation,
   then reuse the existing session journal, OCC rerun, terminalization,
   point-commit, retry, and outcome owners unchanged. Never manufacture the
   missing artifact identities or reinterpret their old rows.
3. **Action lifecycle generation.** The retained action authority persists
   candidate and action-binding identities absent from the new Application
   basis. Add a distinct Application action request/history authority, then
   reuse the generic callback bridge, outbound gateway, external-effect
   sequencing, close/drain protocol, and `ApplicationExecutionHost`. Do not
   relabel old action evidence or derive compatibility digests.
4. **Task System generation.** The current definition and run foreign keys,
   runtime binding, creation authority, and compute preparation all name
   Application Revision V1 and candidate/package/semantic-root evidence. Add an
   issuer-backed active per-task selection, a full Application task runtime
   binding and run-creation authority, and an honest definition/run reference
   generation; migrate run creation, compute preparation, and launch together.
   Historical Task Definition V1 evidence remains historical and is never a
   fallback.

Self-review accepts this decomposition because it exposes the actual authority
gaps instead of hiding them behind structural adapters. The query-first slice
is the next authorized work. Stop and record an owner issue if it requires a
new query authority beyond selection validation and the existing row/index
read primitives. The later mutation, action, and Task slices must not begin
until their separate preflights show how their new evidence reaches the
unchanged OCC/commit, callback/outbound, and run-lifecycle owners.

#### AA-R6 query-first active composition preflight and accepted amendment — 2026-08-12

The exact source audit accepts one medium query-only implementation checkpoint.
It composes already-issued authority; it does not add a durable query request,
outcome, grant, session, or active-head generation.

The implementation has three explicit owners:

1. **Persistence owns the scoped Application query snapshot.** Opening a
   snapshot claims an opaque `ApplicationActiveSelection`, replays the bound
   Application schema through the existing Application Schema Authority
   reader, resolves the bounded developer-index definition set through the
   existing control-catalog port, and opens the located data target. In the
   data transaction it takes the shared scope-clock lock, validates the issued
   selection against the current Application active head, loads the exact
   `fx_system_application_function_v1` row, verifies its catalog digest,
   canonical entry bytes, entry digest, kind, visibility, module/export
   identity, and validator fields against the active manifest, then pins the
   current snapshot token and retained-history floor. The selected root must be
   a public query. Missing, duplicated, malformed, mismatched, or stale state
   fails closed.
2. **The same snapshot owns read capability.** `revalidate`, point read, and
   index-range read each revalidate the active selection and retained floor in
   their located transaction. Point reads use the existing snapshot app-row
   primitive. Index reads decode the table, descriptor, bounds, and limit;
   require the exact schema binding and opaque located definition; require its
   current fenced build to be enabled; scan the existing ordered index at the
   pinned snapshot; materialize the selected live rows through the existing
   bounded set read; and return detached canonical documents. One operation
   budget bounds point reads, index syscalls, documents, and semantic bytes.
   The snapshot adds no journal, OCC evidence, read set, commit behavior, or
   fallback because a query has no write authority to protect.
3. **Standard Application Invocation owns composition.** An unversioned
   private `ApplicationQuerySystem` reads the current Application active
   selection, opens the scoped snapshot, reads authenticated Source Artifact
   V2 bytes by the selected root, constructs the canonical runtime target from
   the selected manifest plus the stored function entry, builds an
   `ApplicationWorkerDefinition`, constructs the exact transaction request,
   and calls the committed `ApplicationExecutionHost`. The Worker receives
   only a bounded RPC adapter over the snapshot. Its target, tables, snapshot
   sequence, execution time, random seed, authentication value, arguments, and
   argument semantic size are decoded by their existing protocol owners. The
   returned value is decoded by the host and returned without a second runtime
   or result path.

The Source Artifact reader and Worker Loader remain injected host capabilities.
The query service is a reusable Effect service; its Layer owns construction,
while the invocation Scope owns the snapshot capability. Narrow Promise calls
exist only at the Worker RPC adapter. Typed schema, selection, persistence,
source, definition, protocol, host, and cleanup failures remain distinguishable
at their owning boundaries; defects are not converted into input failures.

The shared Worker definition currently contains action policy fields even when
only its transaction entrypoint is loaded. This checkpoint supplies one
construction-owned, canonically encoded deny-all action policy solely to meet
that existing definition contract. It is not request input, active evidence,
or query authority. The implementation must not widen that policy or attach it
to the transaction request. Splitting transaction and action definitions may
be considered with the action checkpoint, when both consumers and the concrete
simplification can be reviewed together.

The private cut replaces only
`invokeStandardApplicationPointQueryV1`. Its compatibility name may remain,
but it must require the new unversioned query service and must not read
`ApplicationRevisionV1`, call `ApplicationPointQuerySystemV1`, prepare a
candidate-bound target, read Declarative V2 runtime artifacts, or fall back to
the displaced path. The old query System is renamed `Legacy...` only where the
bounded cut touches its retained exports; full deletion remains AA-R8.
Mutation and action continue using their old active reader until their own
authority checkpoints, which is explicit temporary coexistence between
different operations rather than dual authority for one query.

Required proof covers exact function selection, argument/result validation,
anonymous and user authentication projection, point read, developer-index
range order and page completion, all four budget dimensions, stale active head,
stale retained floor, disabled or mismatched index definition, malformed
stored function evidence, Source Artifact corruption, Worker definition or
load failure, fresh Worker load per invocation, RPC disposal, and interruption.
An integration assertion must prove that the Standard point-query consumer
never invokes the old active reader, legacy query System, candidate runtime
artifact store, or dispatcher. Focused PGlite proof is required here; genuine
PostgreSQL remains the mandatory AA-R7 gate.

Self-review accepts this amendment. It is the smallest complete query cut
because omitting stored-function validation would weaken publication
authority, omitting schema/index replay would trust caller structure, and
reusing the legacy query snapshot would preserve the very candidate/runtime
artifact dependencies being displaced. It preserves the source, schema,
activation, app-row, ordered-index, Worker Loader, and protocol owners and
changes no OCC, commit, route, deployment, mutation, action, or Task behavior.
If implementation discovers that the existing row/index primitives cannot
provide the promised snapshot semantics without changing their authority, stop
at that owner boundary and amend this preflight before proceeding.

#### AA-R6 query-first active composition checkpoint — 2026-08-12

The query-only cut is implemented without adding a query grant, session,
journal, outcome row, runtime artifact copy, or alternate active source.
Persistence now issues one Scope-owned `ApplicationQuerySnapshot` only after
claiming the process-local active selection, replaying the exact Application
Schema Authority projection, resolving the complete developer-index definition
set, validating the active head under the shared scope-clock lock, and matching
the selected public-query manifest entry to the canonical stored Application
function row. Every capability use revalidates the active selection and retained
history floor at the pinned commit sequence.

Point reads delegate to the existing snapshot row owner. Developer-index reads
require the exact schema binding and opaque located definition, require the
current fenced build to remain enabled, scan the existing ordered-index history,
re-derive each selected row's key, and materialize documents in bounded
eight-document batches while charging the shared point/index/document/semantic-byte
budget. This is deliberately a read capability only: it records no OCC read set
and has no write or commit authority.

One snapshot-local semaphore serializes document-producing point and index RPC
operations. This is part of the resource contract, not database consistency:
each operation observes all prior document and semantic-byte charges before it
can start another materialization transaction, so concurrent user-code fan-out
cannot turn a small cumulative budget into many simultaneous large reads.
Scope finalization marks the snapshot closed before removing its opaque handle;
queued RPCs re-check that state after acquiring the semaphore and therefore
cannot start transactions after Worker timeout, interruption, or normal return.

The new unversioned private `ApplicationQuerySystem` reads the new Application
active selection, opens that snapshot, reads the authenticated Source Artifact
bundle, constructs the exact Application runtime target and Worker definition,
and invokes the committed fresh-load `ApplicationExecutionHost`. Query argument
normalization now reuses the protocol owner's operation-specific 1 MiB traversal
ceiling, so composition does not first allocate under the broader general Value
limit. The Worker sees only the bounded RPC snapshot adapter. The Standard
point-query compatibility entrypoint requires only this new service and Scope;
it no longer reads Application Revision V1 or invokes the candidate-bound query
System. Mutation and action still use the displaced reader pending their own
approved authority checkpoints.

Focused proof covers canonical stored-function selection and corruption,
foreign-control developer-index composition refusal, active-head and retained-
history staleness, all four operation-budget dimensions, disabled-index
refusal, a real PGlite row plus developer-index build and ordered page,
anonymous and authenticated-user request projection, operation-specific
argument traversal, single-capture Layer construction, and a Standard
invocation that cannot obtain the old active reader. The existing committed
Application execution-host tests remain the owner proof for request/result
decoding, fresh Worker load, interruption, late-result disposal, and timeout.
The query checkpoint is validated and reviewed without absorbing or repairing
unrelated concurrent R2 or Task Runtime work.

The committed Application Revision V1 SAP05 harness and shared simulation are
retained legacy proofs, not composition roots for this migrated entrypoint.
They call their displaced query System through test-local legacy helpers; they
do not receive `ApplicationQuerySystem` and cannot call the Standard query
compatibility entrypoint. This prevents either harness from manufacturing new
Application authority from old revision evidence while keeping the production
cut exclusive. AA-R7 owns the new end-to-end Application system proof.

This checkpoint completes only the first of the four accepted consumer cuts.
It does not satisfy the mutation transaction-start/grant authority, action
history authority, Task definition/run generation, AA-R7 genuine-PostgreSQL
proof, or AA-R8 removal gates. The next authorized work is the mutation-authority
preflight; no mutation implementation begins until that preflight shows an
honest ingress to the unchanged journal, OCC, terminalization, and commit owners.

#### AA-R6 mutation-authority bridge preflight and accepted amendment — 2026-08-12

The connected mutation trace rejects a runtime-only adapter. The displaced
Transaction Grant, point-mutation start, stored session, pinned-function
metadata, OCC execution, and commit-authority checks all require one coherent
`packageId` / `dynamic-worker` / `artifactId` / `sourcePackageHash` generation.
Those fields are persisted in `fx_system_tx_session`, reconstructed when a
sealed attempt is authenticated, checked again before every OCC execution, and
compared by the point-commit owner. Application Analysis owns none of that
evidence. Deriving the fields from an Application digest, using placeholders,
or teaching only the final runner to ignore them would create a session whose
stored authority says something different from the runtime that executed it.

The opposite shortcut is also rejected. Application mutation does not receive
a new journal, OCC validator, retry loop, commit compiler, point-commit
transaction, idempotency table, committed-outcome projection, change feed, or
outbox. Those existing owners are runtime-neutral after they receive an
authenticated attempt. The bridge changes the evidence that authenticates the
attempt and the runner selected by that evidence; it does not create a second
write system.

The accepted durable authority is an exact discriminated union:

1. **Legacy dynamic-worker authority** retains the current package, artifact,
   source-package, execution-module, pinned function-metadata, and Transaction
   Grant contracts byte-for-byte. Existing sessions continue to authenticate,
   rerun, finish, and replay through that branch until the `AA-R8` drain and
   retirement gate passes.
2. **Application authority** stores one owned canonical Application Runtime
   Target V1 plus its digest, and the activation-head witness under which the
   mutation was admitted. The target already binds scope, revision,
   candidate, analysis, Source Artifact root, manifest, schema frame, function
   catalog, publication, execution module, exact public mutation entry,
   validators, partition, and entry digest. The session continues to store the
   existing schema-version, canonical arguments, identity-policy digest,
   request key/hash, revocation epoch, expiry, and lifecycle evidence in their
   current owner columns. It must not duplicate every Application digest into
   an independently mutable set of scalar columns.

Persistence adds an execution-authority-generation discriminator and a
canonical execution-authority envelope with digest. The old artifact columns
become a nullable all-or-none group required only by the legacy branch; they
remain unchanged for every existing row. The Application envelope is required
only by the Application branch. Database checks must make mixed, partial, or
unknown generations impossible. The stored-session decoder exposes the same
discriminated union rather than widening legacy strings to optional fields.
The transaction journal/envelope protocol remains version 1 because its read,
write, result, and sealing semantics do not change; the new versioned contract
is the stored execution-authority envelope, not a false chronology suffix on
the whole mutation product.

The Application branch uses a distinct Application Mutation Grant V1. Its
signed logical pins are the deployment and scope authority, canonical runtime-
target digest, activation sequence and head digest, schema version, canonical
argument digest, request key/hash, identity-policy digest, revocation epoch,
policy version, issuance, and expiry. It may reuse the existing signing-key,
canonical-JWS, clock, expiry, and revocation mechanics through a shared private
signing kernel, but it must not reinterpret the old Transaction Grant payload
or accept one grant family where the other is expected. The generic physical
grant JSON/bytes/digest columns may store either exact envelope under the
execution-authority discriminator.

Admission reads the current unversioned Application active selection, verifies
that the selected entry is an exact public mutation, constructs the canonical
runtime target from authenticated publication/function evidence, canonicalizes
the request and arguments, and issues and verifies the Application grant. The
session-creation transaction then validates the opaque active selection and
head witness under the existing shared scope-clock ordering before it inserts
the Application authority. A head movement before insertion rejects admission.
After insertion, the immutable stored target and grant—not the mutable active
head—authorize initial execution and OCC reruns. This deliberately preserves
the current mutation rule: an activation change does not reinterpret or kill
an already admitted session, while a retry can never switch revisions.

Executor authentication becomes generation-aware at one seam. Legacy evidence
continues through the existing Transaction Grant verifier and pinned metadata
reader. Application evidence decodes and rehashes the stored runtime target,
verifies the Application grant and its exact logical pins, reloads the selected
immutable publication/function/schema evidence, and proves exact agreement.
The resulting authenticated runner input is a discriminated legacy-or-
Application authority value; it must not expose a `verifiedGrant` plus legacy
`PointMutationTargetFunctionMetadataV1` as though those types described both
generations. Everything after authenticated arguments, schema bindings,
function authority, and journal capability are produced continues through the
existing attempt liveness, journal seal, commit-input validation, point-commit
planning/publication, OCC replacement, retry, and durable outcome paths.

The Application runtime runner builds the exact Application Worker definition
from authenticated Source Artifact bytes and the stored target, constructs the
write transaction request with the attempt's persisted execution time and
snapshot token, binds the existing journal capability, and calls
`ApplicationExecutionHost.runTransaction`. Every attempt performs a fresh
Worker Loader load. Worker/runtime failure is translated once into the current
mutation execution error families; only a sealed successful result can reach
commit planning. The runner owns no active selection, session transition, OCC
decision, commit, or outcome authority.

Implementation is split into three medium checkpoints, each committed and
reviewed before the next begins:

1. **Contract and persistence generation.** Add the Application grant and
   stored execution-authority contracts, the guarded additive session
   migration, exact row decoding, Application session admission, and legacy
   replay compatibility. This checkpoint is inert and does not run user code.
2. **Stored-attempt authentication and runner.** Make authentication and the
   runtime-neutral runner input generation-aware, add the Application
   publication/function/schema verifier and Application Worker runner, and
   prove that both generations reach the unchanged journal/OCC/commit tail.
   It remains unwired from the Standard consumer.
3. **Standard mutation composition and exclusive cut.** Add the unversioned
   `ApplicationMutationSystem`, compose active selection, source loading,
   definition construction, grant issuance, session admission, and execution,
   then replace only the private Standard point-mutation consumer. Rename
   touched displaced exports `Legacy...` where bounded and retain no fallback
   or comparison execution.

Required proof includes legacy-row decode and completion; Application exact
grant/session replay; same-key same-request idempotency; same-key conflicting-
request rejection; stale active head before admission; active-head movement
after admission without target drift; wrong, mixed, corrupted, or cross-
generation authority rejection; exact function, publication, Source Artifact,
and schema agreement; fresh Worker load on initial execution and OCC rerun;
journal read/write and internal-call behavior; conflict replacement followed
by one successful commit; losing-attempt rollback; terminal worker or journal
failure without commit; durable result replay; and unchanged commit/change-
feed/outbox effects. Focused PGlite proof is required in these checkpoints;
genuine PostgreSQL and the complete Application vertical remain mandatory in
`AA-R7`.

Self-review accepts this amendment because it introduces one honest authority
branch at the narrow point where runtime identity is authenticated and leaves
the write lifecycle single and predictable. Stop and amend this preflight if
implementation requires fabricated artifact evidence, a legacy/Application
fallback, dual execution, a second journal or commit path, mutable-head
revalidation after session admission, a schema or function selected from the
request, or any change to commit compilation, commit publication,
idempotency outcomes, change feeds, or outbox semantics.

Checkpoint 1 is now implemented as an inert private boundary. Application
Mutation Grant V1 and the canonical Application mutation execution-authority
envelope are distinct from the legacy Transaction Grant family, and session
admission accepts only an opaque grant handle produced after signature
verification. Migration `0060` adds the execution-authority discriminator and
an exclusive all-or-none database constraint: existing rows default to the
unchanged legacy branch, while Application rows require the canonical envelope
and forbid all legacy package/artifact fields. The Application admission
transaction validates the exact active-selection witness under the existing
scope-clock ordering before initial session creation. Exact replay relies on
the stored immutable authority and evidence and does not revalidate the mutable
active head. Both paths reuse the unchanged session, journal, lease, and
execution-claim owners. Stored-attempt and commit-authority
materialization still reject the Application branch until checkpoint 2; no
Standard mutation consumer or user-code runner is wired by this checkpoint.

#### AA-R6 mutation checkpoint 2 commit-owner correction preflight and accepted amendment — 2026-08-12

The checkpoint-2 connected-owner audit rejects one sentence in the preceding
preflight as too broad. The journal representation, OCC decision algorithm,
row-intent compilation, write application, idempotency outcome, change feed,
and outbox can remain unchanged. The authority shape entering that tail cannot.
`CommitInputAuthorityPinsV1`, `PointCommitAuthorityPinsV1`, the point-commit
commands, and the point-commit transaction currently require and compare the
legacy `packageId`, `artifactRuntime`, `artifactId`, `sourcePackageHash`, and
`executionModule` fields. An Application session deliberately forbids those
columns. A runner-only bridge could therefore execute and seal Application
user code but could never authenticate or publish its commit without
fabricating legacy artifact evidence.

This is a shared commit-owner boundary, so checkpoint 2 receives a separate,
bounded correction preflight rather than treating the change as incidental
runtime wiring. The accepted correction changes only the execution-authority
identity carried through commit authentication:

1. Stored session scalars and commit authority pins become exact discriminated
   unions. The legacy branch retains the five current artifact fields
   byte-for-byte. The Application branch carries the already-persisted
   execution-authority generation and canonical authority digest and forbids
   the legacy fields. Common deployment, scope, session, attempt, storage,
   snapshot, schema, function, policy, revocation, request, grant, argument,
   seal, journal, and result evidence stays in its current owner.
2. Stored-attempt and stored-commit-authority loaders decode, recanonicalize,
   and rehash the Application authority envelope, then authenticate its
   immutable activation, readiness, revision, analysis, publication,
   function, manifest, and schema graph inside the same repeatable-read
   capture. They do not consult the mutable active head after admission.
3. Executor commit authentication dispatches exactly once on the stored
   generation. Legacy evidence continues through the Transaction Grant and
   pinned-metadata verifier. Application evidence continues through the
   Application Mutation Grant verifier and the immutable Application graph
   verifier. There is no cross-generation fallback.
4. Point-commit command validation and the locked-session comparison match the
   command's discriminated authority branch against the same stored branch.
   No OCC comparison, row intent, commit sequence, transaction ordering,
   publication, outcome, change-feed, or outbox behavior changes.
5. Only after that authority correction is proven may the Application Worker
   runner bind the existing journal capability and reach the shared tail. The
   runner remains private and Standard-unwired in checkpoint 2.

Required owner-specific proof is: legacy and Application command/session
agreement; mixed generation, absent authority, wrong authority digest, and
legacy-field substitution rejection; exact replay through conflict replacement
and one commit; unchanged committed outcome, change-feed, and outbox receipts;
and a query-observation receipt showing no new transaction or lock phase was
introduced. Existing point-commit tests remain the behavioral baseline and
must pass unchanged apart from fixtures extended to express the authority
union.

Self-review accepts this bounded amendment because it is the minimum shape
change that lets the existing commit owner authenticate the authority that
actually executed. It does not authorize a second commit path or any semantic
change to journal, OCC, compilation, transaction, result, feed, or outbox
ownership. Stop and amend again if implementation needs a new commit table,
dual writes, placeholder legacy evidence, current-active-head revalidation,
or a branch inside row-intent compilation or write application.

The commit-owner correction is now implemented and stops at that boundary.
Stored transaction session evidence is an exact legacy-or-Application union;
the stored-attempt loader recanonicalizes and rehashes Application authority
JSON/bytes/digest; commit input and point-commit authority pins carry a matching
generation; and the locked-session transaction compares the legacy fields or
Application authority digest without changing its lock order or downstream
write behavior. Legacy executor authentication remains intentionally fail-
closed for the Application branch until the immutable Application graph and
runner portion of checkpoint 2 is implemented.

Focused receipts are green: protocol typecheck and 9/9 transaction-session
tests, persistence and executor typechecks, 61/61 stored-attempt authentication
tests, 4/4 point-commit finishing tests, and the exact canonical Application
stored-attempt regression. The broader stored-attempt suite still has the same
two connected execution failures observed before this correction: a test
runtime emits string syscall sequence `"1"` where the journal owner requires a
bigint. That shared journal-sequence defect is recorded as diagnostic evidence
and is not repaired or weakened in this authority-only slice.

#### AA-R6 mutation checkpoint 2 immutable-authority preflight and accepted amendment — 2026-08-12

The commit-owner correction proves that the stored session and final commit
refer to the same Application authority digest. It does not yet prove that the
digest names an admitted immutable Application graph or that the stored
Application Mutation Grant authorized that graph at the database time captured
for commit authentication. This next medium checkpoint closes only those two
gaps. It remains persistence-and-authentication-only: it does not load Source
Artifact bodies, construct a Worker, run application code, or wire Standard.

The preflight initially assumed all Application evidence shared the located
scope database. Implementation challenged that assumption: readiness publishes
the deployment-stable schema version and Application schema authority in the
control database, while the session, activation, readiness, revision, analysis,
publication, and selected function live in the located scope database. A single
PostgreSQL repeatable-read cannot span those owners without introducing a new
distributed transaction, which this migration forbids.

The scope-owned Application evidence is captured inside the existing located
repeatable-read used by `StoredCommitAuthorityEvidenceLoader`. The loader must
never consult the mutable active-head row after session admission. The control
owner is read separately through a narrow content-addressed schema-authority
snapshot keyed by deployment, schema version, and Application schema digest.
Those control rows are immutable once published, so their correctness comes
from exact canonical bytes/digests and cross-owner pins rather than false
transactional atomicity. Neither side may call a repository that reselects a
mutable current head. The combined proof establishes:

1. the exact activation at the stored activation sequence and its canonical
   bytes/digest;
2. the readiness receipt selected by that activation and the historical
   active-head frame reconstructed from activation plus readiness, whose digest
   must equal the stored head digest;
3. the exact revision, analyzed analysis manifest, publication frames,
   selected public mutation entry, and canonical runtime target named by the
   stored execution authority; and
4. the revision-schema publication plus the separately captured immutable
   control schema version, stable bindings, and canonical Application
   schema-binding frame.

The readiness receipt is an immutable commitment used as evidence; this
checkpoint does not re-run cold eligibility, enumerate task definitions, or
re-evaluate current activation policy. The selected mutation proof recomputes
the complete schema and function-catalog commitments from the canonical
manifest, so loading every function row is unnecessary. Candidate-row and
analysis-receipt replay are likewise outside this selected-path authorization
proof. If implementation needs those rows to establish an identity claimed
above, this preflight must be amended rather than silently widening the graph.

Large graph evidence follows the loader's existing size-before-payload rule.
An Application-only scalar projection captures unique row identities and byte
lengths first; those lengths count toward the existing aggregate
materialization ceiling. Only an admitted size projection may fetch payload
bytes. Missing, duplicate, oversized, non-canonical, digest-mismatched, or
cross-linked rows become the existing typed stored-authority corruption or
mismatch result. Legacy query order, evidence, and behavior remain unchanged.

Application Mutation Grant verification cannot use one long-lived protocol
namespace whose trusted clock was fixed during host construction. Commit
authentication owns the database timestamp captured with the located scope
evidence. The executor therefore adds a private
Application grant verification kernel parallel to the existing Transaction
Grant kernel: immutable deployment/key/retention configuration is captured
once, while each verification call supplies the captured database time and the
exact expected logical pins. The kernel delegates canonical JWS, Ed25519, key
lifecycle, issuance, expiry, and lifetime checks to the protocol verifier,
then compares deployment, scope, execution-authority digest, activation/head,
schema version, public mutation path/kind, policy, identity-policy digest,
argument codec/digest, request key/digest, capabilities, auth, and revocation
epoch. Stored grant JSON/bytes/digest/expiry/revocation evidence must also agree
exactly. There is no Transaction Grant fallback.

The resulting authenticated evidence is a discriminated union. The legacy
member retains the existing verified Transaction Grant and pinned dynamic-
worker function metadata. The Application member carries inspected Application
grant evidence plus the authenticated immutable Application runtime target and
schema evidence; it must not be typed as legacy function metadata. Downstream
runner and commit-input adaptation remain fail-closed until their separately
validated runner slice.

Required proof for this checkpoint is: immutable Application graph success;
missing, duplicate, oversized, non-canonical, wrong-digest, wrong-link, wrong-
function, wrong-runtime-target, wrong-schema-binding, and wrong historical-head
rejection; size projection before payload; a later active-head change that does
not invalidate the admitted historical witness; database-clock grant success;
wrong logical pin, physical grant evidence, key phase/window, time, lifetime,
and cross-family rejection; and unchanged legacy authentication. Focused
PGlite and unit receipts are sufficient here; genuine PostgreSQL and the full
Application vertical remain AA-R7 gates.

Self-review accepts this amended preflight because it authenticates the
already-stored authority at the existing evidence seam without pretending two
databases share a transaction, consulting mutable selection, or changing
journal/OCC/commit behavior. Stop and
amend if implementation requires current-head revalidation, ambient verifier
time, a legacy/Application fallback, eager unbounded joins, Source Artifact
execution, or any change below the authenticated-authority boundary.

The checkpoint implementation now satisfies that amended boundary. The scope
capture reconstructs activation and historical-head commitments, correlates
readiness/revision/analysis/publication/selected-function evidence, and never
reads the mutable active-head row. The control capture proves the exact schema
artifact, stable table bindings, and canonical Application schema-binding
frame from its content-addressed published authority. Both owners perform
size projections before payload reads and their lengths share the existing
64 MiB materialization budget. The size phase projects only scalar selectors
and byte lengths: Application execution-authority JSON/canonical bytes are
charged before being fetched, and the graph payload omits unused analysis
receipt bytes. Missing control composition fails closed.

Focused receipts are green: persistence and executor typechecks; 66/66
Application-grant-kernel plus legacy stored-authentication tests; and the real
PGlite Application graph case proving exact load, both size-before-payload
orders, a 64 MiB+1 aggregate rejection before every payload query,
mutable-head independence, missing-control rejection, and tampered function
rejection. Constraint-valid malformed authority selectors remain typed
corruption rather than SQL failures, and the Application grant kernel snapshots
its deployment, retention, and key-window configuration before use. Malformed
Application grant-pin scalars and mixed legacy/Application runner evidence also
remain in the typed corruption channel; graph verification failures are folded
once at the materialization boundary rather than manually reboxed.

The verifier currently owns package-local copies of activation, historical-head,
cold-receipt-set, and schema-binding frame construction that the existing
persistence producers still construct privately. Before AA-R7, factor the
producers onto this single pure frame owner with byte-identity regressions; do
not change either wire spelling while doing so. This is drift-prevention debt,
not authority to widen the present authentication checkpoint.

The broader
stored-attempt suite remains 90/92 because of
the already-recorded shared journal string-versus-bigint defect; this slice
does not alter or weaken that owner.

#### AA-R6 mutation checkpoint 2 Application-runner preflight and accepted amendment — 2026-08-12

The immutable-authority checkpoint is committed at `b524d8ff`. The next medium
slice is only the private Application mutation runner and its authenticated
input. It remains unwired from Standard admission and does not authorize the
consumer cut.

The package trace rejects placing the runner in executor. Source Artifact V2
reading, Application Worker definition construction, and `WorkerLoader`
execution are owned by `flarex-backend`; making executor import that package
would reverse the existing dependency direction. The accepted composition is
therefore a backend-owned runner implementing executor's narrow runtime-neutral
runner port. Executor continues to own attempt liveness, journal opening and
sealing, OCC replacement, commit planning, publication, and durable replay.

The authenticated runner input becomes an exact generation union:

1. the legacy member retains its verified Transaction Grant and pinned
   `PointMutationTargetFunctionMetadataV1` unchanged; and
2. the Application member carries the verified Application grant, canonical
   runtime target, already-authenticated canonical Application manifest, and
   immutable publication/schema witness. The persistence materializer already
   decodes and verifies that manifest; retaining an owned frozen snapshot avoids
   rereading or treating the physical schema manifest as application source
   authority.

The backend runner receives injected Source Artifact reader, Application
execution host, and trusted host-policy frame/digest. It reads only the pinned
Source Artifact root, builds `ApplicationWorkerDefinition` from the authenticated
manifest and target, projects the write request from authenticated arguments,
auth, stable table bindings, execution time, random seed, and creation-time
cursor, then calls `ApplicationExecutionHost.runTransaction`. Each call reaches
the host separately, so initial execution and every OCC rerun perform a fresh
Worker Loader load. No mutable active head is consulted.

Application Worker transaction capabilities are flat while the existing journal
port is table/index scoped. A private executor adapter may expose exactly
`revalidate`, point read, index range, insert, patch, replace, and delete over
that existing port. It serializes every admitted operation and assigns the
existing next syscall sequence in call order because the Worker does not supply
journal sequence evidence. It translates only between the two exact operation
and result shapes, closes admission after host settlement, drains all admitted
operations, and preserves first journal failure as terminal authority. It must
not cache reads, invent retry, bypass validation, or own sealing/commit.

Failure mapping remains single and predictable. Worker application/user errors
map to the existing mutation application/user-code families. Definition,
source, request, transport, timeout, and invalid-result failures map to the
existing runtime-host family with an Application-specific reason/cause.
Journal failures retain journal authority and win during close/drain exactly as
the legacy runner does. Only a successful host result returned after adapter
drain can be sealed by the unchanged executor operation.

Required proof for this slice is: exact Application request projection; source,
manifest, target, and definition correlation; anonymous/user auth projection;
flat point read/write and index-range translation; serialized syscall ordering;
internal query/mutation calls sharing the same capability; journal-first close
and drain; dropped/late capability failure; terminal host failure without seal;
fresh Worker loads across two executions; legacy request bytes unchanged; and
the shared tail receiving a successful Application result through its existing
seal/planning seam. Focused executor and backend/Miniflare tests are sufficient;
PGlite conflict replacement and Standard admission remain the next consumer
checkpoint, while genuine PostgreSQL remains AA-R7.

Self-review accepts this preflight because it moves only authenticated runtime
projection across an existing package boundary. Stop and amend if implementation
requires executor-to-backend imports, a second journal or commit path, mutable
selection reads, fabricated legacy artifact fields, unsequenced concurrent
journal calls, a source/manifest fallback, or Standard wiring.

Implementation checkpoint receipt — 2026-08-12: the private runner is now
implemented but remains unwired from Standard. Executor's authenticated runner
input and commit-input pins are exact legacy/Application unions; Application
evidence retains the already-verified manifest plus readiness-pinned runtime-host
identity and compatibility date. The backend runner reads only the pinned Source
Artifact root, rebuilds the Worker definition from that manifest/target, snapshots
and hashes its injected host policy, projects authenticated anonymous/user
identity into the Application Worker request, and calls the existing
`ApplicationExecutionHost` once per execution.

The flat capability adapter is a single translation layer over the existing
bound journal. A real workerd proof admits concurrent read, index-range, insert,
patch, replace, and delete calls, serializes them to the existing syscall
sequence `1..6`, and rejects post-close use. It owns no storage, retry, seal, OCC,
or commit behavior. Focused receipts are green: executor typecheck and 76/76
stored-authentication, grant-kernel, legacy-runner, and flat-capability tests;
backend typecheck and 36/36 Worker-definition, execution-host, and runner tests;
persistence typecheck and the focused Application-authority loader proof; plus
the workspace Effect-boundary check. The next checkpoint is the separately
preflighted Standard/PGlite mutation consumer cut; this checkpoint does not
authorize it.

Final correction receipt — 2026-08-12: the readiness-pinned runtime-host
identity now commits both the registration core and the exact Application
execution Worker core, and the runner rejects a mismatched identity before
source reading or Worker loading. The Application Worker result contract now
has an exact structured `applicationError` member; public `FlarexError`
code/message/data crosses the Worker RPC and host without being collapsed into
generic user-code failure, while ordinary exceptions retain the existing
user-code family. Protocol, host, real Miniflare Worker, and runner regressions
pin the owned/detached envelope and both failure projections.

The final journal correction preserves the pre-existing C03-V exception:
the exact schema-document-validation failure remains application-catchable,
does not poison the attempt, and does not consume the next syscall sequence.
Every other journal failure remains terminal. A real Worker proof catches an
invalid write and completes a valid write, while the flat-adapter proof pins
sequence reuse. The shared executor-tail regression also carries one successful
Application result through sealing and planning exactly once.

#### AA-R6 mutation checkpoint 3 Standard composition preflight and accepted amendment — 2026-08-13

The runner checkpoint proves an authenticated Application attempt can execute
and reach the existing seal, planning, and publication tail. It does not yet
provide an honest Standard ingress. A direct replacement of the legacy System
would still be incomplete: persistence can insert an Application session row,
but executor's process-local activated-session capability is issued only from
the legacy prepared start; no production owner yet selects and authenticates a
public mutation before grant preparation; and the protocol intentionally
provides grant frames and verification rather than retaining a private signing
key. Standard must not forge any of those authorities.

The accepted composition adds one unversioned `ApplicationMutationSystem` with
four narrow injected owners:

1. A persistence-owned Application mutation admission projection consumes the
   opaque active selection and requested function path, requires the exact
   manifest entry to be a public mutation, correlates its stored function,
   publication, schema, and active-head evidence, and returns an owned canonical
   runtime target plus the selection witness. It uses the same immutable frame
   constructors as readiness and stored-authority verification. It does not
   open a query snapshot, read user rows, or select authority from caller data.
2. A narrow Application grant issuer owns the active signing key and issuance
   clock. The System supplies the exact prepared logical pins: canonical
   execution authority, anonymous identity-access policy, canonical validated
   arguments, request key/hash, revocation epoch, and bounded expiry. The issuer
   signs and verifies the JWS against its owned public-key lifecycle snapshot
   and returns only `VerifiedApplicationMutationGrantV1`; neither Standard nor
   persistence receives the private key or manufactures an opaque handle.
3. An executor-owned Application session-activation adapter accepts the
   persistence activation port, the verified grant, exact prepared Application
   evidence, and execution-claim issuer. It snapshots the prepared input,
   delegates the scope-clock/head check and row insertion to persistence, and
   alone registers the existing opaque `ActivatedPointMutationSessionV1`. The
   registered state becomes an exact legacy-or-Application prepared union. No
   public structural constructor is added.
4. The existing initial-execution and committed-outcome owners receive that
   opaque handle. A created session executes through the already committed
   generation-aware runner and shared tail. Busy, replay, conflict, and terminal
   outcomes are resolved through the existing request-key/outcome contracts;
   Standard does not poll tables, retry user code, or publish a result itself.

`ApplicationMutationSystem` is a domain service assembled by a Layer from those
owners plus the existing active-selection reader, argument validator/canonical
value codec, request-key policy, revocation authority, session timing policy,
initial execution configuration, and committed-outcome reader. Construction
captures and validates immutable policy once. Invocation remains one Effect
operation with typed admission, signing, persistence, execution, and outcome
failures; foreign signing or random/id generation failures are mapped once at
their owning adapter. This is a positive service/Layer boundary because it is a
reusable injected operation with lifecycle-owned persistence, cryptographic,
and executor capabilities, not a pure helper or a dynamic per-request value.

The Standard compatibility entrypoint changes only its private mutation
dependency from the displaced `ApplicationPointMutationSystemV1` to
`ApplicationMutationSystem`. The touched displaced service and helper exports
are renamed `LegacyApplicationPointMutationSystem...` and retained only for
explicit legacy tests and drain support until `AA-R8`; no production Standard
entrypoint, Layer, or export may provide a legacy fallback, comparison run, or
dual execution. Query and action routing are unchanged by this checkpoint.

This accepted work is split into two medium checkpoints without shrinking the
migration gate:

- checkpoint 3a establishes the executable authority owners and the exclusive
  Standard route: exact public-mutation admission, private grant issuance,
  opaque Application session activation, the unversioned service/Layer, and
  explicit legacy-only test helpers. Its focused PGlite proof covers exact
  selection and stale-head rejection; focused unit proof covers signed grant
  pins and proves the Standard entrypoint has no legacy System requirement.
  Checkpoint 3a is not the full composition proof and does not authorize the
  next consumer migration by itself.
- checkpoint 3b adds one reusable Application-native PGlite fixture and drives
  the complete Standard composition through it. It must cover a successful
  write; same request key plus same request returning the durable result after
  the first invocation has settled; a concurrent duplicate returning the exact
  typed `inProgress` failure and succeeding as a durable replay when retried;
  the same key plus different request rejecting; head movement before
  insertion rejecting; head movement after admission not changing the pinned
  target; fresh Worker loads for initial execution and an OCC rerun; conflict
  replacement then one commit; terminal Worker and journal failures without
  commit; exact result replay; and unchanged commit, change-feed, and outbox
  receipts. It also pins the opaque Application activation handle,
  unknown/mixed generation rejection, non-public/non-mutation selection, and
  all real live-layer requirements.

Genuine PostgreSQL and the complete cross-product vertical remain `AA-R7`
gates. Checkpoint 3b is the next required slice after 3a; the split exists so
the Application-native fixture is a reusable authority owner rather than a
copy of readiness internals inside a single Standard test.

Self-review accepts this amendment because every new step terminates at an
existing authority owner and the orchestration has one deterministic route.
The persistence projection proves selection, the issuer proves the signature,
executor proves capability membership, and the existing tail proves the
commit. Stop and amend before implementation if the slice requires a private
key in Standard, a structurally forged grant or activated-session handle,
caller-selected schema/function/publication evidence, mutable-head validation
after admission, a legacy fallback, a second outcome/idempotency path, or any
change to journal, OCC, commit compilation, commit publication, change-feed,
or outbox semantics.

#### AA-R6 checkpoint 3b runtime-host identity correction preflight and accepted amendment

The Application-native composition fixture exposed a shared contract mismatch
before its first session could be admitted. Readiness deliberately requires the
Task catalog binding and cold Application Worker receipt to name the same
runtime host identity. The accepted Application Worker identity is currently
315 UTF-16 code units because it commits both generated-core digests and the
import/runtime policy. The Application Task Binding contract and its durable
catalog check admit at most 256 code units. A real readiness settlement must
therefore reject the current host with `coldMaterialization`; using a shorter
test identity would no longer prove the runtime that execution actually loads.

The bounded correction raises only the runtime-host-identity ceiling in the
Application Task Binding contract and matching durable catalog constraint from
256 to 1,024 code units. NUL-free Unicode-scalar validation, nonempty policy,
canonical bytes, digest commitments, replay comparison, and PostgreSQL text
safety remain unchanged. Revision, candidate, analysis, task, module, export,
and other identity limits remain 256. The migration replaces the named catalog
check without rewriting stored evidence; every value accepted before remains
accepted, and the new ceiling remains small relative to the existing binding
byte budget.

Required proof is exact acceptance at 1,024, rejection at 1,025, persistence of
the accepted full Application Worker identity, and the resumed readiness plus
Standard mutation composition. This correction does not authorize a shortened
or aliased host identity, a Task/Application policy split, a readiness bypass,
or any journal, OCC, commit, feed, or outbox change.

Self-review accepts this correction because readiness already owns exact
identity equality and the persisted text column already owns canonical binding
bytes. Aligning their finite ceilings restores the existing invariant rather
than adding a new authority or fallback.

The resumed run also exposed one connected runtime-accounting mismatch. Stored
point-mutation evidence deliberately names the semantic size of the legacy
one-element argument array, including its two-byte container charge; the
Application Worker request carries the argument object itself. The Application
runner must subtract the protocol-owned array overhead when projecting that
request, while retaining the stored size for legacy exact-runtime execution.
This is a projection correction only: arguments, canonical bytes, digest,
validator result, and all commit evidence remain unchanged. The runner proof
must start with the stored array size so it cannot pass through the previous
object-sized fixture shortcut.

The split PGlite fixture also has to distribute the immutable schema catalog to
the located database because the journal resolves pinned table identities
locally. It does so by invoking the existing schema publisher against the
located target with the same canonical manifest after control publication. It
does not copy rows or add a journal fallback. Production distribution and
genuine topology coverage remain `AA-R7` gates; this receipt proves only that
both sides are content-addressed by the same schema authority.

Finally, Application retries cannot reuse the physical grant JWS: the private
issuer creates a fresh valid grant for each invocation. Session replay must
therefore compare the authenticated Application authority, function, schema,
policy, argument, request, and revocation pins while retaining the first stored
grant as the attempt's execution authority. Legacy replay remains byte-exact
for its externally prepared grant. A changed request, arguments, authority, or
revocation epoch still conflicts; only grant ID, JWS bytes/digest, and expiry
may differ after the fresh Application grant has been verified against the same
logical pins. This generation-specific equality is required for typed busy and
durable replay semantics and does not authorize grant-family fallback.

Implementation self-review corrected one overly broad concurrency claim before
the checkpoint was frozen. Session activation intentionally returns `busy`
without minting an execution claim, and the existing crash-redispatch owner also
projects `busy`; there is no owner-level wait-for-outcome contract. The System
must therefore return a typed `inProgress` failure immediately when activation
is busy and the durable outcome is still absent. It must not pass the
non-authorizing handle into initial execution, poll the outcome table, or invent
a Standard-owned wait loop. The caller may retry the same canonical request;
once the first execution settles, the normal pre-admission outcome lookup
returns the exact durable replay. This is the smaller deterministic contract and
preserves the existing execution-claim and redelivery owners.

First migrate executable authority and publication:

- the private Standard producer and fixtures emit real execution registration
  and schema modules;
- Standard Application Analysis returns the new manifest/receipt through a new
  exact exported contract, while the existing V1 static result remains legacy
  until consumer removal;
- application-named function catalog and whole-bundle runtime publication are
  derived from the manifest; and
- point mutation, query, internal-call, and edge-action runtime-target contract
  generations bind the new candidate and manifest/publication identities.

Then migrate readiness and activation:

- new readiness evidence proves the accepted analysis, inactive revision,
  schema/catalog publication, every required whole-bundle runtime object, cold
  materialization, and existing index readiness;
- new activation and active-selection generations bind that readiness receipt;
- task-capable revisions use a new task runtime-binding generation without a
  semantic-root field; and
- all private consumers select only the new active generation.

This gate may adapt the narrow inputs supplied to existing runtime and
transaction owners. It must not modify their authority or execution semantics.

#### AA-R6 action checkpoint 4 authority-generation preflight and accepted amendment

The completed query and mutation cuts leave the private Standard action on the
displaced path. `invokeStandardApplicationActionV1` still reads
`ApplicationRevisionV1`, `ApplicationActionSystemV1` still claims a
candidate-bound action target, and admission still materializes Declarative V2
runtime artifacts. Its durable invocation row requires
`applicationRevisionId`, `candidateSha256`, and `actionBindingSha256` and has a
foreign key to Application Revision V1. None of those values exists in the new
Application active basis, so mapping the new runtime-target digest into an old
column would manufacture compatibility evidence and is rejected.

The source audit also corrects the earlier implication that a distinct
Application action lifecycle needs a second invocation table. The current
invocation row owns generic request-key, execution-fence, cancellation,
external-effect ordinal, result, and terminal state. The shared external-effect
owner has no foreign key to that row, but its operations deliberately lock and
advance the current invocation parent before inserting or transitioning effect
evidence. A second parent table would therefore duplicate lifecycle logic or
add a table-selection branch to every effect operation without introducing a
new semantic lifecycle.

The accepted simpler design keeps one action invocation lifecycle table and
makes only its execution-authority evidence an exact generation union:

1. `legacy_candidate_bound_v1` retains the existing Application Revision V1,
   candidate, action-binding, request-frame V1, foreign-key, replay, and host
   behavior unchanged.
2. `application_v1` stores one canonical Application action execution authority
   as owned JSON, canonical bytes, and SHA-256. Its protocol format binds the
   canonical public-action runtime target, runtime-target digest, activation
   sequence, active-head digest, and schema version. A distinct action request
   frame V2 binds that authority digest, execution identity, host policy,
   canonical argument reference, scope, and request key. It does not reuse or
   reinterpret the legacy candidate or binding fields.
3. A database check enforces structural exclusivity. Legacy rows keep the
   existing foreign key; Application rows have all legacy authority columns
   null and exact bounded canonical Application evidence present. Unknown,
   incomplete, mixed, noncanonical, or digest-mismatched branches fail closed.
4. Claim, cancellation, expiry recovery, request replay, execution fencing,
   effect ordinals, external-effect uncertainty, result publication, and
   settlement continue through one lifecycle owner. The process-local direct
   action subject remains opaque and binds the request identity plus execution
   generation, so the existing outbound and child-mutation evidence table does
   not gain a generation branch or a fallback.

This action migration is split into three medium checkpoints:

- **4a — inert authority generation.** Add the action authority and request V2
  protocol contracts, the additive invocation-row union migration, exact
  generation-aware persistence materialization, and an active Application
  action selector that validates the issued selection and stored public-action
  function under the scope-clock transaction. Exercise admission, replay,
  conflict, claim, effect, settlement, cancellation, recovery, corruption, and
  migration behavior for both branches. Do not wire Standard or load a Worker.
- **4b — Application action host composition.** Read only the authority-pinned
  Source Artifact root, build the Application Worker definition from its
  authenticated manifest and runtime target, construct the Application action
  request, and call `ApplicationExecutionHost.runAction`. Adapt the existing
  opaque callback bundle, outbound gateway, effect sequencer, and close/drain
  settlement to the generation-aware subject. Do not retain the
  candidate-bound R2 runtime artifact path as a fallback or comparison run.
- **4c — exclusive Standard cut and private proof.** Add the unversioned
  `ApplicationActionSystem`, make it read the new active Application selection,
  and change only the compatibility-named Standard action entrypoint to require
  that service. Rename the displaced service and active-revision reader as
  explicit Legacy owners for retained tests until `AA-R8`. A reusable PGlite
  proof covers success, exact replay without another Worker, conflicting key
  reuse, head movement before admission, head movement after admission retaining
  the pinned target, external-effect confirmation and uncertainty, child
  mutation callback evidence, cancellation/expiry recovery, structured
  Application errors, terminal failure, fresh Worker loads, and no legacy
  selection or candidate-runtime-artifact access.

Checkpoint 4a must prove fresh and upgrade migration, injected rollback, exact
legacy-row preservation, exact Application insert/replay, unknown and mixed
generation rejection, canonical JSON/bytes/SHA correlation, caller-byte
detachment before asynchronous work, stale active selection rejection, and the
same external-effect sequencing and fencing on both branches. Checkpoint 4b
must prove pinned source/manifest/target correlation, runtime-host and
compatibility-date agreement, bounded argument and result projection,
callback/outbound close-and-drain order, uncertain-dispatch preservation, and
fresh Worker loading. Genuine PostgreSQL and the combined cross-consumer
vertical remain `AA-R7` gates.

Self-review accepts this amendment because it introduces one new authority
contract but no new lifecycle. The discriminated row makes version skew
visible, keeps the shipped branch exact, and lets the already accepted effect
owner remain single and deterministic. Stop and amend before implementation if
4a requires a derived legacy digest, a second action/effect journal, a mutable
head read after admission, an Application Worker load, a Standard dependency,
or any query, mutation OCC/commit, Task System, route, schedule, or production
change.

### `AA-R7` — private proof

Run the complete private application vertical against PGlite and genuine
PostgreSQL from finalized Source Artifact V2 bytes through cold analysis,
inactive registration, whole-bundle publication, readiness, activation, point
mutation, point query, internal calls, edge action, and task binding when the
current test vertical includes it.

Required negative proof includes invalid metadata, missing runtime entry,
forbidden import-time effects, nondeterminism, timeout, interruption, cold
restart from bytes, manifest/receipt corruption, stale scope/candidate evidence,
wrong runtime group, and runtime capability rejection. No suite may pass by
falling back to old evidence or weakening an assertion.

### `AA-R8` — displaced-system removal and migration stop

After all new consumers and proofs are green:

- remove production imports and package exports for the static verifier,
  grammar/parser/linker, ABI/call-graph analysis, progress/restart/evidence,
  analyzer verifier host, and obsolete executor HTTP transports;
- stop Semantic Artifact V1 production and remove its active readers only after
  runtime-target and task-binding consumers have migrated;
- retain historical decoders only when a proven supported row or external
  consumer requires them;
- add guarded retirement migrations after verifying the actual migration head;
  each refuses nonempty or referenced old state; and
- run zero-skip genuine PostgreSQL migration and end-to-end evidence.

Completion of `AA-R8` completes this focused goal. Stop there. Do not enable a
route, Worker binding, production caller, Dynamic V1 retirement, auth support,
or `AA-R9` cutover.

## Medium Implementation Slices

1. **Contracts and pure core:** `AA-R2` plus `AA-R3`.
2. **Trusted exact-byte host:** `AA-R4`.
3. **Durable analysis and inactive revision:** `AA-R5`.
4. **Executable producer and whole-bundle publication:** first slice of
   `AA-R6`.
5. **Whole-bundle runtime materialization and new task-binding generation:**
   second slice of `AA-R6`.
6. **Schema authority bridge and Application readiness:** first checkpoint of
   the final slice of `AA-R6`.
7. **Application activation and issuer-backed active selection:** second
   checkpoint of the final slice of `AA-R6`.
8. **Query-first active composition and private query cut:** third checkpoint
   of the final slice of `AA-R6`.
9. **Mutation authority bridge, action lifecycle generation, and Task System
   generation:** three separately preflighted medium checkpoints that complete
   the final slice of `AA-R6`.
10. **Private system proof:** `AA-R7`.
11. **Removal and guarded retirement migration:** `AA-R8`, then stop.

Each slice is reviewed against this plan before implementation and again
against its final diff. Significant code checkpoints require both repository
reviewers before commit. Documentation-only preflight and roadmap commits do
not.

## Current Execution Constraints

Application schema authority, readiness, activation history, the active head,
and issuer-backed selection are now the accepted private authority chain.
Capability composition and consumer migration remain explicitly unwired. Any
unrelated durable-task, system-test, foundation-roadmap, or script work in the
worktree must still be protected rather than absorbed. Before the consumer cut
or any later simulation slice, the main thread must re-read the current
schema/migration head and preserve the production-inert boundary.

## Preflight Review Decision

**Accepted with amendments.** The replacement is materially simpler than the
static verifier only if executable bundle registration becomes authoritative,
whole-bundle publication replaces static call-graph minimization, and every old
persisted identity receives an honest migration rather than a rename. The plan
is authorized through `AA-R8` under those conditions.

The preflight specifically rejects a new analysis package or product-version
name; hidden Canonical Declarative Program or Semantic Artifact acceptance;
reused old revision/readiness/activation/task/runtime-target meanings; static
JavaScript parsing, ABI inference, or resumable parser progress; fallback,
shadow acceptance, comparison authority, or dual writes; and production
cutover as part of this goal.
