# Native read decoding

Status **Implemented.** Flarex baseline `49528a1f1`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism: [reuse of issued document roots](../divergences/issued-document-reuse.md),
extended to decoded stored documents. No other Convex mechanism changes.

## Measured reason

A native Product list page spent about 30% of its CPU turning fetched rows into
documents and about 8% selecting metadata reads.

| Cost | Cause |
| --- | --- |
| JSON to document | One `Result.gen` generator per JSON node. |
| Second document walk | `readDocumentObject` and `populate` captured the decoded document again. |
| Developer ID decoding | Once per index for the same document. |
| Metadata reads | Recomputed on every native capture for the same registry and authority. |

## Changes

| Change | Owner |
| --- | --- |
| Plain recursion; refusals thrown to the decode boundary, same reasons and order | `fromJson` in `flarex-protocol/src/document-value.ts` |
| Decoded root without a binary leaf is proven at once | `decodeDocumentValue` |
| Shape check bounded by the size measured at issuance | `capture` |
| Last proven developer ID kept | `decodeKeyId` in `flarex-protocol/src/index-key.ts` |
| Successful selection kept per registry, frozen authority and table; selective authorities excluded | `coreNativeMetadataReads` in `persistence-postgres/src/core/nativePolicy.ts` |

Registries are copy-on-write, so revocation and schema change always arrive as a new
registry object. A mutable authority is recomputed every time, as the existing
verified-authority memo does. System-field, nesting and underscore-field checks in
`captureCoreDocument` still run on every call.

## Independent review

Two read-only reviewers inspected the diff against current Core and the committed
divergence record. Neither found a behaviour change.

| Finding | Outcome |
| --- | --- |
| A selective authority's reads also depend on the registry's separately recorded schema proof | Selective authorities are excluded from the kept selections. |
| The divergence record said issuance alone is never proof | Record updated: a decoded tree is this module's own and holds no foreign leaf. |
| Missing tests | Added for kept selections and revocation, decoded-root identity, binary copies, refusal order and the kept developer ID. |

## Measured outcome

Ordinary-role PostgreSQL, one local host, 200-product catalogue, one caller. Medians of
three alternating rounds against a clean baseline clone, 100 operations each. Measured
before selective authorities were excluded, which affects only the create row.

| Operation | CPU per operation | Median latency |
| --- | --- | --- |
| Retrieve | 11.0 → 7.8 ms | 23.6 → 16.3 ms |
| List by IDs | 39.3 → 26.0 ms | 45.6 → 32.5 ms |
| List page | 46.6 → 31.2 ms | 54.4 → 38.2 ms |
| List recent | 46.6 → 30.6 ms | 49.3 → 38.2 ms |
| Search | 46.4 → 31.2 ms | 48.9 → 32.7 ms |
| Product create | 62.3 → 55.3 ms | 92.8 → 89.6 ms |

Round trips did not change. Native Medusa on the same host needs about 0.5–20 ms of
CPU for these reads, so a large gap remains. Each request still fetches and decodes
its rows again; a decoded-revision cache shared across requests is a separate design.


## Decode once per request

Baseline `4dd219735`. Mechanism:
[decoded document handoff](../divergences/decoded-document-handoff.md).

A fetched row was decoded twice in one request: by the fill that derives its index keys
and by the observation that reads it. An independent challenge rejected a process-wide
decoded cache and selected a handoff inside the transaction.

Same host and catalogue, minimum of three alternating rounds (medians were disturbed by
other load on the host):

| Operation | CPU per operation |
| --- | --- |
| Retrieve | 7.6 → 7.0 ms |
| List by IDs | 27.5 → 26.3 ms |
| List page | 31.5 → 28.6 ms |
| List recent | 31.6 → 27.0 ms |
| Search | 32.0 → 26.7 ms |
