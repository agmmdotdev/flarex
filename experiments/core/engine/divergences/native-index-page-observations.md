# Native index page observations

Status: **Selected Currency page requirement implemented through the shared
native index/observation owners; broader page profiles and hosting remain gated.**

## Source mechanism

At Convex `db914cf06e2b06ee985646611b9e12ed7a770318`,
`transaction_index.rs` range prefetch does not itself record semantic reads.
The consuming `query/index_range.rs` owner records the consumed prefix through
the last key, and the remaining interval only when EOF is observed. Buffer/cache
coverage does not establish a dependency. The translated `query.ts` and
`indexSnapshot.ts` retain that distinction.

## Necessary native difference

The selected Currency default ascending list uses the old native owner's index
page operation. It consumes bounded physical windows, with minimum batch 16
and target `offset + take + 1`, before returning its projected page. All examined
window entries are remembered bodies and membership, including logical
lookahead. A physical extra guard beyond the window establishes non-EOF and
counts toward examined capacity, but its identity/body is not retained. Each
page call recaptures membership; remembered earlier bodies retain their revision,
and incompatible fresh revision/key evidence fails immediately. There is no
page-result memo. A page is not a complete-table capture
and does not pre-observe every code unique slot.

These are required native candidate/resource and visibility semantics. Using
the existing complete native interval capture followed by array slicing would
observe records beyond the window, introducing conflicts and capacity failures.
Observing only the final returned `take` rows would drop dependencies on examined
candidates. Neither is equivalent to the executing native owner.
The per-call examined bound includes pending candidates, window entries and
non-EOF guards. It is separate from deduplicated retained identity capacity.

## Product list consumer

Owner-selected. A plain Product list with no total, no relation filter and only
the active-row predicate reads a page in `id` or `created_at` order, ascending or
descending, when no read receipt observes the call. Every other read keeps the
complete path: `listAndCount`, relation filters, `q`, multi-selection, `handle`
order and workflow-internal reads.

A descending page mirrors the ascending owner: the observed interval runs from the
last examined key to the end of the range, and an insert below it does not conflict.
Convex has no OFFSET, no lookahead and returns `SplitRequired`. Here the skipped
prefix and lookahead are examined and observed, the 16-row minimum window stays, and
reaching the examined bound refuses rather than returning a short page. A soft-deleted
row is a residual and counts toward that bound.

## Translation boundary

Use the same Core index snapshot, native observation state, pending overlay and
acceptance owners. Reuse Source consumed-prefix/EOF interval construction for
the native owner's actually examined window. Retain that window's stable index
membership and original body revisions; a non-EOF physical guard is not another
remembered original. Do not use the ordinary Application fixed-snapshot scanner
as a replacement for current-first native observations.

Currency membership predicates already lower through per-code unique slots.
Keep those separate from ordinary page capture. After an ordinary page remembers
a body, a first scalar code lookup detects an incompatible current owner revision
at that document checkpoint. A repeated scalar/code-list slot retains its prior
body and validates at settlement. `listAndCount` performs its separate count
observation in the same root.

## Proof

Cover a competitor beyond the observed prefix, changes to examined logical
lookahead, non-EOF guard changes, EOF/phantoms, pending overlay, repeated windows,
first unique coherence, selective dependency/accounting and source identity
limits. The default query limit 256 does not increase this profile's Currency
capture capacity 128. Prove PGlite and ordinary PostgreSQL separately before
claiming broader Currency list parity. The selected actual native page/count
consumers use this mechanism; arbitrary native page grammars remain unadmitted.
