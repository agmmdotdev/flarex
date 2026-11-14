# Core AOT request hot paths

Status: bounded encoding optimizations implemented with local complete-request
measurement; broader performance acceptance remains unproven.
Baseline checkpoint: `2d30e605`.

The owner selected optimization of actual Core hot paths for Bun machine-code
AOT and matched complete-request PostgreSQL measurement in the current checkout.
This does not select a new execution profile, authority cache, transaction API,
production host or broad runtime redesign. The complete performance program's
other acceptance gates remain separate.

## Independent challenge and bounded candidate

Independent current-owner, accepted-guarantee and pinned-Convex challenges first
inspected their sources, then exchanged concrete counterexamples. All three
converged on the immediate query capture/serialization handoff as a safe
candidate, conditional on actual request profiling. Static compiler percentages
and earlier decoder microbenchmarks do not establish its request cost.

| Current owner | Pinned mechanism | Keep / adapt / replace |
| --- | --- | --- |
| `core/query.ts` captures the selected document, then `encodeDocumentValue` captures that private copy again. | `crates/common/src/document.rs` serializes its established `ConvexObject`; `crates/value/src/object.rs` retains size/nesting from construction. | Keep the original capture, profiles and accounting. Reuse the protocol's exact serialization algorithm through an established-value entry point for the immediate private handoff. Remove only the second normalization/copy. |
| Public document codec accepts unknown mutable values. | Rust owns its immutable value representation; JavaScript callers do not gain ownership from a type. | Keep descriptor-safe public capture and binary detachment. Public encoding remains guarded. |
| Query page selection validates and charges emitted values. | The translated stream preserves bounded traversal, consumed read intervals and pending/snapshot merge. | Keep encoded and semantic limits, cursor costs, first failure, callback ordering and dependency cuts. |

The inspected Convex pin is
`db914cf06e2b06ee985646611b9e12ed7a770318`. The enclosing checkout documented in
the source map is absent on this computer; immutable HTTPS source was inspected
and its bytes matched the recorded identities:

- `crates/value/src/object.rs`: `ebbbf7f9bbf671c0e1017fa88a9b8fec4fa5b33eaa390ac7c91998e0cec0ca9c`
- `crates/common/src/document.rs`: `bd2244455df8103aa864af0e617b92acd436d2bf52bb745626409db70c73d585`

Serializing an established value follows the pinned mechanism and the protocol's
existing `encodeCapturedIndexValue` precedent; it introduces no new semantic
divergence. The runtime slice owns `flarex-protocol`'s document serializer and
the proven immediate query caller, plus their connected regression coverage.
No stored format, schema, durable data or migration changes are selected.

## Retained invariants and counterexamples

The first `captureCoreDocument` still detaches the original value, copies binary
leaves, freezes containers and validates system fields, names and nesting.
The applicable user 1 MiB/16 or general 32 MiB/64 capture profile remains.
The newly captured local tree has no external alias before serialization.
Caller callbacks run only later. Preserve the original order: capture and Core
document validation, serialization, encoded/semantic overflow, document charge,
read recording and returned frontier.

A readonly `DocumentObject` type, a frozen outer object or a cache hit is not
capture evidence. Do not bypass public capture, introduce an issuer symbol,
retain a general cross-call document cache or skip fresh registry/permission
checks. JavaScript `ArrayBuffer` leaves can remain mutable even when enclosing
containers are frozen.

Broader `readDocumentObject` to observation reuse remains deferred: it crosses
system/user profiles and corruption/refusal ordering. `documentIndexKey` callers
can pass raw objects, so removing its field capture globally is also deferred.
Preparsed index paths and registry-name maps require their own hotness/ownership
proof. Native framework behavior and settlement owners remain unchanged.

## Connected proof and measurement

Use the existing current `prepareCoreMixedProductScenario` and its fixture.
Its complete request includes Application mutation, Product update/read/list,
events, outcome and atomic publication. Seed, verify committed results and close
resources outside the request timer. Do not inject the rejected Legacy finite
observation capabilities or compare a reduced business graph.

Provision a separate loopback-only PostgreSQL cluster with an ordinary serving
role and a distinct maintenance endpoint. Existing Core fixtures own generated
namespaces and their cleanup. Retain durability settings. Match frozen dependency
graphs, request construction lifetime, inputs, warmups, verification and outputs
for Node and Bun AOT; retain an interpreter control in each runtime. Collect
quiet timing separately from request-only CPU diagnostics and stop owned runtime
resources. No Node result establishes a Cloudflare deployment claim.

Required witnesses include exact document bytes for int64/special floats/binary,
Unicode/NUL, sorted keys and omission; foreign mutation and binary independence;
getter refusal and proxy defects; document profiles; query encoded/semantic page
boundaries, refusal order, pending changes, coverage/accounting and dependency
cuts. Current mixed Product tests must preserve one-timestamp publication,
idempotent and cold replay without callbacks, and whole-root rollback on late,
caught or dropped failures. Run affected PGlite and ordinary-role PostgreSQL
lanes and the required source/type/lint/review checks before committing.

## Profile-selected hexadecimal rendering

Request-only profiles also identified the existing byte-to-hex renderer in
registry, index and conflict-key paths. Independent current-owner and
accepted-guarantee challenges inspected its callers and tests, then exchanged
the same wrong-type and monkeypatch counterexamples. Their resolved scope is a
private immutable 256-string lowercase table in `utils/bytes.ts`, replacing
repeated byte formatting while retaining the exact intrinsic
`Uint8Array.prototype.values.call(value)` iteration.

This is deterministic domain-neutral rendering at its existing utility owner,
not a cache, protocol change or Convex engine mechanism divergence. Keep visible
subranges, empty input, ignored caller iterator/values/length overrides, and
platform TypeErrors for detached, Proxy and impostor inputs. Do not add native
host-feature detection, a fallback, a second validation traversal or assertions
to hide an invalid table index. Actual intrinsic Uint8Array bytes are 0–255.
Wrong runtime typed-array kinds and Number/String global formatting-hook effects
have no named supported obligation; they are not a wider input contract.

Required witnesses are exhaustive byte spelling, subranges, empty and detached
views, poisoned subclass/instance properties and intrinsic refusal cases. Keep
the original full-request frozen assets and a query-only candidate snapshot so
combined changes can be compared without reverting shared source. Sampled
frames justify this experiment but do not predict its removable CPU cost.

The [complete-request findings](../../../../packages/executor/benchmarks/core-aot/RESULTS.md)
retain the matched source controls, generated/interpreter modes and remaining
measurement limits. The local comparison does not close the full goal's native,
host or scale gates.
