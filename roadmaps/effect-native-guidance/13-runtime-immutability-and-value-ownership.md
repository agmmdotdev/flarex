# Runtime Immutability And Value Ownership

Status: active cross-cutting implementation guidance.

Evidence snapshot: 2026-07-16 current working tree and installed Effect
4.0.0-beta.90. Re-check both before relying on a specific API or count.

## Decision

`Object.freeze` is neither an Effect pattern nor an anti-pattern by itself.
Use it only when runtime mutation protection expresses a real Flarex contract:
captured authority, canonical evidence, an opaque capability, a stable public
snapshot, or a deliberately shared constant.

Effect does not remove the need to reason about ownership. `Schema`,
`Data.Class`, `Data.TaggedClass`, `Context.Service`, and `Layer` do not imply a
deeply frozen runtime value. Conversely, a pure freeze of a newly owned plain
object does not need `Effect.sync` or `Effect.try` merely to look Effect-native.

For private ephemeral result records, prefer TypeScript `readonly`, `as const`,
and `satisfies` unless callers require runtime mutation resistance. For state
that intentionally changes, use an explicit state owner such as `Ref` rather
than repeatedly freezing replacement objects without naming the lifecycle.

## Name The Guarantee First

| Need | Default tool | What it does not prove |
| --- | --- | --- |
| Compile-time immutable shape | `readonly`, `ReadonlyArray`, `as const`, `satisfies` | Runtime mutation safety |
| Shallow runtime record | `Object.freeze` on a fresh owned copy | Deep immutability or ownership detachment |
| Detached plain-data snapshot | `structuredClone`, then a domain-limited recursive freeze if required | Support for arbitrary class, capability, or resource objects |
| Functional collection updates | Effect `HashMap`, `HashSet`, or `Chunk` when their semantics fit | Automatic conversion of public arrays, maps, or wire contracts |
| Managed evolving Effect state | `Ref`, `SynchronizedRef`, or `SubscriptionRef` | Persistence, transaction authority, or cross-process coordination |
| Opaque process-local capability | Private brand plus `WeakMap`; freeze the handle when surface mutation must be impossible | Authorization outside the owning process or runtime generation |
| Validated construction | `Schema` or a project decoder | Runtime immutability after decoding |
| Service construction and lifecycle | `Context.Service`, `Layer`, and `Scope` | Immutability of the service object's fields |

Do not substitute one guarantee for another. A `ReadonlyMap` type does not stop
`Map.set` at runtime, and `Object.freeze(map)` does not freeze the map's entries
or prevent its mutator methods. A frozen `Uint8Array` is not the ownership
boundary Flarex needs; defensive byte copies remain the reliable rule.

## Why Flarex Uses Runtime Freezing

### Transaction And OCC Snapshots

Commit decisions, row identities, read evidence, and publication snapshots can
outlive the call that supplied their input. The constructor should copy the
caller-owned record and freeze the owned copy so later caller mutation cannot
rewrite the evidence being validated.

```ts
function captureRowIdentity(
  identity: AppRowIdentityV1,
): Readonly<AppRowIdentityV1> {
  return Object.freeze({ ...identity })
}
```

This is stronger than freezing the input directly: the copy establishes
ownership; the freeze protects the captured value. For nested data, copy and
freeze the nested owned structure according to its declared shape.

### Opaque Capability Handles

`transactionGrant.ts` uses private `WeakMap` state keyed by branded handle
identity. The object identity, not a structurally matching record, is the
capability. Freezing those small handles is appropriate because it prevents
surface mutation while the private `WeakMap` remains the authenticity owner.
Do not replace this with Schema validation or a freely constructible tagged
record; structural decoding cannot prove process-local capability identity.

### Canonical Protocol Values

`flarex-protocol/src/value.ts` normalizes and recursively freezes canonical
value trees. That protects the relationship among the value, its encoded JSON,
its bytes, and any hash or comparison derived from them. Preserve this rule
unless a replacement proves the same canonical and ownership invariants.

### Shared Public Snapshots And Constants

An exported object reused by many callers may need a frozen runtime surface to
prevent one consumer from mutating what every other consumer observes. Keep
this only when the API or tests deliberately promise runtime stability. A
module-local one-shot result object normally needs only precise readonly types.

## Ownership Rules

1. Never freeze a caller-owned object in place unless the API explicitly
   transfers ownership. Copy or construct the owned value first.
2. `Object.freeze` is shallow and returns the same object. Nested arrays,
   records, maps, sets, dates, and typed arrays require their own ownership
   decision.
3. Treat `Object.freeze(structuredClone(value))` as deep detachment plus a
   shallow root freeze. It is not a deep-freeze helper.
4. Prefer named domain constructors such as `captureRowIdentity` or
   `captureSchemaSnapshot` over scattered nested `Object.freeze` calls. The
   name should state why the snapshot exists.
5. Do not introduce a universal `deepFreeze(unknown)`. Cycles, accessors,
   prototypes, `Date`, `Map`, `Set`, resources, and typed arrays need explicit
   semantics. A recursive helper must accept only a documented plain-data
   domain and establish ownership before freezing.
6. Keep public wire and persistence shapes unchanged. Internal persistent
   collections are useful only when repeated functional updates justify the
   conversion boundary.

## Effect Cutline

### Data And Schema

Use Effect `Data` for tagged values and structural equality when those are the
required semantics. In the installed version, `Data.Class` assigns fields but
does not freeze the instance. Use Schema for decoding and invariant checking;
do not assume decoding produces a deeply immutable value.

If runtime immutability is part of the domain contract, express it in a named
constructor after validation and test that contract directly. Do not add
`Data.Class` or Schema only to replace `Object.freeze` syntax.

### Persistent Collections

Consider `HashMap`, `HashSet`, and `Chunk` for internal values that are built
through repeated functional updates, shared across versions, or passed through
Effect APIs already using those collections. Do not convert ordinary public
arrays or protocol records merely to increase Effect usage; the encode/decode
cost and API boundary must have a concrete benefit.

### Managed Mutable State

Use `Ref` when one lifecycle owner intentionally updates state and operations
must observe the current value atomically. Use `SynchronizedRef` when updates
are effectful and serialized, and `SubscriptionRef` when observers need change
notifications. These are runtime state tools, not substitutes for Postgres
authority, OCC evidence, or durable coordination.

### Services And Layers

Use services and Layers to own capabilities, dependencies, acquisition, and
release. Freezing a service object does not create dependency injection, and a
Layer does not make the provided service immutable. Decide service lifecycle
and value mutation independently.

### Pure Construction

Keep a total capture constructor pure:

```ts
const decision = {
  kind: "accepted",
  commitSeq,
} as const satisfies CommitDecision
```

Add `Object.freeze` only when `decision` crosses a boundary that requires
runtime mutation protection. Do not wrap a fresh plain-object freeze in
`Effect.try`; it has no recoverable foreign failure to map.

## Current Repository Evidence

The current working tree contains 723 `Object.freeze` occurrences: 585 under
source paths, 137 under test paths, and one elsewhere. The largest groups are
`persistence-postgres` (448), `executor` (151), and `flarex-protocol` (100).
These counts identify review pressure, not a removal target.

Representative evidence:

- `packages/persistence-postgres/src/appRowPointOcc.ts` correctly copies row
  identities before freezing, but also shows why reviewers must check whether
  every nested input is newly owned before freezing it.
- `packages/executor/src/transactionGrant.ts` uses frozen branded handles with
  private `WeakMap` inspection state; this is an intentional capability
  boundary.
- `packages/flarex-protocol/src/value.ts` recursively freezes canonical value
  trees; this is a protocol invariant.
- `packages/persistence-postgres/src/appSchemaPublicationPreparation.ts` and
  `packages/flarex-protocol/src/app-schema-catalog.ts` contain similar local
  recursive freeze helpers. A future touched slice should decide whether one
  domain-owned plain-data snapshot abstraction can centralize them without
  widening supported inputs or changing contracts.
- Existing tests that assert `Object.isFrozen` prove that some runtime freezes
  are deliberate contracts. Other freezes on tiny private return records may
  be removable ceremony, but only after their callers and mutation tests are
  checked.

## Migration Classification

Classify each touched usage before changing it:

- `keep`: authority evidence, canonical values, capability handles, or an
  explicit runtime-stable public contract;
- `centralize`: repeated copy-and-freeze logic with the same owned plain-data
  domain and invariant;
- `replace with readonly`: private ephemeral records where runtime mutation is
  not observable or promised;
- `replace with persistent collection`: internal repeatedly updated
  collections where structural sharing and functional APIs are useful; or
- `remove with legacy path`: freezing that only supports code being deleted by
  an approved replacement slice.

Do not run a repository-wide mechanical removal. Apply the classification to
the smallest connected operation and preserve behavior with focused tests.

## Testing And Performance

- Assert `Object.isFrozen` only when runtime freezing is part of the contract.
- Prefer mutation-isolation tests: mutate the original input after capture and
  prove the stored decision or snapshot does not change.
- For deep snapshots, test nested arrays and records, not only the root.
- Test that forged structurally identical capability handles remain invalid.
- Keep byte aliasing tests where mutable buffers cross a boundary.
- Measure allocation and freeze cost in hot loops before changing semantics.
  Performance suspicion alone is not evidence to expose mutable authority.

## Review Checklist

- What runtime mutation or aliasing failure is this freeze preventing?
- Who owns the object before and after construction?
- Is the value copied before caller-owned input is frozen?
- Is shallow freezing sufficient for the declared shape?
- Would readonly typing express the actual requirement more accurately?
- Is evolving state owned by a `Ref`, service, transaction, or database rather
  than hidden in ad hoc replacement objects?
- Would an Effect persistent collection materially improve repeated internal
  updates without leaking into public contracts?
- Do tests prove ownership isolation and the real contract rather than syntax?

See also
[`04-data-types-schema-and-control-flow.md`](./04-data-types-schema-and-control-flow.md),
[`05-testing-observability-and-adoption.md`](./05-testing-observability-and-adoption.md),
[`11-data-validation-and-trust-boundaries.md`](./11-data-validation-and-trust-boundaries.md),
and
[`12-encoded-data-and-database-codecs.md`](./12-encoded-data-and-database-codecs.md).
