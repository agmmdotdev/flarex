# Native command budgets

Status: **Selected native budget requirement implemented and validated; wider native and host gates remain open.**

Pinned Convex Source accounting owns document/query/read/write limits in the
translated `CoreAccounting`. Those limits remain unchanged. The admitted CMS
profile additionally has a request lifetime shared by arguments, nested native
operations, retained data and returned results. Its existing defaults are 256
identities, 64 KiB per document and 1 MiB total command bytes. Returning one small
page does not permit retaining an unbounded set of filtered-out documents.

The old working-set owner charged first retained originals and changed document
versions to that same lifetime; it did not grant a second independent megabyte
to storage reads. Inspect `logicalDocuments/workingSet.ts` hydration/staging and
`frameworks/cmsTransaction/lifetime.ts` plus `BoundedRequestLifetime.charge`.
Those resource obligations survive removal of the old working set. Its private
128-byte envelope estimate and SQL/compiler bookkeeping do not define the new
core's representation.

## Responsible replacement

The trusted outer host supplies required numeric native limits and an Effect
`chargeRetained(bytes)` callback when it begins the Core native operation. The
callback uses the already-created request lifetime, not another byte counter.
It remains transaction-local and never enters framework operations, stored
metadata, outcomes or the finalized observation packet. Only numeric limits
enter the packet for bounded final validation.

Core owns canonical encoded document measurement and identity reservation.
Charge a newly retained original once, including raw candidates later hidden by
pending changes or residual predicates. Cached reads do not duplicate that
retention charge. Accepted changed versions charge their retained body before
mutating the sole writes/pending owner. Apply the per-document bound before
disclosure. Source read/write accounting still records actual Source work;
native limits do not replace it. Identity absence still consumes an identity.

The CMS callback must consume `lifetime.fromResult(lifetime.charge(bytes))`
before projecting failures: the original Result authenticates a retained full
Cause receipt. Mapping it first would lose that identity. Use complete Cause
mapping at the trusted boundary, preserving typed failures, defects,
interruption and origin annotations. `CoreNativeBudgetError` distinguishes the
known limit/closed/rollback-only outcomes and an unexpected typed refusal;
never relabel an unexpected failure as a normal capacity or closed result.
The native projection preserves the original CMS failure from this trusted
callback. No untrusted caller receives the charging or finalization capability.

## Required proof

Real Local API count/select operations over fewer than 256 large matching rows
must exhaust the shared command budget even when their output is tiny. Prove
arguments and retained rows consume the same counter, caught failures remain
rollback-only, and the body runs once. Cover PGlite and ordinary PostgreSQL,
cached original deduplication, staged-version charges, per-document refusal,
mixed Cause preservation and closure. Direct lower Core tests may inject an
explicit caller budget through the real accounting owner; they do not prove the
CMS lifetime composition. Native DO and complete-request performance remain
separate goal gates.
