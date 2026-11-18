# Native declared equality indexes

Status: **Required representation correction implemented after independent
challenge and actual neutral failure. Paired owner, complete selected consumer
and connected proofs are complete; wider lifecycle gates remain open.**

Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.
The [shared prerequisite](../slices/20a-native-declared-equality-indexes.md) owns
the exact source map, ownership and completion gates.

Native relational definitions authenticate `textEquality`: one unconditional
text column, including nullable values. Convex describes ordinary field indexes
directly. Skipping the native declaration loses admitted selective history;
Inventory Line Item history, Sales Channel names and ShippingProfile types expose
the mismatch. They require no new Source index or search algorithm.

Extend the existing [native relational query mapping](./native-relational-query-plans.md)
through the shared schema lowerer. After existing paths, lower declared equality
to a nonunique ordinary Source index, retaining native IDs and existing physical
descriptors. Exact-field aliases reuse coverage; conflicting synthetic IDs fail
closed. Preserve null entries, prefix/EOF observations, pending overlays and
normal conflict checks.

The translation adds no FK, quantity constraint, text range/search, JSON access
or native method. Existing grammar/profile policy stays authoritative. Reuse the
same schema/index lifecycle and five physical tables. No producer workaround,
adapter SQL, extra transaction/lifetime, raised bound or fallback is justified.

Affected metadata and stored proofs retain existing authentication/hash framing.
Compare actual affected bytes, refuse old omitted-index proofs and preserve
unaffected producers. Runtime/populated-data claims need their own evidence;
the neutral actual failing witness precedes implementation.
