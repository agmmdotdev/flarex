# Partitioned Data Model

The primary Cloudflare-native design uses Durable Objects as explicit
transaction partitions. A partition is a group of authoritative documents that
can be read and written atomically together.

The term partition is preferred over shard in the public API because it
describes the developer-facing guarantee:

> All authoritative documents colocated in one partition can participate in one
> atomic mutation.

## Why Partitions

Convex supports arbitrary bounded transactions across documents because its
transaction engine maintains a globally coordinated snapshot, read set, write
log, and OCC committer.

Cloudflare Durable Objects provide a different primitive:

- one globally addressable object
- serialized execution
- private SQLite storage
- atomic transactions inside that object
- no atomic transaction spanning multiple Durable Objects

The platform should use this primitive directly instead of pretending separate
Durable Objects can provide one globally atomic commit.

## What A Partition Contains

A partition Durable Object stores multiple related tables and documents:

```txt
UserPartitionDO(userId)
  users
  userProgress
  lessonProgress
  cart
  cartItems
  privateNotifications
```

It is not one Durable Object per record. It is one Durable Object per useful
business transaction boundary.

Other examples:

```txt
WorkspacePartitionDO(workspaceId)
  workspace
  members
  projects
  tasks

RoomPartitionDO(roomId)
  room
  messages
  participants
  counters

LeaguePartitionDO(leagueGroupId)
  leaderboardEntries
  leagueSettings
  weeklyResults
```

## Schema Placement API

Developers declare placement once in the schema:

```ts
export default defineSchema({
  users: defineTable({
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
  }).partitionBy("_id"),

  userProgress: defineTable({
    userId: v.id("users"),
    totalXp: v.number(),
    streak: v.number(),
    leagueGroupId: v.string(),
  }).colocateWith("users", "userId"),

  lessonProgress: defineTable({
    userId: v.id("users"),
    lessonId: v.id("lessons"),
    completed: v.boolean(),
  })
    .colocateWith("users", "userId")
    .index("by_user_lesson", ["userId", "lessonId"]),
});
```

This declares:

```txt
users/A
userProgress where userId=A
lessonProgress where userId=A

all live in partition users:A
```

The developer does not manually route Durable Object calls.

## Partition Identity

The platform resolves every authoritative document to:

```ts
type PartitionAddress = {
  deploymentId: string;
  partitionFamily: string;
  partitionKey: string;
};
```

Example:

```txt
deployment=duolingo-clone
partitionFamily=users
partitionKey=user_123
```

The Durable Object name can be derived deterministically:

```txt
partition:duolingo-clone:users:user_123
```

## Partition-Local Mutation

A normal mutation selects or infers one partition:

```ts
export const completeLesson = mutation({
  partition: authPartition("users"),

  args: {
    lessonId: v.id("lessons"),
    earnedXp: v.number(),
  },

  handler: async (ctx, args) => {
    const progress = await ctx.db
      .query("userProgress")
      .withIndex("by_user", q => q.eq("userId", ctx.auth.userId))
      .unique();

    await ctx.db.patch(progress._id, {
      totalXp: progress.totalXp + args.earnedXp,
    });

    await ctx.db.insert("lessonProgress", {
      userId: ctx.auth.userId,
      lessonId: args.lessonId,
      completed: true,
    });
  },
});
```

Both writes are staged and committed in one SQLite transaction inside the user
partition.

## Loops, Maps, And Promise.all

Normal JavaScript composition remains supported:

```ts
await Promise.all(
  args.exercises.map(exercise =>
    ctx.db.insert("lessonProgress", {
      userId: ctx.auth.userId,
      lessonId: exercise.lessonId,
      completed: true,
    }),
  ),
);
```

The operations are not individually committed. They are staged in one logical
mutation and applied together when the handler completes.

Required behavior:

- all writes commit together
- failure rolls back all writes
- later reads see staged writes
- staged deletes hide documents from later reads
- loops and `Promise.all` do not create separate transactions

## Read Your Own Writes

```ts
await ctx.db.insert("lessonProgress", {
  userId,
  lessonId,
  completed: true,
});

const completed = await ctx.db
  .query("lessonProgress")
  .withIndex("by_user", q => q.eq("userId", userId))
  .collect();
```

`completed` must include the staged insert. The transaction layer merges the
partition snapshot with the staged write set.

## Cross-Partition Detection

A normal mutation must reject cross-partition access before committing:

```txt
selected partition: users:A
attempted write: users:B
result: CrossPartitionMutationError
committed writes: none
```

Runtime validation is authoritative even when generated TypeScript types also
catch the error.

## Partition Choice

The platform cannot automatically know the best partition for every app.
Developers choose business ownership once in the schema:

- user-owned applications: partition by user
- SaaS: partition by organization/workspace
- chat: partition by room
- multiplayer games: partition by lobby/match
- commerce cart: partition by user/cart
- leaderboard group: partition by league group

The design should make the common choice easy while keeping the transaction
boundary explicit and reviewable.
