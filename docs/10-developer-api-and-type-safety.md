# Developer API And Type Safety

The platform should preserve Convex's approachable APIs while making partition
boundaries safe by default.

Developers should not manually call Durable Objects, create Workflow steps, or
manage idempotency keys.

## Minimal New Concepts

Keep familiar Convex concepts:

```txt
defineSchema
defineTable
query
mutation
action
ctx.db
ctx.auth
ctx.scheduler
useQuery
useMutation
```

Add only the concepts required by the Cloudflare consistency model:

```txt
partitionBy
colocateWith
defineProjection
workflowMutation
```

## Function Contracts

```txt
query
  reads authoritative tables and projections
  reactive
  cannot write

mutation
  reads and writes authoritative data in one partition
  fully atomic
  rejects cross-partition access

workflowMutation
  permits cross-partition reads and writes
  automatically grouped into Workflow steps
  durable and compensatable, not globally atomic

action
  permits external side effects
  accesses data through queries, mutations, and workflow mutations
```

## Why Mutation Must Never Auto-Upgrade

The platform must not silently convert a normal mutation into a workflow based
on runtime arguments.

This would make the same function sometimes atomic and sometimes temporarily
partially visible:

```txt
mutation called with one user  -> atomic
mutation called with 20 users  -> saga
```

That is unsafe and difficult to reason about.

Use a strict rule:

```txt
mutation is always atomic
workflowMutation is always workflow semantics
```

## Partition-Aware Generated Types

Generated types should carry partition scope:

```ts
type PartitionScope<Family extends string, Key> = {
  readonly family: Family;
  readonly key: Key;
};

type ScopedId<
  TableName extends string,
  Scope extends PartitionScope<string, unknown>,
> = Id<TableName> & {
  readonly __partitionScope: Scope;
};
```

A mutation context is scoped:

```ts
type MutationCtx<Scope> = {
  db: PartitionScopedDatabaseWriter<Scope>;
  auth: Auth;
  scheduler: Scheduler;
};
```

## Query-Proven Scope

A partition-constrained query returns scoped IDs:

```ts
const progress = await ctx.db
  .query("lessonProgress")
  .withIndex("by_user", q => q.eq("userId", args.userId))
  .unique();

await ctx.db.patch(progress._id, { completed: true });
```

Because the schema says `lessonProgress` is colocated with users by `userId`,
and the query is constrained to the selected user, `progress._id` is known to
belong to the mutation partition.

## Compile-Time Cross-Partition Error

```ts
export const rewardOtherUser = mutation({
  partition: args => userPartition(args.currentUserId),

  args: {
    currentUserId: v.id("users"),
    otherUserId: v.id("users"),
  },

  handler: async (ctx, args) => {
    await ctx.db.patch(args.otherUserId, { rewarded: true });
  },
});
```

Expected type error:

```txt
Id<"users"> is not proven to belong to the selected mutation partition.
Use workflowMutation() for intentional cross-partition writes.
```

## Cross-Partition Loop Error

```ts
export const rewardUsers = mutation({
  partition: args => userPartition(args.currentUserId),
  args: { userIds: v.array(v.id("users")) },

  handler: async (ctx, args) => {
    for (const userId of args.userIds) {
      await ctx.db.patch(userId, { rewarded: true });
    }
  },
});
```

The array contains unscoped user IDs, so the normal mutation cannot prove they
belong to the selected partition.

Changing only the function type makes the intent explicit:

```ts
export const rewardUsers = workflowMutation({
  args: { userIds: v.array(v.id("users")) },

  handler: async (ctx, args) => {
    await Promise.all(
      args.userIds.map(userId => ctx.db.patch(userId, { rewarded: true })),
    );
  },
});
```

## Runtime Enforcement

TypeScript cannot prove every case because developers may use:

- JavaScript
- `any`
- unsafe casts
- deserialized IDs
- helper functions that erase generic scope

The runtime must stage all writes, resolve their partitions, and validate before
commit:

```txt
normal mutation:
  zero partitions -> valid read-only completion
  one partition   -> commit atomically
  multiple        -> reject before commit
```

## Build-Time Analysis

Add optional ESLint/build analysis:

- warn on unsafe `Id` casts inside mutations
- warn on unbounded cross-partition queries
- warn when projection data influences mutation writes
- suggest `workflowMutation` for obvious multi-owner loops
- suggest `defineProjection` for repeated cross-partition list joins

## Projection Type Safety

Projection documents must be visibly derived:

```ts
type ProjectionDocument<T> = Readonly<T> & {
  readonly _projectionUpdatedAt: number;
  readonly _projectionVersion: string;
};
```

More importantly, generated `MutationCtx` must not expose projections:

```ts
ctx.db.query("cartView");
// Type error: projection tables are unavailable inside mutation contexts.
```

Runtime enforcement must reject projection reads in mutations even if types are
bypassed.

## Client APIs

Client usage remains close to Convex:

```ts
const progress = useQuery(api.progress.get);
const completeLesson = useMutation(api.progress.completeLesson);
const rewardUsers = useWorkflowMutation(api.admin.rewardUsers);
```

Workflow mutations may expose a durable handle:

```ts
const run = await rewardUsers.start({ userIds });

const status = useQuery(api.workflows.status, {
  workflowId: run.workflowId,
});
```

The developer should only confront workflow status when the business operation
is genuinely long-running or cross-partition.
