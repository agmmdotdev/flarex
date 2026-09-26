# Framework Execution Policy

Status: implemented for source-controlled framework defaults and trusted host
selections. [Execution policy configuration](./72-policy-configuration.md) owns
the follow-up, including CMS/Payload host-start request budgets.

## Outcome And Owners

Give CMS, Commerce and their relational sessions one source for shared execution
defaults and supported resource ceilings. Payload decoding and trusted Medusa
composition consume the same policy through their existing private facades.
Keep distinct profiles and one existing request/transaction owner.

The immediate proof is that changing a shared timeout reaches the actual SQL
settings and request owners, and changing CMS page size reaches both storage and
Payload admission. Previously, code repeated timeout defaults in three models and
literal SQL settings in five hosts. Payload repeated the CMS page-size ceiling.
Atomic Commerce already resolves trusted selections once, caps them by the
applicable participant profiles and includes explicit selections in identity.
Retain that flow and consolidate its duplicated validators and ceilings.

## Design And Scope

`persistence-postgres` owns the source-controlled framework execution policy:
shared request defaults, transaction timeouts, domain profiles and Commerce
resource ceilings. Existing adapter facades expose only the relevant values.
Validators derive from those values. The relational session and atomic host use
one command-duration schema, with their existing domain-specific refusal mapping.
Prepared effective limits are immutable.

This first slice centralizes build-time configuration and existing trusted host
overrides. It does not introduce environment parsing, runtime hot reload, a
global mutable registry or a new public configuration API. Application protocol
ceilings, logical materialization limits, migration/recovery policies, workflow
business batch contracts and framework feature admission retain their owners.
Page size, cumulative bytes, call count, command deadline, statement timeout,
lock timeout and cleanup time remain distinct controls.

One universal budget would conflate different resources and execution profiles.
Only moving declarations would leave SQL literals and Payload validators stale.
The connected replacement therefore includes declarations, schemas, host SQL,
adapter consumers and their boundary witnesses.

## Where To Change A Setting

Use `packages/persistence-postgres/src/frameworkExecutionPolicy.ts` for common
transaction timings, default request calls/bytes, CMS page/document limits and
Commerce resource ceilings. The existing `cmsLimits`, `commerceLimits` and
`relationalLimits` facades project these values for their consumers. Rebuild and
recreate hosts after changing source policy; existing prepared hosts are not
hot-reloaded.

Use the existing atomic host selections (`requestCallLimit`, `requestByteLimit`,
`requestEventLimit`, `requestCommandMs`) for a specific trusted workload within
supported bounds. Its prepared configuration contains the effective limits;
physical participant caps and all-participant byte caps still apply. Logical
atomic commands alone may select an extended command deadline. These inputs
never come from business request arguments.

## Compatibility And Cleanup

- Replace repeated shared defaults and SQL literals with the authoritative policy.
- Replace Payload's copied CMS page/document bounds with its existing CMS facade.
- Retain domain errors and adapter facades; they own real consumer boundaries.
- Retain explicit Medusa workflow selections with their named workload owners;
  their existing core host validates and resolves the selected allowances.
- Preserve values, omitted-versus-explicit selections, participant cap rules,
  request identity bytes, rollback-only behavior and recovery ownership.
- Future changes to default values require an explicit replay/compatibility
  decision: relocating defaults does not version previously implicit policy.
- No durable data, wire format, schema or public contract migration is required.
  Remove displaced declarations within this slice; no parallel policy engine.

## Validation And Completion

Exercise malformed and boundary selections, participant caps, cumulative budget
rollback, deadline refusal and replay. Check database timeout settings under a
real CMS host, and Payload pagination through its native Local API. Run focused
PGlite and ordinary-role PostgreSQL lanes, affected typechecks, package boundary
guards, core/diff/staged lint and both read-only project reviews. Leave unrelated
shared-worktree edits outside the commit. Numeric widening and additional
runtime configuration require a subsequent explicit policy decision.

### Existing Medusa Witness Gap

The unchanged `logical-category-currency-atomic-boundaries.test.ts` scenario
"shares aggregate call and byte budgets and revokes borrowed contexts" currently
receives `invalidAuthority` where it expects `limitExceeded`. This also occurs
with the pre-centralization sources. Its synthetic participant probe is not a
passing aggregate-budget witness; determine the authority refusal before changing
the scenario. Preserve its assertion and do not loosen admission to make it pass.
The separate explicit-root-limit scenario and core cumulative-budget witnesses
remain the evidence for this slice's resource accounting.
