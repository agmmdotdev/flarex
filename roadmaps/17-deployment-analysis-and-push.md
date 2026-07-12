# Deployment Analysis And Push

## Status And Scope

**Status:** Active domain authority with an implemented local and backend
control-plane baseline. Hosted analyzer deployment and FlarexDB schema-readiness
integration remain incomplete.

This roadmap owns:

- the developer source-package contract;
- local-feedback versus backend-authoritative analysis;
- the push candidate lifecycle;
- the relationship between analysis, final codegen, artifact persistence, and
  activation;
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

- `apps/backend/wrangler.jsonc` binds `FLAREX_ANALYZER` to `flarex-analyzer`,
  but this workspace has no deployable analyzer Worker application. Tests and
  local dev inject service implementations; hosted source-only analysis is not
  operationally proven by the repository alone.
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

## Target Direction

Keep the developer contract source-only and Convex-shaped while completing the
Cloudflare deployment split:

```text
CLI/dev source package
  -> authenticated public backend start
  -> private backend-controlled analyzer Worker
  -> managed candidate Dynamic Worker analysis
  -> validated candidate metadata + deterministic artifact
  -> final codegen and developer validation
  -> FlarexDB schema/index preparation and readiness
  -> atomic active schema/package/artifact publication
  -> invocation through active metadata and private executor
```

The analyzer, artifact runtime, and executor may be separate Workers, but the
source-package identity and authority chain must remain continuous. Replacement
schema activation should move to the accepted Postgres control/data model with
compatibility comparison and rollback, rather than extending DeploymentDO as a
second long-term schema authority.

## Next Correctness Gates

1. **Make the hosted analyzer concrete.** Add or designate one deployable,
   backend-controlled analyzer Worker that implements the existing service
   contract through the managed Dynamic Worker analysis boundary. Prove its
   Worker-safe bundle, capability isolation, timeouts, egress denial,
   diagnostics, and cold-isolate determinism.
2. **Narrow analyzed-start compatibility.** Inventory legitimate callers, move
   them to source-only analysis where possible, rename the deploy-push
   credential to match its actual scope, and remove or strictly internalize
   `/push/start-analyzed` without breaking local/test parity.
3. **Join push candidates to FlarexDB schema artifacts.** Convert validated
   analyzer schema output into the immutable canonical schema-manifest path;
   reject any mismatch before readiness work begins.
4. **Add readiness-aware finish.** Require the exact scope/generation/fence,
   schema artifact, physical index definitions, build validation, and rollback
   state declared by the foundation before publishing the active version.
5. **Prove race and rollback behavior on real Postgres.** Concurrent pushes,
   failed validation, superseded candidates, missing artifacts, and interrupted
   activation must preserve the previous executable deployment and a usable
   rollback switch.
6. **Complete analysis conformance evidence.** Cover exact source-map positions,
   unsupported import-time APIs, module/size limits, schema separation, forged
   source/hash cases, and parity between local Miniflare and hosted analysis.
