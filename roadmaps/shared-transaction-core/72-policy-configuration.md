# Execution Policy Configuration

Status: implemented; host-start configuration, fixed protocol ceilings.

## Outcome And Authority

Finish the configuration cleanup from [framework execution policy](./71-framework-execution-policy.md).
Use small policy modules at the existing owners, with one directory here telling
operators where each setting lives. Application protocol ceilings stay in
`flarex-protocol`; migration lifecycle policy stays in migration coordination;
Medusa workflow selections stay in the adapter. Shared framework defaults remain
in `frameworkExecutionPolicy.ts`. Equal numbers do not establish shared semantics.

The accepted design retains separate Application and framework profiles and one
settlement owner. This slice changes configuration construction and reuse, not
transaction ownership, framework capabilities or resource ceilings.

## Focused Preflight

- Extract the existing Application execution/operational constants into a small
  protocol policy module. Keep the current commit-protocol exports and exact
  versioned values; they are used by evidence decoders and persisted journals.
- Centralize migration target defaults, ceilings and installer validation with
  Schema. Capture immutable per-target settings before opening connections.
  Preserve distinct acquisition, transaction, cleanup, lease and run controls.
- Keep logical materialization bounds at their owner. Make Commerce batch
  selections reuse the row ceiling, and name its distinct ordinary working-set
  defaults instead of copying literals into participants.
- Collect the existing named Medusa workflow allowances in one adapter module.
  Migrate its consumers and promotion receipts without changing profile bytes.
- Add optional trusted CMS `requestBudget` selections for calls and cumulative
  bytes, bounded by the supported defaults. Capture them once at construction;
  Payload binding forwards this existing host input. Business arguments cannot
  select limits. The host exposes its frozen effective request budget.
- Preserve omitted-budget replay identity. Explicit budgets use a distinct byte
  domain and include the complete effective selection, so they cannot collide
  with an old arbitrary policy object. Changing a selected budget under an
  already committed request key yields request conflict. No dual reader, data
  reset, public API or wire-format change is required.

Host-start configuration is the selected runtime model. To apply new settings,
construct a new host and retire the old one through its existing close lifecycle.
No global registry, environment-variable naming scheme or live mutation of an
in-flight request is introduced. Application ceilings and CMS storage shape
bounds remain build-time contracts. Extended atomic Commerce deadlines retain
their existing logical-only admission and physical-session enforcement.

## Validation And Completion

Prove CMS selection refusal, capture isolation, aggregate rollback and replay
conflict through actual hosts in PGlite and ordinary-role PostgreSQL. Exercise
the Payload binding with the selection. Test migration policy boundaries and
retain the existing target lifecycle regression lane. Verify protocol fixtures,
affected typechecks, lint and source guards. Both project reviewers inspect the
final owned diff. Remove displaced declarations and update this status before
the scoped commit; preserve unrelated Medusa link edits.

## Configuration Directory

| Setting | Owner | How changes apply |
| --- | --- | --- |
| Framework default request/SQL timings and CMS storage bounds | `persistence-postgres/src/frameworkExecutionPolicy.ts` | Rebuild and recreate hosts; changed defaults need replay compatibility review |
| CMS/Payload request calls and cumulative bytes | `CmsHostInput.requestBudget` | Validated and frozen at host construction, at or below supported defaults |
| Atomic Commerce root calls, bytes, events and command duration | `AtomicCommerceHostInput` trusted selections | Captured and identity-bound at construction; participant caps still apply |
| Commerce profile rows, facts and value nodes | `commerceTransaction/resources.ts` | Validated profile selection; physical installed profiles retain their contract |
| Application execution and evidence ceilings | `flarex-protocol/src/commit-limits.ts` | Versioned protocol change, never request input |
| Logical materialization rows/pages/bytes | `logicalDocuments/policy.ts` | Storage-owner policy, independent from framework call budgets |
| Migration connection and installer policy | `migrationCoordination/policy.ts` | Validated per-target/per-installer construction |
| Named Medusa workflow allowances | `medusa-adapter/src/workflow/policy.ts` | Rebuild workflow composition; core still validates/caps selections |
| Payload pagination defaults and maximum page number | `payload-adapter/src/query.ts` | Rebuild adapter; page-size ceiling comes from CMS storage policy |

Framework feature admission, relation schema cardinality, test runner timeouts,
retention and transport protocols retain their own contracts. This directory is
not permission to enlarge them together.

For example, a trusted Payload composition can bind the same runtime with
`runtime.bind({ ...hostInput, requestBudget: { calls: 32, commandBytes: 524288 } })`.
`host.requestBudget` exposes the frozen effective selection. Omitting it retains
the established default policy and replay identity. Both fields are required
when selecting a budget; malformed, fractional, excess and unknown fields fail
closed before host preparation or database work. This selection reduces the
supported request envelope; it does not enlarge document, page or SQL bounds.

The obsolete `product-shipping-profile-contract.ts` declaration is removed;
workflow and test consumers import the adapter policy owner directly. Existing
protocol exports and materialization facades retain their active consumers.
