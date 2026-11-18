# Live table mapping across the Worker boundary

Design status: **Accepted necessary Worker transport adaptation**.
Implementation status: **Fresh Worker mapping and ID normalization implemented**.
Measurement status: **Fresh Worker and controlled DO reconstruction validated locally; wider native/managed/capacity gates remain open**.

The [shared schema slice](../slices/07-shared-schema-lifecycle.md) owns this
adaptation. Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` binds isolate
syscalls directly to the namespaced transaction table mapping. A schema or
manifest is not the runtime table-access whitelist. Missing-table reads,
implicit creation and synchronous ID normalization use that mapping, recording
its metadata dependencies.

Flarex's untrusted Worker reaches the trusted app owner through asynchronous
RPC. It cannot synchronously fetch a new mapping for normalizeId. Capture the
transaction's accessible non-system table map at invocation start, with the
source full `_tables.ById` dependency. Fresh point reads pass the ID to the
engine for namespaced resolution; an absent table number returns None.

Use a narrow insert result carrying the trusted table binding on success or
catchable document validation. Update the private Worker map before returning
the ID or throwing the catchable validation error. Root and nested functions
share the actual Worker/map, so no extra child RPC or full-map envelope on every
read is needed. This preserves source behavior when a caught invalid insertion
leaves an empty table. Other failures retain full-Cause/root-poison semantics.

The map carries no installation/commit authority. Private namespaces and future
native writer/exposure policy remain engine-enforced. Native tables cannot be
made public merely by removing the old manifest whitelist. Legacy transport
remains only for named old consumers until their connected migration.

Prove omitted-table access, missing default scan versus explicit-index errors,
unknown-ID None, valid and caught-invalid implicit insertion, nested creation,
ID normalization, scope isolation and unchanged supported error behavior through
real Worker calls. Both database lanes and actual DO reconstruction are required.

The insert bridge detaches the existing native RPC disposal metadata before its
strict protocol decoder. Catchable refusals define their own Error name after
intrinsic hardening; malformed frames retain terminal boundary behavior. The
separate [Effect initialization record](./worker-effect-stack-trace.md) owns the
earlier immutable stack-trace-limit setup required by the installed library.