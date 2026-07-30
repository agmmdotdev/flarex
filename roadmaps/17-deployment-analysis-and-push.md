# Deployment Analysis And Push

## Status And Scope

**Status:** Dynamic V1 has an implemented local/backend compatibility baseline.
Declarative V2 is the accepted production metadata direction. Its private S0
physical foundation, S1 durable verifier progress, Semantic Artifact V1
provenance, generated bounded-verifier foundation, and durable verifier-progress
repository mechanics are implemented and inert. Authenticated source/semantic
readers and the earlier request-scoped monolithic private analyzer dispatch are
also implemented and inert. That dispatch consumes the earlier whole-request
analyzer protocol, not A1b2c0b0 admitted-command capabilities, and therefore
does not prove A1b2 composition. Executor-host composition,
static/candidate/runtime projection publication, readiness, activation,
production ingress/binding, and final cutover remain incomplete. The production
upload-orchestration preflight is accepted below. Its U1 portable protocol and
the bounded U2 reader,
same-isolate authority, fail-closed host-construction, and checkpoint-boundary
prerequisites are implemented and remain private and inert; the
route-independent dispatcher, route, client, and candidate handoff are not
implemented.

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
- [`packages/flarex-backend/src/sourceArtifactV2/UploadCore.ts`](../packages/flarex-backend/src/sourceArtifactV2/UploadCore.ts)
  and
  [`packages/flarex-backend/src/semanticArtifactV1/UploadCore.ts`](../packages/flarex-backend/src/semanticArtifactV1/UploadCore.ts)
  for the existing durable artifact mutation contracts;
- [`packages/flarex-backend/src/artifactStore.ts`](../packages/flarex-backend/src/artifactStore.ts)
  and [`artifactRuntime.ts`](../packages/flarex-backend/src/artifactRuntime.ts)
  for durable source-package and runtime seams; and
- [`packages/flarex-backend/test/push.test.ts`](../packages/flarex-backend/test/push.test.ts),
  [`packages/flarex-backend/test/declarativeV2UploadCorrelation.test.ts`](../packages/flarex-backend/test/declarativeV2UploadCorrelation.test.ts),
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

Roadmap 39 now accepts a private host-neutral materialization boundary for the
first global-table/unpartitioned-mutation vertical. It combines an admitted
Canonical Declarative Program V1 with separately normalized prebuilt modules
and explicit logical-to-artifact path bindings, then emits an inert Source
Artifact V2 ingress plan plus canonical Semantic Artifact V1 NDJSON. The
materializer cannot mint roots, selectors, finalization, verifier evidence,
readiness, or activation authority; the backend must still derive those claims
from bytes accepted through the existing artifact owners. The private
protocol-contract, host-neutral materializer-core, and `flarex-dev` prebuild
producer-parity checkpoints are complete. Roadmap 39's test-owned M9
composition now proves backend-derived source/semantic content-root correlation
through the existing upload-core and proof contracts. Production
upload-orchestration design and routing remain separately gated by a new
preflight; the one-block test driver is not a production transport or API.

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

## Declarative V2 Production Upload Orchestration Preflight

### Decision

The production upload boundary will be a versioned command protocol connecting
the `flarex-dev` upload client to a deployment-scoped backend host. It will
drive the existing Source Artifact V2 and Semantic Artifact V1 cores without
changing either artifact's roots, selectors, attempt rows, fences, command
digests, R2 namespaces, or proof rules.

This is not a second materializer, analyzer, push coordinator, or activation
API. The materializer produces an inert ingress plan. The upload boundary
accepts its bytes and derives durable artifact evidence. The verifier consumes
freshly authenticated finalized evidence later. Candidate creation, readiness,
and activation remain separate owners and later gates.

The preflight approves only the staged slices below. It does not authorize a
production route in the first slice.

### Current Evidence

The current repository establishes these facts:

- `@flarex/declarative-materializer` emits an ordered Source Artifact V2 plan
  and canonical Semantic Artifact V1 NDJSON without backend authority;
- `SourceArtifactV2UploadCore` already owns begin, ordered module/block upload,
  close, finalize, reopen, abandon, fences, exact replay, budgets, hashes, and
  R2 reconciliation;
- `SemanticArtifactV1UploadCore` already owns source-bound begin, arbitrary
  byte-block append, finalize, reopen, abandon, finalized reread, fences,
  exact replay, budgets, and R2 reconciliation;
- `DeploymentDO` SQLite already contains both attempt tables and exposes only
  the authenticated finalized Source Artifact V2 read path;
- the backend Worker has the deployment namespace, artifact R2 binding,
  deployment-push bearer configuration, project configuration, and executor
  service boundary required by the existing project/deployment authorizer;
- the process-local finalized-source proof cannot cross a Worker or Durable
  Object RPC boundary and therefore must be issued and claimed in the same
  host operation as semantic begin or reopen;
- no production source/semantic mutation host, upload command codec, public
  route, `flarex-dev` upload client, resume checkpoint, or candidate handoff
  currently exists; and
- M9 proves the core composition only with fresh in-memory ports and a
  one-block test driver. It is not a transport or deployment receipt.

The production design must therefore compose existing owners. It must not copy
the M9 fixture into production or make the public Worker a remote
reimplementation of the attempt stores.

### Package And Host Ownership

| Owner | New responsibility | Explicit non-responsibility |
| --- | --- | --- |
| `flarex-protocol` private subpath | Canonical upload command envelope, checkpoint/receipt projection, wire error codes, media types, and bounded codecs | Upload policy, R2, SQLite, authentication, retries, or client journaling |
| `flarex-dev` private adapter | Split an admitted materializer plan into deterministic commands, persist the local command journal, perform exact retries only when allowed, and resume from checkpoints | Roots, selectors, server fences, semantic proof, candidate state, or activation |
| backend public Worker | Match the deployment-scoped upload route, authenticate before caller-proportional allocation, preserve the bounded body stream and credential needed by the private host, and map host responses | Core mutation logic, durable replay truth, rechunking, or proof serialization |
| deployment-scoped `DeploymentDO` host | Decode the bounded command, construct the existing stores/R2/hash/core adapters, execute one command, issue and claim semantic source proofs locally, and project a stable checkpoint | Materialization, analysis, readiness, activation, or a second artifact algorithm |
| existing upload cores and stores | Remain the sole mutation, framing, hashing, fencing, reservation, replay, and reconciliation authority | HTTP status, client retry loops, or candidate publication |

There is no new package for orchestration in the first vertical. The portable
wire contract belongs in the existing protocol package; the only current
client belongs in `flarex-dev`; and the only durable host belongs in
`flarex-backend`. A separate package becomes justified only after a second
non-test host or client proves an identical portable service contract.

### Transport Contract

The private protocol subpath will define
`DeclarativeV2ArtifactUploadCommandV1` as an exact discriminated union. The
first vertical contains:

- source `begin`, `beginModule`, `appendBlock`, `closeModule`, `finalize`,
  `observe`, and `abandon`;
- semantic `begin`, `append`, `finalize`, `observe`, and `abandon`; and
- no reopen command until the production resume proof demonstrates a real
  caller and the existing fresh-authorization semantics are preserved.

One public command endpoint is sufficient; the command discriminant selects
the owned operation. Metadata-only and byte-bearing commands share one bounded
binary framing:

```text
u32 big-endian metadata byte length
canonical UTF-8 JSON command metadata
zero or more raw payload bytes
```

The decoder must reject an oversized metadata length, body, or payload before
caller-proportional allocation; reject trailing payload for metadata-only
commands; and pass an owned byte snapshot to the core. Source and semantic
bytes are never base64-encoded inside JSON, copied into a push row, or
reconstructed as one whole artifact by the public Worker.

The response is a bounded canonical JSON success or error envelope with an
exact media type. A success contains the command identity and a stable
checkpoint projection, not the store row or its untyped `lastReceipt`. A
checkpoint contains only the fields needed to continue safely:

- artifact kind and upload selector;
- lifecycle, generation, and mutation fence;
- accepted command key;
- next module/block coordinate and current source-module coordinate when
  applicable;
- cumulative usage;
- finalized root and selector only after finalization; and
- source correlation evidence on finalized semantic checkpoints.

The transport contract does not expose process-local witnesses, proofs,
Durable Object names, R2 keys, pending reservation internals, SQL rows, stack
traces, or foreign causes.

### Identity, Commands, And Exact Retry

Source and semantic upload selectors and every command key use the exact
lowercase UUID text contract. They are untrusted selectors, not authority.
The client creates them before the request so a lost begin response can be
retried against the same durable key. The deployment ID comes only from the
authenticated route and must agree with every decoded command.

The backend injects the requested semantic selector through a request-scoped
`makeUploadId` when constructing the semantic core. This preserves the current
core contract while making begin replay durable; it does not let the caller
mint a root, selector digest, project identity, source proof, or fence.

One command key identifies one byte-exact logical command for one upload.
Changing the operation, metadata, payload, admission, expected generation, or
expected fence while reusing the key is a conflict. A normal retry resends the
same frame. The client must retain the last issued frame until it receives a
settled checkpoint or completes authoritative observation.

Generic HTTP retry policy is forbidden:

- validation, authorization, scope, lifecycle, stale-fence, budget, and
  conflicting-replay failures are not retried;
- a direct confirmed-rollback result permits one immediate byte-identical
  operation-specific retry;
- a timeout, lost response, resource failure after dispatch, or settlement
  uncertainty permits no mutation retry until `observe` rereads durable state;
- observation showing the same pending or settled command permits replay of
  only that byte-identical command; and
- observation showing another command or fence requires replanning from the
  returned checkpoint and never reuses the old command key.

The public response may describe this only through
`retryDisposition: "never" | "exactAfterObserve" | "exactNow"`. An HTTP status,
`Retry-After`, library default, or transport exception cannot independently
grant retry authority.

### Chunking, Order, And Resume

`flarex-dev` chunks the already-admitted materializer plan. The backend does
not reorder modules, merge blocks, split blocks after admission, or silently
choose new budgets.

- source modules remain in canonical materializer order;
- source and optional source-map streams have independent contiguous block
  indices under the currently open module;
- semantic NDJSON may split UTF-8 and record boundaries arbitrarily, as the
  semantic core already specifies;
- each raw payload is nonempty and no larger than both the command admission
  and the transport payload ceiling;
- only one command per upload is in flight from a client; Durable Object
  serialization is not a replacement for persisted fences and replay checks;
  and
- local resume starts from the journaled last frame plus an authenticated
  `observe`, not from caller-reconstructed roots or store internals.

The first client policy uses fixed, explicitly configured block ceilings and
one request per core command. Adaptive chunking, parallel block upload,
multi-command batches, and streaming several commands through one request are
deferred until measurement proves a need and their failure semantics have a
separate preflight.

### Budgets

Three budget layers remain distinct:

1. the materializer budget bounds construction of the inert ingress plan;
2. the transport budget bounds request metadata, raw payload, response bytes,
   calls, and elapsed time before and around dispatch; and
3. the existing source/semantic attempt ceilings and per-command admissions
   bound durable artifact work.

All are explicit inputs with no permissive defaults. Product configuration may
apply stricter maxima, but cannot silently invent a missing caller budget.
Transport decoding charges before allocation. Per-command admission is
included in the command digest. Exact retry never resets cumulative attempt
usage, and observation has its own read-only command and cumulative budget.

The client may calculate proposed ceilings from the admitted plan, but the
backend independently validates every bound and derives all actual usage. A
caller total, digest, module count, record count, or EOF claim is never
authoritative.

### Authentication And Trust

The existing deployment-push bearer remains the first public gate for this
vertical. The public Worker validates it and the deployment route before
forwarding the bounded stream. Semantic begin and any future reopen additionally
use the existing project/deployment scope authorizer and fresh finalized-source
read inside the `DeploymentDO` host. The host issues and claims the
request-bound source proof within that same command execution; the proof is
never serialized.

Every command is deployment-scoped. A selector found under another deployment,
a configured project mismatch, a changed deployment incarnation, stale source
generation/fence, or changed source root/selector fails closed. Possession of a
selector, checkpoint, command key, content digest, R2 object key, or prior
receipt grants no authority.

The bearer may be forwarded only across the private Worker-to-DeploymentDO
binding needed for the same request and must never enter a response, log,
stored attempt row, command digest, R2 object, or analyzer payload.

### U2 Preflight Blockers And Current Status

U1 may define the portable shapes while the following host issues remain
explicit U2 blockers:

1. `SourceArtifactV2AttemptStore.read` has no caller-supplied read budget,
   unlike the semantic attempt store and finalized source reader. A public
   `observe` implementation must not project an unrestricted stored row. U2
   must either prove and enforce a fixed admitted row ceiling or add a
   metadata-first bounded checkpoint reader before exposing observation.
   **Resolved in U2 checkpoint 1:** the checkpoint reader measures the full
   variable-width stored row before calling the existing decoder and returns
   only the resume projection.
2. The production finalized-source composer reaches `DeploymentDO` through a
   namespace RPC, while semantic begin must issue and claim its process-local
   proof inside the target deployment host. U2 needs a same-isolate adapter
   that retains the existing authorizer, fresh attempt reread, digest
   validation, request binding, and single-use claim semantics without
   self-RPC or a serialized proof. **Resolved in U2 checkpoint 2:** the
   adapter implements the existing finalized-attempt reader contract as a
   plain DeploymentDO-scoped instance. It synchronously burns the existing
   request-bound authorization witness, rereads the attempt through the
   bounded checkpoint reader under an explicit host-pinned stored-row ceiling,
   revalidates generation, fence, lifecycle, and selector digest, and returns
   only owned finalized evidence. The existing semantic proof factory remains
   the sole issuer and single-use claimant; neither witness nor proof is
   serialized.
3. The source attempt store exposes settlement uncertainty but no
   confirmed-rollback result. Therefore source failures cannot produce
   `retryDisposition: "exactNow"` under the current contract. That disposition
   is emitted only for an actual owning typed confirmed-rollback failure; U1
   must not infer it from a generic resource exception.
4. The current semantic `sourceDrift` error uses a field named
   `semanticUploadId` even when the value is the source upload selector.
   The wire error must expose a neutral or accurately named selector and must
   not freeze that touched-flow naming defect. Any internal public-type
   correction requires its own bounded U2 contract change and direct-caller
   proof. **Resolved in U2 checkpoint 1:** source drift now has its own typed
   error carrying `sourceUploadId`, while deployment mismatch remains a
   semantic-attempt state failure.
5. `DeploymentDO` currently constructs neither upload core nor an R2 adapter,
   and `ARTIFACTS` remains optional in `Env`. U2 must fail closed at host
   construction when the binding or pinned root configuration is absent; no
   in-memory fallback is permitted. **Resolved in U2 checkpoint 3:** a
   backend-local, route-free host composition factory owns exact construction
   from one DeploymentDO storage authority, its verified object-name/deployment
   identity pair, `ARTIFACTS`, and pinned environment configuration. It derives
   every SQL consumer from that same storage authority and constructs only the
   existing stores, R2 adapters, hash adapters, upload cores, checkpoint
   reader, authorizer, and
   process-local proof capability. Missing or malformed configuration returns
   a typed construction failure before any command work; it never substitutes
   memory storage, placeholder identities, or a remote finalized-source
   reader.

### Wire Errors

The protocol owns stable error codes and retry disposition; each backend owner
retains its typed internal error. The initial mapping is:

| HTTP | Wire class | Meaning |
| --- | --- | --- |
| 400 | `invalidCommand` | malformed frame, unsupported operation, invalid selector/coordinate, or trailing bytes |
| 401 | `unauthorized` | missing or mismatched deployment-push credential |
| 403 | `scopeMismatch` | authenticated caller does not own the configured project/deployment incarnation |
| 404 | `notFound` | deployment or upload selector is absent |
| 409 | `stateConflict` | stale generation/fence, invalid lifecycle/order, pending different command, or conflicting replay |
| 413 | `payloadTooLarge` | transport body or raw block exceeds the admitted transport ceiling |
| 422 | `budgetExceeded` | another explicit transport/core/store budget is exhausted |
| 500 | `corruption` | durable or protocol evidence violates an internal invariant |
| 503/504 | `resourceUncertain` | resource failure, timeout, or uncertain settlement requiring observation |

Error envelopes contain operation, safe selector fields, stable reason, and
retry disposition only. They do not flatten typed failures into an ordinary
`Error`, expose internal tags as the wire contract, or convert defects and
interruption into expected failures.

### Abandonment, Rollback, And Cleanup

Abandon affects only the exact open/closing attempt and preserves its fencing
and audit evidence. It never rolls back an already finalized source or semantic
root, changes a push candidate, changes active routing, or deletes
content-addressed R2 objects. A finalized but unreferenced source artifact and
a failed/abandoned semantic attempt remain inert; retention and garbage
collection require a later reference-aware policy.

If semantic upload fails after source finalization, the client may abandon only
the semantic attempt when its checkpoint permits it. It must not hide the
original failure behind cleanup failure. Candidate creation receives finalized
source and semantic evidence only after both succeed; until that later handoff,
the existing active deployment remains unchanged.

There is no V1 fallback, dual write, shadow upload, auto-activation, or
best-effort candidate publication in this boundary.

### Approved Stages

1. **U1 portable protocol only.** Add the private
   `flarex-protocol` command/checkpoint/error codec, golden vectors, strict
   budget tests, owned-byte tests, and no backend route or package consumer.
2. **U2 private DeploymentDO host.** Compose real SQLite stores, R2 stores,
   hashes, upload cores, local semantic proof issue/claim, observation, and
   route-independent error projection. Exercise it through a private
   test/workerd harness; add no public Worker path.
3. **U3 authenticated public dispatch.** Add the deployment-scoped route,
   pre-body authorization, bounded streaming dispatch, exact response mapping,
   and negative cross-deployment/project tests. This stage is still
   non-candidate and non-activating.
4. **U4 `flarex-dev` client and real resume proof.** Drive a materialized plan
   with a persisted command journal; prove lost begin/append/finalize responses,
   pending reconciliation, confirmed rollback, crash resume, budget exhaustion,
   and cold-run root parity against direct core composition.
5. **U5 verifier/candidate handoff preflight.** Define how finalized evidence
   starts authenticated verification and later candidate creation. This stage
   cannot begin merely because upload transport exists.

U1 was authorized and completed independently. U2 is now separately
authorized, but remains split into bounded private-host checkpoints. That
authorization still adds no public Worker route, `flarex-dev` client, Wrangler
binding, candidate handoff, readiness transition, activation, or runtime
routing change.

### U1 Exit Criteria

U1 is complete only when:

1. every command union member has exact keys and a bounded canonical encoding;
2. metadata length, raw payload length, total frame length, response length,
   and elapsed/call budget semantics are explicit;
3. byte-bearing decode returns owned bytes and rejects trailing or missing
   payloads according to the operation;
4. checkpoint fields are sufficient for the staged resume algorithm without
   exposing store rows or authority capabilities;
5. retry dispositions and safe wire errors are exhaustive and independent of
   HTTP-library defaults;
6. semantic begin binds caller-selected selector, finalized source selector,
   generation, fence, and explicit budgets without serializing a proof;
7. two independent codec runs produce identical bytes and golden digests;
8. negative tests cover malformed lengths, noncanonical JSON, duplicate/extra
   fields, invalid UUIDs, oversized budgets/payloads, and error-envelope
   redaction; and
9. current production routes, bindings, stores, active metadata, and M9 tests
   remain unchanged.

### Implemented U1 Contract

U1 is complete. The private
`flarex-protocol/internal/declarative-v2-artifact-upload-v1` subpath now owns:

- the exact source and semantic command unions, including caller-created
  lowercase UUID upload selectors and command keys;
- explicit transport, attempt, command, observation, scope-lookup, and
  finalized-source-read budgets;
- canonical `u32 big-endian metadata length + canonical JSON metadata + raw
  payload` command framing, with payload bytes excluded from JSON;
- stable bounded source and semantic checkpoint projections;
- safe exhaustive wire errors whose retry disposition is protocol-owned; and
- pure Effect `Result` encoders and decoders that return owned byte snapshots.

The codec rejects malformed lengths and UTF-8, noncanonical or duplicate JSON,
extra or accessor-backed fields, invalid selectors and coordinates, missing or
trailing payloads, payloads larger than their command admission, invalid
checkpoint lifecycle/operation combinations, unsafe retry claims, and every
transport byte ceiling independently. `exactNow` is admitted only for a
semantic `confirmedRollback`; source cannot claim it because the current source
store has no confirmed-rollback result.

Contract tests pin two independent encodes and SHA-256 golden digests for all
twelve commands plus representative success and error responses. They cover
exact-limit admission, defensive byte ownership, hostile record/typed-array
rejection, safe error redaction, finalized source-semantic correlation, and
intentional subpath-only export.

This receipt adds no `flarex-backend` or `flarex-dev` consumer, production
route, Durable Object host, Wrangler binding, storage mutation, candidate
handoff, readiness transition, activation, or runtime-routing change. The five
confirmed U2 host blockers above were carried into the authorized private-host
stage and are tracked individually above.

### Accepted U2 Boundary And Current Gate

U2 is accepted as a sequence of private, non-routed checkpoints rather than
one broad host commit. The first checkpoint closes blockers 1 and 4 before any
command dispatcher is composed:

- add a source-attempt checkpoint reader that first measures the complete
  persisted text/blob row under caller-supplied `maximumCalls` and
  `maximumStoredBytes`, then decodes through the existing source-attempt row
  authority and returns only the resume-safe projection;
- require two admitted SQLite calls for an existing source attempt, fail
  before the full-row read when either the call or stored-byte budget is
  insufficient, and retain store corruption/resource failures without
  projecting the stored row;
- keep accepted-command identity explicit: a pending reservation reports its
  unsuffixed pending command key, while a settled attempt reports its last
  command key;
- separate source-correlation drift from semantic-attempt lifecycle failures
  so the typed error carries `sourceUploadId`; and
- classify a semantic attempt found under another deployment as a deployment
  mismatch instead of misreporting it as source drift.

The second checkpoint closes finalized-source blocker 2 without composing the
full host:

- add a same-isolate finalized-attempt reader implementing the existing reader
  interface, with no `DEPLOYMENTS` namespace dependency or private HTTP/RPC
  hop;
- claim the existing request- and deployment-bound scope witness before any
  durable read, so failed, interrupted, or corrupt reads cannot leave reusable
  authority;
- use the bounded checkpoint reader for the fresh durable reread, with a
  construction-time positive safe-integer `maximumStoredBytes` ceiling kept
  distinct from command response-body accounting;
- recompute the upload-selector frame and SHA-256 digest locally under the
  existing command and cumulative call, frame, hash, and elapsed budgets; and
- retain the existing semantic proof factory for process-local request binding,
  digest ownership, and single-use claim.

This checkpoint deliberately does not construct an upload core in
`DeploymentDO`, read `ARTIFACTS`, decode semantic root configuration, map wire
errors, or add an RPC/HTTP method. After its focused trust and budget proof, the
next U2 gate is fail-closed host construction for the artifact binding and
pinned root configuration before any private dispatcher composition.

The third checkpoint closes host-construction blocker 5 without adding a
dispatcher:

- add one backend-local composition factory for a deployment-scoped artifact
  upload host; do not add a package, Context singleton, global Layer, or
  application-wide dependency container for this DO-scoped value;
- require the real callable `ARTIFACTS` `get`/`put` capability, canonical
  `FLAREX_SEMANTIC_ARTIFACT_V1_ROOT_CONFIGURATION`, and exact positive
  `FLAREX_SOURCE_ARTIFACT_V2_FINALIZED_READ_MAXIMUM_STORED_BYTES` text at
  construction;
- verify the caller-supplied Durable Object name is exactly the routing name
  for the deployment identity, and derive SQLite from that same DO storage
  authority so mismatched identity or transaction/SQL tuples are
  unrepresentable;
- decode the semantic root configuration through one domain-owned exact
  contract, then reuse that captured owned value in every request-selector
  semantic-core instance;
- compose the real Source Artifact V2 and Semantic Artifact V1 SQLite stores,
  R2 stores, live SHA-256 adapters, bounded checkpoint reader, scope
  authorizer, same-isolate finalized-source reader, and proof factory; and
- expose only the source core, bounded observation reader, finalized-source
  proof capability, and a lowercase-UUID-bound semantic-core factory needed by
  the later dispatcher.

This checkpoint does not add the two new environment values to production
Wrangler configuration with invented identities or ceilings. Until an operator
pins real values and a later checkpoint composes the private dispatcher, host
construction fails closed and no new route is reachable. The next U2 gate is
route-independent command dispatch and exhaustive internal-to-wire error
projection; public Worker forwarding remains a separate U3 stage.

The dispatcher preflight found one projection prerequisite that must close
before that gate. The existing source mutation receipt does not carry
cumulative usage or the current module's exact next block coordinates, the
semantic mutation receipt does not carry the complete source-correlation
projection required by a finalized checkpoint, and the host has no bounded
semantic observation port. A dispatcher must not fill those fields from the
command admission, perform an unbudgeted post-mutation reread, or expose an
attempt row.

The fourth checkpoint therefore closes only the standard checkpoint boundary:

- define one domain-owned Semantic Artifact V1 checkpoint snapshot and bounded
  reader over the existing attempt-store read budget, parallel to the existing
  Source Artifact V2 checkpoint reader;
- include a complete owned domain checkpoint snapshot in each successful
  source and semantic mutation receipt, projected directly from the settled
  attempt already returned by the authoritative write path;
- expose the bounded semantic checkpoint reader from the route-free
  DeploymentDO-scoped host for `observe`, without exposing its attempt store or
  SQL authority; and
- expose one pure protocol response-capture function that validates and brands
  an already-owned response projection without encoding bytes, allocating a
  second response buffer, or inventing a transport byte ceiling.

This checkpoint does not dispatch a command, map an internal error, issue a
semantic proof, add a runtime bridge, or add an HTTP/RPC route. Once its focused
receipt, observation-budget, ownership, and protocol-normalization proofs pass,
the next U2 gate remains the private route-independent dispatcher plus
exhaustive internal-to-wire error projection. The four U2 prerequisites above
are current implemented private foundations, not evidence that this dispatcher
or any upload route, client, or candidate handoff exists.

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
   restart state now has a separate private portable owner rather than widening
   the report-evidence codec. A versioned parse/link page manifest binds the
   exact reservation, contiguous page/evidence/diagnostic ranges, predecessor
   page, payload length/digest, and cumulative diagnostic root; the final
   canonical page digest is the command output's evidence root. Canonical
   length-framed restart records preserve complete static imports (including
   unused bindings), export-to-local-function bindings, admitted functions,
   direct-call/value-flow evidence, deterministic diagnostics, resolved link
   edges, module order/cycle results, and terminal exact counts/roots. These
   roots are not caller summaries: a domain-separated rolling root commits
   each preceding canonical record digest, the single graph-wide cycle result
   commits the complete deterministic module-order root, and link completion
   must reproduce the parse-pages root admitted when the link sequence began.
   bytes encode no live proof, session, cursor, lease, fence, clock, request,
   transport, Cause, or opaque handle. The private A1b2a1b analysis gate now
   produces these records directly from verifier-owned module/link arenas and
   rehydrates them only after a factory-local synchronous claim binds fresh
   authenticated input plus the exact reservation, output, receipt, usage, and
   parse-page commitments. Rehydration validates metadata before payload,
   canonical bytes, page/range/root continuity, and deterministic linker replay
   before registering fresh process-local module or link authority; partial or
   cancelled recovery yields no handle and never reconstructs or recharges
   durable attempt usage. This gate remains pure, private, inert, and
   production-unreachable.

   The A1b2b0 storage foundation is additive and V2-only. Dedicated attempt,
   command, and ordered evidence-page tables retain the accepted canonical
   reservation/output/receipt/progress frames, immutable settled
   26-dimension usage, page-manifest metadata, and separately admitted restart
   payload bytes. Composite primary and foreign keys preserve exact
   attempt/sequence/reservation lineage with `ON DELETE RESTRICT`; existing V1
   tables and codec meanings are unchanged. A persistence-private pure stored
   row decoder validates hostile metadata without invoking accessors, admits
   lengths before byte copies, and reuses the protocol codec for canonical
   frame truth. These rows and normalized columns remain inert evidence and
   grant no proof, lease, work token, replay, settlement, or verifier authority.
   The private A1b2b1a repository now owns only exact attempt creation and
   observation, database-time fenced acquisition/renewal, non-finalizing
   command reservation/resume, safe release, and terminal abandonment.
   Canonical command capture and command-budget admission happen before the
   short READ COMMITTED decision transaction; the attempt row is always locked
   before its command row. Exact pending replay never recharges durable usage,
   expired takeover preserves the pending command while rebinding its fence,
   and stored rows remain inert rather than minting a writer capability.
   The private A1b2b1b repository now appends and reads only
   `parse_module`/`link_page` restart-evidence pages under the existing
   same-factory run/work capability and live database fence. Append fixes the
   attempt → command → predecessor/replay-page lock order, inserts a new page
   and advances the command tail in one READ COMMITTED transaction, and treats
   byte-identical repeats as inert replay rather than a second write. Bounded
   reads validate metadata and aggregate caller ceilings before fetching exact
   manifest/payload bytes, returning only owned inert evidence and a next-page
   ordinal. Neither operation changes or refunds durable 26-dimensional usage.
   The private A1b2b1c repository now closes only verifier-command settlement
   and committed readback. Under the existing same-factory work capability,
   live database fence, and attempt-before-command-before-final-page lock
   order, it validates the five canonical settlement frames and parse/link
   final-page commitments, settles the command, advances attempt
   lifecycle/progress/receipt state, and clears the pending group in one
   located READ COMMITTED transaction. The attempt's conservatively reserved
   26-dimensional usage remains byte-identical: actual command usage may not
   exceed its reservation and settlement cannot add, refund, reset, or replay
   charge. Capability-free cold readback returns only missing, pending,
   terminal-unsettled, or owned inert settled evidence after metadata-first
   admission. That observation includes settlement and final-page commitments,
   not the complete ordered restart-page manifest/payload sequence. This is
   verifier-progress repository mechanics only; executor host composition
   remains a separate later A1b2 gate.

   The private A1b2c0a persistence adapter now accepts one executor-owned,
   already-connected request `pg.Client` plus the caller-supplied exact
   physical scope locator and constructs only the existing V2 progress
   repository. It reuses the persistence-owned short READ COMMITTED runner,
   leaves connection lifetime and unusable-client quarantine with the request
   owner, and exposes neither the client, Drizzle database, transaction
   capability, locator, nor application commit authority. No executor host
   composer, binding, route, candidate-preparation authority, or real-system
   harness is implemented by this adapter.

   The private A1b2c0b0 executor-HTTP contract now defines only a canonical,
   bounded transport envelope for the four durable verifier commands:
   `source_page`, `registration_page`, `parse_module`, and `link_page`. The
   envelope carries the accepted reservation and all 26 command-budget
   dimensions plus command-specific ordered module, source-byte, or
   semantic-byte frames. Decoded frames remain inert data. No fresh backend
   producer, analyzer command host, executor composer, candidate authority,
   binding, route, real-system harness, readiness, or activation is implemented
   by this contract.

   The private A1b2c0b1 backend producer now issues a fresh request-bound
   finalized-source proof and opens the A1b1 authenticated read session before
   deriving any command commitment or encoding transport bytes. It binds the
   authenticated source/semantic roots, selectors, generations, mutation
   fences, semantic attempt, ordered module metadata, installed analyzer and
   verifier identities, exact reservation lineage, and all 26 command-budget
   dimensions into the A1b2c0b0 envelope. Full-module parse source and the
   canonical semantic stream are copied only after bounded admission; an input
   that cannot fit one command fails closed rather than inventing pagination,
   rescanning, truncation, or fallback. Its request-local result and output
   cursor are private, same-factory, single-use capabilities, while every
   emitted byte and receipt remains inert. This producer does not create
   candidate authority, an analyzer command host, executor composition,
   persistence or transaction authority, a route, the real-system harness,
   readiness, or activation.

   The private A1b2c0b2a executor-HTTP admission owner now adds an opaque,
   factory-local `create`/`step`/`finish`/`close` decoder for those exact
   A1b2c0b0 request bytes. It copies into preallocated owned storage, admits
   metadata before payload, validates structure and canonical embedded
   commitments in fixed quanta of at most 1,024 transitions, and completes an
   independently derived, separately metered byte-wise canonical re-encoding
   and input-equality proof before returning an inert decoded-request
   capability. The existing whole-call decoder remains
   an inert compatibility API and is not an authority-capable source path.
   The private `A1b2c0b2b` executor-HTTP owner now transfers one admitted
   capability into one same-factory, result-bound view/cursor. It reuses the
   retained canonical frame plans to emit ordered immutable header and frame
   metadata followed by fresh owned reservation, budget, module-identity, and
   payload byte chunks in fixed quanta of at most 1,024 transitions. Every
   metadata, byte, allocation, and copy action is precharged against a separate
   exact receipt; exhaustion or close irreversibly releases retained byte
   authority. The view remains inert and cannot mint repository `Work`, a
   fence, candidate, analyzer, verifier, transaction, route, or execution
   authority. No production caller yet composes it with the verifier restart
   runtime, analyzer execution, or durable repository in `apps/executor`. The
   current request-scoped monolithic analyzer path remains unchanged and does
   not prove this replacement A1b2 command path.

   The accepted checkpoint order is:

   1. `A1b2c0b2c0` now provides a private pure bounded analyzer-to-executor
      command-response transport with its own identity, version, and media
      type. It binds the request and reservation digest, command kind and
      sequence, analyzer and verifier identities, and range lineage. It carries
      the output manifest, actual command usage, next progress, ordered restart
      page manifests and payload chunks, and bounded evidence and diagnostics,
      with metadata before payload and allowances from zero through 1,024.
      Embedded durable frames use the protocol owner's admission-before-write
      encoder and owned-range canonical verifier, so exact protocol allocation,
      copy, write, scan, and transition work is admitted before execution and
      successful response receipts settle the exact actual work. Encoding,
      verification, payload hashing, and multi-page terminal validation advance
      through separate resumable quanta so no successful call exceeds its
      allowance.
      Those bytes remain inert and grant no repository owner, fence, candidate,
      or receipt authority. Resulting attempt usage and the final receipt remain
      executor/repository-owned.
   2. `A1b2c0b2c1` remains split across two prerequisites:
      - `A1b2c0b2c1a` is implemented as a private, pure executor-HTTP
        restart-input transport with its own identity, version, and media type.
        It binds the target request and reservation digests,
        command kind and sequence, analyzer and verifier identities, range
        lineage, and the ordered page-manifest predecessor/range/digest chain.
        It admits all page metadata before payload, advances through fixed
        quanta with allowances from zero through 1,024 and exact precharge, and
        returns only owned inert bytes through factory-local, result-bound,
        revocable capabilities. It reuses the existing protocol-owned frames,
        admission-before-write encoder, and owned-range verifier, so it needs no
        protocol change and preserves A1b2c0b0 and monolithic bytes. It remains
        production-unreachable and cannot by itself prove real cold delivery.
      - `A1b2c0b2c1b` is implemented as a separate persistence-owned,
        capability-free bounded settled-page readback. The existing
        page reader requires a live pending `Work`, while settlement closes that
        `Work`; the earlier capability-free settlement observation exposes only
        the latest settlement and final-page evidence, not a historical
        command's complete page sequence. The private
        `readSettledEvidencePageBatch` operation identifies one final
        historical decision by physical scope, attempt digest, command kind and
        sequence, reservation digest, output-manifest digest, and receipt
        digest. Its persistence-private historical settled-command decoder
        proves the canonical reservation/output/receipt lineage, settled
        finality, page count and final tail/root, and each page's command,
        predecessor, range, length, and digest membership before returning
        bytes.

        Readback uses one located READ COMMITTED transaction. It captures
        hostile input and a caller-supplied no-default operation budget before
        SQL; locks or snapshots command metadata first, then predecessor and at
        most 1,024 ordered page-metadata rows; validates and precharges the
        complete admitted page/byte total; and only then reads the exact
        settlement frames and page payloads. Returned pages are detached,
        frozen, inert values with an inert next page ordinal and predecessor
        digest or a terminal marker, not a database cursor. Missing decisions,
        lineage conflicts, pending or terminal-unsettled commands, corruption,
        exhaustion, confirmed rollback, and decision uncertainty remain typed
        persistence failures; interruption and foreign database `Cause` remain
        Effect-owned. Pure row/frame validation stays in `Result`; the named
        repository operation owns database I/O and cancellation, while the
        later request host owns `Scope`, client quarantine, full `Cause`
        observation, and finalization. No serialized row or byte mints a
        `Run`, `Work`, fence, lease, candidate, verifier, or writer authority.
        Existing command/page keys, settlement constraints, immutable settled
        rows, page foreign keys, and final-root/tail evidence are sufficient:
        this gate required no schema, DDL, migration, protocol, package export,
        or connected-client adapter-source change. It supplies the inert
        historical bytes required by the later engine and host, but does not
        itself prove that an analyzer receives and rehydrates them after a cold
        restart.
   3. `A1b2c0b2c2` remains split across two checkpoints:
      - `A1b2c0b2c2a` is implemented as a private, inert executor-HTTP
        prerequisite. The restart-input decoder retains the already validated
        authenticated restart header and terminal with its ordered page state,
        but the raw decoded source exposes no metadata or body authority. One
        same-factory hostile-safe claim compares the retained
        `targetRequestSha256`, `targetReservationSha256`,
        `targetCommandKind`, `targetSequence`, `analyzerReleaseSha256`,
        `analyzerIdentitySha256`, `verifierIdentitySha256`,
        `rangeAndPredecessorTailsSha256`, `sourceReservationSha256`,
        `sourceCommandKind`, `sourceSequence`,
        `sourceAuthenticatedInputSha256`, `sourceOutputManifestSha256`, and
        `sourceSettledReceiptSha256`, plus the already verified terminal
        `pageCount`, `finalPageSha256` final page digest/tail,
        `manifestSequenceSha256`, `payloadByteLength`, and `payloadSha256`.
        Only after that complete retained tuple matches may metadata or body
        authority become usable. Success consumes and revokes the raw source
        and returns only a result-bound claimed source. A resolved same-factory
        claim mismatch, cross-result misuse, reuse, stale state, exhaustion, or
        close fails closed and terminalizes that source. Forged and
        foreign-factory handles are rejected as stale without authority to
        revoke capability state owned by another factory.
        Metadata-before-payload ordering, sequential page/body transfer,
        allowances from zero through 1,024, exact precharge and accounting,
        irreversible ownership release, and inert authority exclusions remain
        unchanged. Existing request, response, restart-input,
        settled-readback, progress, and monolithic bytes and identities remain
        unchanged. The capability remains unwired, production-unreachable, and
        insufficient to prove real cold recovery.
      - The earlier `A1b2c0b2c2b` blocker analysis established the
        authenticated command-plan authority sequence. Its remaining core and
        composition work now belongs to capabilities 1 and 2 rather than a
        chain of research-only gates.
        `A1b2c0b2c2b0a1a-P — authenticated companion producer/consumer
        fact-availability preflight` rejects the earlier single
        pre-execution-companion and two-stage-plan formulation. The accepted
        A1b2c0b0 request identity, grammar, bytes, admitted view, producer
        operation, response, restart-input, progress identities, and package
        root exports remain unchanged. The reservation's existing
        `commandInputSha256` remains the opaque canonical commitment to the
        current authenticated selection, module, and fresh-input facts;
        persistence does not interpret its preimage.

        The truthful authority lifecycle has four distinct stages. First, the
        existing opaque command-input commitment is prepared before
        reservation without reservation or request digests. Second, only after
        canonical reservation and unchanged request bytes exist, a separately
        versioned private post-reservation admission envelope may bind their
        digests, canonical current-progress bytes plus the persistence-owned
        digest, canonical command-budget bytes plus digest, the explicit
        authority-kind discriminator, and full attempt, candidate,
        command-kind/sequence, authenticated-input, range, predecessor,
        analyzer-release, analyzer-identity, and verifier-identity lineage.
        That admission envelope is inert lineage only: it must not claim a
        requirement/capacity vector or deterministic next-progress bytes that
        the analysis owner has not yet derived.

        Third, `@flarex/analysis` alone may create a sealed, process-local,
        nonserializable requirement/capacity capability after the owning
        command accumulator has captured and validated its authenticated
        inputs. `source_page` assembles its exact requirement only after
        owner-local metadata and terminal-plan sealing; `link_page` derives
        immutable capacity only after authenticated module summaries are
        accumulated and sealed; and `registration_page` derives immutable
        capacity only after semantic decode, handler lookup, physical-frame,
        progress, and terminal planning. The former `parse_module`
        `exact_requirement` claim is rejected. Its committed sizing policy
        consumes detailed token, parser, semantic, evidence, and output facts
        for which no authenticated warm or settled-cold producer exists; the
        only exact-fact integration is a test oracle that parses once, derives
        terminal facts, then allocates and parses again. The real engine plans
        and allocates its arena before source parsing and enforces only
        `actual <= required`. The currently supportable design direction is
        therefore an immutable parse capacity followed by verifier-owned
        terminal actual usage, not an exact pre-command requirement. No
        caller-authored vector, preliminary parse, duplicate representation,
        rescan, or copied command ceiling may fill the authority gap.

        Fourth, a separately versioned private terminal authority proof must
        bind the analysis-owned authority kind and requirement/capacity vector,
        verifier-owned terminal actual usage, canonical next-progress bytes and
        digest, output-manifest digest, reservation/request digests, and the
        same full lineage. Source must prove
        `actual = requirement <= command budget`; parse, link, and registration
        must prove `actual <= capacity <= command budget`. Capacity-only
        destination, table, arena, and peak-storage facts never become terminal
        actual usage, and 1,024 remains an execution quantum rather than a
        sizing formula. Existing response and command-receipt identities do not
        bind that authority vector and remain unchanged. A later
        persistence-owner preflight must decide whether the terminal proof is
        durably stored or only transactionally validated before the existing
        settlement is accepted; this roadmap does not select a schema or
        storage representation.

        Each authority has exactly one owner. `@flarex/analysis` derives
        command semantics, any proved exact requirement or immutable capacity,
        verifier-owned terminal actual usage, and current-to-next progress
        policy. Executor-HTTP may later own only the separately versioned,
        hostile-safe admission-envelope and terminal-proof codecs and their
        opaque canonical admission. The backend owns Effect-based proof/session
        reads and hashing and may later prepare the existing pre-reservation
        commitment and post-reservation admission envelope without owning or
        duplicating analysis formulas. Persistence owns canonical current
        progress, reservation, command budget, repository `Work`/fence
        authority, settlement, confirmed-rollback retry, decision uncertainty,
        and the later terminal-proof storage-versus-transactional-validation
        decision. The implemented private `apps/analyzer` adapter connects
        opaque admitted-command and claimed-restart capabilities to
        analysis-owned ports and exposes exact terminal `A`, `E`, and `R`
        channels; it does not mint the separately versioned terminal proof.
        Its host owns request lifecycle, not command-plan or repository
        authority.

        Caller-authored usage vectors, duplicated formulas or representations,
        WeakMap possession without authenticated lineage, serialized handles,
        hidden preliminary work, rescans, banked allowance, copied command
        ceilings or prior actual usage, and settlement without authenticated
        requirement/capacity authority are forbidden. Source pages advance
        a contiguous authenticated module range from the current source
        ordinal and either remain in `source` or enter `parse`; parse commands
        consume exactly the current module ordinal and either remain in
        `parse` or enter `link`; the current body-free `link_page` grammar
        completes one bounded link command and enters `registration`; and the
        complete authenticated `registration_page` enters `verdict`.
        `finalize` remains forbidden. `settledSequence` becomes the command
        sequence, predecessor semantics remain exactly those required by the
        repository, and every ordinal inactive in the resulting phase is
        canonically zero. All ordinal, count, range, and arena-size arithmetic
        is checked against signed-int64 and verifier addressability bounds.

        Capability 1 removed the provisional
        `declarativeV2VerifierCommandPlanV1` source, test, and private package
        export instead of promoting its universal `required` vector. The
        analyzer export snapshot now records only intentional package subpaths,
        including the pre-existing canonical-program subpath. No caller-authored
        command-plan vector, `1,024 * authenticatedUnits` sizing rule, or
        command-budget copy is retained as authority.

        `A1b2c0b2c2b0a0a` is now the committed package-local parse-capacity
        owner in
        `packages/analysis/src/declarativeV2VerifierSizingV1.ts`. It accepts
        authenticated lineage, the opaque module-path owner, the supplied
        source digest, and one bounded owned source snapshot. It derives
        immutable capacity before arena allocation from checked generated
        bounds and leaves terminal actual usage to the existing V1 verifier.
        The source snapshot is the only bounded pre-execution copy; there is no
        preliminary parse, rescan, second source representation, or
        terminal-fact replay. The later trusted analyzer adapter remains
        responsible for authenticating the source/digest correlation before
        invoking this private owner. The terminal driver deliberately preserves
        V1's observable allowance-partition-dependent `calls`; allowance 1 and
        1,024 therefore have identical semantic/evidence results and the same
        capacity but may have different terminal `calls`. The owner remains
        package-unexported, externally unwired, production-inactive, and pure
        `Result`/plain TypeScript. The unchanged analyzer release-identity
        reproduction mismatch remains a separate baseline.

        For the parse-capacity direction, exact authenticated-input or fixed
        dimensions are `objectBodyBytes`, `sourceBytes`, `modules`, and
        `tableBytes`; `tokenBytes` and `stringBytes` have proven source-length
        bounds. Exact-zero current parse dimensions are `objectCalls`,
        `sourceMapBytes`, `semanticBytes`, `schemaNodes`, `validatorNodes`, and
        pure `elapsedMilliseconds`. Linear source lemmas already follow from
        the current owners: every non-EOF token consumes source while EOF adds
        one token; import, call, export, function, value-flow, graph, and
        frontier records are bounded by token occurrences; nesting frames are
        bounded by source openers; and the evidence frame count is exactly
        `1 + callCount + valueFlowCount + diagnosticCount`. Capability 1 adds
        checked generated proof metadata for the canonical parser and
        diagnostic multiplicities: maximum production RHS length `3`, two
        epsilon productions, six parser-stack entries per admitted domain
        unit, four parse diagnostic phases per unit, and the owned
        evidence/semantic multiplicity and encoding constants used by the
        capacity proof. The generated bounds identity is
        `db2dd17538d9c26f8d03b01f244cb8d2bfe845bb8a41e3093261778b25c9b56b`.

        The exact V1 caller-proportional arena is
        `12_544 + 56*tokens + 24*parserStates + 16*nestingDepth + 64*modules +
        64*importEdges + 48*exports + 144*functions + 32*schemaNodes +
        32*validatorNodes + 64*graphNodes + 32*frontierEntries +
        3*objectBodyBytes + tokenBytes + stringBytes + 2*canonicalBytes +
        2*frameBytes + 2*diagnosticBytes + 2*outputBytes`. Every region and the
        cumulative total must fit u32 after checked signed-int64 arithmetic;
        the fixed generated table remains outside that caller-proportional
        arena.

        `A1b2c0b2c2b0a1e-P` is resolved as V1
        multiplicity/addressability contract evidence. For a function-name
        length `L = 80_394` and `K = 4_452` platform ABI calls, the valid
        high-work source has exact length
        `N = 68 + L + 18*K + 16 = 160_614`. Each call repeats the function name
        in import-call and value-flow evidence and twice in semantic output.
        Repeated evidence text is therefore `2*L*K = 715_828_176` bytes;
        canonical plus frame arena factors contribute `2_863_312_704` bytes
        and output contributes `1_431_656_352`, for a combined repeated-text
        demand of `12*L*K = 4_294_969_056`, already `1_761` above u32 before
        any other region. A same-length low-work module is constructible with
        `160_577` comment-padding characters and small terminal actual usage.
        Consequently, a source-length-only V1 fixed-arena worst case cannot
        preserve every same-length actual-fit module. The exact universal
        maximum remains unproved, while this constructive family proves the
        hard ceiling `Nmax <= 160_613`.

        Capability 1 selects a conservative combined UTF-8 module-path plus
        source-domain limit of `128` bytes. The generated checked arena proof
        selects the largest power-of-two domain beneath a `67,108,864`-byte
        core arena ceiling, leaving half of the Cloudflare Worker `128` MiB
        isolate limit for non-arena host state: the complete V1
        caller-proportional arena is at most `48,273,592` bytes at `128`,
        while the next power of two (`256`) requires `156,553,528` bytes.
        Every formula is evaluated with checked signed-int64 arithmetic before
        existing u32 region/total addressability admission; `129` fails before
        allocation. This deliberately conservative limit changes accepted
        inputs and pre-allocation failure order while preserving admitted V1
        bytes and identities. An
        analysis-owned streaming, interning, or factoring design could separate
        peak storage capacity from cumulative canonical/hash/output actual
        while preserving canonical evidence bytes, but would change the
        arena/module/restart representation and require monolithic and warm/cold
        compatibility proof. A separately versioned arena representation would
        deliberately change arena/generated identity and restart representation.
        A separately versioned evidence representation is an option only if
        evidence bytes and identity are intentionally changed, with downstream
        compatibility proved separately. Those three representation directions
        are deferred. Reserved storage remains capacity rather than terminal
        actual, and streaming would not remove canonical/hash/output work from
        terminal accounting.

        Durable command usage and restart recovery usage remain separate
        ledgers. Recovery-side `objectCalls`, page/body bytes, hashes, records,
        and manifests belong only to the bounded recovery receipt; they never
        enter, reset, refund, recharge, or enlarge settled command
        `attempt_usage`. The exact current V1 durable `calls` law is one call at
        engine creation, plus one for every accepted public `step` invocation,
        plus one for every accepted public `finish` invocation, plus
        evidence-SHA feed and finalization work. An allowance-zero `step`
        charges one call while performing no transition. An allowance-zero
        `finish` also charges one call and seals source input, so a later
        `step` observes the changed lifecycle. Caller allowance partition,
        inserted empty calls, and repeated pending `finish` calls therefore
        leak into observable V1 receipts, budget-failure timing, and the usage
        reconstructed on warm or settled-cold restart even when terminal
        semantics are identical.

        `A1b2c0b2c2b0a1d-P` is resolved as contract-fork evidence. No
        owner-internal split-invariant law can preserve the current V1 receipts,
        allowance-zero lifecycle, budget-failure timing, and warm/cold usage.
        The selected completion branch preserves V1's partition-dependent
        external-invocation accounting. A separately versioned owner-internal
        work-unit contract is deferred because it would require explicit
        metered ownership for source sealing, semantic work, terminal
        publication, and evidence hashing; true zero-work semantics;
        compatibility, receipt, and first-failure-order review; and a deliberate
        identity/version decision. No internal quantum, phase constant,
        migration, dual behavior, or compatibility shim is introduced.

        The multiplicity/addressability contradiction remains separate from the
        preserved V1 call-accounting branch. It blocks an unrestricted
        source-length-only V1 fixed arena, not the selected conservative-limit
        direction. Command-budget copying, a preliminary parse, rescan,
        caller-authored facts, hidden work, and duplicated parser semantics
        remain rejected. Capability 1 owns the generated bounds, numerical
        limit proof, capacity/allocation implementation, and focused
        compatibility evidence. Pure deterministic capacity, arithmetic,
        schedule, and terminal-proof mechanics remain Effect v4 `Result`/plain
        TypeScript; the later Effect host owns authenticated acquisition,
        request `Scope`, cancellation, interruption, foreign `Cause`, clocks,
        resources, uncertainty, release, and finalization.

        `A1b2c0b2c2b0a1c-P` is resolved by capability 1: the terminal-fact
        sizing API was replaced with authenticated-length capacity planning,
        the V1 driver retained its existing call law, and the provisional
        command-plan API was removed. Any need for a protocol field, backend
        producer, executor-HTTP codec, persistence/schema decision, analyzer adapter,
        generated identity change, or different parser allocation owner crosses
        a material boundary and must stop for a new proportional preflight.
        Existing request,
        response, restart, progress, and physical identities and bytes,
        package-root closure, monolithic behavior, and the committed
        source/link/registration owners remain unchanged; no parse formula may
        be generalized to another command kind or borrowed from one.

        `A1b2c0b2c2b0a0b0a — protocol-owned resumable verifier-progress
        encode-into cursor` is implemented and committed in the existing
        internal progress-codec owner. Its exact owner set is only
        `packages/flarex-protocol/src/declarative-v2-verifier-progress-v2.ts`
        and
        `packages/flarex-protocol/test/declarative-v2-verifier-progress-v2.test.ts`.
        It adds a factory-local opaque `create`/`admit`/`step`/`close` cursor
        beside the existing codec through the intentional
        `flarex-protocol/internal/declarative-v2-verifier-progress-v2`
        subpath. It adds no module, package-manifest entry, wire identity,
        frame kind, public package-root contract, decoder, or executor-HTTP
        change. The existing atomic encoder is now the compatibility wrapper
        over that owner, so canonical bytes, identities, grammar, decoder,
        callers, package-root closure, and current request, response, and
        restart transport behavior are preserved. The package-local
        source-page owner now consumes the resumable symbols directly; no
        executor host, production caller, route, or binding invokes them.
        Existing atomic callers continue to reach the owner through the
        compatible wrapper.

        Creation preserves hostile-safe capture and first-failure order,
        computes checked exact frame length/work, invokes trusted destination
        admission once before any canonical write, and validates detachment,
        destination range/addressability, shared storage, and borrowed-input
        overlap before publishing a cursor. Each `step` performs at most one
        canonical byte copy or write per actual primitive transition.
        Allowance is an exact safe integer `0..1024`; zero performs no byte
        work or state advance. Banked credit, hidden whole-frame work, rescans,
        and a second canonical buffer are forbidden. Per-call delta and
        aggregate allocation/copy/write/scan/transition receipts are exact,
        and the completed aggregate equals the admitted protocol plan.
        Completion, close, and terminal failure release retained
        frame/destination/cursor state; forged, cross-factory, stale,
        exhausted, closed, or reused handles fail closed.

        Recoverable protocol and lifecycle failures remain pure Effect v4
        `Result` data; trusted callback throws and accepted-state
        contradictions remain defects. The later Effect host owns request
        `Scope`, cancellation, interruption, full foreign `Cause`, resources,
        and finalization. Cold reconstruction starts from offset zero with
        identical bytes and receipts; no serialized mid-frame recovery is
        added. Validation covers all nine frame kinds and all 26
        budget fields, predecessor layouts, atomic-versus-cursor golden and
        two-cold equality, every split, allowances `0/1/1024` and rejected
        `1025`, exact delta/aggregate work, admission-before-write, hostile
        capture/destination/reentrancy/lifecycle cases, existing
        encoder/decoder ownership and failure precedence, destination reuse,
        package-root closure, focused/full protocol and direct
        analysis/executor-HTTP compatibility, typecheck/build, frozen-install,
        and Effect/diff checks; those lanes are green and both exact-final
        reviewers are clean. The additive cursor contract remains private,
        inert, and unwired outside its compatibility wrapper; it creates no
        analyzer, executor, repository, route, readiness, or activation
        authority.

        `A1b2c0b2c2b0a0b0 — private source-page metadata accumulator, sizing,
        and deterministic terminal driver` is implemented and committed in
        `packages/analysis/src/declarativeV2VerifierSourcePageV1.ts` with its
        focused test. It remains package-local, package-unexported, unwired,
        production-unreachable, inert, and incapable of minting transport,
        repository, candidate, host, route, readiness, or activation authority.

        The owner directly consumes the committed protocol resumable cursor;
        it has no allowance-credit bank or deferred atomic-encoder path. It
        captures hostile descriptors and array data once, rejects shared input
        storage, binds candidate/input, command kind/sequence,
        reservation/budget, current progress, predecessor/range lineage,
        analyzer identity, and verifier identity, and derives the exact plan
        before mutable work. Its contiguous metadata-first schedule advances
        only through safe-integer allowances `0..1024`, with zero performing no
        work, no rescan or hidden read, one seal/finish, and canonical
        validation before budget failure. Completion, close, and failure
        release retained caller, frame, destination, and driver authority.

        The source-page owner derives and actualizes all 26 durable
        `attempt_usage` dimensions in canonical order, including exact zeros,
        using checked signed-int64, u32, and arena-addressability arithmetic.
        Its planned and actual usage must agree exactly before output or next
        progress is published. A1b1 authenticated reads, executor-HTTP
        transport work, restart recovery, and host clocks/resources remain
        separate ledgers and never enter or recharge durable source-page usage.
        Request ceilings, irreversible digests, prior actuals, and parse-module
        formulas remain checks or foreign evidence, not source-page authority.

        Recoverable hostile-input, validation, budget, overflow, lifecycle, and
        transition failures remain pure Effect v4 `Result` data; accepted-state
        plan/receipt/progress/output contradictions remain defects. The later
        Effect host still owns request `Scope`, cancellation, interruption,
        full foreign `Cause`, clocks, resources, transport uncertainty,
        release, and finalization.

        Final validation covered the focused source-page suite (16/16),
        resource-partitioned full analysis (347/347), protocol compatibility
        (33/33), executor transport compatibility (65/65), persistence
        progress/readback compatibility (33/33), typecheck/build, generators,
        frozen install, Effect boundaries, and diff checks. Both refreshed
        exact-final reviewers were clean. The monolithic analyzer lane passed
        26 tests with two environment-gated skips; its unchanged generated
        release-identity reproduction mismatch remains an out-of-scope baseline
        and was not repaired or absorbed by this gate.

        At that checkpoint, the trusted `apps/analyzer` adapter, `link_page`
        consumption and settlement, and `registration_page` sizing/driver
        ownership were unresolved. The later committed link and registration
        owners described below close the package-local ownership questions;
        trusted composition, consumption, and settlement now belong to
        capabilities 1 and 2. Source-page and parse-module formulas still do not
        generalize to either command kind.

        The accepted `link_page` preflight found that link sizing and driving
        cannot yet land as a standalone owner. The current call graph remains
        `apps/analyzer/src/Verification.ts` or the restart runtime into
        `createDeclarativeV2VerifierLinkerV1`, opaque module append, bounded
        linker step/finish, and canonical link-record production. The
        monolithic caller supplies its own maximum and required frames, while
        cold rehydration copies the remaining recovery budget into a temporary
        linker requirement. Neither is durable command-plan authority.

        The authenticated `link_page` request is deliberately body-free and
        carries no module-result or link facts. The linker requires exact
        required usage before it accepts opaque WeakMap-owned module results,
        and the current append check proves only a live same-process module
        handle. It does not bind that handle to the candidate, authenticated
        input, parse-pages root, expected module ordinal/range, current
        progress, predecessor receipt, analyzer identity, or verifier
        identity. Request ceilings, retained-source length, irreversible
        digests, prior actual usage, and the recovery-only remaining-budget
        copy cannot substitute for those facts.

        The accepted c0a-P authority decision separates immutable
        pre-allocation capacity from verifier-owned terminal actual usage.
        `link_page` authenticates a separately named capacity plan; it never
        predicts exact `attempt_usage`. The single-pass driver publishes only
        after proving `actual <= capacity <= command budget`, and later
        executor/repository settlement must verify the same relationship before
        accepting the result. Capacity bytes, arena widths, and peak-storage
        facts bound allocation but are not charged as actual work merely
        because they were reserved.

        This contract has two owners. Package-local `@flarex/analysis` owns a
        factory-local opaque authenticated link-input accumulator, warm and
        settled-cold private link summaries, the immutable capacity plan, the
        single-pass linker/evidence schedule, exact terminal actual usage, and
        irreversible completion/failure/close release. The implemented private
        `apps/analyzer` adapter authenticates the already admitted command and
        claimed restart capabilities through factory-local trusted claim
        ports. WeakMap possession and caller-provided identity fields prove
        neither command lineage nor cold equivalence. Analysis does not depend
        on executor-HTTP, and no external or production consumer is wired to
        this path.

        The private link summary is accumulated once while constructing or
        cold-reconstructing the existing opaque module representation. It
        retains only checked lineage, counts, canonical ordinals, relevant
        byte lengths, and bounded diagnostic/traversal facts; it is neither a
        second module representation nor a preliminary link pass. Exact
        pre-allocation equality is rejected because ordering, resolution,
        cycle detection, diagnostics, and evidence are content-sensitive. A
        preliminary link violates the no-hidden-link/no-rescan rule; a backend
        producer summary moves analyzer authority across the trust boundary;
        provenance alone does not size allocation; a constant-work linker
        changes budget/performance semantics; and current caller requirements,
        ceilings, digests, prior actual usage, and recovery budgets are not
        durable command authority.

        All 26 dimensions retain canonical order and checked signed-int64,
        u32, region-width, and total arena-addressability arithmetic. The
        implemented driver makes `calls` split-invariant by counting canonical
        internal create/admit/1,024-transition quanta rather than caller step
        splits. For `N` authenticated modules and `I` imports, terminal core
        actuals are `modules = N`, `importEdges = I`, `exports` equal to the
        authenticated export total, and `graphNodes = N + I`; their capacity
        facts use the same checked cardinalities. `frontierEntries` records
        cumulative actual discovery while a separately named peak fact bounds
        allocation.
        `diagnosticBytes` and `outputBytes` use checked content-dependent
        terminal totals, with capacity derived from the retained byte-length
        and maximum-diagnostic summary. `tableBytes` is a fixed generated-asset
        capacity fact and remains zero in core link actual usage.
        `objectCalls`, `objectBodyBytes`, `sourceBytes`, `sourceMapBytes`,
        `semanticBytes`, `functions`, `tokens`, `tokenBytes`, `parserStates`,
        `nestingDepth`, `schemaNodes`, `validatorNodes`, `stringBytes`, and
        `elapsedMilliseconds` are exact zero in core link actual usage.
        `canonicalBytes`, `frameBytes`, and `hashBytes` are also zero in the
        core ledger and belong, with their own calls and output/page work, to
        the later canonical evidence/response component. Durable command,
        restart recovery, executor-HTTP transport, A1b1 read, and host clock/
        resource ledgers remain separate without reset, refund, or recharge.

        Allowance is a safe integer `0..1024`; zero performs no work, every
        successful unit advances owned state, and caller splitting cannot
        change usage or output. There is no banked work, rescan, preliminary
        link, or serialized mid-link authority. Warm and settled-cold
        reconstruction start from offset zero and must produce identical
        capacity, actual usage, evidence, and output for identical authenticated
        facts. Nothing publishes before terminal capacity/actual agreement,
        and completion, close, or terminal failure irreversibly releases
        accumulator, module, plan, linker, record, and destination authority.

        Pure hostile-input, capability, lineage, ordinal, transition, budget,
        and checked-arithmetic failures remain Effect v4 `Result` data.
        Contradictions after accepted opaque module/arena/plan/receipt state are
        defects. The later Effect host retains request `Scope`, cancellation,
        interruption, full foreign `Cause`, clocks, resources, uncertainty,
        release, and finalization.

        `A1b2c0b2c2b0a0c0a0 — private authenticated link-capacity and
        deterministic actual-usage capability` is implemented and committed
        through the existing package-internal analysis facade, on exactly:

        - `packages/analysis/src/declarativeV2VerifierExecutableV1.ts`;
        - `packages/analysis/test/declarative-v2-verifier-executable-v1.test.ts`;
        - `packages/analysis/src/declarativeV2VerifierV1.ts`.

        The factory-local capability binds authenticated lineage at its trusted
        claim boundary, rejects shared-backed digest storage, owns one immutable
        pre-allocation capacity plan distinct from verifier-owned terminal
        actual usage, and proves `actual <= capacity <= command budget` across
        all 26 canonical dimensions with their exact zeros/formulas, checked
        arithmetic, and separate durable/recovery/transport/read/host ledgers.
        Its split-invariant allowance schedule is `0..1024`; warm and
        reconstructed-cold runs are deterministic from offset zero; recoverable
        failures remain `Result` data, accepted-state contradictions remain
        defects, and the later Effect host retains `Scope`, full `Cause`,
        resources, uncertainty, and finalization. Completion, close, and
        terminal failure irreversibly release retained capability authority.

        Focused and full analysis, parse/source/restart/evidence/monolithic and
        transport compatibility, typecheck/build, generator/identity,
        Effect-boundary, and diff validation were green. Both refreshed
        exact-final project reviewers were clean. The capability remains
        package-root-unexported, externally unwired, production-inactive, and
        has no trusted `apps/analyzer` adapter or production consumer. The
        later trusted app-adapter producer boundary plus `link_page`
        consumption and settlement remain unresolved. The accepted
        `registration_page` preflight also found that its sizing and terminal
        driver cannot yet land as a standalone analysis owner. Registration
        carries no source or module-result body, but its ordered semantic-byte
        payload still must become canonical registration, diagnostic, progress,
        and output-manifest frames. This gate creates no transport,
        persistence, candidate, repository, host, route, OCC, commit,
        readiness, or activation authority.

        `A1b2c0b2c2b0a0d0 — protocol-owned resumable physical-frame
        encode-into cursor` is implemented and committed beside the physical
        V1 codec on exactly
        `packages/flarex-protocol/src/declarative-v2-physical-v1.ts` and its
        focused test. The additive symbols remain available only through the
        existing `flarex-protocol/internal/declarative-v2-physical-v1`
        subpath. They are package-root-unexported, externally unwired,
        production-unreachable, inert, and have no registration-driver or
        other authority-bearing consumer.

        The physical owner exposes a factory-local opaque
        `create`/`admit`/`step`/`close` cursor. Creation captures hostile input
        once in the existing canonical order and owns admitted byte facts
        before trusted destination admission. Destination offset, capacity,
        detachment, shared backing, sibling reentrancy, active-range overlap,
        and addressability remain protocol-owned checks with checked
        arithmetic. Allowance is an exact safe integer `0..1024`; zero performs
        no work and every consumed unit performs one actual canonical-byte
        transition. Delta and aggregate allocation, copy, write, scan, and
        transition receipts are exact, and terminal work must equal the
        admitted plan. There is no banked credit, hidden whole-frame write,
        preliminary encode, rescan, second canonical buffer, per-byte
        caller-proportional allocation, caller-forged cursor, or serialized
        mid-frame recovery. Completion, close, and terminal failure
        deterministically revoke and release cursor and destination authority;
        cold reconstruction restarts from offset zero.

        `encodeDeclarativeV2PhysicalFrameV1` is now the compatibility wrapper
        over that owner. Physical frame identities, grammar, canonical bytes,
        decoder precedence, returned ownership, error spelling, existing
        callers, internal subpath, and package-root closure remain unchanged.
        Recoverable capture, admission, destination, allowance, and lifecycle
        failures remain Effect v4 `Result` data. Trusted callback throws,
        allocation/platform failures after validated input, and contradictions
        after an accepted plan remain defects. Request `Scope`, cancellation,
        interruption, full foreign `Cause`, clocks, async resources, release,
        and finalization remain with the later Effect host.

        Focused physical validation passed 15 tests; full protocol validation
        passed 45 files and 426 tests; protocol typecheck/build,
        analysis/verifier/restart, monolithic analyzer, persistence-progress,
        frozen-install, Effect-boundary, and diff compatibility checks were
        green. Both refreshed exact-final project reviewers were clean after
        allocation-failure classification, sibling-reentrancy, and per-byte
        allocation findings were closed. The unchanged analyzer
        release-identity reproduction mismatch and the HEAD-identical
        persistence `storedAttemptEvidence.test.ts` typecheck failures remain
        separate out-of-scope baselines and are not evidence for this gate.

        The accepted post-d0 owner trace proves that the completed-link claim
        cannot safely land as a standalone capability. The public
        `DeclarativeV2VerifierLinkResultV1` retains only module and diagnostic
        counts plus terminal usage. Authenticated-link completion stores the
        linker presentation but closes the driver bindings and module-handle
        sequence. Cold `adoptLinkResult` adds only an owner and
        `parsePagesRootSha256`; the restart claim does not carry the complete
        registration tuple or module sequence. The semantic stream receipt
        likewise exposes coarse input, record, canonical, string, member,
        depth, and transition facts rather than every registration-owned
        candidate inspection and string comparison. A live WeakMap result,
        its narrow presentation, warm possession, cold parse-root provenance,
        or caller-supplied fields therefore cannot authenticate the required
        lineage or authorize exact registration usage.

        `A1b2c0b2c2b0a0d1 — private authenticated completed-link claim and
        registration-page sizing/terminal driver` is implemented and committed
        through the existing package-internal analysis facade. It is
        package-root-unexported, externally unwired, inert, and
        production-inactive. The factory-local completed-link claim landed
        atomically with its first and only registration consumer rather than
        as an independently reusable claim. The claim binds `attemptSha256`,
        `reservationSha256`,
        `candidateSha256`, `authenticatedInputSha256`, authenticated
        `registration_page` kind and sequence, `parsePagesRootSha256`,
        `currentProgressSha256`, `predecessorAndTailsSha256`, `rangeSha256`,
        `analyzerReleaseSha256`, `analyzerIdentitySha256`, and
        `verifierIdentitySha256`; the exact same-factory and result-bound
        completed-link result; the canonical module-result sequence, ordinals,
        and producing parse-result identities; the authenticated semantic
        input commitment; and the admitted physical/progress/output destination
        and plan owner/range lineage. No new wire field or caller assertion may
        substitute for that opaque ownership.

        The deterministic lifecycle is fixed as
        capture, validate, consume, decode-and-meter, resolve, seal, derive
        capacity, admit destinations and protocol plans, emit, hash, prove,
        publish, and release. Hostile claim and semantic inputs are captured
        once in canonical order. Factory/result identity and the complete
        authenticated tuple are proved before the raw completed-link claim is
        consumed. Semantic metadata is accumulated contiguously from offset
        zero and its existing completeness work gains the detailed inspection
        and comparison receipts needed by registration; handlers then resolve
        exactly once against the retained module sequence. Sealing occurs once,
        checked immutable capacity is derived before final allocation, and the
        committed resumable physical and progress owners emit registrations in
        ordinal order, diagnostics, next progress, and the output manifest.
        Hash/root, plan/actual, and
        `actual <= capacity <= command budget` proofs all precede publication.
        Completion, close, and terminal failure irreversibly release the claim,
        semantic bytes, module sequence, accumulator, plan, emitters, hash
        state, records, and destination authority.

        Allowance is an exact safe integer `0..1024`; zero performs no work and
        each consumed unit advances owned state. Caller splits cannot change
        receipts or bytes, and two cold constructions from identical
        authenticated facts start at offset zero and are equal. There is no
        preliminary registration pass, semantic or module rescan, hidden work,
        banked allowance, duplicate module representation, hidden atomic
        encode, serialized mid-operation recovery, or warm-WeakMap trust.
        Canonical first-failure order is factory/result/capability validity,
        authenticated identity and lineage, semantic shape/grammar/order/
        completeness, completed-link and module resolution, checked
        signed-int64/u32/region/arena addressability, capacity, command budget,
        destination admission, emission/hash proof, and terminal publication.

        Registration durable usage retains all 26 canonical dimensions and
        their distinct owners. `calls` is the exact frozen internal
        claim/capture/decode/resolve/emit/hash/terminal schedule, including
        internally owned 1,024-transition quanta rather than caller call
        splits. `objectCalls`, `objectBodyBytes`, `sourceBytes`,
        `sourceMapBytes`, `importEdges`, and pure `elapsedMilliseconds` are
        exact zero. `semanticBytes` is the exact authenticated semantic-stream
        byte length; `modules` is the exact canonical semantic module count
        proved against the claimed module sequence; `exports` is cumulative
        inspected export candidates; `functions` is the exact semantic
        function count; `tokens` is the exact semantic JSON token count plus
        canonical record separators; `tokenBytes` is the exact semantic
        record, header, and separator byte work; `parserStates` is the exact
        decoder, record-order, and completeness transition count;
        `nestingDepth` is peak accepted depth; `schemaNodes`,
        `validatorNodes`, and `graphNodes` count exact canonical
        member/element admissions, validator-value nodes, and declaration plus
        completeness/handler-relation nodes. `frontierEntries` is cumulative
        completeness and handler-discovery candidates while retained peak
        frontier storage is capacity-only. `stringBytes` counts each UTF-8 byte
        actually decoded, owned/copied, or compared.

        `tableBytes` is capacity-only and remains exact zero in terminal actual
        usage. `canonicalBytes` is the exact canonical semantic bytes plus the
        owned registration, diagnostic, progress, and output-manifest bytes;
        `frameBytes` is the maximum exact encoded owned-frame length;
        `hashBytes` is the exact byte count admitted to handler-identity,
        frame, registration/diagnostic-root, progress, and manifest hash
        states; `diagnosticBytes` is the exact canonical diagnostic-frame
        length; and `outputBytes` is the exact terminal canonical output
        published. Checked capacity also retains destination, allocation,
        peak-frontier, and arena facts without charging them as actual work.
        Durable command usage remains separate from A1b1 object reads,
        executor-HTTP transport, restart recovery, host clock/resource, and
        later settlement ledgers without reset, refund, or recharge.

        Recoverable hostile input, canonical grammar/order/completeness,
        forged/foreign/stale/reused/closed capability, identity/lineage/
        ordinal/range/module-sequence, allowance, capacity, budget, overflow,
        addressability, destination-admission, and recoverable protocol
        failures remain pure Effect v4 `Result` data. Trusted claim or
        admission callback throws and contradictions in already accepted
        opaque module, plan, emitter, hash, receipt, or terminal output state
        remain defects. The later Effect host retains request `Scope`,
        cancellation, interruption, full foreign `Cause`, clocks, resources,
        transport uncertainty, retry, release handshake, and finalization.
        The implemented private `apps/analyzer` adapter authenticates
        admitted-command and restart capabilities and consumes trusted
        warm/cold claims without making `@flarex/analysis` depend on
        executor-HTTP. d1 alone did not prove real settled-cold delivery;
        capability 2 now proves private claimed-source reconstruction and
        continuation while leaving every external producer and route absent.

        The committed d1 owner set is:
        `packages/analysis/src/declarativeV2VerifierExecutableV1.ts`,
        `packages/analysis/test/declarative-v2-verifier-executable-v1.test.ts`,
        `packages/analysis/src/declarativeV2SemanticRecordsV1.ts`,
        `packages/analysis/test/declarative-v2-semantic-records-v1.test.ts`,
        `packages/analysis/src/declarativeV2VerifierRegistrationV1.ts`,
        `packages/analysis/test/declarative-v2-verifier-registration-v1.test.ts`,
        and `packages/analysis/src/declarativeV2VerifierV1.ts`. No manifest,
        package-root export, restart-runtime, or app-adapter widening is part
        of d1. Accepted focused coverage includes every lineage field and
        one-field mismatch, warm and two independently reconstructed cold
        claims, module sequence/ordinal/ownership failures, every semantic
        record and handler resolution, all 26 exact and one-less
        capacity/budget cases, arithmetic/addressability boundaries,
        allowances `0/1/1024` and rejected `1025`, every split, hostile and
        shared/detached inputs, failure precedence, plan/actual/capacity
        agreement, publication/release, and package-root/no-production-caller
        proofs. Focused and partitioned full analysis, semantic/executable/
        parse/source/restart/evidence, physical d0/progress, transport and
        monolithic compatibility, typecheck/build, generator/identity,
        frozen-install or exact environment evidence, Effect-boundary, docs,
        and diff lanes were green on the accepted final bytes. Focused
        registration/semantic validation passed 42/42, completed-link focused
        validation passed 4/4, analysis typecheck, both generator identity
        checks, Effect-boundary checks, and scoped diff checks passed, and both
        refreshed `typescript-diff-reviewer` and
        `code-quality-diff-reviewer` reports were clean.

        d0 remains committed, protocol-internal, inert, and externally unwired.
        d1 is committed, package-internal, root-unexported, and is now consumed
        only by the private accepted analyzer entry. The `apps/analyzer` Effect
        adapter consumes admitted-command and claimed restart-source
        capabilities through factory-local trusted session/command/restart
        claim ports, while the default claim owner fails closed. No backend
        companion or trusted claim producer, settlement owner, route/binding,
        candidate, repository `Work`/fence, OCC/commit authority, activation
        path, or production caller exists. Capability 1 removed the
        provisional command-plan source/test/private export rather than
        treating its bytes as authority. `A1b2c0b2c2b0a1-P` is complete as
        research/design evidence; b0b/b0c/c2b/c3 and real cold recovery remain
        unimplemented.
        Registration and diagnostic frame identities, request/response/
        restart/readback/progress/physical bytes, package-root closure, monolithic
        analyzer behavior, production activation, candidate/repository
        authority, OCC/commit/journal/idempotency/feed/outbox/application-row
        semantics, A1b2/C07 separation, and all governance non-goals remain
        unchanged.

        The earlier b0b/b0c micro-gate sequence is superseded by two
        medium-sized coherent analyzer capabilities. The accepted direction is
        to preserve V1 call accounting and to close parse allocation with a
        proven conservative source/domain limit plus generated parser and
        diagnostic multiplicity bounds. Streaming/factoring, a new arena
        representation, and a new evidence representation are deferred; they
        are not compatibility shims or parallel implementations.

        **A1b2 capability 1 — verifier core contract completion.** The
        four-command verifier core is implemented and committed as one
        analysis-owned capability. It preserves observable V1 `calls`, selects
        the checked `128`-byte combined module-path/source domain, admits its
        immutable parse capacity before allocation, and retains verifier-owned
        terminal actual enforcement. The generated proof pins a
        `48,273,592`-byte maximum arena at the selected limit beneath the
        `67,108,864`-byte core arena ceiling; the next power-of-two domain
        requires `156,553,528` bytes. Source, link, and registration retain
        their existing capacity/actual laws, the provisional command-plan API
        is removed, and focused monolithic, restart, canonical-byte,
        generated-bound, identity, allowance, and transport compatibility
        lanes are green. The capability remains package-internal, externally
        unwired, inert, and production-inactive.

        **A1b2 capability 2 — accepted complete analyzer port.** This
        capability is implemented by the package-internal
        `makeDeclarativeV2AnalyzerPortFactoryV1` semantic entry and the
        `apps/analyzer` `makePrivateDeclarativeV2AnalyzerHostV1`
        dependency-inversion and Effect-host entry. The semantic entry composes
        source, parse, link, and registration through their real owners, retains
        module/link authority only in factory-local process state, and accepts
        settled-cold parse authority through the committed restart runtime
        before deterministic link continuation. The host consumes the existing
        same-factory admitted-command and claimed restart-source capabilities.
        Its trusted session, command, and restart claim ports are
        single-use/fail-closed boundaries rather than caller-authored lineage
        records; no production composition is wired.

        The exact Effect channels are now explicit. `open` returns
        `Effect.Effect<PrivateDeclarativeV2AnalyzerSessionV1,
        PrivateDeclarativeV2AnalyzerHostV1Error, Scope.Scope>`. Warm `execute`
        and settled-cold `rehydrate` return
        `Effect.Effect<DeclarativeV2AnalyzerCompleteV1,
        PrivateDeclarativeV2AnalyzerHostV1Error, never>`. Terminal successes
        retain the analysis-owned capacity/actual/progress/result projection;
        recoverable admission, transport, and analysis failures stay in `E`;
        trusted callback defects remain in the full `Cause`; and `R` owns the
        request-scoped session. Interruption releases the admitted view,
        analysis driver, claimed restart source, and session in deterministic
        reverse ownership order. Retry and persistence uncertainty remain with
        a later bound Effect producer rather than being invented inside the
        pure analyzer.

        Pure plan and capability mechanics remain `Result`/plain TypeScript in
        `@flarex/analysis`; analysis does not depend on executor-HTTP. The app
        host owns Effect acquisition, interruption, full foreign `Cause`, and
        finalization. Allowance `0` remains true no-work at the pure port, host
        driving is cooperatively interruptible at owner step boundaries for
        allowances `1..1024`, and no analysis handle, sealed capacity, or
        mid-command cursor is serialized. Focused warm
        source/parse/link/registration, real claimed-source
        cold-rehydrate-plus-link, allowance partition, typed failure, defect,
        interruption, release, full analysis, protocol, and executor-HTTP
        compatibility lanes are green. Existing request/response/restart/
        readback/progress/physical bytes, identities, package-root closure, and
        the monolithic host are unchanged. The new entry remains directly
        unimported by production composition, externally unwired, inert, and
        production-inactive; acceptance creates no production route or
        activation authority.

        **A1b2-S1 — authenticated reservation and terminal settlement
        bridge.** The private prerequisite discovered by FSV03 is implemented.
        Protocol V1 now owns a canonical 13-field future-registration intent
        that binds one real link reservation to later registration command
        inputs without pretending to know the successor reservation before the
        link receipt exists. Link admission binds that intent digest;
        registration admission separately binds the later real reservation
        digest.

        The backend command producer can open one scoped authenticated
        preparation, capture source/session evidence and module-path bytes
        once, expose the five stable pre-reservation commitments, and consume
        one exact reservation with serialized byte-identical replay. The
        analyzer host reconstructs and hashes the exact admitted canonical
        request, correlates the exact returned terminal result plus its
        analyzer-owned progress/output facts, and issues one single-use
        canonical terminal-authority proof. Recoverable preparation,
        host, and repository failures remain in their existing typed Effect
        channels; trusted callback defects remain in full `Cause`; `Scope`
        owns the authenticated read session and prepared-command lifetime.

        Migration `0038` adds a separate two-phase private command-authority
        row. The persistence facade returns only opaque session and Work
        capabilities. Link command reservation, immutable future intent, and
        pending-attempt state commit atomically; settlement completes the same
        authority row with terminal proof in the transaction that settles the
        existing command, receipt, and progress. Lease takeover atomically
        rebinds the pending authority fence. Registration reservation locks and
        validates the settled link command, exact stored intent, terminal
        proof, real receipt, and unchanged V2 predecessor lineage before it
        creates the successor command and authority row.

        Authenticated authority presence is now invariant across pending replay,
        resume, and settlement: a raw legacy-form call cannot downgrade a
        command that already has an authority row. Persistence also requires
        analyzer capacity to remain within the reserved command budget. If the
        settlement response is lost after commit, the opaque bridge retains the
        exact selector and terminal proof long enough to observe the immutable
        command decision, validate its settled reservation/receipt lineage, and
        close the consumed session without exposing repository `Run` or `Work`.

        Focused PGlite proof covers duplicate and contradictory reserve,
        rollback at every reservation and settlement publication boundary,
        terminal-law validation, legacy-downgrade rejection, uncertain-decision
        observation, takeover, and cold resume. Genuine PostgreSQL
        proof covers concurrent duplicate reserve, link settlement, real
        receipt lineage into registration, pending-registration takeover, and
        cold resume with zero skipped cases. Existing V2 reservation,
        predecessor, receipt, progress, OCC, commit, journal, feed, outbox, and
        application-row identities are unchanged. This bridge remains private,
        fail-closed, production-inactive, and adds no route, readiness,
        activation, provisional plan, dual write, or fallback. FSV03 remains a
        separate unimplemented real-system proof, but this named prerequisite
        no longer blocks its selected private host-neutral lane.

        One proportional approval for either capability covers its
        implementation, in-scope test fixes, validation, roadmap
        reconciliation, required reviewers, and commit. A new preflight is
        required only if implementation crosses a material trust/authority,
        schema/migration, transaction, public-contract, identity/version,
        compatibility, routing/activation, or owner boundary. The current
        request/response/restart/readback/progress/physical bytes, package-root
        closure, and rule that no analysis handle or sealed capability is
        serialized remain unchanged unless such a separately approved boundary
        is reached.
   4. The former standalone `A1b2c0b2c3` host/adapter step is subsumed by
      analyzer capability 2. That capability owns the fresh release handshake,
      single-use claim, request `Scope`, cancellation and interruption, full
      foreign `Cause`, and deterministic resource acquisition, release, and
      finalization. Pure synchronous claim and engine mechanics remain in
      `Result` and plain TypeScript.

   The private, inert `A1b2c0b2c0` response transport,
   `A1b2c0b2c1a` restart-input transport, and `A1b2c0b2c1b`
   capability-free historical settled-page readback are implemented.
   The c2a claimed-source prerequisite is also implemented but inert. The
   former four-file b0a command-plan snapshot has been removed, including its
   private export, rather than adopted as authority. The private a0a
   parse-module capacity policy, b0a0b0a resumable protocol
   cursor, and b0a0b0 source-page sizing/driver are implemented and committed.
   The source-page owner consumes the cursor directly while remaining
   package-local, unexported, unwired, production-unreachable, and inert. The
   private link-capacity owner is committed but externally unwired; link
   consumption and settlement remain unresolved. Registration's protocol-owned
   resumable physical-frame cursor d0 and its d1 authenticated completed-link
   claim plus sizing/terminal driver are implemented and committed through
   internal, root-unexported owners, but remain unwired, inert, and
   production-inactive. Parse/source formulas do not generalize to registration.
   The a1 preflights are retained as evidence, not as a queue of prerequisite
   micro-gates. They established the four-stage command-input/admission/sealed-
   capability/terminal-proof lifecycle, the source-length addressability
   counterexample, and the observable V1 call-accounting contract. The selected
   completion preserves V1 call accounting and uses generated
   parser/diagnostic bounds with a checked conservative `128`-byte combined
   source/domain limit and a `48,273,592`-byte maximum arena proof beneath the
   `67,108,864`-byte core arena ceiling. Streaming/factoring,
   arena-version, and evidence-version redesigns are deferred.

   Analyzer completion is exactly two medium capabilities: verifier core
   contract completion, followed by one accepted complete analyzer port.
   Capability 1 is complete: it owns generated bounds, checked
   capacity/allocation and terminal actual enforcement across all four
   commands, removal of the provisional command-plan API, and focused
   monolithic/restart/identity compatibility proof.
   Capability 2 is complete through
   `makeDeclarativeV2AnalyzerPortFactoryV1` and
   `makePrivateDeclarativeV2AnalyzerHostV1`: it owns
   source/parse/link/registration composition, trusted warm/cold host/session
   claim consumption, exact terminal `A`, `E`, and `R` channels, deterministic
   interruption/failure/release proof, and focused integration validation. Its
   authenticated backend preparation and durable settlement bridge now exist
   as private prerequisites, while every production composition and external
   consumer remains deliberately absent.
   Settled-cold recovery keeps one package-owned restart runtime per private
   analysis session: parse results reconstructed by that owner form the
   authenticated link module set, and a reconstructed link result installs one
   result-bound registration presentation without rerunning the linker,
   duplicating the module representation, or serializing a handle. The Effect
   host reads the claimed restart source cooperatively, preserves the original
   transport failure channel, retains admitted payload chunks and joins each
   role once, and consumes a complete module path before the committed
   `128`-byte combined source/domain limit is enforced. Progress replay or
   skipping fails before a new owner driver is created.

   The complete analyzer port remains externally unwired and
   production-inactive until the separate routing and activation boundary is
   approved. FSV02 now owns private candidate/attempt preparation and A1b2-S1
   now owns private repository `Work`/fence authorization plus terminal-proof
   settlement storage. They add no backend production route,
   `apps/executor` production composition, U2, readiness, activation, or
   production caller. C07 is accepted independently under its own roadmap.
   Current request/response/restart/readback/progress/physical bytes,
   package-root closure, the monolithic analyzer, and OCC/commit/journal/
   idempotency/feed/outbox/application-row authority remain unchanged. A
   materially new trust/authority, schema/migration, transaction, public
   contract, identity/version, compatibility, routing/activation, or owner
   boundary still requires a new proportional preflight.
   Candidate preparation and private repository `Work`/fence settlement are
   now closed prerequisites; `apps/executor` production composition, U2, and
   the private real-system harness remain distinct gates. The current
   monolithic analyzer path remains unchanged. This order creates no alternate
   OCC, commit compiler or execution path, transaction journal, idempotency
   outcome, feed, outbox, authoritative application-row semantics, route,
   readiness, or activation authority.

   These Declarative V2 contracts replace only the deployment-analysis and
   artifact-verification path named by this roadmap. Component suffixes such as
   `CoreV1`, Semantic Artifact V1, or Progress V2 do not authorize a general
   legacy-to-V2 rewrite. In particular, Declarative V2 must not fork or change
   FlarexDB OCC, commit compilation/execution, transaction journals,
   idempotency outcomes, commit/change feeds, outbox behavior, or authoritative
   application-row semantics. The executor may supply a narrowly located
   READ COMMITTED verifier repository, but verifier work never runs inside or
   becomes a second application commit path.

   The intended analysis cutover is replacement-only after one real-system
   acceptance proof. That proof must use the actual backend, analyzer,
   artifact-runtime Worker Loader/Dynamic Worker, executor, and Postgres
   composition with the exact immutable runtime projection selected by the
   private harness; production readiness remains a later gate. The standalone
   runtime-topology probe remains historical evidence and must not be copied
   into production as an alternate runtime. Until the proof and a separate
   cutover decision are complete, the shipped legacy analyzer contract remains
   compatibility state; afterward remove its route, root exports, and consumers
   rather than retaining a dual analysis path or silent fallback.

   The immediate acceptance milestone is a private end-to-end system
   correctness and stress harness, not developer-facing APIs or production
   activation. Test-owned user code must traverse the real authenticated
   backend, analyzer, and artifact-runtime boundaries, the private executor,
   the transaction journal, the existing FlarexDB OCC and commit
   compiler/execution owners, and the authoritative PostgreSQL row/outcome
   path. Minimal harness APIs are internal/test-only, capability-scoped thin
   adapters over those existing owners. They may not create an alternate OCC,
   commit, persistence, authority, dual-write, fallback, or production route.

   A1b2 and foundation `C07` remain distinct prerequisites: A1b2 composes
   authenticated analysis with durable verifier progress in the executor host,
   while `C07` proves the existing private point-mutation correctness kernel.
   They converge only in the same later real-system harness. Its ordered
   acceptance ladder is:

   1. complete one real point mutation and verify its authoritative result;
   2. prove conflicts, cold restart, takeover, cancellation,
      confirmed-rollback retry, decision uncertainty, and crash/fault cases;
   3. prove real-Postgres concurrency, sustained stress, and resource/budget
      enforcement;
   4. close observability, reproducibility, and stability gates; and
   5. only then consider developer-facing APIs and SDK ergonomics, public
      routing, readiness, activation, and cutover.

   **Cross-session handoff:** when the complete A1b2 replacement analyzer port
   is accepted, the analyzer-owning session must send an explicit handoff
   message to the existing FlarexDB System API session rather than beginning
   System API implementation itself. The message must identify the accepted
   analyzer entry point, its exact success/error/requirement channels, the
   acceptance commit or commits, and the validation commands and results. If
   direct session-to-session messaging is unavailable, ask the user to relay
   that same handoff. The receiving System API session must reverify the current
   tree and baselines, then may begin only roadmap 43 `FSV01`. This notification
   does not unblock `FSV02`, `C07`, readiness, activation, active invocation,
   routing, or cutover.

   This harness and real-system proof are not implemented or green. Exercising
   the existing transaction and commit path does not authorize changing
   application OCC, commit compilation/execution, journals, idempotency
   outcomes, feeds, outbox behavior, or authoritative application-row
   semantics.

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
