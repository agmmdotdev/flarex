# Task Mechanism Divergences

Status: **first source adaptations recorded; runtime mapping under refinement**.
The [workflow](../WORKFLOW.md) requires a focused Markdown record for every
necessary departure from adopted Trigger lifecycle or pinned Convex database
mechanisms before affected implementation. The accepted independent fork permits
changes; a record explains their correctness rather than treating source
similarity or infrastructure convenience as proof.

Each record names source revision/files/symbols, original mechanism, replacement,
necessary reason, affected consumers/data, preserved or changed guarantees,
concurrency/failure cases, validation and displaced code. Distinguish accepted
design, proposed contract, implemented behavior and measured evidence.

Shared-core divergences also follow the existing
[core divergence owner](../../../experiments/core/engine/divergences/README.md)
under AGENTS.md. Link the responsible record instead of creating competing
authority. No runtime adaptation is admitted merely by listing it here.

| Record | Necessary adaptation |
| --- | --- |
| [System logical installation experiment](../../../experiments/core/engine/divergences/system-logical-schema-installation.md) | Checkpointed current-code contract, superseded as a target implementation; retain authority/readiness witnesses and re-select against translated bootstrap/persistence |
| [Transactions and effects](./trigger-transactions-and-effects.md) | Replace Redis outer-lock assumptions and pre-settlement publication with authoritative borrowed operations and durable intents |
| [Ownership and heartbeats](./trigger-ownership-and-heartbeats.md) | Preserve live fence/subject/lease checks while replacing Redis ownership and heartbeat scheduling |
| [Native checkpoints](./trigger-native-checkpoints.md) | Map process checkpoints to admitted native serialized waits, original deadlines and winner receipts |
| [Post-settlement refusals](./trigger-post-settlement-refusals.md) | Preserve the source's max-attempt terminalization before exposing its expected refused-start outcome |
