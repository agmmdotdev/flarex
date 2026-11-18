# Native Payment module and payment-session workflows

## Status and authority

Status: bounded private implementation, validated on PGlite and ordinary-role
PostgreSQL. The selected System Payment session roots use shared logical persistence.

The selected fork is Medusa 2.13.4, revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
`third_party/medusa/SOURCE.json`. The accepted shared logical storage design,
Medusa adoption roadmap and existing atomic workflow owner govern this slice.

## Selected connected outcome

The genuine `createPaymentSessionsWorkflow` root and its
`deletePaymentSessionsWorkflow` child operate on an existing PaymentCollection,
using `pp_system_default` with absent Customer input. They retain complete selected
reads, exact amounts, native provider/service calls, replacement, failure order,
retained inverses, events and transaction rollback. PaymentCollection creation is
a supporting native service operation; no collection-creation workflow is claimed.

Full native metadata includes PaymentCollection, PaymentSession, Payment, Capture,
Refund, RefundReason, AccountHolder, PaymentProvider and the implicit
Collection/Provider pivot. Installation does not authorize every model's methods.
Customer/account-holder execution, Cart and Order Links, authorization, capture,
refund, external providers, host bootstrap and production activation remain gated.
The Cart chat owns Cart/Tax/Customer/Promotion and Links; the Order chat owns its
foundation/archive and approved shared serial/index corrections.

## Shared JSON-object defaults

Native PaymentSession and AccountHolder declare non-null JSON `data` with `{}`
defaults. The original checked DML decoder rejected these values and lowering
mistook every object default for an exact-number companion. The Payment metadata
witness is `packages/medusa-adapter/test/payment-schema.test.ts`.

The explicitly approved shared correction adds `emptyJsonObject` through the
relational schema contract, canonical/physical validation, structural SQL default
rendering, logical row defaults and checked DML lowering. Only an exact empty
object is admitted, only for JSON columns. Omitted insert values receive a fresh
object; explicit null still obeys nullability. Existing exact-number companion
and array defaults remain distinct. Neutral framework fixtures exercise physical
installation/replay/drift and logical inserts separately from Payment.
No populated-schema conversion, reset or new migration engine is selected.

## Native composer and singleton query

The native root composes `createPaymentAccountHolderStep(...).config({
noCompensation: true })` even when its Customer branch will be skipped. The finite
SDK formerly rejected this root at definition time. The approved SDK extension
admits true-only step-instance suppression, preserves ordinary compensation and
sibling/child isolation, and refuses unknown options and child-wide suppression.

The approved singleton query extension admits the named PaymentCollection
selection with `throwIfKeyNotFound: false`, using authenticated graph reads.
Absence resolves undefined, preserving the genuine root's unchecked TypeError.
The native step also has a checked Customer projection for faithful composition
typing; the actual bound Query resource refuses Customer singletons and the root
input refuses Customer. Module resources continue to own query authority.

Type-only adaptations admit native own-undefined inputs and retained nullable
contexts. The root infers its checked Query projection; erased non-null annotations
preserve native unchecked dereferences. They are not validation. The source guard
compares complete typed and emitted programs after only named adaptations.

## Native lifecycle and limits

The root queries the collection and its sessions, composes the Customer branch,
derives session input, and runs creation and old-session deletion in native
parallel order. Up to four selected old sessions are admitted. Unsupported inputs
and excessive cohorts fail closed. Empty deletion still resolves logger/service.

Creation retains its new ID and compensates with genuine deletion. Deletion
retains complete old sessions and compensates by creating sessions with new IDs;
it does not restore the original identities. Native partial deletion logs each
failed call before validation rejects incomplete deletion. Atomic rollback is a
separate storage guarantee, not a replacement for proving retained inverses.

The portable native System provider executes locally. Remote providers require a
separately designed durable-effect boundary; no database transaction may span
those effects. Bounded tests do not establish hosted or general Payment support.
