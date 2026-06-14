# Cross-Shard Workflows

## Current Decision

Normal `mutation` must be single-shard. Cross-shard writes must be explicit
`workflowMutation` operations.

Cloudflare Workflows can coordinate durable steps, but this is not the same as
Convex's single atomic mutation over one deployment database.

## Intended Model

- Detect affected partitions.
- Group operations by partition.
- Run one durable step per partition.
- Make failures and compensation explicit.
- Type-level and runtime checks should reject accidental cross-shard writes in
  normal mutations.

## Convex References

- `crates/application/src/application_function_runner/mod.rs`
  Mutation execution and OCC retry behavior.
- `crates/database/src/committer.rs`
  Single-transaction commit semantics.
- `crates/database/src/database.rs`
  OCC retries around database transactions.

## Cloudflare Difference

Convex can retry and commit a mutation against one deployment database. Flarex
cannot provide hidden atomicity across many Durable Objects. Workflows provide
durability and sequencing, not transparent global serializability.

## Known Limitations

- No Workflow integration exists yet.
- No generated type-level cross-shard enforcement exists yet.
- No compensation API exists yet.

## Last Update

Recorded the rule that cross-shard writes are explicit workflow semantics, not
hidden normal mutation behavior.
