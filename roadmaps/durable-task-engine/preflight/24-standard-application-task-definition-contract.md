# Preflight 24: Standard Application Task-Definition Contract

## Status

**Status:** complete: admit DTE04-A2b only.

This checkpoint admits the production-inert Standard Application contracts
that Roadmap 04 needs before its Postgres schema can be defined. It does not
admit registration, readiness, activation, persistence, run creation, object
publication, runtime dispatch, or a public task SDK.

## Owner And Package Decision

The task catalog extends the existing
`@flarex/standard-application-definition` owner. It is exposed only through
the private `./internal/task-definition-v1` subpath. The shipped `./v1`
definition-preparation surface and its behavior remain unchanged.

This placement is preferred over a new task-definition package because:

1. the catalog is part of one Standard Application definition, beside the
   canonical function program rather than a competing application model;
2. the existing package already owns inert, producer-neutral definition
   normalization;
3. `@flarex/durable-task` must remain unaware of application revisions,
   artifacts, object references, activation, and Standard Application; and
4. no second independent consumer currently proves a lower shared package.

The definition package may import only these additional exact owners:

- `@flarex/durable-task/internal/run-attempt-v1` for the admitted retry policy,
  compute-profile reference, and definition-revision identity;
- `flarex-protocol/validator-json` for the canonical validator syntax and
  bounded admission rules;
- `flarex-protocol/json` for canonical JSON bytes;
- `@flarex/utils/bytes` for intrinsic digest classification, copies, and
  lowercase hexadecimal encoding; and
- `@flarex/analysis/internal/private-sha256-v1` for the existing portable
  Web Crypto adapter mechanics.

The package boundary checker must encode this exact allowlist and inspect the
durable-task named imports: only the three admitted types and their three
schemas may cross. Namespace/default imports, dynamic imports, re-exports, and
other run-attempt symbols remain forbidden. The new dependency allowlist is
confined to `src/taskDefinition/**`; the shipped `src/v1.ts` retains its prior
dependency boundary. Node,
Cloudflare, persistence, Drizzle, Prisma, backend, runtime, Trigger packages,
and direct frozen-source imports remain forbidden.

## Canonical Task Identity

`TaskIdV1` is a branded developer-owned string. Admission requires:

- a primitive string containing only Unicode scalar values;
- between 1 and 255 UTF-8 bytes inclusive;
- no C0 or C1 control code point, including NUL;
- no ECMAScript whitespace at the first or last code point; and
- no normalization, trimming, lowercasing, case folding, path parsing, or
  function-name interpretation.

Equality and duplicate detection use exact JavaScript string equality. The
catalog ordering is ascending by the exact UTF-8 byte sequence, not locale
ordering. Therefore canonically equivalent Unicode spellings remain distinct
task IDs, while the exact same spelling is a duplicate.

## Canonical Manifest

`CanonicalTaskManifestV1` contains exactly:

```ts
interface CanonicalTaskManifestV1 {
  readonly version: 1;
  readonly taskId: TaskIdV1;
  readonly handler: {
    readonly logicalModulePath: string;
    readonly artifactModulePath: string;
    readonly exportName: string;
  };
  readonly payloadValidator: ValidatorJsonV1;
  readonly outputValidator: ValidatorJsonV1 | null;
  readonly runAttemptPolicy: RunAttemptPolicyV1;
  readonly maximumDurationInSeconds: number;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly queue: { readonly kind: "default" };
}
```

Handler fields are immutable location evidence, not logical task identity.
They are bounded nonblank scalar text without control characters or boundary
whitespace. Maximum duration is a positive safe integer. Retry and compute
validation reuse the durable-task schemas without redeclaring them. Validator
input first passes the protocol admission walk, then its strict Schema.

Out-of-memory escalation remains disabled in this first version, and the
seconds ceiling guarantees an exact safe conversion to lifecycle
milliseconds. Unknown manifest fields fail closed. Returned manifests are
owned snapshots; the validator trees and policy are detached before the
snapshot is frozen.
Runtime freezing protects captured canonical evidence rather than caller-owned
input.

## Catalog And Digest Contract

`CanonicalTaskCatalogV1` is an owned, immutable ordered array of decoded
manifests. Catalog admission:

1. validates each manifest in producer order;
2. rejects the first exact duplicate task ID;
3. sorts accepted manifests by exact UTF-8 task-ID bytes; and
4. enforces one catalog-wide 65,536-node validator budget before accepting
   further manifests, preventing shared-input clone amplification; and
5. never reads artifact or activation state.

Each manifest has a canonical JSON preimage with an explicit codec tag and a
lower-level field order independent of object insertion order. The SHA-256 of
that preimage is `canonicalTaskManifestSha256`.

The catalog preimage contains the codec tag plus the ordered pairs of exact
task ID and lowercase manifest digest. Its SHA-256 is `taskCatalogSha256`.
The exported encoder independently rejects excess entries, non-intrinsic
digests, duplicates, and any sequence that is not strictly increasing under
the same UTF-8 comparator; canonicality does not depend on callers having used
the catalog hasher first.
The digest operation is Effect-native because Web Crypto is asynchronous and
can be unavailable. Definition validation remains pure `Result`; the digest
operation receives the admitted local SHA capability explicitly and has no
service, Layer, runner, or hidden global state.

The SHA adapter copies input before foreign observation, copies its digest
output, maps only expected Web Crypto resource failures into tagged errors,
and leaves unexpected causes as defects through the existing private SHA
owner.

## Runtime Binding Contract

`TaskDefinitionRuntimeBindingV1` is the immutable semantic tuple identified by
one future storage-issued `TaskDefinitionRevisionIdV1`. Its frame contains:

- the application revision ID;
- candidate and application-revision task-binding digests;
- exact task ID and canonical manifest digest;
- the task-runtime entry digest and its ordinal, handler, group, and
  projection digest fields;
- catalog, entry-root, runtime projection, task-group manifest, and runtime
  materialization-specification digests;
- package, artifact, source-root, and semantic-root digests from the same
  candidate; and
- a nonempty, deterministically ordered set of immutable task-runtime object
  references needed for reconstruction.

The task-runtime entry group is exactly `durable_task`. Its task ID and handler
must agree with the selected canonical manifest. Runtime object references use
the task-definition owner's closed roles, content-derived object keys, positive
byte lengths, and 32-byte SHA-256 values. Duplicate roles or object keys fail
closed.

The canonical binding preimage encodes bigint ordinals and byte lengths as
canonical unsigned decimal strings and digests as lowercase hexadecimal.
`taskDefinitionRuntimeBindingSha256` is the SHA-256 of those bytes. The binding
deliberately excludes activation revision, activation-head digest, readiness
receipt, tenant, deployment, scope, and current active selection.

## Creation-Authority Receipt

`TaskRunCreationAuthorityReceiptV1` is a separate immutable frame containing:

- version 1;
- application revision ID;
- positive activation revision;
- activation-head digest;
- readiness-receipt digest;
- candidate digest;
- application-revision task-binding digest; and
- the selected `TaskDefinitionRevisionIdV1`.

Its canonical digest is the `creationAuthoritySha256` already captured by the
DTE04-A2a run-creation receipt. The authority receipt is audit and idempotency
evidence, not a capability. It cannot authorize a caller merely because its
shape and digest are valid, and existing runs never re-check it against the
current active head.

## Correlation With DTE04-A2a

The two halves now meet without introducing a cycle:

```text
Standard Application active claim (future issuer-owned operation)
  -> TaskDefinitionRuntimeBindingV1
  -> storage-issued TaskDefinitionRevisionIdV1
  -> TaskRunCreationAuthorityReceiptV1
  -> creationAuthoritySha256
  -> durable-task TaskRunCreationRequestV1 + TaskRunCreationReceiptV1
```

The DTE04-A2a request contains only the opaque definition-revision ID and input
reference. `TaskIdV1` stays above that boundary. DTE04-C's persistence
transaction verifies that the supplied authority belongs to the same definition
revision before inserting a run; DTE04-A2b itself still does not own that
transaction.

## Required Proofs

The implementation checkpoint must prove:

1. exact Task ID acceptance, byte ceilings, scalar validation, boundary
   whitespace rejection, and preservation of distinct Unicode spellings;
2. duplicate rejection and deterministic UTF-8 catalog ordering;
3. strict manifest fields, validator limits, reused policy/compute schemas,
   and input ownership isolation;
4. golden canonical manifest, catalog, binding, and authority preimages;
5. deterministic digests and field sensitivity;
6. binding/manifest task ID and handler correlation;
7. task-runtime object-reference key/digest/role correlation;
8. binding independence from activation events and authority-receipt
   sensitivity to them;
9. private export and dependency boundary enforcement; and
10. no persistence, host, route, object write, registration, activation, or
    public SDK side effect.

## Stop Boundary

This checkpoint stops before:

- changing the canonical declarative-program function-kind union;
- adding `durable_task` to active runtime projection or artifact publication;
- mutating registration, readiness, activation, or active-selection schemas;
- issuing a definition-revision ID;
- adding Drizzle tables, SQL, migrations, or persistence adapters;
- creating a run or storing an authority receipt;
- loading or publishing any referenced object;
- routing or executing task code; or
- exposing any public SDK, HTTP, live, stream, or UI API.

## Admission Receipt

Closed on 2026-08-05. DTE04-A2b added the private Standard Application task
definition surface, canonical catalog and binding frames, lifecycle-free digest
capability, creation-authority receipt, and exact dependency/export gates. The
final implementation also rejects nested policy accessors without invocation,
enforces the catalog-wide validator budget, and prevents admitted durable-task
bindings from being re-exported through local aliases.

The closing validation receipt is:

- full workspace `pnpm typecheck`: 26 projects passed;
- Standard Application definition tests: 21 passed;
- durable-task tests: 51 passed;
- script and boundary tests: 53 passed;
- Effect, Standard definition, Trigger compatibility, lifecycle-vector, and
  source-map checks: passed; and
- both required final reviewers: no findings.

The aggregate workspace `pnpm test` command exceeded its five-minute wrapper
without emitting a failure receipt, so it is not recorded as passing. The
focused owning-package, dependency-package, boundary, and full typecheck lanes
above are the admission evidence for this slice. Roadmap 04 and Preflight 20
now admit DTE04-A3 as the next code slice.

## DTE04-C Handoff

DTE04-C now factory-binds one private creation capability to the decoded
`TaskDefinitionRuntimeBindingV1` and `TaskRunCreationAuthorityReceiptV1`
provided by the trusted active-selection composition owner. Ordinary creation
calls supply only the closed durable-task request, so they cannot select or
replace authority evidence. The adapter re-hashes and compares the canonical
binding bytes and every stored immutable projection before inserting or
replaying a run. Factory inputs are decoded and captured before the lazy
operation can execute, and stored authority frames are canonically decoded,
re-encoded, hashed, and correlated to the stored definition basis on replay.
This does not make the authority receipt itself a capability,
implement active selection, or open registration, host, route, or activation
work.

## Open Validator Snapshot Defect

The AA-R6 5d1 Worker review found a pre-existing task-definition decoder defect
at `taskDefinition/Schema.ts` `freezeValidator`. `ValidatorJsonV1` admission
accepts an own object-validator field named `__proto__`, but the snapshot loop
assigns fields into an ordinary `{}` record. That assignment invokes prototype
setter semantics, so the admitted field disappears from the returned canonical
manifest. Reproduction: decode a valid object validator containing one required
own `__proto__` field; decoding succeeds, while `Object.hasOwn` on the decoded
validator value is false and `Object.keys` is empty. Expected behavior is an
owned, frozen data record retaining the exact field.

This is shared Standard task-definition authority, not a 5d1 Worker-host defect.
The Worker builder therefore keeps its separate safe `JSON.parse` embedding
correction, but 5d1 does not repair the decoder owner. The decoder must later
use a null-prototype record or descriptor-based data definition and add a
focused regression before claiming full validator-key preservation.

## References

- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md)
- [`../04-task-system-api-and-postgres.md`](../04-task-system-api-and-postgres.md)
- [`06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md)
- [`08-application-revision-and-runtime-binding.md`](./08-application-revision-and-runtime-binding.md)
- [`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md)
- [`20-task-system-storage-and-schema-contract.md`](./20-task-system-storage-and-schema-contract.md)
- [`23-run-creation-domain-contract.md`](./23-run-creation-domain-contract.md)
- [`../../42-standard-application-apis.md`](../../42-standard-application-apis.md)
- [`../../16-package-boundaries.md`](../../16-package-boundaries.md)
