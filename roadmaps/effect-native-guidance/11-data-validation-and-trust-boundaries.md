# Data Validation And Trust Boundaries

Status: active cross-cutting implementation guidance.

Evidence basis: the transaction-grant protocol and executor verification flow
inspected on 2026-07-16. Re-check current code before an implementation
preflight.

## Decision

Do not treat every condition as Schema validation. First identify what claim
the check proves and which boundary owns that claim.

| Validation kind | Preferred tool | What it proves |
| --- | --- | --- |
| Unknown encoded or wire input | Effect Schema decoder | Shape, primitive constraints, declared transforms, and encoded contract |
| Stable cross-field invariant intrinsic to the value | Schema filter/refinement | Every value of the decoded type satisfies the invariant |
| Pure reusable validation with a meaningful failure | `Result<A, E>` | A deterministic verdict retained as data |
| Runtime policy, authorization, freshness, or contextual comparison | `Effect` with typed failures | The value is acceptable under current trusted state and capabilities |
| Cryptographic or foreign verification | Narrow Effect service/adapter | An external or asynchronous proof completed under an owned failure contract |
| Process-local capability authenticity | Issuer-owned identity/WeakMap inspection | This exact handle was issued by this process and lifecycle owner |
| Trusted invariant that cannot fail without a bug | Defect or startup failure | The program or accepted configuration is internally inconsistent |

Schema is strongest at data boundaries. It is not a universal authorization
engine, capability system, or replacement for explicit domain decisions.

## Validation Pipeline

Keep trust acquisition visible:

```text
unknown bytes or JSON
  -> structural and encoded Schema decoding
  -> canonicalization and stable value invariants
  -> runtime verification: key, crypto, time, policy, current state, pins
  -> process-local verified capability
```

Each arrow should have one owner and one error contract. Do not decode the
same input independently in several layers or collapse every later rejection
back into `invalidSchema`.

## What Belongs In Schema

Use a stable Schema for properties intrinsic to a value:

- required and optional fields, strict structs, literals, and tagged unions;
- bounded strings, arrays, numbers, byte arrays, and canonical encodings;
- transformations between an owned encoded form and decoded domain form;
- brands that mark successful structural or value-level decoding; and
- stable cross-field invariants such as `expiresAt > issuedAt` when that rule
  is part of the value's definition.

Inside Effect code, prefer a hoisted Effect-returning decoder:

```ts
const decodeUnknownGrantPayload = Schema.decodeUnknownEffect(
  TransactionGrantPayloadV1Schema,
)

const decodeGrantPayload = Effect.fn("TransactionGrant.decodePayload")(
  (input: unknown) =>
    decodeUnknownGrantPayload(input).pipe(
      Effect.mapError((cause) => new InvalidGrantPayload({ cause })),
    ),
)
```

The decoder is compiled once. Its error is translated once at the real
protocol-to-domain boundary.

Do not replace Flarex `ValidatorJson`, canonical byte rules, or public encoded
types merely because Effect Schema can describe a similar TypeScript shape.
The owning protocol semantics remain authoritative.

## What Does Not Belong In Structural Schema

These checks depend on current authority or effects and should normally remain
typed operations:

- whether a key is currently active, disabled, retired, or retained;
- whether a signature or digest is cryptographically valid;
- whether a grant is expired relative to the trusted current clock;
- whether a caller has the required policy or capabilities;
- whether runtime pins match the prepared request or current deployment;
- whether a database authorization epoch is still current; and
- whether a process-local handle was actually issued by this verifier.

A Schema can validate that an object contains fields resembling a capability.
It cannot prove authority, freshness, signature validity, database state, or
WeakMap membership. Do not serialize or structurally reconstruct a private
capability to make Schema accept it.

Keep a precise guard when it communicates the policy directly:

```ts
if (expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
  return yield* Effect.fail(verificationFailure("expired"))
}
```

`Effect.filterOrFail` is useful in a short pipeline when it clarifies a single
refinement. It is not automatically better than an `if` inside a dependent
`Effect.gen` verification flow.

## Pure Validation As Result

Use `Result` when a helper is deterministic, reusable, and its failure is a
meaningful value:

```ts
function compareExpectedPins(
  actual: GrantPins,
  expected: GrantPins,
): Result.Result<void, PinMismatch> {
  for (const field of grantPinFields) {
    if (actual[field] !== expected[field]) {
      return Result.fail(new PinMismatch({ field }))
    }
  }
  return Result.succeed(undefined)
}

yield* Effect.fromResult(compareExpectedPins(actual, expected))
```

Do not use `Option` when absence would erase which validation failed. Do not
introduce `Result` for a one-off local Boolean only to convert it immediately
back into an Effect; a normal typed guard may be clearer.

## Canonicalization And Compatibility APIs

Apply [`12-encoded-data-and-database-codecs.md`](./12-encoded-data-and-database-codecs.md)
when validation crosses number/text, UTF-8/bytes, hex/base64, JSON, or database
representations. General Effect encoding validity does not by itself prove a
Flarex canonical representation.

When canonicalization is used by Effect-native verification, its primary API
should return an Effect with precise protocol failures. A throwing or Promise
API may remain as a thin compatibility wrapper when an existing caller needs
it; it must not become a second implementation.

Avoid this transitional shape:

```ts
Effect.tryPromise({
  try: () => throwingCanonicalizer(input),
  catch: () => verificationFailure("malformedEvidence"),
})
```

It maps expected protocol rejection, unexpected bugs, and foreign failures to
one business error. Prefer an Effect-native canonicalizer that emits its
tagged protocol errors at source. Translate only the expected tags at the
verification boundary; preserve unexpected defects for boundary diagnostics.

## Configuration Validation

Classify configuration by origin:

- Environment, file, network, or other unknown startup input should use
  Effect `Config`, Schema, or a typed Effect constructor.
- A pure reusable configuration planner may return `Result`.
- A trusted synchronous factory may reject invalid programmer configuration at
  startup when that is its deliberate contract.
- Layer construction should fail with a typed configuration error when callers
  need composition or recovery.

Do not run a general Schema decoder per request for a verifier configuration
that is stable for the host lifecycle. Validate and construct it once at the
narrowest stable factory or Layer boundary.

## Dynamic Context Is Not A Dynamic Schema By Default

Avoid building request-specific schemas merely to compare a value with runtime
state such as expected pins, current epochs, or a selected key. That adds
compiler/allocation overhead and hides the real dependency inside a closure.

Use a static Schema to establish the value type, then pass explicit trusted
context to a pure `Result` validator or Effect operation. A dynamic Schema is
appropriate only when the schema itself is genuinely runtime data and is
compiled once at its stable ownership boundary.

## Transaction-Grant Evidence

The current transaction-grant flow demonstrates the intended separation and
the remaining transitional debt:

- `flarex-protocol/src/transaction-grant.ts` already uses strict Schemas,
  brands, canonical encodings, bounded evidence, and intrinsic cross-field
  checks. Preserve that structural layer.
- Executor verification owns key, crypto, time, policy, and pin decisions.
  When that flow is Effect-native, prefer a named `Effect.fn`, tagged failures,
  and clear guards inside its dependent orchestration.
- WeakMap-backed inspectors in `packages/executor/src/transactionGrant.ts`
  prove process-local capability authenticity. Schema must not replace them.
- Promise/throw canonicalizers wrapped by broad `tryPromise` catches remain a
  migration seam. Prefer typed Effect-native protocol operations.
- Pure key-window or pin-comparison helpers may return `Result` when reuse and
  direct tests justify the representation.
- Discriminated key-state handling should use exhaustive `Match` or `switch`
  when a new variant must become a compile error; a simple two-way guard may
  remain an `if`.

This classification is guidance, not authorization to refactor the active
transaction-grant slice. A behavior-changing port still requires its own
preflight and focused verification.

## Review Checklist

For each touched validation flow, reviewers should ask:

1. Is the input truly unknown, or already decoded and branded?
2. Is the rule intrinsic to the value, or dependent on current authority?
3. Does Schema preserve the exact encoded and decoded contract?
4. Is a pure failure better represented as `Result`, or is a local guard
   clearer?
5. Are crypto, time, database state, and capability checks explicit Effects?
6. Can an unexpected defect be accidentally normalized by a broad catch?
7. Is a process-local capability being confused with a structural object?
8. Are stable decoders and configurations constructed once?
9. Would `Match` or an exhaustive switch protect a growing union?
10. Do tests prove malformed input, each semantic rejection, and the success
    capability separately?

## Primary Reference

- [Effect Schema API](https://effect-ts.github.io/effect/effect/Schema.ts.html)
