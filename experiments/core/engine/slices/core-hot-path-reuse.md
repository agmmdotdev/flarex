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
