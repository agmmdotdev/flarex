# Execution Artifact Lifecycle Parity

This roadmap tracks the local-first runtime and hosted deploy/push parity work
after the shared artifact runtime host kit foundation.

## Current Diagnosis

Local dev and hosted execution now share the generated runtime host kit, but the
source package lifecycle is still split across packages:

- `flarex-dev` bundles local source packages and stores them in local memory or
  an R2-shaped durable store.
- `flarex-backend` persists hosted source packages, activates deployments, and
  materializes artifact runtime invocations from active deployment records.
- `flarex/artifacts` derives deterministic artifact refs, but ref/source-package
  validation was partially duplicated by the dev and backend stores.

The goal is not to make local dev run hosted Dynamic Workers. The goal is to
make local and hosted paths share the same lifecycle contract from source
package to artifact ref to materialized runtime invoke, with host mechanics kept
separate.

## Implementation Slices

- [x] L-0. Create a concrete lifecycle parity roadmap and turn checklist.
- [x] L-1. Move execution artifact ref equality and source-package ref
  assertions into `flarex/artifacts`; make local in-memory, local durable, and
  backend durable stores use the same validation helper.
- [x] L-2. Extract a shared artifact lifecycle payload helper for
  `ExecutionArtifactRef` plus optional `sourcePackage` materialization so local
  and hosted invocation paths build the same runtime input shape.
- [x] L-3. Align local dev push/runtime activation around the shared lifecycle
  helper, keeping Miniflare and local file watching as dev-only host mechanics.
- [x] L-4. Align hosted deploy/push activation around the same lifecycle helper,
  keeping Worker Loader, service bindings, and R2 as hosted-only mechanics.
- [x] L-5. Add parity tests that exercise source-package bundle, artifact ref,
  deployment activation, runtime materialization, and invoke behavior across dev
  and backend boundaries.
- [ ] L-6. Final audit: local-first runtime and hosted push/deploy still share
  lifecycle behavior while preserving their different host adapters.

## Quality Bar

- Every runtime-affecting slice updates this roadmap and
  `roadmaps/27-execution-artifact-lifecycle-parity-goals.md`.
- Shared contracts belong in `flarex`, `flarex-protocol`, or backend host-kit
  modules only when both local and hosted users consume them.
- `flarex-dev` can own developer ergonomics, watchers, Miniflare process
  management, and local CLI composition, but not a divergent artifact lifecycle
  contract.
- `flarex-backend` can own deployment persistence, Durable Object state, hosted
  service bindings, and R2 integration, but not a divergent artifact lifecycle
  contract.
- Significant code changes require focused validation plus the two read-only
  reviewers named in `AGENTS.md`.

## Completed Checkpoints

- `579b1bf` (`Mark host kit audit complete`) finished the shared runtime host
  kit foundation before this lifecycle parity stream began.
- `2d0f118` (`Align hosted artifact ref lifecycle`) aligned hosted finish-push
  artifact ref derivation around the shared deployment artifact Effect helper.
- `1a192cf` (`Add artifact lifecycle parity tests`) added cross-boundary local
  and hosted lifecycle tests plus shared fixtures for source-package,
  activation, materialization, and invoke payload parity.
