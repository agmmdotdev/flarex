# Confined native root participation

Status: **Selected private roots and complete Product/Variant workflow composition
implemented through the shared kernel, including complete repository/event
failure observation; broader native composition and hosting gates remain open.**

## Source and required native behavior

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` shares one transaction through
its nested-call mechanism. Translate that single state owner. Its ordinary
Application snapshot and catchable child write checkpoint do not define the
existing Currency/Payload/trusted-insert profile: this native root uses explicit
current-first remembered observations and sticky failed nested commands. Those
required differences are already owned by native visibility/failure records.

## Selected translation

Seal an explicit root binding over selected native source/command capabilities
and one Application-owned table insert grant. `beginNativeRoot` creates one
transaction kernel. Immutable child access descriptors supply confined closures
over the same semaphore, writes, pending indexes, observation state, root time
and finalization vault. Do not mutate ambient authority or grant every child a
union of source access. The App child can insert and read only its own pending
insert; generated-ID absence, validation, accounting and staging still pass
through the same kernel. It has no committed read or general Application facade.

## Native16 protected consumer extension

The existing authored reverse-page consumer inserts an Application row, consumes
native pages, then patches that same pending row. Preserve this developer logic
through the ordinary point-patch syscall and unchanged Worker kernel. Extend the
existing one-insert grant with a confined pending-only patch; do not grant a
second insert, committed/foreign row mutation, replace/delete, query, transaction
or finalizer. The same generated Core ID, namespace, table validator, authority,
staging and budgets apply to every attempted patch. Failure remains sticky and
does not refund already consumed resources.

The protected profile also carries a separately confined Application point-read
grant for the backend-selected permission record. Its exact immutable program
revision and current head, explicit global authority epoch, consumed table
validator and tracked point observation remain with Core. This is separate from
the pending-insert view and cannot be used to self-grant through ordinary writes.

The actual authored insert → native pages → pending patch consumer and foreign
or committed-row refusal must be proved through the private generated Worker on
both databases. This extension does not broaden the retained Native15 consumer
or establish a general framework-facing Application transaction API.

Add a truthful `nativeRoot` case to the existing Core claim/outcome owner. Root
identity covers selected source identities and actual child command/table/profile
semantics, including target scope/epoch UUIDs. Unrelated producers, whole bundle
hashes, allocated schema/table/index IDs and runtime authority epochs are not
durable command identity. They remain operational binding/acceptance fences.

The trusted outer host authenticates/captures, claims or recovers, and returns a
committed replay before constructing participants or invoking callbacks. It
projects one bounded lifetime into existing Commerce/CMS/Application domains,
executes and drains native work, captures/charges the result, seals/closes once,
finalizes once and commits once under the original deadline. Uncertain persistence
outcomes remain with Core recovery; no adapter retry/materialization engine or
SQL transaction spans callbacks.

## Resources and refusal

One retained-byte allowance is 1 MiB, calls 64, original deadline 10 seconds and
per-document allowance 64 KiB. Preserve source-specific captured identity caps:
Payload 256, Currency 128 and App pending insert 1; their finite union is 385.
The existing final joint limit is 128 changed user identities after coalescing:
equal-body attempted updates and existing-row deletes count, new insert-then-delete
and system records do not. Use the existing writes map at finalization; Source
per-stage write charges have different meaning/timing. Do not allocate separate
lifetimes/byte counters or silently replace these caps with a global 256 limit.

Native promises remain with their existing framework continuation owners. They
retain full Causes, cancellation and root failure provenance; they receive no
settlement capability. Unsupported events, relations and preferences fail closed.
Ordinary Application OCC and standalone native read profiles remain distinct.

### Medusa repository observation versus later capture

The [Native18 continuation](../slices/18-native-product-multi-source-workflows.md#repository-failure-propagation-and-later-capture)
keeps failure observation separate from admitting a new operation. Repository
`checked` receives Effect work that may already have failed and been latched.
Observe its complete Cause through the existing context's `recordFailure` and
propagate the returned owned Cause; if observation refuses the context, preserve
both the original Cause and that refusal. Re-entering `ctx.refuse` fabricates a
new operation and masks propagation with another rollback-only check. Observation
adds no calls or bytes and creates no new transaction, lifetime or failure cache.

Product's event-check bridge follows the same rule. A missing supplied Product ID
can enter native upsert's create branch; its `product.created` event is refused
by the selected update profile before the later update-receipt validator runs.
Preserve that first `unadmittedEvent` and observe it through the existing checked
repository context. Do not re-enter `ctx.refuse`, grant the event, or reorder
native work merely to obtain a different refusal. Fresh decoder failures still
poison the active context before event capture, while borrowed and revoked
contexts retain their existing authority checks.

A callback that catches a refusal and returns successfully is different: result
capture is a genuine subsequent operation. Its rollback-only rejection retains
the original failure, and the outer seal still adds its own marker. Preserve
every actual reason and authenticated origin; do not globally erase derived
refusals or treat unrelated occurrences of the same Error as one failure.
This does not replace native sticky failure with Source's catchable handler
checkpoint or alter the separate Payload Promise-completion boundary.

## Proof and retirement

Prove wrong-source/forged/stale child refusal, shared pending visibility,
first-current/remembered observations, exact resource boundaries, caught nested
failure, native continuation draining/cancellation, callback-free cold replay,
unknown acknowledgement recovery and one atomic publication/outcome. Migrate
the selected announcement and matching admission witnesses; retain the old
Application-relations consumer under an explicit later removal gate. No new
host may fall back to that old session/contribution/materialization path.
