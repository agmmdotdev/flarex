# Flarex Realtime Room Actors Draft

## Status

Draft idea only.

This is not part of the current FlarexDB v1 schema, transaction, or sync
foundation. It records a possible later product/runtime lane for generic
Durable Object backed actors: multiplayer rooms, AI agent sessions, chat rooms,
collaborative documents, support sessions, auctions, live classrooms, and other
low-latency stateful workloads.

## Why This Is Separate

The current FlarexDB API is designed for durable application data:

```text
ctx.db
  -> durable app data
  -> Postgres/FlarexDB source of truth
  -> transactional commits
  -> OCC/read-set validation
  -> live query invalidation and rerun
  -> client query cache updates
```

That is the right model for:

```text
CMS content
commerce products/orders/inventory/payments
users/accounts/permissions
learning progress
durable leaderboards
normal reactive application queries
```

It is not the right engine for:

```text
60 FPS player positions
physics ticks
high-frequency room inputs
presence/cursors/typing
server-authoritative game loops
transient collaborative canvas state
AI response streaming coordination
chat room delivery/presence coordination
live session orchestration
```

Trying to push those workloads through `ctx.db.patch(...)` would overload the
Postgres commit path, OCC validation, query reruns, and durable sync semantics.

## Draft Direction

Add a separate generic hot-state primitive later:

```text
ctx.actor
  -> Durable Object backed
  -> actor-local authority
  -> low-latency in-memory state
  -> optional checkpoint/event log to FlarexDB/Postgres

ctx.room
  -> optional convenience wrapper over ctx.actor for room-shaped workloads
```

Possible actor use cases:

```text
multiplayer game match
collaborative canvas/document session
AI agent conversation/session
chat room presence, typing, and ephemeral delivery
live classroom/session
workflow monitor/control loop
auction/bidding room
support ticket copilot session
device/IoT session
```

Possible high-level room API sketch:

```ts
export const matchRoom = defineRoom({
  state: {
    players: v.record(v.object({
      x: v.number(),
      y: v.number(),
      hp: v.number(),
    })),
  },
  events: {
    move: v.object({ x: v.number(), y: v.number() }),
    shoot: v.object({ targetId: v.string() }),
  },
  onEvent(ctx, event) {
    // update hot room state
  },
  onTick(ctx) {
    // optional server-authoritative tick
  },
})
```

Alternative lower-level shape:

```ts
export const agentSession = defineActor("agentSession", {
  state: v.object({ ... }),
  onMessage(ctx, message) {},
  onAlarm(ctx) {},
})
```

These APIs are intentionally separate from normal database queries and
mutations.

## Actor Identity And Addressing

Actor identity should be stable and explicit:

```text
actor type + actor id = one live actor instance
```

Internal Cloudflare Durable Object names should include platform scope:

```text
scopeId + ":" + actorType + ":" + actorId
```

Examples:

```text
chatRoom + chatRooms row id
agentSession + conversations row id
match + matches row id
documentSession + documents row id
supportTicket + tickets row id
temporaryLobby + generated lobby id
```

This gives these properties:

```text
same actor type + same actor id + same scope -> same actor
different actor id -> different actor
different actor type -> different actor namespace
different deployment/scope -> isolated actor
```

An actor id should usually reference a durable app row when there is durable
metadata or history, but it can also be a generated temporary id for ephemeral
lobbies or short-lived sessions.

## App Table Bridge

Actors can read and write app data, but only through a controlled bridge.

```text
actor hot state
  -> DO memory / optional checkpoint

app tables
  -> durable FlarexDB/Postgres
  -> accessed through explicit read/query/mutation APIs
```

Allowed:

```text
snapshot read at actor start/join
watched read for durable config changes
durable write through normal Flarex mutation/internal mutation
```

Not allowed:

```text
long Postgres transaction held by an actor
direct physical table writes from actor code
hot tick writes into app tables
DO memory participating in ctx.db atomicity
```

API sketch:

```ts
export const matchRoom = defineActor("matchRoom", {
  async onJoin(ctx, player) {
    const profile = await ctx.db.get("players", player.id)
    ctx.state.players[player.id] = {
      name: profile.name,
      level: profile.level,
      x: 0,
      y: 0,
    }
  },

  onMessage(ctx, msg) {
    ctx.state.players[msg.playerId].x = msg.x
    ctx.broadcast("playerMoved", { playerId: msg.playerId, x: msg.x })
  },

  async onEnd(ctx) {
    await ctx.db.runMutation(api.matches.finish, {
      matchId: ctx.actor.id,
      scores: ctx.state.scores,
    })
  },
})
```

The boundary is:

```text
ctx.actor.state is hot/actor-local.
ctx.db is durable/global.
The bridge between them is explicit and asynchronous.
```

## Chat Room Actor Example

For a durable chat room, the actor id should normally be the durable
`chatRooms` row id.

Durable schema:

```ts
chatRooms: defineTable({
  title: v.string(),
  createdBy: v.id("users"),
  createdAt: v.time(),
})

messages: defineTable({
  roomId: v.id("chatRooms").index(),
  userId: v.id("users").index(),
  text: v.string(),
  createdAt: v.time(),
})
```

Actor definition:

```ts
export const chatRoomActor = defineActor("chatRoom", {
  async onStart(ctx) {
    const room = await ctx.db.get("chatRooms", ctx.actor.id)
    ctx.state.title = room.title
  },

  async onMessage(ctx, msg) {
    if (msg.type === "typing") {
      ctx.broadcast("typing", {
        userId: msg.userId,
        at: Date.now(),
      })
      return
    }

    if (msg.type === "message") {
      ctx.broadcast("pendingMessage", {
        clientMessageId: msg.clientMessageId,
        userId: msg.userId,
        text: msg.text,
      })

      const messageId = await ctx.db.runMutation(api.messages.create, {
        roomId: ctx.actor.id,
        userId: msg.userId,
        text: msg.text,
        clientMessageId: msg.clientMessageId,
      })

      ctx.broadcast("messageCommitted", {
        clientMessageId: msg.clientMessageId,
        messageId,
      })
    }
  },
})
```

Server-side usage:

```ts
const room = ctx.actor.get(chatRoomActor, roomId)

await room.send({
  type: "message",
  userId,
  text: "hello",
  clientMessageId,
})
```

Frontend usage:

```ts
const room = useActor(api.actors.chatRoom, roomId)

room.send({
  type: "typing",
  userId,
})

room.send({
  type: "message",
  userId,
  text,
  clientMessageId: crypto.randomUUID(),
})
```

Chat split:

```text
chatRooms row
  -> durable room metadata

chatRoom actor
  -> hot presence, typing, connected clients, delivery coordination

messages table
  -> durable message history
```

For an AI agent conversation, use the same pattern:

```text
actor type = agentSession
actor id = conversations row id

hot actor state:
  current streaming response
  active subscribers
  tool-call progress
  cancellation/retry state

durable app data:
  final messages
  conversation metadata
  usage/billing/audit rows
```

## Runtime Shape

```text
Client input
  -> ActorDO
  -> validate input
  -> update in-memory actor state
  -> broadcast actor delta immediately
  -> optionally append event/checkpoint later
```

Durable outputs still flow through FlarexDB:

```text
match ended
  -> ActorDO writes final match result through FlarexDB mutation/internal API
  -> Postgres commit makes result official
  -> normal Flarex sync updates durable app queries
```

## Consistency Rule

Use two explicit lanes:

```text
Durable lane:
  ctx.db / ctx.commerce / ctx.cms
  Postgres-confirmed official data

Realtime room lane:
  ctx.actor / optional ctx.room wrapper
  DO-backed hot state
  actor-local authority
  optional checkpoint/event log
```

Do not make DO hot state the source of truth for durable commerce, CMS,
permissions, payments, orders, or inventory.

Do allow DO hot state for:

```text
player positions
presence
typing indicators
cursor positions
transient canvas edits
draft room state
game inputs/ticks
temporary collaborative state
```

## Failure Model

Room state must declare its durability level:

```text
ephemeral
  -> state may disappear when the DO is evicted or reset
  -> clients can rejoin and rebuild from current participants

checkpointed
  -> periodic snapshots saved to FlarexDB/Postgres
  -> room can restore from latest checkpoint after restart

event-logged
  -> inputs/events appended to durable log
  -> room can replay from log, with higher write cost
```

The API should make this choice explicit because game/presence workloads and
durable business workloads have different correctness requirements.

## Relation To SpacetimeDB

SpacetimeDB can make multiplayer demos feel fast because its database runtime
owns hot memory and durability together. Flarex on Cloudflare should not copy
that directly for all data.

The Flarex equivalent is:

```text
RoomDO/ActorDO
  -> SpacetimeDB-like hot room state feel

FlarexDB/Postgres
  -> durable app/business truth
```

This gives Flarex a path to support multiplayer/collaboration later without
weakening the current durable database API.

## Not V1

Do not include this in the first FlarexDB sync foundation:

```text
defineRoom(...)
defineActor(...)
RoomDO tick loop
server-authoritative game APIs
DO-first durable database writes
automatic use of room state inside ctx.db queries
```

V1 should stay focused on:

```text
Postgres/FlarexDB source of truth
executor commit summaries
DeploymentSyncDO invalidation/rerun
client query cache and optimistic pending mutations
```

Room actors can be designed after the durable sync foundation is proven.
