# Native non-null index backing

Status: **Implemented and validated for the selected Order Change source.**

The pinned native Order models declare PostgreSQL nonunique partial B-tree
indexes for `field IS NOT NULL` and `deleted_at IS NULL AND field IS NOT NULL`.
Their authenticated declarations include the original names, ordered keys and
predicates. Convex's ordinary PostgreSQL persistence records all keys through the
versioned `indexes` table. Its sort order and exclusive range start above null
already express the selective interval without a partial-index storage mechanism.

Lower the admitted single-key declarations to full ordinary indexes on the key
or a fixed null column followed by the key. Keep the predicate identity in the
native binding. Resolve existing bindings first and alias exact field lists to
their original backing. Allocate a separate backing for each novel field list.
Exclude guarded bindings from unconditional native page and historical FK/reverse
admission. Complete reads use their actual bounded selection and residual
evaluation. Named pages on backings owned only by new guarded bindings remain
unadmitted. Physical writes, snapshots, pending overlays and conflict history
stay with the same index owner. Unique non-null predicates, serial allocation
and arbitrary SQL predicates retain their separate admission gates.

The [prerequisite](../slices/25a-native-non-null-indexes.md) owns the neutral
interval, lifecycle, authority and real Order producer proof.
