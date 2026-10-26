# Bounded Payload CRUD continuation

Status: bounded native CRUD implemented. The actual Local API
create/read/update/delete paths use the native
binding and one trusted framework command owner. Native preference cleanup uses
the [core equality operations](./EQUALITY.md) and selected document/preference
definitions. Initial [CRUD measurements](./RESULTS.md) miss the latency goals.
General Payload support and performance acceptance remain open.

## Executing native contract

Use the same Payload 3.88.0 collection and complete result contract as
[PAYLOAD-CREATE.md](./PAYLOAD-CREATE.md), with its explicit configuration gates.
Native `updateByID` first reads the document, executes native update processing,
then calls `db.updateOne`. Native `deleteByID` reads the document, calls
`db.deleteOne`, always invokes `preferences/deleteUserPreferences`, then runs
native read/delete/operation hooks. Preserve that order and its failures.

For this non-auth collection, preference cleanup calls `db.deleteMany` on
`payload-preferences` with `key in [collection-<slug>-<id>]`. The key is indexed
but not globally unique: multiple users can retain the same document key. Empty
cleanup is still an actual indexed query with negative-result evidence. Auth
collection deletion and its user predicates remain outside this profile.

The preference shape comes from executing `preferences/config.js`: `user` is a
required polymorphic relationship, `key` is optional indexed text, and `value`
is optional JSON. A bounded internal definition and decoder must preserve its
actual admitted values. Fixture insertion is administrative seeding through the
same core writer; it must not claim native user/preference API support or general
relationship/FK enforcement. Preference writer and cleanup use the same explicit
index metadata, materialization and accepting owner.

## Core-owned indexed deletion

The bounded text-equality capability owns original index intervals and pending
membership at the core query/change owners. Application numeric queries and
their admitted scalar profile remain separate. Drizzle schema/migrations apply
only to disposable experimental installations; no adapter-local SQL is used.

The operation input is a selected index/field and a bounded set of exact text
keys. The result is a deletion count. Its acquisition needs matching identities
and predecessor revisions, plus exact predicate evidence. It does not need full
preference `value` JSON transferred to the client. The core stages deletion from
that accepted projection, merges matching pending inserts/updates/deletes through
incremental membership, and checks concurrent membership changes at acceptance.
An adapter must not emulate this operation with repeated point reads and deletes.

Preserve these distinctions: a missing row, an actual tombstone, and a live row
whose body was deliberately not acquired. A projected live predecessor must not
be recorded as a tombstone. If later work genuinely needs its body, acquire the
same accepted revision or refuse; never silently reread a newer row.

Index keys must avoid PostgreSQL's large-btree-entry failure. A bounded fixed-size
fingerprint can locate candidates, but full text equality must disambiguate
collisions. The physical representation remains replaceable; fingerprints are
neither equality proof nor authorization. Account examined historical candidates,
projected rows/bytes, retained evidence and pending edits against shared limits.
Overflow is failure rather than partial cleanup or an empty success.

The accepting profile checks equality-predicate invalidation even for the direct
framework cleanup operation. This is its explicit mutation-query obligation,
not automatic Application OCC for every framework call. The mixed profile also
retains all Application dependencies. Scope order, fresh selected gates, deadlines,
write predecessors, history and one atomic outcome remain with existing owners.

## Native and outer ownership

Payload adapters translate the actual point-delete and cleanup arguments into
selected borrowed operations. The native request uses one logical transaction ID;
native code receives no physical session or settlement capability. The selected
set includes the document and preference definitions. Only the trusted outer
owner publishes both, including the zero-preference case. Do not reserve a child
command for cleanup or return a fabricated successful no-op.

Standalone update/delete keep the direct framework profile and no automatic
native retry. Mixed CRUD borrows the same concrete operations and uses its one
accepting owner. Reuse native argument/result translation and its full invocation
lifetime tracking. Avoid copying settlement/recovery into a CRUD test fixture.
If shared host plumbing needs replacement, keep the concrete profile and authority
boundary explicit rather than adding a universal transaction context.

`payload.ts` now constructs the native binding once and owns actual DAL argument,
result/error and lifetime translation. `payload-host.ts` composes standalone CRUD
with `framework-command.ts`, whose direct framework owner selects definitions,
opens one group, accepts once and resolves unknown accepting outcomes. The old
Payload-specific single-table finalization block is removed. The mixed host uses
the same binding and retains its own explicit mixed accepting profile.

Create/update select only the document definition. Delete additionally selects
the native generated preference definition; a retired preference definition must
not block create/update. Native `deleteMany` admits only the key list for this
specific deletion and the issued preference facet. It returns native `void`
after real projected cleanup, including the zero-match predicate. It neither
starts a child command nor fabricates successful cleanup.

The preference definition verifies the generated native collection's actual
required users relationship, optional indexed text key and optional JSON value.
Its bounded codec admits only the host's `users` relation with text IDs and
uses explicit null for absent optional key/value fields in administrative
seeding. The fixture writer validates that definition through the same core root;
native user/preference APIs and general reference enforcement remain unsupported.

Saved native outcomes use metadata decoding and current operation-specific
collection access. Native update/delete do not independently invoke collection
read access, so their replay does not add that barrier. The mixed graph's explicit
read still checks current read access. Business hooks are not replayed.

## Connected witnesses and remaining gates

PGlite and ordinary-role PostgreSQL witnesses cover the bounded native lifecycle,
preference cleanup, atomic rollback, concurrent matching writers, operation-specific
replay access, uncertain acceptance and cancellation/draining. The equality
foundation separately covers pending membership and actual index plans. These
prove this declared profile. The mixed graph now borrows the same native deletion
and preference cleanup under its one accepting owner; performance acceptance
remains open after the initial failed-goal cohort.

- Real Local API create, persisted-row read/update/delete and complete results;
  defaults, validation, boolean access and admitted hooks execute natively.
- Zero, one and multiple-user matching preferences; unrelated keys retained;
  large preference values demonstrate projected transfer rather than hydration.
- Pending preference insert/update into/out of membership, repeated edits and
  deletes; exact empty/nonempty results and shared-budget refusal.
- A concurrent matching insert/update/delete invalidates cleanup; independent
  keys are a control. Write and predicate evidence must agree after rollback.
- A late native hook failure rolls back the document and cleanup together;
  caught refusal, cancellation, escaped capabilities and dropped DAL continuations
  preserve the existing lifetime contract.
- Actual accepting-response loss resolves one durable result before native
  replay. Saved outcomes use native/metadata decoding and current admitted access.
- PGlite and ordinary-role PostgreSQL results reported separately, with actual
  index plans and retained failure evidence. No active-core mutations.

Only then run matched native/candidate CRUD and mixed measurements under
[VALIDATION.md](./VALIDATION.md). Keep the active-lane preparation failure visible;
missing native atomicity or an Application baseline is not a fabricated match.
