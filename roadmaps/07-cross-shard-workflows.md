# Cross-Shard Workflows And Atomic Mutations

## Current Decision

Normal `mutation` must be single-shard. Cross-shard writes must be explicit
operations.

Flarex should eventually expose two explicit cross-shard layers:

- `atomicMutation` for small, bounded, declared shard sets that need real
  all-or-nothing commit.
- `workflowMutation` for large, unbounded, or long-running cross-shard work
  that needs durable retries and compensation but is not one atomic database
  transaction.

Cloudflare Workflows can coordinate durable steps, but this is not the same as
Convex's single atomic mutation over one deployment database.

## Intended Model

### `workflowMutation`

- Detect affected partitions.
- Group operations by partition.
- Run one durable step per partition.
- Make failures and compensation explicit.
- Type-level and runtime checks should reject accidental cross-shard writes in
  normal mutations.

### `atomicMutation`

`atomicMutation` is a future bounded multi-shard transaction API. It should not
be implemented until the current single-shard `mutation` path is hardened.

Candidate developer API:

```ts
export const transferPoints = atomicMutation({
  args: {
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    amount: v.number(),
  },

  shards: args => [args.fromUserId, args.toUserId],

  handler: async (ctx, args) => {
    const from = await ctx.db.get(args.fromUserId);
    const to = await ctx.db.get(args.toUserId);

    if (from.points < args.amount) throw new Error("Insufficient points");

    await ctx.db.patch(args.fromUserId, { points: from.points - args.amount });
    await ctx.db.patch(args.toUserId, { points: to.points + args.amount });
  },
});
```

Required implementation shape:

1. Developer declares all participant shards up front.
2. Backend sorts shard keys deterministically.
3. A `TransactionCoordinatorDO` opens participant sessions against each
   `PartitionDO`.
4. User-code DB syscalls route through the coordinator and can only touch the
   declared shard set.
5. Participant shards stage writes and validate read sets.
6. Coordinator asks each participant to prepare.
7. If all prepare succeeds, coordinator commits all participants.
8. If any prepare fails, coordinator aborts all participants.
9. Durable coordinator state and alarms recover in-doubt transactions after a
   crash.

This layer needs hard product limits:

- small maximum shard count, likely 8 or 16
- declared shards only, no dynamic shard discovery inside the handler
- short execution timeout
- bounded reads/writes per shard
- no external fetches or side effects during the atomic section
- idempotency required for retrying the coordinator protocol
- clear `AtomicConflictError` / `AtomicRouteError` style failures

Concurrency behavior:

- If two `atomicMutation`s touch disjoint shard sets, they can proceed
  independently.
- If they touch the same shard or same documents, participant `PartitionDO`s
  serialize prepare decisions and reject conflicting prepared/read sets.
- The client or platform retry loop can retry `AtomicConflictError`, but the
  DX must make the higher latency and contention risk visible.

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

`atomicMutation` would be Flarex-specific. Convex does not need a
developer-visible coordinator API because Convex mutations already execute
against one logical transactional database. Flarex would need an explicit
coordinator because each `PartitionDO` owns only its local shard.

## Known Limitations

- No Workflow integration exists yet.
- No `atomicMutation` implementation exists yet.
- No `TransactionCoordinatorDO` exists yet.
- No participant prepare/commit/abort protocol exists yet.
- No prepared transaction table or recovery alarm exists yet.
- No generated type-level distinction exists between `mutation`,
  `atomicMutation`, and `workflowMutation`.
- No generated type-level cross-shard enforcement exists yet.
- No compensation API exists yet.
- Single-shard `mutation` hardening remains the immediate priority.

## Last Update

Recorded future `atomicMutation` as a bounded multi-shard atomic layer and
explicitly deferred it until the single-shard transaction path is hardened.

Checkpoint title: `Document atomicMutation as future layer`

Previous completed checkpoint: `ea69fc5` Enforce partitionBy field ownership.

What changed:

- Kept normal `mutation` single-shard.
- Split future cross-shard APIs into `atomicMutation` and `workflowMutation`.
- Documented that `atomicMutation` requires declared shards, a
  `TransactionCoordinatorDO`, participant prepare/commit/abort, durable
  recovery, idempotency, and hard shard/read/write limits.
- Documented expected concurrency behavior under disjoint shard sets and
  contended shard sets.
- Marked single-shard hardening as the immediate priority before implementing
  cross-shard atomicity.

Convex references:

- `crates/database/src/committer.rs`
  - Convex commit validation is the semantic target for all-or-nothing writes.
- `crates/database/src/database.rs`
  - Convex OCC retry behavior inspires retryable conflict handling.
- `crates/application/src/application_function_runner/mod.rs`
  - Convex function execution remains the developer mental model, but Flarex
    must expose a different API when multiple Durable Objects participate.

Cloudflare difference:

- Convex does not need a visible multi-shard coordinator API. Flarex would need
  one because Durable Object storage is authoritative only inside one object.

Verification:

```sh
git diff --check
```

## Previous Update

Recorded the rule that cross-shard writes are explicit workflow semantics, not
hidden normal mutation behavior.
