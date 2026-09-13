# Direct Exact Assignment Restoration

Status: proposed; awaiting approval. No runtime change is implemented or
authorized by this document. [Record 66](./66-connected-product-shipping-profile.md)
remains paused at its shared installation gate.

## Outcome, Owners And Scope

Remove the synthetic-driver-row round trip after a successful exact SQL
assignment comparison. Return the same authenticated stored assignment through
the existing issuer, retaining the actual database identity and every current
integrity check. This is a shared persistence correction, not ShippingProfile
logic or a new general verification framework.

Primary owners under `packages/persistence-postgres/src`:

- `migrationCoordination/physicalNameAssignmentRepository.ts`: exact SQL
  comparison, actual result decoding and ordinary mismatch restoration.
- `migrationCoordination/storedRestoration.ts`: authentic stored assignment
  issuance and collision/coordinate invariants.
- `relationalSchema/physical/canonical.ts` and
  `relationalSchema/physical/storedRestoration.ts`: existing pure canonical
  verification and assignment construction.
- `migrationCoordination/migrationPlanRepository.ts`: existing caller and
  assignment ordering/replay checks; no new assembly responsibilities.

Any necessary reuse of `planVerificationScope.ts` stays within its present pure
value entries and bounds. It must not retain stored rows or restored authority.
Do not change graph-pass keys/capacity/lifetime, coordinator transactions,
receipt/event history, lock order, settlement, schema, stored identities, public
exports, tracing policy, module grants or the 90-second fixture deadline.

The nearest connected proof is reliable installation and cold reopening of the
seventeen-table Product/ShippingProfile artifact, followed by its unchanged
native operation suite. Passing this correction does not complete the separate
two-Link workflow draft or activate Fulfillment.

## Evidence And Challenged Alternatives

The accepted FlarexDB design and package roadmap 16 retain authority with
Postgres. [Record 27](./27-product-installation-reconstruction-cost.md) owns
existing pure-verification versus read-only graph lifetimes. Record 66's phase
investigation places substantial cost in shared assignment/plan reconstruction,
but inclusive timings overlap and do not predict this candidate's savings.

Current source supplies a concrete representation round trip:

1. `readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect`
   captures expected canonical assignment evidence and calls the assignment
   inventory reader.
2. `readExactAssignmentRows` asks SQL to compare actual stored canonical bytes,
   byte length, digests, format/version and collision/namespace projections
   against that evidence. It returns actual storage IDs and spellings only when
   the complete requested batch matches exactly.
3. On success it re-encodes expected JSON to UTF-8, decodes expected hex digests,
   and manufactures `StoredRelationalPhysicalNameAssignmentRow` objects.
4. The ordinary metadata restorer decodes those manufactured bytes/projections,
   invokes the physical verifier, checks coordinate/name relationships and
   creates a registered stored assignment. The pure assignment owner also
   compares canonical evidence.

The redundant representation is concrete; the integrity checks are not
automatically redundant. SQL equality does not prove the expected value was
valid, and `PhysicalNameAssignmentReadExpectation` is a structural interface,
not an authentic verified capability. Removing step 3 without replacing the
verification/issuance contract would be unsafe.

[Record 70](./70-typed-physical-assignment-verification.md) explicitly deferred
this SQL-result-to-restored-reference contract. Its withdrawn candidate removed
only repeated structural guards. This proposal removes the synthetic row path;
it does not reinstate that candidate or relax its failed performance gate.
[Record 68](./68-shared-installation-read-pass-overhead.md)'s tracing-only
candidate remains withdrawn.

Do not instead enlarge graph caches, retain authority across writes, skip
receipt/event dependencies, change the fixture, or optimize cold reopening.
Those alternatives either change a distinct integrity contract or miss the
measured dominant path. A broader history-validation redesign needs independent
evidence and approval, not inclusion in this candidate.

## Recommended Private Contract

Keep the current inventory reader and its consumer-facing result. Its exact
branch should compose the existing pure-value verification with the fresh SQL
match and the existing stored-reference issuer directly:

```text
Before: exact SQL match -> synthetic driver row -> ordinary decode -> stored assignment
After:  exact SQL match + verified pure assignment -> stored assignment
```

No caller should import a cache, pass a restoration mode tag, construct a proof
graph, or supply an "already verified" Boolean. No new service, registry,
versioned API or package export is required.

The trusted repository path must bind each SQL result to precisely the expected
assignment used in that query. Pure validation must use the existing canonical
owner, with its exact-byte evidence and bounded operation lifetime where
available. Cold execution still performs full verification. A typed frame,
digest match, shallow freeze or SQL predicate result alone is insufficient.

Keep stored-reference registration in its current issuer. If a small
source-private completion operation is needed, it must accept evidence from
these established owners rather than authenticate arbitrary caller objects by
assertion. It must not expose an independent grant/authority constructor.
Decoding an actual storage ID and authenticating the collision remain mandatory.
Reuse existing value types and validators; do not add a competing assignment
validator or a second memo/authority registry.

### Proof Obligations

| Claim | Required evidence after replacement |
| --- | --- |
| Expected canonical value is valid | Existing physical verifier: canonical encoding/digest, closed frame contract, embedded name evidence and derived spelling; existing size bounds |
| Stored bytes are precisely that value | Fresh SQL exact-byte comparison, not digest-only acceptance |
| Stored metadata agrees | Existing SQL collision/database/schema, assignment/name digests, format/version and byte-length predicates remain |
| Complete requested inventory | Existing batch bound, duplicate sentinel, exact cardinality, unique spelling and expected-to-result correspondence |
| Actual stored identity | Decode actual SQL storage ID with the existing positive-ID decoder |
| Assignment belongs to the collision | Authentic collision plus deployment/target, owner, lineage and namespace-profile checks currently owned by metadata restoration |
| Result is an authentic stored reference | Existing issuer registration; fresh result, no reuse of a prior stored occupant |
| A later database change is visible | Repeat fresh reads; pure verification may be reused, database evidence may not escape its existing read pass |

Keep candidate order and first-failure behavior. Do not eagerly validate all
expectations before the current SQL/mismatch decision if that changes which
failure wins. Preserve current error tags, operation labels and resource-error
causes; defects and interruption must not become a no-match result.

The existing nonmatching/no-expectation path remains the ordinary authenticated
stored-row reader. It is necessary for actual stored corruption, missing values
and cross-collision classification, not a new compatibility or consumer fallback.
Do not add another comparison query or recovery path to conceal a mismatch.

## Retain, Replace And Delete

- Retain ordinary stored-row restoration for genuinely fetched rows and the
  existing mismatch branch, with tests demonstrating its necessity.
- Retain SQL bounds/predicates, actual IDs, full canonical semantics, authentic
  issuance, pure/read lifetimes, public contracts and stored schema/identities.
- Replace only the exact-match synthetic-row result with direct owner
  composition. Any private typed refinement must serve that operation; do not
  carry over unrelated record 70 edits.
- Delete synthetic row fabrication in the exact branch and helpers/imports made
  obsolete by that replacement. Do not retain a dual exact implementation.
- Delete temporary timing/call observers after measurement. No production
  diagnostics or baseline changes are part of this scope.

There is no data migration or external compatibility obligation requiring the
manufactured-row representation. Ordinary restoration remains because it
authenticates different inputs, not because an internal historical API must live.

## Validation And Completion Gates

Before optimizing, add a deterministic owner witness for exact inventory
restoration that proves current issuance and fresh-row checks. After replacement,
it must also prove the exact branch no longer reconstructs/re-decodes synthetic
rows. Call counts alone are not integrity evidence.

Extend the existing assignment/plan suites and shared neutral two-driver
assignment harness. Cover:

- Exact, reordered, empty and batch-boundary inputs; malformed/forged expectation
  frame, digest and canonical JSON; no expectation and cold verification.
- Old digest with changed bytes, changed length/format/version/name projection,
  deleted assignment, missing/duplicate result, wrong storage ID and
  cross-coordinate/database/owner evidence.
- A successful read followed by changed stored evidence, in a new read pass
  within the transaction and in a later transaction; no global warm shortcut.
- Exact equality against semantically invalid expected/stored data must still
  refuse; a mocked SQL true result must not replace pure/collision validation.
- Existing mismatch classifications and first-error order, rollback and
  interruption, driver rejection and ordinary-role PostgreSQL behavior.

Run affected physical verification, assignment, plan, graph-pass, receipt/event,
fresh coordinator and installation regressions, plus unchanged Product/SalesChannel
consumers. Preserve neutral fixtures rather than relying only on Medusa inputs.
Apply Effect data/codec/ownership guidance before implementation; use the current
canonical decoders and narrow error boundaries, not broad recovery.

Performance gate: serialize heavy work and run uninstrumented baseline,
candidate, candidate, baseline on both PGlite and ordinary-role PostgreSQL using
the full seventeen-table ShippingProfile suite. Keep all 106 steps, cold reopening,
timeouts and assertions. Record all samples, including failures; do not retry
until a favorable result appears.

Proposed retention threshold: both candidate runs must pass each full suite;
each completed baseline/candidate pair should reduce installation-plus-reopen
time by at least 5 percent on both drivers. A baseline timeout is censored, not a
numeric duration suitable for a percentage: in that lane require both candidates
to finish within 85.5 seconds (5 percent deadline headroom), alongside the
deterministic removed-work witness. This threshold is an acceptance decision,
not a promised gain. Do not attribute any observed improvement to unrelated
neighboring changes.

If correctness or the reproducible-benefit gate fails, withdraw the candidate
and its specific scaffolding. Do not broaden authority reuse or weaken the
consumer to retain it. Passing samples do not establish the cause of historical
intermittent failures or production performance.

Before a retained implementation commit, run persistence/affected typechecks,
source/private-export guards, core/diff/staged lint, and both required read-only
project reviewers on the exact final owned diff. Stop owned database/runtime
resources and reconcile records 66/72 and adoption roadmap 06. Resume connected
ShippingProfile completion only after its preserved installation gate is met;
otherwise report the remaining boundary.
