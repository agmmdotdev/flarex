# Reuse Core policy comparisons and Effect operations

Baseline `80567b909e4eda2272a414e9dd41ffb30aab1d9f`.
The full Product profile at the preceding page-reuse checkpoint found
repeated Effect function creation and calls, plus canonical encodings under
native policy checks. This slice changes these Core owners and remeasures the
complete graph against the same pinned native Medusa runner.

| Owner | Pinned Convex evidence | Selected mechanism |
| --- | --- | --- |
| Native policy and registry | The transaction borrows live registry meaning, records consumed dependencies, and settles against the published suffix and pending writes. | Retain successful pure matches only for issuer-owned definitions and deeply captured stored policies, keyed by exact policy, definition and table name. The ordinary exact comparison and the protected canonical comparison can return early for the same captured object. Different or unissued objects keep their existing comparison. |
| Snapshot, persistence, and schema execution | `DatabaseIndexSnapshot::range_batch` and the pinned persistence reader borrow data and retention at the call boundary. Their methods are static. The physical index scan retains a trace span. | Define history and point-read operations once per owner and bind the selected timestamp. Reuse the PostgreSQL query operation with the acquired client. Forward schema state access through the existing named method. Use lazy internal page implementations with the existing span names and no per-call Effect.fn stack capture at the profiled scan boundaries. |

The independent challenges distinguish immutable policy meaning from authority.
A parsed policy is detached recursively before capture. A frozen outer object
alone proves neither ownership nor immutability. A definition hash, table name,
or namespace alone cannot identify a successful match. Changed, unissued and
distinct policy objects still run their original comparisons where required.
Protected policy comparison retains its intentional schema ID and endpoint
digest normalization. Current epoch, schema proof, table and index selection,
retention, dependency recording and commit validation still run. Native capture
removes one immediate duplicate call because the metadata-read owner checks
the same registry, authority and table before building the read set.

Do not retain an open SQL connection beyond its checkout or freeze the current
native frontier. History floor checks, scoped read snapshot, interrupts, failure
classification, rollback, uncertain acknowledgement and concurrent settlement
remain at the same owners. No stored representation or migration changes.

Validate policy mutation and authority withdrawal witnesses, schema models,
history, driver lifetime and cache tests, and the genuine Product graph on
PGlite and ordinary-role PostgreSQL. Measure the exact local Product workload
in alternating native pairs and profile the final Node path separately.

See [native policy match reuse](../divergences/native-policy-match-reuse.md)
and [Effect hot scan spans](../divergences/core-effect-hot-scan-spans.md).

## Invocation-local native validation lookups

Selected scope: replace repeated index-specification scans in
`nativePolicy.checkNativeTableIndexes` and command-membership scans in
`commerceTransaction/nativeHost.compose`. Keep both implementations at their
existing owners. The connected consumers are ordinary and protected native
operations, the Product facade, and the mixed Application/Product request.

Independent current-owner and pinned-source challenges agree that this is
structural lookup work, not a new authorization cache. The coordinator relays
the peer counterexamples and dispositions before runtime edits. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`
[`IndexRegistry`](https://github.com/get-convex/convex-backend/blob/db914cf06e2b06ee985646611b9e12ed7a770318/crates/indexing/src/index_registry.rs)
keeps enabled and pending indexes distinct;
[`IndexedFields`](https://github.com/get-convex/convex-backend/blob/db914cf06e2b06ee985646611b9e12ed7a770318/crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs)
is ordered, and
[`SchemaRegistry::get_by_state`](https://github.com/get-convex/convex-backend/blob/db914cf06e2b06ee985646611b9e12ed7a770318/crates/database/src/schema_registry.rs)
reads current namespaced schema state and records its dependency. Native
command/policy obligations retain their existing divergence; invocation-local
lookup structures add no new guarantee or mechanism divergence.

Index membership uses the exact name and ordered field specification. Retain
the original expected-list cardinality and compare the actual array length,
so duplicate records cannot disappear through set deduplication. Enabled
membership starts with intrinsic indexes only; custom enabled specifications
come from the active registry selection. Read active, pending and validated
schema state in that order before actual-cardinality refusal. Keep staged-index
refusal and the distinction between candidate existence and active readiness.
Epoch, schema proof, table/tablet and exact index-identity checks remain live.

Commerce membership uses the authorized command subset from every fresh
`initialization.readBinding()` result, matching exact name/mode pairs. Additional
installed commands remain allowed. The writable initializer registration remains
required. Duplicate catalog names must not let a mismatched mode overwrite a
matching pair. Definition-wide commands do not substitute for binding commands.

Focused witnesses cover generation replacement, ordered fields, missing and
unexpected indexes, duplicate cardinality, staged/premature enablement and
fresh schema-read errors; commerce witnesses cover subsets, modes and changed
bindings. Run paired lifecycle/initialization and current Product regressions
on PGlite and ordinary-role PostgreSQL. Compare complete requests using freshly
matched, alternating control/optimized runs with the same frozen dependencies,
warmups, inputs and verification. Earlier variable CPU runs are investigation
evidence, not a causal before/after baseline or full performance acceptance.
