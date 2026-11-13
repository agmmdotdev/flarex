# Bounded logical participant allowance

Design status: **Accepted**. Implementation status: **Implemented**.
Measurement status: **Unmeasured**; no deployed capacity claim.

## Ownership and decision

The [native checkout slice](../slices/36-native-checkout.md) and
[Medusa adoption owner](../../../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
own the connected consumer. Store Cart completion with populated Promotions
requires twenty genuine commerce sources: the nineteen-source Customer
checkout and the native Order–Promotion stored Link. The user's authorized
completion promotion includes this bounded framework admission correction.
No named durable data or schema changes are required.

`frameworks/atomicCommerce/nativeConfiguration.ts` and `participants.ts` own
logical participant admission. The pre-correction refusal rejected an explicit
allowance above nineteen before source preparation. The required behavior is
an explicit, identity-bound twenty-source logical root. Keep omission at eight, physical
bindings at eight, every smaller selected allowance, existing call/byte/event
budgets, source authentication and one outer settlement. Core's separate
native-root closure ceiling remains sixty-four.

## Pinned Convex mechanism

Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
The actual immutable source blobs match the hashes in
[REFERENCES.md](../../REFERENCES.md):

- `crates/database/src/database.rs`, `begin_with_usage` and
  `begin_with_repeatable_ts`, select one snapshot; `commit_with_write_source`
  delegates the transaction to the trusted committer.
- `crates/database/src/transaction.rs`, `begin_subtransaction`,
  `commit_subtransaction` and `rollback_subtransaction`, checkpoint the same
  transaction's writes, indexes, metadata and limits.
- `crates/isolate/src/environment/udf/async_syscall.rs`, `run_udf`, lends the
  original transaction to nested execution and restores it afterward. A failed
  nested mutation rolls back its checkpoint.

Convex does not expose Medusa logical-source participants or a corresponding
nineteen-source allowance. This bounded framework composition policy differs
from the source's nested-UDF mechanism; its numeric extension does not replace
snapshot, settlement or lifetime behavior. Relevant upstream tests are absent
from the official pinned database/application/isolate tree. The translated
neutral database witnesses below carry the required admission evidence.

## Current core and challenge

The independent challenges traced both the executing native completion graph
and the shared admission owners. Order–Promotion is a genuine stored Module
Link created by the native workflow for every Cart promotion. Dropping it,
synthesizing its result or grouping source identities cannot preserve native
behavior. Reusing the existing bounded participant owner admits the complete
graph without another root, database transaction, lifetime or host runtime.

`nativeConfiguration.ts` authenticates the source selectors against installed
source/configuration/provenance identities and includes selected and effective
participant allowances in the root contract. Core's `bindNativeRoot` and
`bindNativeRootRecovery` already admit up to sixty-four sources. Existing
[native root participation](./native-root-participation.md) continues to own
the necessary current-first visibility and sticky native failure differences;
this change does not adopt catchable Convex child rollback.

## Replacement mechanism and guarantees

The existing AtomicCommerce participant schemas admit explicit limits through twenty.
Allowances above eight remain logical-only in `captureAtomicCommerceParticipants`.
The native configuration continues to require authentic native sources and
bind the complete selected policy into durable request identity. Existing
per-source and aggregate document limits still apply. No new capability,
independent commit, retry, recovery route or fallback is introduced.

The observable admission change is limited to explicit twenty-source logical
profiles. Omitted limits and explicit smaller limits retain their refusals;
twenty-one remains unsupported. Ordinary Application OCC and native profiles
remain distinct. The two existing framework paths retain their own source
authentication and share the same bounded policy.

## Required witnesses and limits

`atomicCommerceParticipantLimitCapture.test.ts` exercises twenty-source admission
and default/smaller-limit, malformed-limit and physical-cohort refusals. Its
twenty-source expectation reproduced the original admission failure before the
owner correction.
`checkoutParticipantAllowanceScenario.ts` exercises twenty genuine neutral
logical sources with overlapping local row IDs, callback-free replay, complete
rollback and allowance-bound request identity on PGlite and ordinary-role
PostgreSQL. Its ordinary call-budget refusal must remain effective.

The connected populated native checkout and local Workerd HTTP route must also
pass their own consumer gates. These bounded witnesses establish neither
production activation nor arbitrary source counts, concurrency or capacity.
