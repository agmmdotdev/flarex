# Canonical Declarative Program Contract

## Status And Scope

**Status:** Accepted architectural direction; implementation is deferred until
the preflight in this record is completed, reviewed, and accepted.

This record owns the proposed standard contract boundary between:

- ergonomic developer APIs in `flarex`;
- direct, minimal program fixtures used to develop and test downstream domains
  before the developer APIs are mature;
- developer-machine or CI compilation and artifact generation;
- Declarative V2 source and semantic artifact production;
- analyzer and verifier inputs; and
- the later verified runtime projection consumed by a function runtime host.

The decision is to create stable inter-domain contracts rather than let one
domain consume another domain's classes, builders, incidental object layout, or
private implementation details.

This record does not approve a package, public export, migration, runtime
route, analyzer change, artifact version change, readiness transition, or
activation. Those require the completed preflight and a separately bounded
implementation slice.

## Why This Boundary Is Needed

The public developer API is intentionally ergonomic and is still evolving.
Schema builders, validators, function registration helpers, generated
references, and future higher-level APIs should be free to improve without
forcing the analyzer, verifier, executor, or runtime to understand every SDK
implementation generation.

The inverse is also important. Work on the analyzer, runtime, and FlarexDB must
not be blocked until the final developer experience exists. Tests and internal
tools need a supported way to describe a minimal valid application without
constructing private SDK objects or copying analyzer-specific payloads.

The accepted direction is:

```text
ergonomic developer API                 direct test/tool fixture
          |                                      |
          +---------- normalize and validate ----+
                                 |
                                 v
                 canonical declarative program input
                                 |
                   compile / bundle / materialize
                                 |
              +------------------+------------------+
              |                                     |
              v                                     v
      immutable Source Artifact V2       Semantic Artifact V1
              |                                     |
              +-------------- verify ---------------+
                                 |
                                 v
                    verified runtime projection
                                 |
                                 v
                       function runtime host
```

The canonical program input is not deployment authority. Source artifacts,
semantic artifacts, analyzer evidence, verified projections, activation
records, and execution requests retain their own contracts and authority
owners.

## Current Sources Of Truth

Current behavior must be verified against:

- [`packages/flarex/src/schema.ts`](../packages/flarex/src/schema.ts) and
  [`packages/flarex/src/server.ts`](../packages/flarex/src/server.ts) for the
  current developer schema and function-registration objects;
- [`packages/analysis/src/index.ts`](../packages/analysis/src/index.ts) for the
  current loaded-module and schema-object analyzer input;
- [`packages/flarex-protocol/src/declarative-v2-semantic-artifact-v1.ts`](../packages/flarex-protocol/src/declarative-v2-semantic-artifact-v1.ts)
  for the current canonical Semantic Artifact V1 wire contract;
- [`packages/flarex-backend/src/declarativeV2`](../packages/flarex-backend/src/declarativeV2)
  for current private authenticated read, command, verification, and progress
  boundaries;
- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  for deployment analysis, artifact, readiness, and activation sequencing;
- [`38-declarative-v2-external-analyzer-compute.md`](./38-declarative-v2-external-analyzer-compute.md)
  for the portable ESM, analyzer-compute, and trust boundary; and
- [`16-package-boundaries.md`](./16-package-boundaries.md) for dependency
  direction and public-versus-internal ownership.

Current naming remains **Declarative V2 + Source Artifact V2 + Semantic Artifact
V1**. A future in-memory program contract must not be called Semantic Artifact
V2 or imply a new artifact generation without a separate versioning decision.

## Current Architecture

The current developer SDK registers functions as runtime objects carrying
markers, validators, partition policy, and handlers. The current analysis
package can inspect loaded execution-module exports and a live schema
definition. It lowers those values into deployment analysis and codegen shapes.

Declarative V2 is a separate private path. Its finalized source and Semantic
Artifact V1 bytes are immutable evidence. Authenticated backend capabilities
produce bounded inert analyzer commands; the analyzer/verifier cannot acquire
backend, persistence, readiness, activation, or application transaction
authority from those values.

No single canonical in-memory program model currently allows both:

1. the developer SDK to lower its definitions into a stable downstream input;
   and
2. focused tests to construct the same downstream input without using the
   developer SDK.

Consequently, current tests often begin from a live SDK object, analyzer-owned
shape, protocol artifact, or source module map depending on the domain under
test. Those are useful current interfaces, but they do not yet form the
accepted standard boundary described here.

## Decisions And Rationale

### Use A Contract Chain, Not One Universal Object

Each transition owns a value with claims appropriate to that transition:

```text
DeveloperDefinition
  -> CanonicalProgramInput
  -> BuildInputs
  -> SourceArtifactV2 + SemanticArtifactV1
  -> AnalyzerEvidence
  -> VerifiedRuntimeProjection
  -> FunctionExecutionRequest
```

These values may reuse exact lower-level types, but they are not aliases for
one another. In particular:

- an SDK object may contain methods, symbols, closures, and type-only
  ergonomics;
- a canonical program input is normalized application intent;
- an artifact is immutable encoded provenance;
- analyzer output is inert evidence;
- a verified projection records trusted verification and publication claims;
  and
- an execution request carries only the bounded data needed for one attempt.

Collapsing these claims would either make the developer API storage-shaped or
let untrusted serialized input masquerade as verified authority.

### Allow Two Legitimate Producers

The canonical program input has exactly two intended producer categories:

1. the developer SDK/compiler adapter; and
2. an explicit fixture/tool builder for downstream development and tests.

The fixture builder is not a second language or analyzer. It must use the same
decoder, normalization, canonical ordering, version rules, and artifact
materializer as the SDK adapter.

### Keep Compilation On The Developer Or CI Side

Developer tooling or CI owns TypeScript, dependency resolution, bundling,
minification, source maps, and generation of portable ESM and semantic
declarations. The trusted verifier hashes, frames, correlates, parses, and
verifies bounded portable inputs. It does not install packages or run arbitrary
build plugins.

### Keep Authority Out Of The Standard Program Contract

The canonical program contract must not carry:

- authenticated backend sessions or request-local proof handles;
- persistence repositories, transactions, or physical locators;
- readiness, publication, activation, or routing authority;
- executor or journal capabilities;
- Cloudflare bindings, Worker Loader handles, or R2 credentials; or
- caller-authored claims that source or semantic content has been verified.

### Prefer A Dedicated Domain Owner If The Preflight Proves It

The leading package candidate is `@flarex/declarative-program`. It would own
the host-neutral in-memory model, strict decoder, deterministic normalization,
and fixture construction needed by independent SDK/compiler and analysis/test
consumers.

The name and package are provisional. The preflight may instead prove that the
wire portions belong in explicit `flarex-protocol` subpaths while the SDK
adapter remains in `flarex` and no new runtime package is justified. It must
not create a vague `core`, `common`, or catch-all package.

## Proposed Contract Responsibilities

Subject to preflight, the canonical program input should be able to describe:

- contract/version identity;
- logical modules and canonical module paths;
- declared function path, kind, visibility, validators, and supported policy;
- schema tables, document validators, logical indexes, and accepted placement
  intent;
- portable module-source or build-input references needed by the build owner;
- source-map associations when present; and
- deterministic ordering and bounded counts.

It should not attempt to encode JavaScript closures or pretend a TypeScript
type is runtime evidence. Executable functions still become portable ESM.
Runtime validators and declarations need an explicit encoded form.

## Mandatory Preflight Before Implementation

The preflight is a research deliverable, not an implementation checkpoint. It
must inspect current code and tests and produce an accepted amendment to this
record before a package or migration begins.

### P1. Producer And Consumer Inventory

Locate every current producer and consumer of:

- SDK schema definitions and registered function objects;
- loaded execution modules;
- deployment analysis and codegen analysis;
- source packages and source maps;
- Source Artifact V2 and Semantic Artifact V1;
- schema manifests and function metadata;
- analyzer commands, responses, and verification evidence; and
- runtime projections and materialization definitions.

For each edge, record whether the value is trusted, untrusted, authenticated,
canonical bytes, decoded data, process-local capability, or runtime-only
object.

### P2. Shape And Semantics Matrix

Create a field-by-field matrix covering schema, validators, functions, module
paths, visibility, routing/placement policy, indexes, source positions, and
runtime capability declarations.

For every field, identify:

- current owner and exact source type;
- producer and consumers;
- normalization and canonical-order rules;
- validation and failure owner;
- whether omission differs from `undefined` or `null`;
- whether it is intent, derived evidence, or authority; and
- whether it is still part of the accepted FlarexDB target.

This step must expose legacy partition/placement assumptions rather than
silently freezing them into a new standard.

### P3. Convex And Current Flarex Research

Inspect the matching Convex schema, function registration, codegen, analysis,
and function-runner boundaries before finalizing the contract. Record what can
be ported directly and each necessary Flarex divergence caused by Cloudflare,
portable ESM, Postgres authority, or the accepted deployment model.

### P4. Contract And Package Options

Compare at least:

1. a dedicated `@flarex/declarative-program` owner;
2. explicit protocol subpaths plus adapters in existing owners; and
3. retaining current boundaries with only a test-fixture adapter.

The choice must include an import/dependency graph, Worker-bundle
compatibility, Effect applicability, public/internal export status, and a
reason each rejected option is worse for the proven consumers.

### P5. Canonicalization And Versioning

Define:

- the exact in-memory and encoded identities;
- deterministic module and declaration ordering;
- size/count/depth limits and their owners;
- duplicate and path-collision behavior;
- validation order and typed failures;
- unknown-field compatibility;
- contract-version versus artifact-version rules; and
- how the same input proves reproducible Source Artifact V2 and Semantic
  Artifact V1 output.

No version suffix grants migration or compatibility authority by itself.

### P6. Compatibility And Migration Audit

Identify shipped or supported consumers before retaining compatibility
wrappers. The first implementation plan must choose one narrow vertical,
preserve current behavior with parity evidence, and avoid dual writes, silent
fallbacks, or a repository-wide rewrite.

### P7. Validation Plan

Specify focused tests for:

- SDK definition and direct fixture producing equivalent normalized programs;
- deterministic encoded output;
- malformed and over-budget inputs;
- analyzer acceptance/rejection parity;
- Source Artifact V2 and Semantic Artifact V1 correlation;
- package export and fresh-consumer behavior if anything becomes public; and
- unchanged activation, OCC, commit, feed, and application-row semantics.

## Preflight Exit Criteria

Implementation may begin only after the preflight has:

1. named every first-slice producer and consumer;
2. separated intent, artifact provenance, analyzer evidence, verified
   projection, and authority;
3. selected the package owner and dependency direction;
4. proposed concrete versioned types and error ownership;
5. defined canonicalization and boundedness;
6. identified the smallest migration vertical and rollback/removal gate;
7. defined parity and negative tests; and
8. been recorded as an accepted update to this roadmap.

An incomplete answer to any item keeps this decision research-only.

## Known Risks

- A universal model could become a cross-domain god object.
- Freezing current SDK classes could make internal representation a permanent
  compatibility obligation.
- Re-declaring existing protocol types could create subtly different
  validation or canonicalization.
- A fixture builder could become a second compiler if it bypasses shared
  normalization.
- Legacy placement or runtime metadata could be accidentally promoted into the
  target architecture.
- A public export could create semver obligations before the contract is
  mature.

## Target Direction

The target permits each domain to be tested independently:

```text
SDK tests
  -> developer definitions -> canonical program

compiler tests
  -> canonical program fixture -> deterministic artifacts

analyzer tests
  -> canonical artifacts -> evidence and diagnostics

verifier tests
  -> authenticated artifact fixtures -> verified projection

runtime tests
  -> verified projection fixture -> function execution
```

No downstream domain needs the final ergonomic SDK in order to develop its own
semantics, and no downstream domain accepts an SDK object as authority.

## Next Correctness Gate

Perform only the mandatory preflight above. Do not create the candidate
package, move types, change artifact versions, or migrate a consumer until the
preflight result is reviewed and this record names the approved first vertical.
