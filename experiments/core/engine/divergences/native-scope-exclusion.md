# Native scope exclusion

Status: **Required native adaptation implemented with paired owner and genuine
native and complete selected consumer proof; wider hosting gates remain.**

The [scope-exclusion prerequisite](../slices/19a-native-scope-exclusion.md) owns
execution scope, owner mechanism and completion gates.
Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Why this differs

Convex uses parallel snapshot bodies, commit-time validation and ordinary handler
retries. That preserves OCC but does not serialize native callbacks. Admitted
Inventory reservation/adjustment workflows require exclusion through their
genuine composed Locking resource; native callbacks cannot be replayed to supply it.

Select exclusion before admission/body entry, hold it through settlement and bind
it to request identity and live authenticated root/borrowed contexts. Distinct
scopes are independent. Ordinary bodies remain concurrent while competing writer
settlement waits. An original Item-deletion race requires that exact boundary.

Legacy supplied a scope-clock SQL lock held across native execution. The target
forbids that long transaction. Dropping the mode, using only commit serialization
or serializing every ordinary body would change the accepted guarantee.

## Translation boundary

Use existing trusted Core database/kernel, committer and app-generation owners,
bound to actual namespace and lease generation. Protect selected callback entry
and competing acceptance through settlement. Reconcile accepted persistence work
before exclusive entry without draining ordinary bodies. Keep Source ordering
mutexes short; reuse native lifetime, Promise drain, terminal stop and whole-
generation outcome recovery.

The global fence has compatible native and global-publication groups. Selected
callbacks in different namespaces may overlap, and global publications may
overlap with each other; opposite groups exclude each other with fair admission.
Ordinary settlement takes only namespace protection. Source's exact metadata
reads, accepted-prefix validation, concurrent saves and registry-delta publication
retain their existing authority. A universal global writer lock would introduce
unnecessary serialization and deadlock the independent metadata-save witness.

The selected settlement-permit mechanism has paired implementation proof. Accepted saves
own protection beyond caller interruption; terminal failure must close/fence the
generation before release can enable more callbacks. No fabricated evidence,
caller-flag authority, host-local mutex, long SQL transaction, item-key narrowing,
callback replay or second recovery authority is allowed.

## Proof and limits

Prove callback serialization, concurrent ordinary bodies with fenced settlement,
original deletion races, genuine reservation outcomes, scope/context isolation,
identity, cancellation/drain, accepted-unsaved writes, generation fencing and
uncertain-ACK recovery on both database lanes. Populated migration,
native deployment and performance remain unproved. The five-table physical
starting point stays unchanged; arbitrary Locking providers and Task support are
not established by this adaptation.
