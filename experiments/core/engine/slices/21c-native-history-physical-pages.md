# Bounded physical pages for native retained history

Status: **Independent current-core, accepted-direction and pinned-source challenge
reconciled. Physical reader, ordered index and data-preserving upgrade are
implemented with paired reader/upgrade and focused ordinary-role plan proof;
selected connected acceptance and renewed review are complete. Managed hosting,
production cutover and wider full-goal gates remain open.**

This corrects the physical prerequisite of [native restoration](./21b-native-recorded-row-restoration.md).
Baseline is `d31c5df21ea79ba63e25dc4e1d9814361396611a`; Convex pin is
`db914cf06e2b06ee985646611b9e12ed7a770318`. The full rewrite remains active.

## Challenge and selected mechanism

The current ordered index ends at `(instance,index,prefix,sha)`, while history
orders `(prefix,sha,ts)` before `LIMIT`. Many versions of one complete key can
require an unbounded sort before a small page. Merely appending `ts` does not
bound work across keys with no versions inside the requested time window.

The pinned PostgreSQL schema, `sql.rs:154-164`, already tolerates the older
timestamp-bearing secondary. Its snapshot `DISTINCT ON` and long-prefix group
buffer are not bounded all-version history mechanisms. Accepted storage also
states that `LIMIT` is not a scanned-work bound.

Select the timestamp-bearing ordered secondary and take at most B **physical**
headers before timestamp eligibility. The physical CTE uses only instance/index,
coarse key bounds and the exclusive actual tuple cursor. Charge every selected
header/key, including collisions, tombstones and out-of-window versions. Hydrate
only eligible live revisions at their exact timestamps; legitimately retired
ineligible anchors must not cause corruption. Return eligible entries and the
last actual physical tuple, including an out-of-window timestamp. Empty entries
with positive examined work and an advancing cursor are valid pages.

Keep the strict B-row physical cap, existing root accounting/bytes/deadline,
canonical key/digest/table/anchor checks, live retention guards and one settlement.
Add no history table, history-read SQL transaction, synthetic cursor or new budget.
Outer sorting/window work is bounded by B; actual PostgreSQL plans must establish
the selected access path without forced-plan hints. No latency/scale claim follows
from schema shape alone.

Two existing-index seeks were considered. Correct key discovery must omit the
time filter and count empty discoveries. At B=1 the existing cursor cannot also
represent an unconsumed timestamp-zero version without an extra phase or probe
allowance. That changes more reader/resource semantics than the selected design.

## Existing installations and ownership

This is platform maintenance, separate from logical app schema installation.
Preserve all documents, index versions, leases and outcomes. Recognize the exact
old physical baseline, drain actual runtime/SQL work, replace the shorter index,
verify the new layout and advance metadata transactionally. Unknown layouts fail
closed. Retain no redundant shorter index or reset fallback.

Lease fencing alone is not SQL drain: taking the lease lock before index DDL can
deadlock with a materializing writer waiting for its final lease share lock.
Keep the maintenance owner's lock order and explicit closed/drained precondition;
prove refusal/rollback when it is not satisfied. Lost acknowledgement must reopen
and recognize the single actual resulting layout.

Root owns plans, resources and acceptance. The schema/install worker owns the
physical definition, baseline recognition, migration and generated artifacts.
The restoration worker owns history transport/contracts and eligible hydration.
The independent proof worker owns physical-page witnesses. Exact path reservations
and shared-file handoffs precede edits. Reviewers remain read-only.

## Gates

- Actual paired REDs for pre-limit time filtering; no fabricated persistence rows.
- Duplicate-heavy unchanged keys and many time-ineligible keys, including B=1,
  continuation, long-prefix collisions, suffix/digest and anchor corruption.
- Ordinary-role PostgreSQL plans showing bounded physical selection; PGlite
  behavior is separate evidence.
- Exact old-target upgrade preserving row bytes, rejected unknown/drifting layout,
  actual SQL drain/fence races, atomic rollback and uncertain-outcome recovery.
- Existing-target and fresh-target loading, affected Core/native consumers,
  source/artifact/type/lint gates and both project reviews after corrections.
