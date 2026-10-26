# Replaceable modules

Status: proposed ownership map. These are logical modules, not instructions to
create one package, interface, service or directory for every row immediately.
Implement a boundary when the first connected operation uses it.

## Ownership map

| Module | Owns | Must not own |
| --- | --- | --- |
| Definitions | Immutable schema/source compilation, codecs and required query capabilities | Database access, live readiness, request identity |
| Installation | Physical structure, protected writers, generations, maintenance/reopen | Per-operation business execution |
| Access policy | Typed authorization and readiness requirements; pure verdicts from complete observations | SQL construction, connection checkout, framework hooks |
| Query | Bounded logical selection, projection, pagination and dependency requirements | Session admission, physical catalog probing, commit |
| Attempt | Profile-specific logical lifetime, observations, pending state, budgets and sticky failures | Driver/SQL implementation, native business rules |
| Storage | PostgreSQL/PGlite operation execution, fresh gates, snapshots and bounded result decoding | Framework callbacks, workflow orchestration, independent child commit |
| Settlement | Commit candidate validation/planning, atomic materialization/outcomes and uncertain-result resolution | Native services, runtime hosting, per-read construction |
| Physical session | Checkout, deadlines, cancellation/draining/quarantine and release | Schema/readiness policy, business transactions |
| Framework bridges | Payload/Medusa contract translation and native lifecycle integration | New integrity rules, direct SQL, alternate recovery |
| Host | Runtime, Worker/Node transport, configuration and resource construction | Domain policy and committed-data authority |

Storage and settlement share SQL/physical primitives through their real lower
owner. Installation is the exclusive structural writer; settlement is the
exclusive business commit owner for its execution. Do not duplicate policy
between modules or give each module its own admission transaction.

## Dependency direction

```text
host composition
  -> native framework bridges / Application execution adapter
  -> explicit direct-read, direct-command or mixed-attempt owner
       -> definitions + query + access-policy contracts
       -> storage operation contract
       -> settlement contract (write profiles only)

PostgreSQL implementations
  -> those narrow domain contracts
  -> physical session + driver + installed SQL

installation
  -> immutable definitions + physical session + controlled DDL
```

The host supplies implementations. Pure query/policy modules do not import a
driver, SQL builder, runtime host, framework package or global service locator.
Avoid importing a public barrel that eagerly constructs the active runtime.
Keep types with their owning contract; a catch-all `contracts.ts` is not an owner.

## Four important handoffs

1. **Prepared definitions:** exact generation identity plus immutable compiled
   mechanics. They contain no live transaction or cached permission verdict.
   Replacing a schema compiler should not change connection handling.
2. **Read demand/result:** a bounded trusted plan and root binding in; accepted
   rows, exact dependencies and resource consumption out. Physical SQL layout
   and diagnostic observation packets stay inside storage. Unknown driver data
   is decoded there. The result cannot be replayed under another root/snapshot.
3. **Commit candidate:** detached effects, original dependencies, provenance,
   native result/event intent and request identity. It conveys intent, not a
   right to commit. Settlement freshly authenticates it and owns the decision.
4. **Physical execution:** storage/settlement invoke a narrow scoped DB operation.
   The resource owner guarantees deadline and completion handling; raw clients
   never escape to native code or application callbacks.

Define distinct direct and mixed contracts when their guarantees differ. Do not
hide nullable snapshots, optional finalizers and unrelated authority fields in
one universal request object. Borrowed participants cannot substitute a direct
execution implementation if the outer root fails.

## Separate policy from observation without weakening enforcement

For each check, record three pieces: what must be true, which state establishes
it, and where freshness is enforced. A pure readiness function can be tested
with observations; only the storage owner may produce an accepted read result.

For gates that must prevent row transfer inside PostgreSQL, enforcement stays
inside the accepting SQL operation. Select one authoritative policy definition:
either execute it in installed SQL, or compile it from the domain definition.
Do not maintain independent handwritten SQL and TypeScript policy algorithms.
The TypeScript result decoder validates the protocol and maps outcomes; it must
not replay a second implementation of the entire gate. Differential witnesses
check any compiled policy against its source contract.

An initial implementation may retain two dependent database visits when a native
callback makes that necessary. Describe that obligation instead of hiding it
behind an interface. Every visit must have a purpose in the operation trace.

## Replacement examples and expected change surface

| Experiment | Expected edits | Regressions that must stay unchanged |
| --- | --- | --- |
| Replace readiness storage with generation/eligibility records | Installation, storage gate, shared observation contract if necessary | Unrelated-index independence, revocation, maintenance races, query-required readiness |
| Replace row-by-row capture with bounded query execution | Query lowering and storage implementation | Native results, visibility, exact negative/range dependencies, limits and error ordering |
| Change SQL layout/index organization | Installation and storage/settlement lowerings | Logical query/commit contract suite and all connected consumers |
| Change commit batching | Settlement and its SQL owner | Atomic outcomes, concurrent conflicts/uniques/references, failure barriers and unknown COMMIT |
| Change driver/resource strategy | Physical session and host construction | Cancellation, pending work, quarantine, cleanup and settlement uncertainty |

If every change requires editing all modules, stop and fix the boundary. Do not
make the contracts generic enough to accept arbitrary policy or raw SQL merely
to avoid explicit edits. A real guarantee change should require consumer work.

## Testing and iteration mechanics

- Keep reusable behavioral witnesses beside the owning contract. Run the same
  suite against each admitted implementation; real database proofs use both
  PGlite and ordinary-role PostgreSQL.
- Keep failure injection at named lifecycle boundaries in test composition.
  Do not embed a shadow admission/settlement engine in a fake storage adapter.
- Select candidate implementations explicitly in the experimental runner. No
  production feature flag, automatic fallback or dual write is introduced.
- Retain one accepted experimental default. Preserve rejected variants as small
  reproducible patches/evidence when useful, not permanent strategy registries.
- Separate immutable setup from sample execution, and reuse setup for fast local
  iteration. Each sample retains independent logical state where isolation matters.
- Track module imports and SQL/physical-command counts. These explain cost; only
  complete correctness and performance evidence can justify replacing the core.
