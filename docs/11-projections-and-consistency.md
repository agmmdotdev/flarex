# Projections And Consistency

Projections provide easy reactive global views without requiring queries to fan
out across many partition Durable Objects.

They are derived, eventually consistent read models. They must never be
mistaken for authoritative transactional data.

## Why Projections

In Convex, a query can read a leaderboard and fetch every referenced user in
one consistent query:

```ts
const entries = await ctx.db.query("leaderboardEntries").take(50);
return Promise.all(entries.map(entry => ctx.db.get(entry.userId)));
```

In a partitioned Durable Object design, those users may live in 50 different
objects. Reading all of them creates:

- N+1 cross-object requests
- inconsistent snapshots across objects
- complicated dependency tracking
- higher cost and latency

Instead, maintain a projection containing the fields needed by the list.

## Projection Schema API

```ts
export default defineSchema({
  users: defineTable({
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    country: v.optional(v.string()),
  }).partitionBy("_id"),

  userProgress: defineTable({
    userId: v.id("users"),
    leagueGroupId: v.string(),
    totalXp: v.number(),
  }).colocateWith("users", "userId"),

  leaderboardEntries: defineProjection({
    sources: ["users", "userProgress"],

    keyBy: row => row.users._id,
    partitionBy: row => row.userProgress.leagueGroupId,

    value: row => ({
      leagueGroupId: row.userProgress.leagueGroupId,
      userId: row.users._id,
      xp: row.userProgress.totalXp,
      displayName: row.users.displayName,
      avatarUrl: row.users.avatarUrl,
      country: row.users.country,
    }),
  }).index("by_ranking", ["leagueGroupId", "xp"]),
});
```

The exact API may be simplified during implementation, but the developer
declares the relationship once. They do not manually update leaderboard rows
from every mutation.

## Projection Maintenance

```txt
authoritative partition mutation commits
  -> transactional projection event is recorded
  -> projection processor consumes event
  -> target projection partition updates atomically
  -> live projection query invalidates
  -> subscribed clients receive new value
```

Projection events must be:

- emitted atomically with source mutation
- durable
- idempotent
- replayable
- ordered where required by projection key

## Live Does Not Mean Immediately Consistent

Projection queries are live:

```ts
const leaderboard = useQuery(api.leaderboards.list, { leagueGroupId });
```

When source data changes, the projection updates and subscribed clients receive
the new result. There can still be a short delay between source commit and
projection update.

The platform must state:

```txt
live = updates automatically
authoritative = safe for business decisions
```

These are different guarantees.

## Mutation Safety

Normal mutations cannot read projections:

```ts
export const checkout = mutation({
  handler: async ctx => {
    const cart = await ctx.db.query("cartView").collect();
    // Rejected: cartView is a projection.
  },
});
```

This prevents developers from charging a stale projected price or enforcing a
business invariant using derived data.

Projection tables are also read-only:

```ts
await ctx.db.patch(leaderboardEntry._id, { xp: 1000 });
// Rejected: projection documents are maintained by the platform.
```

## Authoritative Detail Reads

Projection rows should contain only the fields needed for the view:

```txt
leaderboard projection:
  userId
  displayName
  avatar thumbnail
  country
  XP
  rank
```

For a detailed user screen, query the specific authoritative user partition.

```ts
const leaderboard = useQuery(api.leaderboards.list, { leagueGroupId });
const selectedUser = useQuery(api.users.publicProfile, { userId });
```

## Ecommerce Cart Example

Separate authoritative and display prices:

```ts
products: defineTable({
  name: v.string(),
  currentPrice: v.number(),
  version: v.number(),
}).partitionBy("_id");

cartView: defineProjection({
  sources: ["cartItems", "products"],
  // Includes product display fields and projected price.
});
```

Consistency contract:

```txt
product.currentPrice
  authoritative

cartView.displayPrice
  live projected display value

orderItem.committedPrice
  immutable price accepted by checkout workflow
```

The cart UI can display projected prices. Checkout must use an authoritative
cross-partition workflow that reads product partitions and creates an immutable
quote.

## Projection Failure Handling

Projection lag and failures must be observable:

- projection processed timestamp
- source commit timestamp
- lag duration
- failed event count
- retry count
- dead-letter state

The platform should expose projection health in development and deployment
dashboards.

## Projection Rebuild

Every projection definition should support rebuild:

```txt
1. create new projection version
2. scan authoritative source data
3. write derived rows
4. catch up source events
5. switch readers to new version
6. retire old projection version
```

This is required when projection code or selected fields change.
