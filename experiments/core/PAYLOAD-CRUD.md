# Bounded Payload CRUD continuation

Status: construction contract. Standalone create/read and borrowed native
update/read exist. The [core equality operations](./EQUALITY.md) now supply the
bounded identity projection and accepting predicate checks; their native
preference-cleanup binding, standalone update and native deletion remain
unimplemented. No CRUD measurement or general Payload support is established.

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

Add an explicit bounded text-equality index capability rather than a global JSON
index or adapter-local SQL. Own original index intervals and pending membership
at the core query/change owners. Keep Application numeric queries and their
admitted scalar profile separate; this capability does not silently widen them.
Use Drizzle schema/migrations only in disposable experimental installations.

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

## Required witnesses before measurement

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
