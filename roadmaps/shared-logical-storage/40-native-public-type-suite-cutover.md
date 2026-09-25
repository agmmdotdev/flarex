# Native Public Type Suite Cutover

Status: implemented under the shared-storage completion goal.

The retained broad physical Product suite still fails the same three Product
update/event cases on its existing statement budget. Those cases failed with
the previous 206-case entry and again after this Type suite was removed; the
remaining 158 passing and one skipped case have no coverage mismatch.

## Connected Outcome

Run the 13 unchanged pinned `ProductModuleService` Type service cases against
the selected logical Product source. They cover Type create, update, delete,
list, count, retrieve, selected fields, pagination and native not-found errors.
The current public suite still installs generated physical Product tables even
though the selected logical Type commands, event receipts, nullable-reference
delete and two-shop boundary already execute through generic storage.

The native Product service owns Type behavior and emitted module events. The
Flarex logical participant owns scoped rows, unique claims, foreign-key
transitions and one settlement/publication. Reuse the existing Type commands
and operation-specific logical event policies. Keep this a consumer cutover,
not a claim that all Product methods or high-fan-out Type deletion are ready.

## Replacement And Scope

Replace the focused pinned Type suite's physical runner binding with a logical
Product host that admits only the exercised public Type methods. Between cases,
delete Type rows through the admitted logical delete command; retain installed
schema and history. Preserve each original test and its coverage name. Remove
the suite from the broad physical Product entry and its coverage list so it no
longer executes twice. That broad runner remains for named Product event-bus
and other unported methods. The focused Type configuration currently expects
two boundary tests that are not registered by its source entry; correct that
stale coverage inventory while retaining the direct logical Type tests in their
own file.

This intentionally breaks only private test fixture/alias and physical
installation assumptions. It changes no native public Medusa API, named
durable identity or persisted data. Do not add a physical fallback, weaken the
original assertions or bypass the shared event/transaction owner.

## Validation And Completion

The unchanged 13 cases must pass on PGlite and ordinary-role PostgreSQL.
Preserve the direct logical Type regression, including two-shop and bounded
nullable-reference deletion, and the source-promotion guard. Run affected
typechecks and lint, both required read-only reviews, and commit the runner,
guard, coverage and roadmap cleanup together. A shared-owner defect exposed
by the native suite belongs to the core correction path under standing approval.
