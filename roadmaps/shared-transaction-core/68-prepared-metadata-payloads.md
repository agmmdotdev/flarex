# Prepared Metadata Payloads

Status: implemented under standing core approval. Aggregate host
retention remains open; this does not establish a process memory budget.

## Outcome And Preflight

Reduce the immutable Application bundle retained by readiness preparation to
verified identities, digests, the manifest, and the function count. Discard the
publication byte frames and function rows after verifying them. Keep complete
fresh verification on every acceptance, including replay. This affects the
shared relation-readiness owner used by native, CMS and composite selection;
it changes no durable format or admission authority.

The installation preparation limit currently covers only runtime data. Include
the reference, installation identity, head fingerprint, evidence coordinates
and digests in its existing 8 MiB canonical-payload budget. Encode bigint
coordinates as decimal strings for accounting; this is an internal resource
measurement, not a new persistence codec. Database/target capabilities are
borrowed references and are not traversed or serialized. Canonical payload
bytes are not a measurement of JavaScript heap size.

Full retained publication rows are unnecessary: bundle comparison uses digests
and identities, and function rows are used only for their verified count after
validation. Keeping those rows duplicates bytes without strengthening fresh
verification. Replacing fresh verification with cached digests would weaken the
integrity contract and is rejected.

## Break, Validation And Cleanup

Installations whose complete retained payload exceeds the existing limit now
fail construction with the existing resource failure before issuing a token,
even if runtime data alone fits. No adapter limit bypass or automatic refresh.
No data deletion or schema migration.

Exercise warm Application publication/function corruption without changing its
stored digest through actual CMS reads, mutations and replay, then restore and
reuse the same host. Preserve installation tamper and cancellation witnesses.
Run fast and ordinary-role PostgreSQL lanes, affected typechecks/lint and both
reviewers. Remove the unused full-row copies and row-array types.

## Remaining Lifetime Gate

This bounds the installation payload and removes redundant Application bytes.
It does not bound aggregate hosts, all Application preparation state, or
request-time allocations. A shared budget with deterministic release must cover
opaque definition/relation/unique preparations and host multiplicity. Do not
count garbage collection as release or report this slice as package-2 completion.
