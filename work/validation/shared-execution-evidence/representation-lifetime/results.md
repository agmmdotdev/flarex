# Representation lifetime investigation

**Runtime is unchanged. This investigation establishes no CPU reduction and does not explain the entire native-relative gap.** It identifies a small duplicate event-encoding pass and several bounded redesign candidates. It does not justify a broad canonical-value cache or another broad Effect rewrite.

The latest uninstrumented control remains the prior restored-source **110.200 ms mean / 108 ms median added thread CPU** over 40 matched complete workflows. Historical 125 ms is not the current baseline and cannot be subtracted from this campaign. See [the previous result](../composition-snapshot-reduction/results.md).

## What was measured

Reused the measurement SDK's complete `mixed-workflow`, `small`, ordinary-role PostgreSQL reference, root counters, five warmups per process and all business-result/cleanup gates. Two sequential processes used 32 matched native/Flarex pairs each: `a` recorded ABBA and `b` BAAB. A means recording enabled, B disabled; native roots never record representations. All 64 pairs passed. The 32 observed roots had identical operation counts.

The diagnostic Vite transform observes selected synchronous representation owners, Schema decoders and structuredClone callsites. It records request-local exact object identity without reading object properties, exact string equality, primitive distinctions, phase, selected parent and canonical-JSON callsite. It reuses `createCyclePartition` for disjoint current-thread cycle attribution. Async canonicalization/digest entries are counts only; they do not time SHA work or span awaits. Same-site recursion counts as one top-level walk. Thus a family encoding includes its nested event walks without separate nested event entries.

| Instrumented thread-cycle partition | Mean share of observed root |
| --- | ---: |
| Selected representation functions | 23.8355% |
| Explicit identity-ledger bookkeeping | 7.7438% |
| Outside selected representation functions | 68.4207% |

These are **instrumented current-thread cycles, not milliseconds, added CPU versus native, or removable CPU**. Boundary guards/calls, changed JIT behavior and GC effects remain; bookkeeping is not a complete observer subtraction. The partition covers the entire Flarex root, including work common with native. Its cycle bracket surrounds the SDK counter capture, so it also includes counter-read overhead; it is not exactly the root CPU-counter window. It does not cover crypto worker threads. The outside bucket is not synonymous with Effect: it also contains other application/persistence/driver/Schema work and instrumentation effects.

The on/off comparison demonstrates material observer cost: mean added thread CPU was 142.250 ms with recording versus 104.5625 ms without; the balanced four-pair block difference was **+37.6875 ms**. Whole-process difference was +53.53125 ms. These are descriptive estimates, not a confidence-bounded production result. Disabled roots still run transformed guards/wrappers and share a process with recorded roots, including allocation/GC carryover. Neither value replaces the uninstrumented control. No profile spacing, cycle-frequency conversion or subtraction from historical 125 ms is used.

## Actual repeated work

| Owner | Calls per observed workflow | Finding |
| --- | ---: | --- |
| Private JSON capture | 478 | Largest selected individual owner: 4.3551% exclusive instrumented root cycles. Of 476 object inputs, 428 were distinct references; all-argument tuples numbered 444. Repeated entry is not necessarily a repeated full traversal. |
| Runtime value normalization | 224 | 64 object inputs were all distinct. 135 string calls used 17 different strings; 25 scalar calls used one value. Most apparent repetition is scalar index-component processing. |
| Whole canonical JSON encoding | 270 | 270 different input references produced 141 different texts. Total encoder cost was 1.1662% exclusive instrumented root cycles. Equal outputs from different sources do not establish interchangeable authority. |
| Ordered component encoding | 485 | 2.0077% exclusive instrumented root cycles, including required component/key validation. Calls are not duplicate complete index writes. |
| Byte-to-hex conversion | 882 | 1.4143% exclusive instrumented root cycles. Count alone does not justify dropping physical key or evidence checks. |
| Logical unique-key lowering | 53 | 53 different full input tuples. Existing cache and integrity checks remain owner-specific. |
| Logical index-key lowering | 5 | Five different full input tuples. |
| Actual developer index-key lowering | 58 | 58 different full input tuples; 46 definition references. Reusing a definition across different documents is required work. |

`privateJsonData.capture` already recognizes issued immutable values. Its fast path still enforces current bytes/depth/policy bounds; public capture detaches and private owned use can reuse. A foreign wrapper gets its original descriptor/prototype/key/cycle/Unicode checks. This probe did not separately count full node traversal versus issued fast-path use, so it cannot declare all 478 calls removable. The earlier immutable-handoff candidate already failed the full performance trial.

`relationalRows` already retains canonical interpretations and derived keys with owner/revision and definition identities, mutable byte/digest checks and current charge limits. Detachment deliberately removes derived-key ownership. Copying a WeakMap verdict across roots or accepting equal serialized data would bypass those obligations.

## Concrete redesign candidates, before implementation

1. **Reuse the event text within one digest invocation.** In `commit/events/digest.ts`, the bounded loop encodes each event to charge UTF-8 bytes, then `encodeCanonicalJson(events)` recursively encodes the same family again before hashing. The workflow calls this owner twice: six events during commerce closure and seven during publication, giving 13 individual encodings plus two whole-array encodings. The individual text totals about 8.17K characters; the two arrays about 8.19K. Retaining each accepted event encoding and forming the canonical array from those strings can remove the second object/key traversal and duplicate primitive stringification. Keep the count check, each event's byte check in original order, historical stored-family ceiling, array order, hash input and SHA verification. Audit all callers for genuinely owned immutable events; do not change foreign getter/mutation behavior based on a TypeScript type. Fresh stored-family verification and the later seven-event publication digest remain required. This is duplicate encoding, not duplicate publication facts. Its CPU saving is unmeasured and is a subset of the small encoder budget above.

2. **Simplify private metadata tuple-key construction at its existing owners.** `finiteMetadataDependencies.ts` makes 85 canonical encodings yielding 35 texts, totaling only 4,448 characters. `sourceAdmission.ts` makes 34 encodings yielding eight texts, totaling 2,636 characters. Source inspection shows repeated locally constructed tuple keys for contract, owner and write-closure lookup, alongside necessary object comparisons. Retain prepared tuple text within the existing projection/attempt owner or use the existing primitive-tuple framing convention where its contract is exactly equivalent. Do not turn equal bytes into acceptance, cache negative observations, remove actual transaction observations, or replace object canonicalization indiscriminately with JSON.stringify. Private tuple construction should preserve primitive spelling and refusal behavior; public/foreign contract-key inputs retain their full behavior. This is a small allocation/traversal cleanup, not evidence for tens of milliseconds of savings.

3. **Investigate index-component handoff only if a later focused profile warrants it.** `orderedIndexValueFromFlarexValueV1` normalizes a component and validates it through component encoding; final key construction then encodes the full key. The many equal scalar inputs come largely from this path. A future authenticated canonical-component handoff might reuse projection beneath the existing canonical document owner. It must keep missing/null distinctions, path interpretation, predicates, exact decimals, text-equality formats, component and whole-key size checks, current mutable-binary checks and original error order. No change or savings claim is authorized by these counts alone.

The first two are concrete bounded candidates, but the evidence does not make them a plausible complete explanation of the CPU excess. The next attribution priority is the **68.4% outside these selected representation functions**, using the existing low-overhead root-counter/profile harness to distinguish engine scheduling, remaining Schema/validation composition, and SQL-driver/result handling. Do not add this partition to the earlier generator/engine partition: they are different instrumented experiments and overlap semantically. No new production measurement API or runtime layer is needed for that next pass.

## What remains necessary or unproven

- All 80 canonical-value constructions use distinct normalized object records; their 56 distinct output texts do not prove 24 removable digest operations. Stored input, request/outcome evidence, document revisions and later publication can require equal values to be freshly proved.
- Active-head encodings occur at admission, execution and publication. Equal text does not justify reusing a prior mutable database observation.
- Capture, returned tuple checks, publication membership and final stored proofs stay in original order. No aggregation or batching change was made.
- The transform records phase labels through the existing fixture. It is not a complete object graph of every member, a byte-by-byte provenance proof, or exhaustive attribution of unobserved work. The seal compatibility encoder was not a measured duplicate hotspot on this workflow.
- The 172 ms historical pricing wait remains separate elapsed-time history; this run neither reproduces nor explains it.

## Reproduction and evidence

Current checkout, base `984f6c0875947614c60c8e3f01bad0c7cfb48bf5`; no worktree was created. `a/` and `b/` contain the SDK raw JSON/text reports and gzipped identity ledgers. Each ledger records native-reader hash, transformed source hashes, and before/after hashes for the probe, evidence schemas, transform, campaign, configuration and launcher. Both processes used identical source manifests. The scoped `.gitattributes` preserves the exact measured producer bytes; every staged producer hash was checked against both ledgers. `summary.json` and `analysis.log` come from `pnpm exec vitest run --config work/validation/shared-execution-evidence/representation-lifetime/analysis.config.ts`. The analyzer requires both 32-pair campaigns, complete business/cleanup gates, balanced blocks, matching manifests and reconciled cycles; it resolves report basenames beside each ledger so moving the checkout does not break analysis.

Start the existing local PostgreSQL fixture on port 56434 with its ordinary `flarex_cpu_fixture` and provisioning `postgres` roles; logging/statements/profiling remain disabled as in the prior CPU fixture. The existing native `thread-cycles.node` in `../engine-cpu-attribution/` is required. Run `run-campaign.ps1 -Label <fresh-label> -Samples 32`, then another fresh label with `-Reverse`. The checked-in analyzer expects recorded labels `a` and `b`; change those deliberately for a reproduction. Existing labels are refused. The earlier four-pair smoke predates the final probe and is excluded from all results.

Validation: six forwarding/identity/AST unit tests passed; diagnostic TypeScript check and core/diff lints passed. Both required read-only reviewers examined instrumentation and corrected evidence issues before campaigns. Final review independently reproduced the summary and reconciled counters, assignments and source hashes; both reviewers reported no remaining findings. The analysis reproduction test and exact-index diff lint also passed. Source parsing covered 177 authored modules without transform exceptions or TypeScript parse errors. The 64 matched ordinary-role PostgreSQL workflows passed every business and cleanup gate. PGlite was not rerun because no persistence behavior or query plan changed; this is not a new SQL/isolation validation claim. PostgreSQL was stopped and `pg_ctl status` confirmed no server running. Unrelated finite-snapshot test edits and `.codex-worktrees/` were preserved.
