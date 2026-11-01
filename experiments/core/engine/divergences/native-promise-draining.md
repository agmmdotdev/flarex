# Native Promise completion and cancellation

Status: **Necessary native/runtime adaptation; selected Payload boundary and
private-origin equality correction implemented and validated; general native
hosting remains open.**

## Source and reason

Pinned Convex `crates/database/src/transaction.rs` consumes one owned transaction
at finalization; its pending state cannot remain borrowed by unfinished work.
The [operation-exclusion translation](./transaction-operation-exclusion.md)
preserves that rule in TypeScript. Convex has no Payload Local API integration
whose foreign JavaScript Promise can ignore an AbortSignal and continue using a
request after the Effect caller is interrupted. A cancellation request cannot
establish that this native work has stopped.

## Responsible owners and mechanism

`packages/payload-adapter/src/operations.ts` owns the actual Local API Promise.
It forwards cancellation and drains that same Promise before the request can
finish. Its foreign-error boundary maps known native/CMS rejections to their
typed failures and unknown rejections to defects, retaining existing interruption
and defect reasons. It does not create another request, transaction or runner.

`packages/persistence-postgres/src/execution/preparation/boundedRequestLifetime.ts`
owns deadline competition and request shutdown. A race's internal cancellation
must not discard the completed native operation's additional failure. Preserve
the caller/winner Cause and distinct completed typed/defect reasons by their
existing origin identity; retain sticky request failure and avoid duplicating
the race's internal interruption. Sealing, host close and trusted finalization
follow actual completion. PostgreSQL transactions never span native callbacks.

This preserves the intended drain and failure contract while correcting an
observed loss of late rejection. It grants neither arbitrary hooks nor a claim
that uncooperative foreign code can be forcibly stopped within a deadline.
Native bodies are not replayed, and ambiguous persistence still uses the shared
outcome/recovery owner.

## Required evidence and limits

The indexed continuation additionally exposed the inverse foreign boundary:
Effect's Promise runner can squash a complete Cause before the rejection returns
through Payload. The [indexed slice](../slices/11-payload-indexed-scalar.md)
records the failing mixed-budget witness and owning correction. Preserve native
throwable identity/class where Payload depends on it, and transport the complete
annotated Cause through the same request's private bridge. A matching native
rejection must recover that request's authentic failure; unrelated errors and
other requests must not borrow a receipt. Do not introduce a global carrier,
second lifetime or commit-policy wrapper to repair this request boundary.

The selected correction carries a private completed Exit from the existing
request bridge. It records full annotated adapter failures against the exact
native throwable within that request, after native uniqueness classification.
The Local API still sees its expected Error/ValidationError; only a matching
rejection recovers its complete Cause. Primitive-only failures receive a fresh
private throwable rather than authenticating equal primitive values. Drain the
same Promise before restoring its Exit, so a native interruption does not start
another cancellation/drain cycle.

Changing an error's native classification must not retain authentication for
the old typed error. The bounded-lifetime owner supplies a narrow guarded Reason
projection: unchanged kind/value preserves its origin, while a changed kind or
value overwrites only the private origin annotation with a fresh unissued token.
This leaves diagnostics and the first failure latch intact. Deletion alone is
insufficient: the installed Effect runtime can resurrect a cached annotation
when it clones a Reason for the same Error. Adapters do not manage private
origin keys or receive lifetime authority.

The deadline race also returns the owned completed Cause from its native
branch, rather than only recording it as a side effect and returning an unowned
clone. This keeps each actual failure once while preserving distinct late
defects, caller interruption and the existing deadline-winner behavior.

## Private origin equality

The [Native18 continuation](../slices/18-native-product-multi-source-workflows.md)
adds a concrete shared-lifetime witness: three independently issued failure
occurrences survive repository observation with distinct authenticated origin
tokens, but sealing collapses them when they reuse one Error or refusal value.
Installed Effect RC112 `Cause.combine` uses structural union; distinct empty
object tokens compare structurally equal along with equal errors and annotations.
That violates the existing complete-occurrence contract.

Give newly allocated source-private origin tokens reference equality through
Effect's official `Equal.byReferenceUnsafe` facility. Apply it at both token
issuers: authentic lifetime origins and fresh unissued tokens retiring a changed
classification. Only freshly created private objects are marked; caller-owned
data and Error values are untouched. Retain the same WeakMap authentication,
origin-entry deduplication, first-chain containment and annotation enrichment.
Equality opt-out alone grants no authority.

Existing Cause joins retain their order and implementation. The same authentic
origin propagates once; independent occurrences remain distinct even when their
Error or code matches. Prove direct/projected lifetimes, changed/unchanged
classification, native body/seal, queue/Promise/abort aggregation and context
isolation. Preserve mixed typed failures, defects, interruption and diagnostics.
This does not promise multiplicity for raw, unowned equal Reasons combined before
the lifetime issues origins, nor introduce a global merger, identity counter,
persisted field or migration.

Pinned Convex owns error disposition and rollback through
`transaction.rs:418-454,1551-1562` and `async_syscall.rs:738-767`; its Rust error
representation does not specify Effect Reason counts. This correction preserves
the accepted native full-Cause adaptation. The Payload Promise drain above and
Medusa's bounded foreign-callback grace retain their separate lifecycle contracts.

The actual native drain cases in
`packages/payload-adapter/test/native-drain.test.ts` cover cancellation while a
hook ignores the signal, close waiting for release, and late known rejection or
unknown defect alongside the original interruption. Existing bounded-lifetime
and operation-tracing regressions retain their behavioral assertions. The
[selected native slice](../slices/10-payload-native-core-cutover.md) owns database,
consumer and review gates. Local native proof does not establish Cloudflare
native deployment, general hook support or production capacity.
