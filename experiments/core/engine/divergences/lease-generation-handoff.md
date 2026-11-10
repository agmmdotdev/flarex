# Persisted lease generations for cross-runtime handoff

Status: **Bounded implementation, paired owner proof and serialized actual
Workerd/consumer acceptance complete.**
Owner: [lease handoff slice](../slices/16c-lease-generation-handoff.md).
Pinned Convex: db914cf06e2b06ee985646611b9e12ed7a770318.

## Source and required difference

Pinned Lease::acquire proposes epoch nanoseconds from Rust SystemTime and updates
leases only when stored < proposed and read_only is absent. The current port uses
Effect's runtime-local anchored clock. Separate Node/Workerd clocks are not a
persistence-owned total order; serial legitimate successors must not fail because
those host proposals collide or decrease. The retained failure proves acquisition
refusal, but its exact clock values/cause were not recorded.

Use one persisted predecessor observation T and checked T+1 with one CAS against
exact T and the existing read_only predicate. Never retry/reobserve a missed CAS.
Old timestamp-shaped stored values remain valid predecessors; no reset/migration
or extra physical family is needed. Saturation or malformed persisted state fails
closed. Unknown acknowledgement returns no capability and requires explicit fresh
construction. Remove obsolete host-clock proposal injection and migrate callers.

This deliberately changes arbitration: contenders observing the same predecessor
have one winner, whereas increasing source timestamps can admit successive
acquisitions. A contender paused after observing old T cannot displace its
successor. An attempt that first reads after the successor may still acquire;
neither this CAS nor source wall time establishes canonical host authority.

## Preserved authority and limits

Keep identity-confined issued capabilities, permanently lost old handles,
initial/final exact equality checks, final FOR SHARE lock through commit and
all write/global/backfill fences. Keep fresh bootstrap/resynchronization and
uncertain-write/outcome reconciliation. No expiry, renewal, close-time release,
ABA-producing reset, unconditional increment, retry, or adapter clock repair.
Read-only remains acquisition admission, not retroactive write revocation. A
concurrent marker insertion has only the executing SQL predicate's existing
snapshot semantics; no stronger barrier is claimed.

Supported canonical hosts must retire/drain pending opens/recovery and writes
before a successor starts. Scoped owner recovery remains supported; general
managed stale-host election/replacement is not established. Controlled serial
Node/Workerd fixture handoffs meet this boundary. Wider routing gates remain in
[single-app-owner routing](./single-app-owner-routing.md).

## Proof and reassessment

The owning slice requires independent challenges, controlled old-owner failures,
paired driver race/fence/uncertainty/maintenance witnesses and actual Workerd
recreation. Paired neutral persistence, bootstrap, maintenance and app-owner witnesses are
complete. Actual serialized Node/Workerd reconstruction and the original Option
deletion and Variant/Inventory consumers pass with persisted-generation phase
diagnostics; close and disposal do not advance or reset the token. This remains
a bounded canonical-handoff proof. Reassess if managed host
eligibility, multi-owner arbitration, lease expiry or distributed routing changes;
this mechanism alone cannot supply those authorities.
