# Deployment Analysis And Push

## Status And Scope

**Status:** Dynamic V1 has an implemented local/backend compatibility baseline.
Declarative V2 is the accepted production metadata direction. Its private S0
physical foundation, S1 durable verifier progress, Semantic Artifact V1
provenance, and generated bounded-verifier foundation are implemented and
inert. Authenticated source/semantic readers and the request-scoped private
analyzer dispatch host are also implemented and inert. Durable verifier-progress
integration, static/candidate/runtime projection publication, readiness,
activation, production ingress/binding, and final cutover remain incomplete.

This roadmap owns:

- the dynamic V1 source-package compatibility contract and Declarative V2
  prebuilt-ESM plus canonical-NDJSON input contract;
- local-feedback versus backend-authoritative analysis;
- the push candidate lifecycle;
- the relationship between analysis, final codegen, artifact persistence, and
  activation;
- the immutable deployment-to-runtime projection and function-to-execution-
  group manifest handed to the artifact runtime;
- active deployment metadata used by invocation; and
- the trust, validation, and failure rules across those boundaries.

It does not own:

- individual package placement, covered by
  [`16-package-boundaries.md`](./16-package-boundaries.md);
- Dynamic Worker implementation details, covered by
  [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md);
- public SDK/CLI completeness, covered by
  [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md);
- local server lifecycle, covered by
  [`14-local-dev-server.md`](./14-local-dev-server.md); or
- Postgres schema catalogs, index readiness, OCC, and replacement data
  authority, covered by the
  [FlarexDB foundation](./flarexdb-foundation/README.md) and
  [`20-postgres-executor.md`](./20-postgres-executor.md).

## Current Sources Of Truth

Use these authorities in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and its accepted design precedence;
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   for hosted topology, Postgres authority, and replacement boundaries;
3. the [FlarexDB foundation plans](./flarexdb-foundation/README.md) for schema
   publication, index readiness, and activation prerequisites;
4. this roadmap for deployment-analysis and push semantics;
5. current protocol, source, manifests, and tests for exact implemented
   behavior; and
6. completed initiative records and old checkpoint text only as provenance.

Current implementation anchors are:

- [`packages/flarex-protocol/src/deployment.ts`](../packages/flarex-protocol/src/deployment.ts)
  for transport schemas and push states;
- [`packages/analysis/src/index.ts`](../packages/analysis/src/index.ts) for
  portable analyzer semantics and analyzer-response validation;
- [`packages/flarex-dev/src/sourcePackage.ts`](../packages/flarex-dev/src/sourcePackage.ts),
  [`generate.ts`](../packages/flarex-dev/src/generate.ts), and
  [`backendPush.ts`](../packages/flarex-dev/src/backendPush.ts) for bundling,
  codegen, and push clients;
- [`packages/flarex-dev/src/executionArtifact.ts`](../packages/flarex-dev/src/executionArtifact.ts)
  for the local Miniflare analyzer adapter;
- [`packages/flarex-backend/src/backendAnalyzerResponse.ts`](../packages/flarex-backend/src/backendAnalyzerResponse.ts)
  for backend service-binding analysis and response decoding;
- [`packages/flarex-backend/src/deployment`](../packages/flarex-backend/src/deployment)
  for validation, candidate state, activation, and public/internal route
  boundaries;
- [`packages/flarex-backend/src/artifactStore.ts`](../packages/flarex-backend/src/artifactStore.ts)
  and [`artifactRuntime.ts`](../packages/flarex-backend/src/artifactRuntime.ts)
  for durable source-package and runtime seams; and
- [`packages/flarex-backend/test/push.test.ts`](../packages/flarex-backend/test/push.test.ts),
  [`packages/analysis/test/analyzer.test.ts`](../packages/analysis/test/analyzer.test.ts),
  and [`packages/flarex-dev/test/artifactLifecycleParity.test.ts`](../packages/flarex-dev/test/artifactLifecycleParity.test.ts)
  for decisive current behavior.

## Developer Contract And Terminology

Developers write ordinary TypeScript modules under `flarex/`. They do not
author or deploy Cloudflare Worker entrypoints.

Use these terms consistently:

- **developer modules**: source files written under `flarex/`;
- **source package**: the canonical bundle of developer modules, schema input,
  source maps, hashes, and module metadata submitted to Flarex;
- **deployment analysis**: backend execution metadata—schema plus flattened
  function path, kind, visibility, validators, positions, and routing policy;
- **codegen analysis**: grouped module/schema metadata returned to tooling for
  `_generated` output;
- **candidate push**: validated but inactive source package, analysis, codegen
  analysis, diagnostics, and derived artifact identity;
- **execution artifact**: an internal Flarex runtime shell/materialization for a
  source package; and
- **active deployment**: the single activated push whose metadata and artifact
  invocation may use.

The developer supplies no `fetch` handler, Wrangler configuration, Dynamic
Worker bindings, database connection, Durable Object stub, analyzer endpoint,
or executor capability. Flarex tooling and platform adapters own those details.

## Current Architecture

### Authority Chain

```text
developer modules under flarex/
  -> initial codegen bootstrap
  -> canonical source package
  -> authenticated source-only push start
  -> backend-controlled analyzer service binding
  -> validated deployment + codegen analysis
  -> inactive candidate push
  -> final codegen from returned analysis
  -> optional generated-output typecheck / caller validation
  -> durable artifact availability check
  -> finish push
  -> atomic current-store activation
  -> active metadata + execution artifact used by invocation
```

The public developer-shaped start request contains the source package, not
caller-authored analysis. The public backend forwards that package to its
configured `FLAREX_ANALYZER` service, validates both returned analysis shapes
and their agreement, persists the source package when artifact storage is
configured, and creates an inactive analyzed candidate.

If the analyzer is absent, malformed, fails, omits codegen metadata, or returns
analysis inconsistent with the source package, the push does not become active.
The existing active deployment remains unchanged.

### Portable Analyzer Semantics

`@flarex/analysis` owns portable semantic inspection after a host has loaded the
source package:

- schema export validation and stable analyzed schema shapes;
- registered function recognition;
- query, mutation, workflow mutation, and action kinds;
- public/internal visibility;
- argument and return validator JSON validation;
- partition-policy validation and lowering;
- best-effort source-position extraction;
- conversion to backend deployment and grouped codegen metadata;
- analyzer success-envelope decoding; and
- protocol validation of returned analysis.

It does not own filesystem discovery, Vite bundling, Miniflare, Cloudflare
service bindings, R2, push persistence, or activation.

### Local Analysis

`flarex-dev` bundles the source package and can analyze it in a fresh Miniflare
execution artifact. The local analyzer runs cold-isolate comparison to reject
nondeterministic metadata and retains bounded import-time diagnostics. It uses
the same portable analysis package and protocol shapes as the backend boundary.

Local analysis has two valid roles:

1. offline/standalone codegen feedback when no backend is configured; and
2. the local backend's analyzer service binding during `flarex dev`.

It is not hosted authority. When tooling uses a configured backend push
coordinator, final codegen consumes the analysis returned by that backend.

### Push State And Activation

The implemented protocol state set is intentionally small:

```text
analyzed -> activated
         -> rejected
         -> abandoned
```

An analyzed candidate contains the source package, deployment analysis,
codegen analysis, optional diagnostics, and timestamps. A failed analyzer can
also produce a rejected candidate record with its error and diagnostics.

`finish` is allowed only for an analyzed candidate. In the current
`DeploymentDO` SQLite store, finishing runs one storage transaction that:

- applies active schema and function rows;
- records active push and execution-artifact metadata;
- changes the candidate to `activated`; and
- returns the activated status.

When R2 artifact storage is configured, the public finish boundary first
derives the deterministic artifact reference and rejects activation if the
source package cannot be loaded by that exact reference.

`abandon` is cleanup for an analyzed candidate when final codegen, generated
typechecking, application build, or another pre-finish caller gate fails. It
must not replace the original developer-facing failure if cleanup itself fails.

### Codegen Ordering

The deploy path follows the Convex-shaped two-stage order:

```text
initial codegen
  -> bundle source package
  -> start push
  -> require analyzed candidate + codegenAnalysis
  -> final codegen
  -> caller validation/typecheck hook
  -> finish or abandon
```

Standalone codegen may use:

- a backend push coordinator, which creates an inactive candidate and returns
  authoritative backend analysis;
- a configured analyzer URL, which returns backend-shaped analysis without a
  deployment candidate; or
- the local execution-artifact analyzer when offline.

These modes share final generation logic, but they do not share authority.
Only a backend push and successful finish changes deployment state.

### Invocation Boundary

Invocation resolves from active deployment metadata and its deterministic
execution-artifact reference. The generated Dynamic Worker shell checks that
requested functions exist in analyzed metadata, enforces kind and validators,
and reaches trusted database operations only through restricted executor
transports.

Source-package identity, analyzed metadata, and artifact identity must remain
joined. No direct schema/function metadata route may bypass the push lifecycle.
The canonical deployment inputs are not themselves the steady-state invocation
payload. Activation binds a minimal immutable runtime projection and a
function-to-execution-group manifest to the same candidate identity. A warm
invoke carries only the selected active reference, function path, arguments,
execution identity, and operation-specific fields. It must not transfer or
reread Source Artifact V2, Semantic Artifact V1, canonical NDJSON, analysis
inputs, source maps, provenance, or rollback evidence.

## Ownership Boundaries

| Owner | Responsibility | Must not own or trust |
| --- | --- | --- |
| `flarex` | Function registration, validators, schema definitions, generated-facing types, deterministic artifact-ref helpers | Hosted analysis authority, push state, storage, or platform bindings |
| `flarex-protocol` | JSON-safe source-package, analysis, push, diagnostics, and route contracts | Runtime evaluation or persistence decisions |
| `@flarex/analysis` | Host-neutral semantic analysis and conversion/response validation | Vite, filesystem, Miniflare, service bindings, R2, or activation |
| `flarex-dev` | Initial/final codegen, source bundling, local analyzer host, push clients, local orchestration | Hosted authority or direct active-metadata writes |
| `flarex-backend` public Worker | Authenticated source-only ingress, analyzer dispatch, response validation, artifact persistence/check, and forwarding to deployment state | Caller-authored analysis as the normal developer contract |
| `DeploymentDO` compatibility control plane | Current candidate records, state transitions, and active pointer/schema/function rows | Replacement Postgres app-data authority or future schema-readiness truth |
| Artifact runtime | Load the exact source package, materialize managed Dynamic Workers, and invoke active artifacts | Deployment activation policy or raw database authority |
| FlarexDB control/executor packages | Immutable schema artifacts, readiness, active scope version, deployment package registration, and trusted execution metadata | User-supplied physical IDs or unvalidated analyzer output |

## Invariants And Trust Boundaries

1. **Source-only is the normal push contract.** Hosted deployment metadata is
   never authoritative merely because a client submitted it.
2. **Backend-controlled analysis owns hosted truth.** Shared analyzer code does
   not make a local result authoritative; the execution host and authenticated
   control path determine authority.
3. **Analysis is runtime-module analysis.** Source-text scanning alone cannot
   establish exported function identity, validator behavior, or schema output.
4. **Import-time execution is restricted and deterministic.** Analysis must
   expose no database syscall authority and must reject uncontrolled I/O,
   nondeterministic metadata, and unsupported globals rather than silently
   accepting drift.
5. **Deployment and codegen analysis agree.** Schema, function paths, kinds,
   visibility, validators, positions, and routing metadata are cross-checked
   before candidate storage.
6. **Source and analysis agree.** Every analyzed function module must correspond
   to the submitted source package; forged or missing module identity fails.
7. **Candidate creation is non-activating.** Start may store artifacts and
   metadata but cannot change active invocation routing.
8. **Final codegen uses returned analysis.** Backend deploy mode cannot silently
   regenerate from local scanning after start.
9. **Finish is fail-closed.** Missing artifacts, invalid state, malformed stored
   rows, or unmet readiness blocks activation and preserves the previous active
   deployment.
10. **Activation is atomic within the owning store.** Active schema, functions,
    push ID, artifact reference, auth metadata, and candidate state cannot be
    partially published.
11. **Only active metadata drives invocation.** Candidate or abandoned analysis
    is never executable through normal routes.
12. **Diagnostics are bounded and non-authoritative.** Logs help developers but
    cannot alter analysis or activation decisions.
13. **Mutation routes require explicit credentials.** Start, analyzed-start
    compatibility, finish, and abandon fail closed when the deploy-push token
    is absent or mismatched.
14. **Artifacts are content-bound.** Artifact references are deterministically
    derived and verified against the exact source package.
15. **Legacy storage is not future authority.** Current DeploymentDO activation
    proves the compatibility lifecycle, not FlarexDB schema/index readiness.
16. **Deployment evidence stays off the warm invoke path.** Source Artifact V2
    and Semantic Artifact V1 are authenticated verification inputs. C4 derives
    an immutable minimal runtime projection and function-to-group manifest;
    S03-D4 proves every referenced group can cold-materialize; S04 activates
    those exact digests. A warm invoke consumes only the coherent active
    manifest and selected group reference. No cache, prewarm, or Worker Loader
    reuse is correctness authority.

## Decisions And Rationale

### Keep Analysis Behind An Execution-Isolate Boundary

Developer module top-level code runs while registration metadata and schema are
created. Evaluating it in a controlled runtime is more faithful and safer than
trusting source text or caller-authored JSON. Shared semantic code keeps local
and hosted adapters aligned without collapsing their trust levels.

### Separate Deployment Analysis From Codegen Analysis

The backend needs flattened executable metadata; codegen needs grouped
module-oriented metadata. Keeping both explicit prevents tooling-specific shape
from becoming runtime authority and allows their semantic agreement to be
validated before activation.

### Split Start From Finish

Final generation and typechecking depend on backend-returned metadata. A single
upload-and-activate call would either activate before validation or require the
backend to own the developer's build environment. The candidate lifecycle
keeps the previous deployment active until caller and backend gates pass.

### Make Source Packages The Durable Input

Local Miniflare and hosted Dynamic Workers both materialize from the same
source-package identity. Generated Worker source is an internal artifact, not a
developer deployment product or a second source of truth.

### Retain Analyzed-Start Only As Compatibility

`/push/start-analyzed` remains credential-protected for local/test and
compatibility composition. It is not the public developer model and must not be
used to claim hosted backend authority. Once every legitimate caller uses a
backend-controlled analyzer path, remove or move it behind a strictly internal
service contract.

## Convex Compatibility And Flarex Divergences

Flarex follows Convex's essential model:

- function registration exports runtime metadata and serialized validators;
- tooling performs initial codegen and bundles deployable modules/source maps;
- the backend evaluates modules and schema in a restricted isolate;
- start returns authoritative analysis used for final codegen;
- validation and readiness occur before finish; and
- finish atomically publishes the new active deployment.

Primary Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts` for runtime
  registration metadata and strict validator export;
- `npm-packages/convex/src/bundler/index.ts` and CLI component bundling for
  source discovery, bundling, maps, environments, and hashes;
- `crates/isolate/src/environment/analyze.rs` and `schema.rs` for restricted
  module/schema evaluation;
- `crates/application/src/deploy_config.rs` for start, schema wait, and finish;
- `crates/model/src/modules` for durable analyzed module metadata; and
- `npm-packages/convex/src/cli/lib/components.ts` and `codegen.ts` for the
  initial-codegen -> push -> final-codegen order.

Named Flarex divergences:

- Cloudflare uses service bindings, R2, and managed Dynamic Workers instead of
  Convex's integrated Rust/V8 backend;
- Flarex has `workflowMutation` in addition to query, mutation, and action;
- the local analyzer uses Miniflare and cold-run comparison;
- Cloudflare may require a stricter supported import-time subset when Convex's
  exact isolate controls cannot be reproduced;
- current candidate state lives in DeploymentDO SQLite while FlarexDB schema
  artifacts/readiness are being built in Postgres; and
- source-only push, analyzer service, artifact runtime, and trusted executor are
  separate deployable capabilities rather than one process.

These differences must remain behind typed adapters. They do not justify
caller-authored authoritative metadata, direct deployment-row writes, or
activation without readiness.

## Implemented Capabilities

- Convex-shaped registration metadata and validator exporters feed runtime
  analysis.
- `@flarex/analysis` validates schema, functions, validators, positions, and
  partition policies and converts to both backend and codegen protocol shapes.
- Local source packages are analyzed in Miniflare with diagnostics and
  cold-isolate nondeterminism checks.
- The authenticated source-only push route calls `FLAREX_ANALYZER` and fails
  closed when the service is unavailable.
- Analyzer responses require both deployment and codegen analysis, pass
  protocol decoders, and are checked for mutual/source-package consistency.
- Candidate start leaves the current active deployment unchanged.
- Final codegen consumes candidate-returned codegen analysis.
- Deploy can abandon a candidate when its pre-finish hook fails.
- Source packages use deterministic artifact references and R2-backed storage
  when configured; finish verifies exact artifact availability.
- Current DeploymentDO activation publishes candidate state, schema, functions,
  active metadata, auth metadata, and artifact reference transactionally.
- Active invocation resolves the activated artifact and validates requests
  against analyzed metadata.
- Focused tests cover forged modules, mismatched codegen metadata and positions,
  duplicate modules, missing analyzer fields, missing artifacts, failed
  candidates, active-pointer movement, and local/hosted lifecycle parity.

## Known Gaps And Limitations

- `apps/backend/wrangler.jsonc` still binds `FLAREX_ANALYZER` to
  `flarex-analyzer`; the new `flarex-source-analyzer-v2` app is only an inert
  private identity/compatibility host and is not wired to that production
  binding. Tests and local dev still inject whole-package service
  implementations, so hosted source-only analysis remains operationally
  unproven.
- The current hosted artifact-runtime Worker materializes and invokes Dynamic
  Workers but does not expose the analyzer service expected by the public
  backend. Hosted analysis ownership and deployment wiring remain incomplete.
- `/push/start-analyzed` still crosses the public Worker route namespace and is
  protected by the same legacy-named `FLAREX_ANALYZED_START_TOKEN` used for all
  push mutations. This is authenticated compatibility, not an ideal internal
  capability design.
- Current candidate/active state and schema/function rows live in DeploymentDO
  SQLite. They are not integrated with FlarexDB immutable schema artifacts,
  index build/readiness state, scope active-version publication, or rollback
  generations.
- Finish currently proves artifact availability and current-store atomicity,
  but not real-Postgres schema/index readiness across the accepted replacement
  topology.
- Source-position recovery is best effort and includes source-content scanning;
  exact source-map resolution parity with Convex is not established.
- Analysis restrictions and cold-run determinism are substantially tested
  locally, but the eventual hosted analyzer needs equivalent bundle, isolation,
  egress, timeout, diagnostic, and separate-cold-isolate proofs.
- Standalone analyzer URL and offline local codegen are useful feedback paths;
  they cannot prove that a hosted deployment would accept or activate the same
  package.
- Concurrent candidate supersession is simpler than Convex's full schema race,
  wait-for-schema, and index-backfill protocol.
- The current V1 artifact-runtime handoff is not the Declarative V2 target:
  compatibility mode may forward a complete source package, configured
  ref-only mode resolves R2 source before the materialization-cache lookup, and
  Worker definitions copy the complete package rather than a verified minimal
  runtime projection. Source/semantic authenticated reading and static
  verification are not yet composed with a runtime-projection publication,
  readiness, activation, or reference-only production invoke path.
- A1b1's production contract is authenticated bounded tree-walking, not
  whole-artifact reconstruction disguised behind cursors. Any provisional
  reader that first reconstructs finalized source modules and the semantic
  stream in process memory is validation scaffolding only and cannot become the
  production composition until it is replaced by streaming R2 cursors or an
  explicit immutable ceiling has a measured worst-case concurrent-allocation
  proof for the analyzer host envelope.

## Target Direction

Declarative V2 is a deliberate programming-model boundary, not a bounded
implementation of the dynamic V1 analyzer:

```text
version-pinned prebuild, normally flarex-dev on a developer machine or CI
  -> immutable prebuilt ESM modules
  -> canonical bounded NDJSON semantic declarations
  -> untrusted upload boundary
  -> server-derived source and semantic roots
  -> bounded static core verification and durable link progress
  -> immutable candidate plus both analysis projections
  -> minimal runtime projections plus function-to-group manifest
  -> target-native readiness evidence
  -> scope-clock-fenced activation revision/head CAS
  -> one coherent active reader
  -> reference-only artifact-runtime invocation
```

The V2 declaration is authoritative metadata. Undeclared runtime exports are
ignored. Dynamic, computed, mutable, exporter-derived, or
evaluation-discovered metadata remains V1-only, compatibility-only, and
PAM-ineligible. There is no auto-detection, fallback, shadow path, dual write,
or dual authority between V1 and V2.

V2 input is prebuilt immutable ESM plus canonical bounded NDJSON. “Trusted
prebuild” means a version-pinned transformation contract, not authority derived
from where the transformation runs. The normal producer is `flarex-dev` on a
developer machine or CI. An optional hosted build service may provide
convenience, but it remains isolated and non-authoritative. Its ESM, NDJSON,
chunks, source maps, totals, and digests cross the same untrusted upload
boundary as local output.

TypeScript or Vite/Rolldown/esbuild compilation, package installation,
arbitrary build plugins, network dependency resolution, arbitrary module
evaluation, whole-AST/whole-JSON materialization, and runtime metadata discovery
are outside the bounded authoritative verifier. Developer tooling may hide
generation ergonomics but cannot move compilation into that operation. The
declarative IR is the V2 product authority after validation; it is not evidence
about arbitrary runtime exports. The backend independently validates canonical
declaration bytes and executable core, then derives ordinals, counts, digests,
roots, manifest-last completeness, and EOF from bytes it accepted; caller
totals, hashes, and completeness claims never become authority.

`FlarexDeclarativeExecutableCoreV1` is generated capability-safe output rather
than the primary hand-written interface. Every transitive immutable module is
independently server-verified. Its shell permits only static artifact-local
imports, an exact verifier-pinned platform-import allowlist, and direct
named/default function declarations including async forms. Calls resolve
statically to verified local functions, admitted direct imports, or exact
pinned platform operations. Side-effect-only or dynamic imports, aliases,
re-exports, export-star, cycles, top-level await or executable initialization,
function-valued variables, classes, construction, computed property access,
reflective or method dispatch, callbacks, closures that recover executable
capabilities, higher-order executable values, `eval`/function synthesis, and
equivalent code loading are rejected unless trusted tooling lowers them to the
versioned safe ABI. Fixed-platform evaluation and a runtime membrane are not
readiness authorities. Runtime markers and exporters carry no V2 authority.

The canonical source and semantic artifacts are deployment evidence, not
runtime bundles. After static verification, the backend deterministically
constructs the smallest correct runtime projection for each capability and
execution group: the generated runtime shell, selected executable entry
modules, and only their proven transitive runtime chunks. The accompanying
immutable manifest maps every function path to its kind, visibility, validator
pins, capability profile, execution group, and exact projection digest. It
must not copy analysis-only modules, canonical NDJSON, schema/auth analysis
inputs, source maps, provenance, or rollback material into the runtime host
unless a specific item is also a proven runtime dependency. This contract is
host-neutral; choosing Dynamic Worker or another materialization host remains a
separate implementation and topology decision.

Flarex never accepts caller-generated V8 or Cloudflare bytecode as a deployment
or protocol artifact. Declarative V2 runtime projections contain portable,
verified JavaScript modules plus Flarex-owned metadata. Cloudflare Worker Loader
alone owns engine-specific parsing, compilation, and isolate materialization;
bytecode and isolate state are neither portable Flarex identity nor caller
authority.

Runtime grouping is an internal physical optimization, never a function,
transaction, data-partition, tenant, or authority boundary. Start with one
transaction group when it fits measured size/startup headroom; split by
capability profile, dependency affinity, and observed nested-call affinity only
when the platform envelope requires it. Stable deterministic group IDs and
digests permit cache reuse without making cache state authoritative.

Authenticated verifier input is likewise a bounded stream, not a requirement
to reconstruct the complete source and semantic artifacts before verification.
The production reader walks the authenticated content-addressed trees through
opaque request-local cursors, charges work before caller-proportional
allocation, and retains only the verifier's declared fixed-width arenas plus
bounded input windows. A deliberately retained whole-artifact fast path would
require an explicit immutable admission ceiling and measured concurrent-memory
proof; it cannot arise accidentally from a convenience reader.

Canonical immutable frames bind source, semantic, package, artifact, schema,
validator, core-language, ABI, grammar, Unicode, parser-table, analyzer,
verifier, handler-set, projection, readiness-policy, and deployment-incarnation
evidence. The current deployment incarnation fence is the freshly reread
`(projectId, deploymentId, createdAt)` tuple for the currently supported
non-reuse lifecycle; delete/reuse or broader lifecycle support requires a
separate immutable incarnation identity.

Every producer, verifier-progress command, persistence read/write, and result
projection has mandatory caller-supplied inclusive pre-allocation budgets with
no defaults or disguised product maxima. Budget receipts are deterministic,
cumulative, non-resetting, and checked with overflow-safe arithmetic. Two cold
runs over the same immutable inputs must yield equal canonical roots,
diagnostics, registrations, projections, and verdict evidence. Typed expected
failures remain in their Result or Effect error channel; defects and
interruption retain full Cause. Confirmed rollback may authorize only the exact
operation-specific retry; decision uncertainty mints no root, cursor, receipt,
readiness, activation, or retry permission until authoritative durable state is
freshly observed.

## Next Correctness Gates

The approved work is one staged atomic vertical for the currently composed
shared `primary/public` target only. Mechanically reviewable intermediate
commits are private, inert, and non-authoritative until the final activation
and no-fallback cutover stage. Schema-per-scope and database-per-scope
activation remain blocked until their production host composition is proven.

1. **S0 inert physical foundation.** Add private portable physical
   frame/identity codecs, additive target-local tables, strict stored-row
   verification, and minimal bounded read/insert primitives. Migration 0035
   creates no activation-head row and no production composition. Canonical
   frames own semantics; normalized columns exist only for local foreign keys,
   bounded pagination, fencing, lock/CAS predicates, and metadata-first
   admission.
2. **Durable verifier progress.** The private S1 repository now owns exact-key
   attempt creation/observation, database-time lease acquire/renew/release,
   live-owner abandon, conservative command reservation, pending-work resume,
   bounded non-finalizing settlement, restart/takeover, and exact replay.
   Reservation charges semantic usage once and persists byte-identical command
   evidence before work. Takeover changes only owner/fence and rebinds an
   existing reservation without refund or recharge. Settlement captures and
   hashes the complete output before its short transaction, then locks the
   attempt, page predecessor, immutable evidence in fixed table/key order,
   link nodes by module ordinal, and frontier entries by sequence before
   updating receipt/progress and clearing pending state last. Source/artifact
   reads, parsing, linking computation, and other CPU verification remain
   absent and outside database transactions.

   Database time alone decides lease liveness. A stale worker may finish CPU
   work but cannot settle after expiry or takeover. A lost or uncertain reserve
   or settle response grants no work token, receipt, cursor, release, or retry
   permission; durable exact-key observation is the restart truth. Only the
   direct operation-specific confirmed-rollback class permits one byte-identical
   retry, without resetting time, operation, or semantic budgets. Process-local
   run/work tokens are inert capability checks, while stored cursors, digests,
   frames, owners, fences, and receipts never grant authority on their own.
   The no-DDL C1 strengthening makes each settlement non-circular: ordered
   non-manifest evidence is captured first, the repository derives one
   page-evidence root, creates exactly one phase-page manifest, and then commits
   the complete command-output manifest including that generated page. It also
   derives the next progress cursor and phase transition from locked durable
   state, and exposes a bounded metadata-first read of the four phase tails plus
   registration/diagnostic ordinals. Source and semantic object-reference
   entries remain inert structural commitments only: their page root proves the
   integrity of the captured sequence, not object existence, authentication,
   finalization, read authority, or arbitrary-root authority. The C1 protocol
   identity is a fail-closed cutline; earlier attempts remain retained but are
   not reinterpreted, continued, backfilled, or deleted. S1 stops at
   `registering`/`verdict`: it cannot finalize an attempt or insert verdict,
   candidate-projection, readiness, activation-revision, or activation-head
   evidence.

   The companion Semantic Artifact V1 byte-provenance foundation is also
   private and inert. A backend-local, request-bound single-use proof composes
   the existing project/deployment authorization with a fresh finalized Source
   Artifact V2 reread; only that proof can begin or reopen a semantic upload.
   Its canonical attempt identity binds the freshly reread
   `(projectId, deploymentId, deploymentCreatedAt)` incarnation fence, exact
   source upload generation/fence/root/selector, semantic generation/fence,
   semantic model/codec/policy/ingress identities, and immutable ceilings.
   Canonical NDJSON bytes are stored as content-addressed blocks and tree nodes
   in the distinct `semantic-artifact-v1/` ARTIFACTS namespace. The completed
   semantic root is written last, then DeploymentDO SQLite alone records the
   paired root/selector and finalized lifecycle. Object presence, normalized
   columns, a selector, a Durable Object name, or C1 reference evidence never
   grants read or semantic authority.

   Semantic blocks may split UTF-8 or records arbitrarily; the trusted owner
   derives offsets, ordinals, line-feed counts, the tree, root, and
   manifest-last EOF from the exact accepted bytes. Root and selector framing
   are non-circular: the semantic root binds source content and the pinned
   semantic/tool identities but no candidate; the selector binds the current
   canonical semantic-attempt identity plus the completed root; the later
   candidate repeats the incarnation fence and binds both source and semantic
   roots/selectors. Reopen requires fresh authorization and finalized-source
   proof, recomputes canonical identity evidence, and fails closed on
   incarnation or source rollover. This stage proves immutable semantic byte
   provenance only. C3 still owns bounded NDJSON decoding and independent
   semantic/core verification, while C4 alone may publish static projections.
   Finalized semantic evidence now also returns an owned copy of the verified
   canonical semantic-attempt identity digest. That value is replay/drift
   comparison evidence for the later static verifier; it remains structural
   and cannot replace the backend-owned proof path on restart.

   Per-command admission bounds capture and the hashes that bind an append
   reservation. Before any immutable-object write, DeploymentDO durably stores
   the full conservative R2/SQLite reconciliation reservation and cumulative
   charge under the command digest. Retry reconstructs that digest, resumes the
   pending reservation, and never resets or recharges the attempt ceilings.
   Successful R2 receipts are checked against the reservation. CPU framing and
   capture remain interruptible, while only the short SQLite/R2 settlement and
   reconciliation decision windows are masked.
3. **Static verification, finalization, candidate projection, and runtime
   projection.** Consume
   authenticated immutable source/semantic evidence supplied by the later
   private reader/composition stages through bounded authenticated cursors,
   without requiring whole-artifact reconstruction, independently verify the
   generated core and safe ABI, derive the handler-set digest and both
   `DeploymentAnalysis` projections, deterministically construct the minimal
   runtime projections and function-to-group manifest, and publish only
   immutable static-finalization evidence, the two candidate analysis
   projections, and the separately versioned runtime artifacts and manifest.
   Stage 3 leaves the attempt at `registering`/`verdict`; it writes neither a
   ready nor rejected verdict and does not make the candidate active. Runtime
   projection publication does not load a runtime host or grant invocation
   authority.

   Runtime projections and the function-to-group manifest are not a third
   `DeploymentAnalysis` projection and must not be squeezed into either of the
   two existing candidate-projection rows. Their versioned frame, object
   storage, root/manifest binding, and candidate commitments require a private
   no-authority preflight before Stage 3 implementation. That prerequisite may
   add immutable object/storage shapes, but it cannot change the already-frozen
   two analysis projection kinds or bypass later readiness and activation.

   The first provisional C3/C4 foundation is implemented but intentionally
   unusable on its own. Private protocol subpaths now pin Budget/Progress V2,
   the 26 ordered pre-allocation dimensions, the V2 attempt/progress identity
   cutline, canonical C3 completion, static-finalization evidence, and the
   canonical pair of deployment-analysis projections. The persistence-private
   command-output V2 preimage admits the later fenced `finalize` command while
   V1 remains retained and is never reinterpreted. Executable independent
   vectors own the committed bytes and digests; research receipts are not
   protocol constants.

   These codecs publish no evidence and create no consumer authority. The
   atomic C3-to-C4 range must still supply authenticated source and semantic
   reads, durable V2 progress integration, and the one
   projection/static-finalization transaction. Restart reconstruction must
   reacquire fresh C2 evidence through the backend-owned proof path and compare
   it with durable candidate/C3 commitments; callers cannot reconstruct that
   authority from identity fields.

   The provisional Core asset foundation now owns the complete versioned
   `FlarexDeclarativeExecutableCoreV1` lexical, grammar, local-value,
   operator, capability, query/range ABI, diagnostic, and failure/catchability
   specification on one private `@flarex/analysis` internal subpath. Unicode
   14 `ID_Start`/`ID_Continue` inputs and their license/provenance are vendored
   by exact digest. An offline deterministic generator rejects unstable or
   conflicting numeric IDs and emits one aligned fixed-width asset plus a
   non-self-referential canonical identity manifest; a strict owned Result
   loader and checked-BigInt arena planner admit the asset and all 26
   Budget/Progress V2 dimensions before caller-proportional allocation. Host
   Effect failure, defect, interruption, timeout, uncertainty, and full Cause
   remain uncatchable. Trusted lowering must reject application catch/finally
   whose correctness depends on observing, completing around, or suppressing
   such a host-owned outcome.

   The private verifier foundation now includes a reproducible executable
   contract, deterministic generator, and generated LR action/goto/production
   tables. Those tables are the sole syntax authority. Fatal incremental UTF-8
   processing, preallocated fixed-width arenas and opaque cursors bound all
   retained token, text, parser, semantic, link, value-flow, ordering, and
   output state. Semantic and link analysis are resumable fixed-quantum
   operations rather than synchronous native graph or presentation passes.
   The verification-evidence owner streams canonical bytes through its opaque
   sink, hashes the owned arena range incrementally, and uses metered linear
   indexing rather than a caller-proportional contiguous frame or unmetered
   lookup. Artifact module paths cross the verifier boundary only through the
   canonical opaque exact-byte path contract; a valid path remains inert and
   supplies no source or semantic authority.

   This entire range remains private, production-unreachable, provisional,
   inert, and non-authoritative. The backend now reacquires fresh A0a/R0a/C2
   evidence, opens request-scoped authenticated source/semantic cursors, and
   dispatches only those captured bytes through a fresh release handshake to
   the private analyzer host. The analyzer streams bounded verifier and linker
   work and returns request-bound opaque evidence. Its signed request partitions
   every one of the 26 cumulative dimensions into disjoint per-module, linker,
   and host allocations; the backend and analyzer independently require their
   checked sums to equal the attempt-usage frame, so modules, lookups, and
   evidence encoders cannot reset or multiply a caller ceiling. No backend root route,
   Wrangler binding, production composer, or durable progress owner consumes
   it. A1b2 still owns S1 V2 reserve/resume/settle integration. C3 completion
   persistence, C4 projection/static-finalization publication, readiness,
   activation, ingress, deployment, and cleanup authority remain absent.
   Terminal inert C4 is still the first consumer that closes this private chain,
   and none of these private foundations is shipped.

   The private A1b2 composition owner is the existing `apps/executor` production
   root for the currently composed shared `primary/public` target. That root
   already owns request-scoped PostgreSQL and the authenticated
   backend-to-executor boundary. The backend remains the fresh source/semantic
   authority, the analyzer remains resource-free, and persistence remains a
   dependency leaf; none may serialize or recreate another owner's
   process-local capabilities.

   The provisional A1b2a0 portable contract now adds canonical V2 command
   reservation, output-manifest, and receipt frames for `source_page`,
   `parse_module`, `link_page`, and `registration_page` only. Reservation binds
   attempt/candidate identity, current progress and predecessor receipt, the
   exact command-budget digest, authenticated input, analyzer/verifier
   identities, and the command range/predecessor tails without owner, fence,
   lease, clock, request, deployment, or opaque-handle identity. Output and
   receipt frames bind ordered evidence, diagnostics, actual and cumulative
   usage, and next progress. These bytes are inert commitments, not a lease,
   work token, replay grant, or settlement authority. Verifier-owned evidence
   rehydration, additive target persistence and repository operations, and the
   executor host composition remain separate later A1b2 gates.

4. **S03-D4 readiness.** Under the common scope-clock lock, revalidate scope
   generation/fence/epoch plus real target index/build evidence and the exact
   candidate, artifact, schema, validator, registration, and verifier pins.
   Cold-materialize every transaction and edge-action runtime projection
   through a hosted-equivalent Worker Loader lane, independently enforce raw,
   compressed, and startup envelopes with policy headroom, and retain
   per-group receipts. A successful readiness probe proves materializability,
   not a future regional cache hit or warm isolate.
   S03-D4 alone writes either the ready or rejected verdict and the terminal
   verifier lifecycle. Rejection may reject declared handlers but never discover
   or rewrite semantic metadata.
5. **S04 activation and coherent reader.** Lock scope clock first, then CAS one
   target-local activation revision/head. The reader resolves only the exact
   readiness-approved package/artifact/source/semantic/function-validator/
   schema/runtime-projection snapshot. Its revision-fenced result is the only
   runtime selection authority and may support a correctness-preserving cache;
   stale, missing, or ambiguous revision evidence fails closed. Retain all
   incomplete, rejected, superseded, active, and rollback-referenced evidence
   initially.
6. **Ingress, dispatch, and client consumption.** Add versioned bounded V2
   upload/finalization, pinned analyzer handshake/dispatch, and flarex-dev
   consumption as the real two-sided caller. Artifact-runtime dispatch carries
   only the selected runtime-projection/group reference plus invocation data.
   Its full materialization-identity cache is checked before any R2 load, and
   concurrent cold misses are singleflighted under the same projection,
   compatibility, runtime-shell, executor-configuration, and credential-version
   identity. Preserve legacy whole-package V1 unchanged and non-authoritative.
7. **Atomic activation/cutover.** Enable only after all preceding private
   stages and PGlite plus zero-skip PostgreSQL race/crash/corruption proof are
   green. Switch without fallback, shadowing, or dual authority.

The production active-metadata path is split into `PAM-A0` inert storage
contracts, `PAM-A1` immutable publication, `PAM-A2` atomic activation, `PAM-B`
private reader integration and proof-adapter removal, and the separate `C03-V`
syscall-time validator-parity gate. `PAM-A0a` is complete: persistence now owns
a package-private pure Function Metadata V1 codec/policy that normalizes the
current analysis shape into canonical per-function and complete-set evidence,
delegates literal primitives to Value Codec V1, and requires caller-supplied
operation budgets. It creates no table, catalog limit, readiness fact,
activation authority, reader, or package export. `PAM-A0b0-F` is also complete:
persistence privately owns only the pure, versioned SHA-256 preimage framing
for function paths, canonical function rows, the row-chain seed and step,
package publication pins, and completed-package evidence. It deliberately has
no package-level execution module, hashing adapter, SQL, staging state, or
authority. `PAM-A0b0-H` is complete: one persistence-private Effect adapter
hashes a caller-budgeted owned preimage through SHA-256, retains direct native
resource failure identity privately, and treats malformed platform output as a
defect without exporting a service or authority. The authenticated cursorable
source/EOF owner, `PAM-A0b1` catalog DDL, `PAM-A1`, `PAM-A2`, `PAM-B`, and
`C03-V` remain pending and require their own accepted contracts.
`PAM-A0b0-S1P-J1b0-H0a` is complete: `apps/analyzer` is a deployable but
inert private Worker shell with no routes or resource bindings. Its sole
operation is a bounded service-binding compatibility handshake backed by a
deterministic normalized bundle identity and canonical host-configuration
identity. The tuple is compatibility evidence, not caller or analysis
authority; the app cannot read source artifacts or produce analysis. Production
binding cutover and the finalized-reference reader/dispatch and bounded
inventory/linking gates remain pending.
`PAM-A0b0-S1P-J1b0-R1P-A0a` is complete for the current single-configured-
project backend host: after the existing deployment-push bearer check, the
backend takes `FLAREX_PROJECT_ID` only from host configuration and performs one
strict private service-binding lookup of the existing Postgres deployment row.
Exact persisted project equality may mint one request- and factory-bound,
single-use process-local witness. The lookup is read-only, explicitly budgeted,
and adds no relationship creation, RegistryDO authority, public API, schema,
or production push-path cutover. It proves only coarse backend-service scope
for the configured project; finalized-upload resolution and analyzer dispatch
remain pending.
`PAM-A0b0-S1P-J1b0-R1P-R0a` is complete as an inert backend-private read:
after consuming that same-process scope witness, it performs one exact
read-only DeploymentDO lookup, revalidates the finalized upload row, and
recomputes the selector digest without publishing a transferable reference or
dispatch authority. `R0b0-H` is also complete: the intentional
`@flarex/analysis/internal/private-analyzer-release-v1` subpath now solely owns
the cause-free V1 release tuple, canonical handshake wire contract, and
generated release manifest consumed by the private analyzer host. The package
root remains unchanged. Full `R0b` remains blocked until a real dispatch gate
owns a trusted backend expected tuple and the analyzer deployment posture is
explicitly versioned for its eventual source-reader reachability; serialized
root, selector, request, or release data remains inert meanwhile.

The approved Declarative V2 atomic vertical supersedes the former assumption
that bounded dynamic analysis could close that gap. Its S0 foundation is
implemented but inert: the cause-free physical codec, target-local migration
0035, strict stored-frame verification, and minimal bounded candidate
read/insert repository publish no candidate, readiness, activation, route, or
runtime authority. Later stages must consume this exact foundation inside the
same approved vertical; code presence, a table row, a digest, or an absent
activation head cannot activate V2.
