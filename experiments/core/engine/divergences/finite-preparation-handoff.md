# Finite preparation from the exact original binding

Design status: **Selected adaptation preserving accepted guarantees**.
Implementation status: **Implemented for existing finite consumers**.
Measurement status: **Unmeasured**.
Owner: [04C2](../slices/04c2-exact-selection-preparation.md), within the complete
[single-owner goal](../GOAL.md).

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[run_mutation_inner and FunctionRouter](../../../../../../crates/application/src/application_function_runner/mod.rs)
validate the selected function on the original logical transaction, transfer
its exact begin timestamp, identity, prior writes and typed function metadata,
then merge execution reads/writes into that surviving transaction.
[Transaction::apply_function_runner_tx](../../../../../../crates/database/src/transaction.rs)
requires timestamp equality. Executable metadata registries and source selection
are reconstructed/read at that snapshot through their existing owners.

## Why and how Flarex adapts it

Flarex already has detached, charged preparation under registered repository,
binding, schema and host-generation issuers. A physical PostgreSQL transaction
cannot span Worker/native execution. Retain equivalent immutable selection and
metadata correlation through those actual issuers, then authenticate it at the
existing accepting-entry frontier.

Legacy original preparation already derives its retained basis. Composite
preparation now retains the decoded original head through bindingPreparation and
selectionIdentity. makeCompositeFiniteActivePreparationReader restores the
original readiness through acceptPreparedApplicationRelationActiveRead, checks
its head/basis correlation and issues the matching local selection. The displaced
readActive reselection is removed. No checked-head SQL lock, structural
lookalike authority, lease or generic preparation service is retained or added.

The finitePreparation profile charges the newly retained ready payload through
the original host lifetime and registers disposal there. Ordinary binding
acceptance remains transient. Canonical cold readiness restoration runs in a
short transaction inside the existing current-generation before/after bracket;
fresh entry keeps its admitted metadata checks. Failure cleanup and error
projection preserve complete Causes.

The current Standard configuration wrappers remain a later cutover issue. This
slice must not add unused Standard prewarming or extra hot-path preparation.
It replaces the real finite Product/Payload preparation handoff already present.

## Guarantees, costs and bounds

Preserve exact scope/placement, manifest/source/schema/catalog/publication
identities, activation head/sequence, function entry contract, source composition,
generation borrowing/disposal and charged retained bytes. Before/after current
generation observations still reject an invalid racing construction. A head race
never changes the selected executable silently.

Keep public-only finite roots and existing Application relation/incoming-read
refusals until their separate proofs. Native source relations/extensions and
framework profiles remain supported as currently implemented. Standard
preselected/internal callbacks, stored-profile dispatch and complete finite
activation are not enabled here.

Retaining immutable correlation has bounded preparation cost and removes a
displaced active reread; no throughput or complete-request improvement is claimed.
No tables, persisted anchors or outcomes are deleted. 04C2 owns genuine issuer,
lifetime/race and native consumer contracts; Standard cutover remains separate.
