# Native duplicate requests within one owner

Status: **Challenged bounded replacement implemented with paired owner and
genuine duplicate/recovery consumer proof; broader hosting remains gated.**
Owner: [ordinary atomic workflows](../slices/17-native-atomic-workflows-and-tax.md).

## Source mechanism and existing obligation

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/model/src/session_requests/mod.rs` performs an authenticated indexed
session/request read that joins transaction dependencies, then records a committed
result through system metadata. `application_function_runner/mod.rs` checks that
result before executing again. Its deterministic UDF retry and sync worker's
session queue do not authorize retrying native hooks or serializing all ordinary
native requests.

The old ordinary native host waited on a database request-key lock. Existing
Product composition/lifecycle consumers require two concurrent same-key/same-args
callers to receive the same complete success with one native child execution.
Core claim/recovery correctly treats an in-flight request as busy. Keep that
authority boundary; replace old lock-held callback execution at the app/profile
owner rather than weakening busy claims or starting a second transaction.

## Selected replacement

Associate current join slots with the actual Core application owner. Leaders
and followers enter the existing owner's request admission before accessing a
slot, so its configured request bound covers both. The private owner-identity
association creates no singleton authority, timer, second capacity, durable
receipt or completed-result cache. Slots exist only during actual admitted uses.

Index by request key and compare the complete issued root identity and request
hash. Changed arguments, command or profile fail closed; another actual owner
cannot join this owner's slot. Different keys remain parallel and retain default
OCC, including both-hooks-enter/one-winner witnesses.

The leader owns the only body/claim and its actual borrow through native drainage.
Followers await its complete Exit. Follower interruption/timeout detaches that
follower without canceling the leader. Leader failure, defect or interruption
propagates without follower promotion or implicit body replay. Existing explicit
new-call retry after authenticated proven noncommit retains its accepted
[native retry contract](./native-proven-noncommit-retry.md). Delete a slot only
if it is still that leader's current slot; retain no completed result there.
PostgreSQL/Core outcomes remain the durable authority. Preserve caller ownership
of complete successful JSON values when serving multiple callers.

Capture request arguments once under actual owner admission through the selected
profile's byte budget, before hashing or a native await. Do not copy arguments
at unstarted Effect construction under a broader global ceiling: those extra
copies would escape the actual request bound. The public workflow adapter keeps
its own boundary capture. The issued immutable token contains owned arguments/
correlation, not a database binding, callback,
live host, generation or finalizer. Exact reconstructed profiles can validate it.
Join and uncertain-outcome lookup use the captured correlation; they must not
rehash caller-owned arguments that changed during a hook. Recovery exits the old
borrow, reconstructs through the existing owner and performs lookup only. Full
mixed Causes remain intact; a sole expected uncertain result is not a retry loop.

Likewise capture a static native host profile once through the production
configuration owner. Generation reconstruction injects fresh database/runtime
resources into that same immutable profile. A fixture must not clone/reimplement
capture or recapture the caller's mutable composition after a lost acknowledgement.
Opaque source selectors remain portable semantic data resolved against the
current trusted host's local whitelist, not foreign live bindings.

## Required proof

Use actual native hosts and existing Product duplicate/explicit-retry consumers,
plus neutral same-key success, changed args/command/profile, foreign owner/epoch,
different-key concurrency, follower cancellation/timeout, leader complete failure,
stale cleanup and capacity cases. Exercise actual final-write ACK loss while
mutating original caller arguments and composition, then return the original full
DTO with one hook and callback-free lookup. Preserve current Core busy/unknown
tests. Run both database lanes; host lifecycle changes still require their actual
host proofs. No generic native replay, all-scope queue or new persistence family
is introduced.

The [native request owner](../../../../packages/persistence-postgres/src/frameworks/atomicCommerce/nativeRequest.ts)
captures correlation and owns exact live joins. The
[native owner host](../../../../packages/persistence-postgres/src/frameworks/atomicCommerce/nativeOwnerHost.ts)
admits both callers through the existing app owner, then reconstructs only for
lookup-only uncertain-outcome recovery. Immutable static profile capture stays
with the existing configuration owner; PostgreSQL outcomes remain authoritative.
