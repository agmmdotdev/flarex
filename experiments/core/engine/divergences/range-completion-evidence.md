# Exact range completion and selected-body evidence

Design status: **Selected bounded producer adaptation**.
Implementation status: **Unstarted**.
Measurement status: **No capacity claim**.
Owner: [range-evidence prerequisite](../slices/04a-range-completion-evidence.md).

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[`read_page_from_query`](../../../../../../crates/isolate/src/environment/udf/async_syscall.rs)
stops at page size without consuming N+1. A full final page may conservatively
report `isDone: false`. The
[`IndexRange` operator](../../../../../../crates/database/src/query/index_range.rs)
records consumed range prefixes and complete exhausted intervals. Physical
overfetch/cache coverage is separate from logical consumption and accounting.

Convex's index registry reports old/new keys even when a body update leaves
the key equal; its read-set overlap checks can therefore protect returned bodies
through those index keys. Document-read accounting is not a separate body OCC
dependency. These are source findings, not executed upstream test results.

## Why and how this step differs

Existing Flarex mutation range results expose an exact N+1 completion verdict.
Preserve that supported result rather than silently adopting conservative false.
The storage reader already fetches and validates the extra membership position;
retain it as a separate internal cursor-shaped witness and extend the logical
non-final dependency through its merged N+1 position. Keep public page contents
and continuation unchanged. No extra body load, query or user-document charge
is needed. Full exhaustion still records the entire requested interval.

The current PostgreSQL writer closure is different: an existing selected-body
update can leave ordered membership storage unchanged. Until all applicable
writers and validation logs have a proven equivalent to Convex's same-key key
reporting, retain selected-body point dependencies. Removing them during this
producer correction would permit stale body-dependent mutations. The removal
gate is complete writer/log participation with same-key body regressions, not
the presence of a new pending index map.

The implementation remains at `appIndexEntries.projectRangePage` and the shared
finite/durable `indexedQueries` evidence producers. It reuses
`AppIndexRangeCursorV1`, current suppression/refill, normalization, accounting and
acceptance. The raw lookahead is authenticated membership data, not authority,
a user-visible body or proof of shared-cache coverage.

## Consumers, data and remaining limits

Affected consumers are existing internal range readers and newly executed finite
or durable mutation operations, including borrowed native operations. Current,
historical and batch reader projections share one implementation; synthetic
complete pages carry no lookahead. Read-only Application cache semantics and
native lifecycle/retry profiles remain unchanged.

No schema, saved-receipt format, committed outcome or request identity changes.
Previously saved durable readsets are not repaired on replay; their safe
cutover/disposition remains a parent milestone gate. No data deletion, native
hook replay, production activation or mutation-cache handoff is selected.

Prove genuine producer/writer/acceptance conflicts and unchanged page/accounting
behavior on PGlite and ordinary PostgreSQL. Both required reviewers assess the
connected change. The full incremental pending-index replacement and actual
Standard mutation migration remain unimplemented by this record.
