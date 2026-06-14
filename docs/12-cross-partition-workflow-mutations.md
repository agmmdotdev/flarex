# Cross-Partition Workflow Mutations

Cross-partition operations are implemented as one Cloudflare Workflow per
developer function invocation. Individual database operations are staged and
grouped by partition. Each affected partition becomes one atomic Workflow step.

The developer does not manually write `step.do()` calls.

## Core Contract

```txt
mutation
  one partition
  fully atomic
  no intermediate visibility

workflowMutation
  multiple partitions allowed
  one automatically generated Workflow
  one atomic step per affected partition
  durable retries and compensation
  intermediate cross-partition states may be visible
```

Cloudflare Workflows provide durable execution, persisted step results,
automatic retries, and rollback handlers. They do not make separate Durable
Object transactions globally atomic.

## Developer API

```ts
export const rewardUsers = workflowMutation({
  args: {
    userIds: v.array(v.id("users")),
  },

  handler: async (ctx, args) => {
    await Promise.all(
      args.userIds.map(userId =>
        ctx.db.patch(userId, { rewarded: true }),
      ),
    );
  },
});
```

The developer writes ordinary loops, maps, and `Promise.all`.

## Behind The Scenes

Execution planning:

```txt
invoke rewardUsers
  -> run handler in planning/staging mode
  -> resolve each write to a partition
  -> group writes by partition
  -> create deterministic Workflow plan
```

Generated plan:

```txt
Workflow rewardUsers:<invocation-id>
  Step commit-users-A
    patch user A

  Step commit-users-B
    patch user B

  Step commit-users-C
    patch user C
```

If the function writes multiple documents in one partition, they remain one
step and one local atomic transaction:

```txt
Step commit-users-A
  patch user A
  insert reward log A
  insert notification A
```

Independent partition steps may run concurrently.

## Why Not One Step Per Database Operation

Do not translate every `get`, `patch`, or `insert` into a Workflow step.

Per-operation steps would:

- expose partial state inside one partition
- make read-your-own-writes difficult
- persist stale read results across retries
- dramatically increase latency and cost
- turn loops into hundreds of durable checkpoints

The correct granularity is one atomic step per affected partition.

## Cross-Partition Reads

A workflow mutation may read multiple partitions, but global snapshot
consistency is not guaranteed.

Example:

```ts
const alice = await ctx.db.get(args.aliceId);
const bob = await ctx.db.get(args.bobId);

if (alice.balance + bob.balance >= 100) {
  // Cross-partition invariant.
}
```

Each partition can validate that its own data has not changed before its step
commits. The combined condition cannot be made globally atomic without a global
transaction engine.

The platform should warn when workflow logic derives one invariant from
multiple authoritative partitions.

## Compensation

If later steps fail, completed steps can run compensation in reverse order:

```txt
commit users:A succeeds
commit users:B fails permanently
rollback users:A runs
```

Automatic compensation can capture previous values and issue conditional
restores:

```ts
type CompensationWrite = {
  documentId: string;
  expectedWorkflowVersion: string;
  restoreValue: unknown;
};
```

Conditional restore is essential. Another mutation may have changed the
document after the workflow step. Blindly restoring old state could overwrite
valid newer work.

## Compensation Limits

Compensation is not rollback:

- intermediate state may have been observed
- compensation can fail
- external side effects may not be reversible
- another mutation may prevent conditional restore
- business meaning may make reversal invalid

Expose workflow statuses:

```ts
type WorkflowMutationStatus =
  | "queued"
  | "planning"
  | "running"
  | "completed"
  | "compensating"
  | "compensated"
  | "failed"
  | "compensation_failed";
```

## Idempotency

Every generated step has a deterministic idempotency key:

```txt
workflow instance ID + partition address + plan version
```

Each partition stores processed step records:

```sql
create table workflow_steps (
  workflow_id text not null,
  step_id text not null,
  status text not null,
  result_json text,
  applied_at integer,
  primary key (workflow_id, step_id)
);
```

Retries return the previously recorded result instead of applying writes twice.

## Read Your Own Writes During Planning

The logical workflow context should maintain a staged overlay:

```ts
await ctx.db.patch(userId, { rewarded: true });
const user = await ctx.db.get(userId);
```

`user.rewarded` should be `true` inside the function, even though the partition
step has not committed yet.

## Client API

Short workflow:

```ts
const rewardUsers = useWorkflowMutation(api.admin.rewardUsers);
await rewardUsers({ userIds });
```

Long-running workflow:

```ts
const run = await rewardUsers.start({ userIds });

const status = useQuery(api.workflows.status, {
  workflowId: run.workflowId,
});
```

The platform should make common workflow mutations feel close to normal Convex
mutations while preserving the distinct consistency contract.

## Appropriate Uses

Good:

- reward many independent users
- grant achievements
- update many tenant partitions
- checkout across cart, inventory, payment, and order services
- transfer with explicit reserve/commit/compensate business states

Poor:

- enforcing a globally atomic invariant
- decrementing many inventories where no intermediate oversell is acceptable
- relying on compensation as if nobody observed intermediate state
- arbitrary global balance calculations
