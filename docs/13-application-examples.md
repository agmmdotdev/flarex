# Application Examples

These examples show how the partitioned model preserves a Convex-style
developer experience while making consistency boundaries explicit.

## Duolingo-Style Learning App

### Schema

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
    score: v.number(),
  }).colocateWith("users", "userId"),

  leaderboardEntries: defineProjection({
    sources: ["users", "userProgress"],
    partitionBy: row => row.userProgress.leagueGroupId,
    keyBy: row => row.users._id,
    value: row => ({
      leagueGroupId: row.userProgress.leagueGroupId,
      userId: row.users._id,
      xp: row.userProgress.totalXp,
      displayName: row.users.displayName,
      avatarUrl: row.users.avatarUrl,
    }),
  }).index("by_ranking", ["leagueGroupId", "xp"]),
});
```

### Complete Lesson

```ts
export const completeLesson = mutation({
  partition: authPartition("users"),

  args: {
    lessonId: v.id("lessons"),
    score: v.number(),
  },

  handler: async (ctx, args) => {
    const progress = await ctx.db
      .query("userProgress")
      .withIndex("by_user", q => q.eq("userId", ctx.auth.userId))
      .unique();

    await ctx.db.patch(progress._id, {
      totalXp: progress.totalXp + args.score,
    });

    await ctx.db.insert("lessonProgress", {
      userId: ctx.auth.userId,
      lessonId: args.lessonId,
      completed: true,
      score: args.score,
    });
  },
});
```

User progress and lesson progress commit atomically in the user partition. The
leaderboard projection updates automatically afterward.

### Leaderboard Query

```ts
export const leaderboard = query({
  args: { leagueGroupId: v.string() },

  handler: async (ctx, args) => {
    return ctx.db
      .query("leaderboardEntries")
      .withIndex("by_ranking", q => q.eq("leagueGroupId", args.leagueGroupId))
      .order("desc")
      .take(50);
  },
});
```

Client usage remains:

```ts
const leaderboard = useQuery(api.leagues.leaderboard, { leagueGroupId });
```

The result includes display details without fetching 50 user Durable Objects.

## Ecommerce App

### Schema

```ts
export default defineSchema({
  products: defineTable({
    name: v.string(),
    currentPrice: v.number(),
    version: v.number(),
    available: v.boolean(),
  }).partitionBy("_id"),

  carts: defineTable({
    userId: v.id("users"),
  }).partitionBy("userId"),

  cartItems: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    quantity: v.number(),
  }).colocateWith("carts", "userId"),

  cartView: defineProjection({
    sources: ["cartItems", "products"],
    partitionBy: row => row.cartItems.userId,
    keyBy: row => row.cartItems._id,
    value: row => ({
      cartItemId: row.cartItems._id,
      productId: row.products._id,
      name: row.products.name,
      displayPrice: row.products.currentPrice,
      productVersion: row.products.version,
      quantity: row.cartItems.quantity,
    }),
  }),
});
```

### Cart UI

```ts
export const getCart = query({
  args: {},
  handler: async ctx => {
    return ctx.db
      .query("cartView")
      .withIndex("by_user", q => q.eq("userId", ctx.auth.userId))
      .collect();
  },
});
```

The UI gets live projected product details and prices.

### Checkout

Checkout must not trust `cartView.displayPrice`. Projection reads are forbidden
inside mutation contexts.

```ts
export const checkout = workflowMutation({
  args: { cartId: v.id("carts") },

  handler: async (ctx, args) => {
    const cart = await ctx.authoritative.getCart(args.cartId);

    const products = await Promise.all(
      cart.items.map(item => ctx.db.get(item.productId)),
    );

    const quote = ctx.quotes.create({
      cart,
      products,
    });

    await ctx.payments.authorize({
      quoteId: quote.id,
      amount: quote.total,
    });

    await ctx.orders.confirm({
      cartId: args.cartId,
      quote,
    });
  },
});
```

The workflow reads authoritative product partitions, creates an immutable
quote, authorizes payment, and confirms the order with durable workflow
semantics.

Consistency:

```txt
cart display: live projection, briefly stale allowed
checkout quote: authoritative
payment/order: workflow controlled and idempotent
```

## Multi-User Reward Operation

```ts
export const rewardUsers = workflowMutation({
  args: {
    userIds: v.array(v.id("users")),
    reward: v.string(),
  },

  handler: async (ctx, args) => {
    await Promise.all(
      args.userIds.map(userId =>
        ctx.db.insert("userRewards", {
          userId,
          reward: args.reward,
        }),
      ),
    );
  },
});
```

Behind the scenes, the platform groups writes by user partition and generates
one atomic Workflow step per user.

## Comparison With Convex

Convex:

```txt
one bounded mutation may atomically touch arbitrary documents
queries may read arbitrary related documents from one snapshot
global OCC and automatic retry hide placement
```

Cloudflare partition model:

```txt
normal mutation is atomic inside one explicit partition
cross-partition operation uses workflowMutation
global list/detail views use defineProjection
type-level and runtime checks prevent accidental consistency bugs
```

The goal is to preserve the easy code shape while making unavoidable
Cloudflare consistency differences safe and understandable.
