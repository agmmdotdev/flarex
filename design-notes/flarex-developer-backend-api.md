# Flarex Developer Backend API

Status: proposed API; transaction details are constrained by
[`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md)

This note records the proposed developer-facing backend API for Flarex schema,
database access, functions, transactions, live sync, CMS exposure, and commerce
access.

It is future-facing. It is not a description of the current executor
implementation.

The goal is:

```text
one Flarex schema
one app DB API
one function runtime model
one transaction model for app data
one commerce facade for commerce behavior
one CMS marker system for CMS exposure
```

Do not make developers learn separate Flarex schema, Payload schema, Medusa
Link schema, SQL migrations, and public projection APIs for normal app work.

## Public Surface

The first public backend API should be small:

```ts
import {
  action,
  defineSchema,
  defineTable,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  task,
  v,
} from "flarex/server"
```

Primary concepts:

```text
defineSchema(...)
defineTable(...)
v.* validators and field builders
query(...)
mutation(...)
action(...)
task(...)
ctx.db
ctx.auth
ctx.storage
ctx.scheduler
ctx.commerce
ctx.cms
```

The core database surface is:

```text
ctx.db.get(...)
ctx.db.query(...)
ctx.db.insert(...)
ctx.db.patch(...)
ctx.db.replace(...)
ctx.db.delete(...)
ctx.db.transact(...)
```

The API should not expose these as normal developer surfaces:

```text
raw SQL
raw Postgres/Hyperdrive client
raw Medusa repositories
raw Payload adapter
raw outbox writes
raw system tables
raw lock rows
public ctx.db.projection(...)
public Medusa Link definitions
```

## Schema Definition

Basic schema:

```ts
export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string().unique(),
    imageUrl: v.optional(v.string()),
    createdAt: v.time(),
  }).index("byEmail", ["email"]),

  courses: defineTable({
    title: v.string(),
    slug: v.string().unique(),
    level: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
    published: v.boolean().default(false),
  }).index("bySlug", ["slug"]),
})
```

Design rules:

- `defineSchema` is the source of truth for app data.
- Payload CMS config is generated from Flarex schema metadata.
- Medusa commerce schema is generated internally from Medusa DML, not written by
  app developers.
- Physical storage, migrations, indexes, tenant scope, OCC, outbox, and live
  sync are FlarexDB-owned.
- Developer-facing tables are logical tables. In hosted shared-schema mode,
  Flarex app/Payload content uses typed authoritative row JSON plus relational
  sidecars such as `fx_app_row_rev/current`,
  `fx_app_edge_rev/current`, `fx_app_index_entry_rev/current`,
  `fx_app_unique_key`, and optional block metadata indexes. Developers should
  not depend on physical per-app table names.
- Payload blocks, arrays, rich text, groups, tabs, and localized values stay
  embedded in the row by default. Declared indexed fields, relationship/upload
  refs, uniqueness, and block metadata are extracted into sidecars for query,
  OCC, and sync.
- Payload CMS content can share the logical app tables where `.cms()` exposes
  them, while Payload lifecycle state remains in fixed internal Payload system
  tables. Medusa commerce remains in fixed Medusa reserved system tables behind
  `ctx.commerce`.

## Validators And Field Builders

Scalar validators:

```ts
v.string()
v.number()
v.int()
v.boolean()
v.time()
v.id("users")
v.uuid()
v.json()
v.bytes()
v.null()
v.literal("value")
```

Composed validators:

```ts
v.optional(v.string())
v.array(v.string())
v.object({
  native: v.string(),
  translation: v.string(),
})
v.record(v.string(), v.number())
v.union(v.literal("draft"), v.literal("published"))
```

Field modifiers:

```ts
v.string().default("untitled")
v.string().required()
v.string().optional()
v.string().unique()
v.string().index()
v.string().cms()
v.string().cms({ label: "Title" })
```

Recommended array shorthand:

```ts
v.array(v.string())
```

Avoid adding too many aliases such as `v.string.array`. Keep the API familiar
and easy to infer from TypeScript.

## Tables

Table options:

```ts
defineTable(
  {
    title: v.string(),
    body: v.richText(),
  },
  {
    cms: true,
    audit: true,
  },
)
```

Table modifiers:

```ts
defineTable({...})
  .index("byCreatedAt", ["createdAt"])
  .index("byStatusCreatedAt", ["status", "createdAt"])
  .searchIndex("searchBody", {
    fields: ["title", "body"],
  })
  .cms()
```

Use table options for cross-cutting behavior. Use field modifiers for field
behavior.

## Indexes

Indexes are the normal way to make queries fast.

```ts
const users = defineTable({
  name: v.string(),
})

const courses = defineTable({
  title: v.string(),
  slug: v.string().unique(),
})

const classrooms = defineTable({
  name: v.string(),
  course: v.relation.one(courses).index(),
})

const classroomMembers = defineTable({
  classroom: v.relation.one(classrooms).index(),
  user: v.relation.one(users).index(),
  role: v.union(v.literal("student"), v.literal("teacher")),
}).unique(["classroom", "user"])

const userStats = defineTable({
  user: v.relation.one(users).index(),
  course: v.relation.one(courses).optional().index(),
  classroom: v.relation.one(classrooms).optional().index(),
  week: v.string(),
  weeklyPoints: v.number(),
  rating: v.number(),
  learningMinutes: v.number(),
  leaderboardScore: v.number(),
})
  .index("byUserWeek", ["user", "week"])
  .index("byWeekScore", ["week", "leaderboardScore"])
  .index("byCourseWeekScore", ["course", "week", "leaderboardScore"])
  .index("byClassroomWeekScore", ["classroom", "week", "leaderboardScore"])
  .unique(["user", "course", "classroom", "week"])
```

Query:

```ts
export const topClassroomLearners = query({
  args: {
    classroomId: v.id("classrooms"),
    week: v.string(),
  },
  returns: v.array(v.object({
    user: v.id("users"),
    classroom: v.id("classrooms"),
    leaderboardScore: v.number(),
    weeklyPoints: v.number(),
    rating: v.number(),
    learningMinutes: v.number(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userStats")
      .withIndex("byClassroomWeekScore", (q) =>
        q.eq("classroom", args.classroomId).eq("week", args.week)
      )
      .order("desc")
      .take(50)
      .populate({
        user: true,
        classroom: true,
      })
  },
})
```

Ceiling:

```text
Good:
  top N by declared index
  filtered list by declared index
  paginated ordered lists
  relation lookup indexes
  search indexes where declared

Not good as direct ctx.db query:
  scan all rows and sort dynamically
  arbitrary GROUP BY over millions of rows
  user-defined formula over all users without stored score/index
  cross-app or global analytics inside the live sync path
```

## Derived Fields

App-owned derived values should usually be normal fields maintained by
mutations, workflows, or internal jobs.

```ts
const userStats = defineTable({
  user: v.relation.one(users).index(),
  course: v.relation.one(courses).optional().index(),
  classroom: v.relation.one(classrooms).optional().index(),
  week: v.string(),
  weeklyPoints: v.number(),
  rating: v.number(),
  learningMinutes: v.number(),
  leaderboardScore: v.number(),
})
```

Mutation:

```ts
export const completeLesson = mutation({
  args: {
    lessonId: v.id("lessons"),
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.auth.requireUserId()

    await ctx.db.transact(async (tx) => {
      const lesson = await tx.get("lessons", args.lessonId)

      await tx.insert("lessonCompletions", {
        user: userId,
        lessonId: args.lessonId,
        course: lesson.course,
        minutes: args.minutes,
        completedAt: Date.now(),
      })

      const stats = await tx
        .query("userStats")
        .withIndex("byUserWeek", (q) => q.eq("user", userId).eq("week", currentWeek()))
        .unique()

      const next = computeStats(stats, args.minutes)

      if (stats) {
        await tx.patch(stats._id, next)
      } else {
        await tx.insert("userStats", {
          user: userId,
          course: lesson.course,
          classroom: null,
          week: currentWeek(),
          ...next,
        })
      }
    })
  },
})
```

Public projection APIs are not part of the first developer surface.
FlarexDB can still create internal materialized read models for expensive
commerce, CMS, search, dashboard, or cross-partition reads.

## Relations

Use relation builders that read like familiar one/many concepts.

```ts
v.relation.one(table)
v.relation.many(table)
v.relation.oneOf({ user: users, organization: organizations })
v.relation.manyOf({ user: users, organization: organizations })
v.relation.back(sourceTable, "fieldName")
```

Example:

```ts
const users = defineTable({
  name: v.string(),
})

const categories = defineTable({
  name: v.string(),
})

const posts = defineTable({
  title: v.string(),
  author: v.relation.one(users).required().index(),
  categories: v.relation.many(categories).ordered().index(),
})

const categoryViews = defineTable({
  category: v.relation.one(categories).index(),
  posts: v.relation.back(posts, "categories"),
})
```

Relation rules:

- Stored forward relations are embedded typed references plus derived Flarex
  relation edge sidecars when they need joins, reverse lookup, invalidation, or
  population.
- Reverse relations are virtual and resolved from relation indexes.
- Ordered many-relations store stable positions.
- Polymorphic relations store target collection discriminator plus target id.
- Relation sidecar writes participate in the same FlarexDB commit as row
  writes.

Populate:

```ts
const post = await ctx.db.get("posts", postId, {
  populate: {
    author: true,
    categories: { limit: 10 },
  },
})
```

The return type should distinguish stored relation ids from populated records.

## CMS Markers

This section is ergonomic research only. The current write-authority decision
is owned by
[`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md);
the chained `.cms(...)` syntax below is superseded and must not be implemented
as a generic marker that leaves write behavior ambiguous.

```ts
const posts = defineTable({
  title: v.string(),
  slug: v.string().unique(),
  body: v.richText(),
  author: relation.one(users),
})
  .index("bySlug", ["slug"])

// Illustrative only; final package and names require a public API preflight.
cms.manage(posts, {
  collection: "posts",
  admin: { titleField: "title" },
})
```

CMS rules:

- Flarex schema remains source of truth.
- Payload config is generated or constrained from that authority.
- A CMS view is read-only and retains app-owned writes.
- A CMS-managed table is editable through the Payload operation pipeline and
  generated `ctx.cms`; ordinary `ctx.db` writes are excluded by type and
  rejected by runtime authority.
- An app-command-owned aggregate remains read-only until dashboard actions can
  delegate to its commands.
- Privileged migrations and repairs are a separate capability, not a normal
  developer write policy.

No raw Payload plugin or schema API should be required for normal Flarex app
developers.

## Commerce References

App data can reference commerce entities with typed commerce IDs or relation
builders.

```ts
const reviews = defineTable({
  product: v.commerce.product().index(),
  userId: v.id("users"),
  rating: v.number(),
  body: v.string(),
  createdAt: v.time(),
}).index("byProductCreatedAt", ["product", "createdAt"])
```

Alternative relation-style API:

```ts
const reviews = defineTable({
  product: v.relation.one(commerce.product).index(),
  rating: v.number(),
})
```

Rules:

- App-to-commerce references are Flarex-owned app relations.
- They do not become public Medusa Module Links by default.
- Commerce data is read or changed through `ctx.commerce`, not through public
  `ctx.db` access to Medusa reserved tables.
- Medusa reserved tables are internal system tables.

## Functions

Queries:

```ts
export const listLessons = query({
  args: {
    courseId: v.id("courses"),
  },
  returns: v.array(v.object({
    _id: v.id("lessons"),
    title: v.string(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("lessons")
      .withIndex("byCourseOrder", (q) => q.eq("courseId", args.courseId))
      .order("asc")
      .take(100)
  },
})
```

Mutations:

```ts
export const createCourse = mutation({
  args: {
    title: v.string(),
  },
  returns: v.id("courses"),
  handler: async (ctx, args) => {
    await ctx.auth.requireRole("teacher")
    return await ctx.db.insert("courses", {
      title: args.title,
      slug: slugify(args.title),
      published: false,
    })
  },
})
```

Durable background work:

```ts
export const generateLessonAudio = task({
  id: "generate-lesson-audio",
  retry: { maximumAttempts: 5 },
  args: {
    lessonId: v.id("lessons"),
  },
  handler: async (ctx, args) => {
    const lesson = await ctx.runQuery(internal.lessons.getForAudio, args)
    const audio = await callExternalTts(lesson.text)
    await ctx.storage.put(`lesson-audio/${args.lessonId}.mp3`, audio)
    await ctx.runMutation(internal.lessons.markAudioReady, {
      lessonId: args.lessonId,
    })
  },
})
```

Function rules:

- Queries are read-only and live-syncable.
- Mutations are short, deterministic transactional functions.
- Tasks own background, queued, delayed, retryable, and scheduled work. They
  may call external APIs and use authenticated query/mutation callbacks, but do
  not hold a database transaction open.
- Actions, if retained, are foreground request/response external-I/O
  functions. They are not scheduler targets and are not nested inside Tasks.
- Internal functions are callable by server code only.

## Ctx Surfaces

Query/mutation ctx:

```ts
ctx.db
ctx.auth
ctx.storage
ctx.scheduler
ctx.commerce
ctx.cms
ctx.runQuery
ctx.runMutation
ctx.runAction
```

Action ctx:

```ts
ctx.auth
ctx.storage
ctx.scheduler
ctx.commerce
ctx.cms
ctx.runQuery
ctx.runMutation
ctx.fetch
```

Task ctx:

```ts
ctx.auth
ctx.storage
ctx.scheduler
ctx.runQuery
ctx.runMutation
ctx.fetch
```

Actions should not receive a raw `ctx.db` write surface by default. They should
call queries/mutations so transactional boundaries stay explicit.
Tasks follow the same rule and receive no raw Task System, Postgres, provider,
Queue, or Cron capability.

## ctx.db Reads

Point read:

```ts
const user = await ctx.db.get("users", userId)
```

Query builder:

```ts
await ctx.db
  .query("lessonCompletions")
  .withIndex("byUserCompletedAt", (q) => q.eq("userId", userId))
  .order("desc")
  .take(20)
```

Expected operators:

```ts
q.eq("field", value)
q.neq("field", value)
q.lt("field", value)
q.lte("field", value)
q.gt("field", value)
q.gte("field", value)
q.between("field", min, max)
q.startsWith("field", prefix)
```

Result methods:

```ts
.first()
.unique()
.take(50)
.collect()
.paginate({ cursor, limit })
```

Rules:

- Queries should prefer declared indexes.
- Full scans need explicit limits and quotas.
- Live queries record read sets for documents, rows, relations, indexes, and
  ranges.
- Query results can be live-synced when called through the sync client.

## ctx.db Writes

Insert:

```ts
const id = await ctx.db.insert("reviews", {
  product,
  userId,
  rating: 5,
  body: "Great lesson",
  createdAt: Date.now(),
})
```

Patch:

```ts
await ctx.db.patch(reviewId, {
  rating: 4,
})
```

Replace:

```ts
await ctx.db.replace(reviewId, {
  product,
  userId,
  rating: 4,
  body: "Updated",
  createdAt,
})
```

Delete:

```ts
await ctx.db.delete(reviewId)
```

Rules:

- Writes validate against Flarex schema.
- Writes record commit summaries for live sync.
- Writes update declared indexes and relation edges.
- Writes participate in OCC/read-set validation.
- Direct writes to Medusa reserved tables are not allowed.
- Direct writes to CMS-managed tables are not authorized; use generated
  `ctx.cms`. App-owned writes remain available only for an ordinary table or a
  table presented through a read-only CMS view.

## Transactions

Use `ctx.db.transact` for explicit app-level atomicity.

```ts
await ctx.db.transact(async (tx) => {
  const courseId = await tx.insert("courses", {
    title: "English Basics",
    slug: "english-basics",
    published: false,
  })

  await tx.insert("lessons", {
    courseId,
    title: "Greetings",
    order: 1,
  })
})
```

Rules:

- `ctx.db.transact` is a staging API over the FlarexDB commit protocol.
- User code runs before the short physical SQL transaction.
- Final commit validates read sets, constraints, indexes, relations, locks, and
  write policies.
- Long work belongs in actions, workflows, jobs, or post-commit outbox
  consumers.
- Transaction windows and total reads/writes have quotas.

`ctx.commerce` is not allowed inside generic `ctx.db.transact`. There is no
automatic atomic app-and-commerce transaction. If extension state is part of a
commerce invariant, the commerce extension exposes one Medusa-owned
facade/workflow and its trusted transaction owns both the commerce rows and its
extension rows. Ordinary app/display state references stable commerce IDs and
follows commerce changes idempotently through the transactional outbox.

## ctx.commerce

Commerce API is a facade over Medusa behavior.

```ts
ctx.commerce.products.get(id)
ctx.commerce.products.list(query)
ctx.commerce.products.create(input)
ctx.commerce.products.update(id, input)

ctx.commerce.carts.create(input)
ctx.commerce.carts.addLineItem(cartId, input)
ctx.commerce.carts.complete(cartId)

ctx.commerce.orders.get(id)
ctx.commerce.orders.list(query)
```

Rules:

- `ctx.commerce` is supplied by the commerce extension package.
- Medusa remains the behavior owner for commerce semantics.
- Commerce reads/writes use the Flarex-backed Medusa adapter internally.
- Public app code does not access Medusa reserved tables through `ctx.db`.
- Commerce events are released after the Medusa-owned transaction commits its
  commerce state plus Flarex change/outbox records.

## ctx.cms

`ctx.cms` is the generated developer facade for operations that must run
Payload CMS lifecycle semantics. It is not an optional convenience alongside
unrestricted `ctx.db` writes for the same CMS-managed table. Ordinary reads may
use the allowed current/published `ctx.db` view; ordinary writes use exactly one
owner.

```ts
ctx.cms.collections("posts").create(input)
ctx.cms.collections("posts").update(id, input)
ctx.cms.collections("posts").find(query)
ctx.cms.globals("siteSettings").get()
ctx.cms.globals("siteSettings").update(input)
```

Rules:

- Dashboard, enabled REST/GraphQL adapters, and `ctx.cms` run through one
  Payload operation pipeline.
- Payload owns hooks, access, validation order, versions, drafts, auth, uploads,
  and lifecycle-sensitive behavior.
- Flarex owns data storage, schema, transactions, indexes, live sync, tenant
  scope, and write policies.
- Request-scoped `ctx.cms` respects its principal by default; a system override
  is explicit and separately authorized.

## Auth

```ts
const userId = await ctx.auth.getUserId()
const user = await ctx.auth.getUser()
await ctx.auth.requireUser()
await ctx.auth.requireRole("teacher")
await ctx.auth.requirePermission("courses.write")
```

Auth checks should be normal function code and may also be enforced by table or
CMS policy.

## Storage

```ts
const key = await ctx.storage.put("audio/lesson-1.mp3", bytes, {
  contentType: "audio/mpeg",
})

const url = await ctx.storage.getUrl(key)
await ctx.storage.delete(key)
```

Storage metadata can be referenced from app tables:

```ts
const media = defineTable({
  key: v.string(),
  contentType: v.string(),
  size: v.number(),
}).cms()
```

## Scheduler And Jobs

```ts
await ctx.scheduler.runAfter("sendReminder", {
  delayMs: 60_000,
  args: { userId },
})

await ctx.scheduler.runAt("publishCourse", {
  at: publishAt,
  args: { courseId },
})
```

Scheduled work creates first-class durable Task runs. Queue, Cron, alarms, and
other host mechanisms only wake the Task System; they do not execute actions or
mutations directly and are not durable truth. A scheduled Task may call the
existing query and mutation systems through authenticated context callbacks.

## Live Sync Semantics

Any query can become live when called by the sync client:

```ts
api.query.topClassroomLearners({ classroomId, week })
```

Backend behavior:

```text
query executes
  -> reads app tables, commerce facade data, CMS-marked app data, or internal
     fresh-enough read models
  -> records read set
  -> returns result
  -> result is cached by query key, args, scope, and commit cursor

mutation commits
  -> final commit writes source data, indexes, relations, commit row, outbox
  -> executor wakes DeploymentSyncDO with compact commit summary
  -> DeploymentSyncDO matches write summary against read-set indexes
  -> affected queries are marked stale and rerun once per latest useful commit
     version
  -> changed result hashes are sent to subscribed clients
  -> unchanged results advance freshness with a settled acknowledgement
```

This means the first sync engine is invalidation and rerun, not exact
client-visible cache patching. Internally, Flarex may record broad dependency
topics before a query finishes and then refine them from actual rows, relation
edges, index/range reads, and read-model keys. If dependency matching is
uncertain, Flarex should rerun the query from the authoritative source instead
of trying to update a cached result by hand.

Developer rule:

```text
Write normal indexed queries.
FlarexDB handles read-set tracking, invalidation, and rerun.
Do not manually write outbox or projection rows.
Do not choose cache/live modes in application code.
```

The API should not add `.live()`, `.cache()`, `ctx.db.projection(...)`, or
public query-shard controls for normal app work. Query-shape caching,
`QueryShardDO`, chunked hot-list caches, and exact in-memory patching are
platform optimizations for later versions. The first public mental model is:
write a normal query, use it from the sync client, and let Flarex decide
whether the backend reruns from Postgres/FlarexDB, serves a warm
`DeploymentSyncDO` result, or later uses a sharded query cache.

Default client behavior:

```text
@flarex/client
  -> stores query results in a small internal cache
  -> reconnects with last seen commit cursor and epoch
  -> receives data, delta, resume, or settled transitions
  -> keeps pending mutations for optimistic UI until subscribed query results
     have caught up to the acknowledged commit cursor
  -> supports optional durable read cache and durable offline mutation outbox

@flarex/react
  -> exposes Convex-style useQuery/useMutation over that client cache
```

This does not require a browser-side database. Complex filtering, joins,
ordering, and authorization belong in Flarex query functions by default.

An optional future `@flarex/tanstack-db` adapter can consume the same sync
protocol for apps that want local-first collections, browser-side joins, and
deep offline querying. That adapter should not define the core Flarex sync
protocol.

## Internal Read Models

No public projection API in the first design.

Internal read models remain allowed for:

```text
commerce browse views
CMS admin search
search documents
large dashboard counters
heavy leaderboard/ranking views
cross-partition/global summaries
```

They are:

```text
Flarex-owned
derived
rebuildable
freshness-tracked
not directly writable through ctx.db
not authoritative for mutation validation unless transactionally updated
```

Public app code should see either logical app tables or normal query results.

The first implementation should not require:

```text
Postgres source rows
  -> mandatory SQLite / Durable Object projection store
  -> TanStack DB as the normal query engine
```

Use internal read models only when they reduce measured load or make a known hot
query practical. Otherwise, run the server query against authoritative
FlarexDB app storage or reserved system tables and cache/rerun/fan out through
`DeploymentSyncDO`.

## API Ceiling

The developer API should be powerful for product apps:

```text
CRUD
typed relations
typed indexes
ordered pagination
search indexes
live synced queries
short transactions
commerce facade calls
CMS lifecycle calls
scheduled jobs
storage
actions for external APIs
```

The API should not pretend to be an OLAP engine:

```text
not arbitrary SQL
not unbounded table scans
not arbitrary group-by/reporting over huge event logs
not dynamic global ranking without a stored score/index/read model
not cross-app or global analytics in the live sync path
not long-running mutation code
```

For an English learning app, the recommended model is:

```text
users = learners and teachers
courses = learning content scope
classrooms = app-level course group
classroomMembers = relation table between classrooms and users
lessonCompletions = source events
studySessions = source events
userStats = app-owned derived stats table with user/course/classroom relations
userStats.byClassroomWeekScore = classroom leaderboard index
userStats.byCourseWeekScore = course leaderboard index
topClassroomLearners query = indexed ordered relational query
```

That gives simple developer APIs and strong performance without exposing public
projection primitives.

## Current Decision

- Keep the public backend API Flarex-first.
- Use `defineSchema`, `defineTable`, validators, relations, indexes, and CMS
  markers as the schema source.
- Use `ctx.db` for app data.
- Use `ctx.commerce` for commerce behavior.
- Do not expose a generic atomic transaction across `ctx.db` and
  `ctx.commerce`; commerce-invariant extensions use a Medusa-owned facade.
- Use `ctx.cms` only when Payload CMS lifecycle semantics are required.
- Do not expose raw Medusa/Payload/SQL/storage internals.
- Do not expose `ctx.db.projection(...)` as a primary public developer API.
- Prefer ordinary indexed tables and app-owned derived fields for leaderboards
  and stats.
- Keep internal read models as Flarex planner/runtime infrastructure.
- Keep the core sync client independent of TanStack DB; add a TanStack DB
  adapter only for advanced local-first collection use cases.
- Keep mutations short and transactional; move long work to actions, workflows,
  jobs, or post-commit subscribers.
