# Bounded mixed-workflow diagnostic and removal proposal

Recorded diagnostic campaign only. Runtime source, SQL, request semantics, freshness checks and failure ordering were not changed by this campaign. Instrumentation exists only in ignored test-process transforms and prototype hooks, restored after each process. Later documentation corrections do not establish a runtime improvement. The [owner-cost follow-up](owner-cost-results-and-design.md) supersedes this campaign's original pure-preparation proposal; the current cost inventory owns active implementation status.

Runtime baseline: immutable metadata-key reuse, `7b26a16717da0d681b6c87859139030ebad1d981`. Later Git changes during this investigation were guidance-only commits; SDK authored-source/settings fingerprints remained stable within every completed lane. The unrelated dirty workerd test and `.codex-worktrees/` were preserved.

Current interpretation: the [correlated follow-up](../price-wait-investigation/correlated-results.md) establishes fresh PostgreSQL IO/WalWrite stalls on other captures, while the original 172.1902 ms pricing event remains unresolved and is not added CPU. Fresh source-stable pricing median/max are 2.6064/13.2492 ms across eight full diagnostics. This report's 100-root capture bound describes its own earlier cohort only. Logged Parse/Bind/Execute sums omit implicit transaction completion at Sync; the client-minus-logged difference can include server WAL I/O. The 125 ms paired added thread CPU remains measured excess, not a value to reduce by subtracting the pricing wait. The latest valid quiet baseline remains 34.76/252.58 ms native/Flarex, with 219.55/251.80 ms paired added median/P95, in [metadata-key results](../metadata-key-reuse/results.md); no post-OCC matched rerun is supplied by the pricing diagnosis.

## Historical 172 ms: what it actually measured

The historical 172.1902 ms was an await interval for capture 30, PricingRepository.find population, table 6/index 94. It was not added CPU and not exclusive PostgreSQL execution time. Its original witness lacks the client/server timestamps needed to establish the cause retrospectively.

The new campaign completed all 100 workflows, with no request failures, in 177.32 seconds from the first measured root through the last root; it stopped at the requested count before the five-minute campaign limit. Fixture installation and deployment/seed preparation were outside the SDK request timer; authentication/attempt construction that the existing complete graph performs inside its request remained inside. Verification and disposal stayed outside request time.

All 3,800 capture queries were retained. None exceeded the predeclared 20 ms driver-wait threshold. Pricing wait: median 1.4711 ms, P95 1.7246 ms, maximum 1.8825 ms. Complete pricing capture: median 1.7889 ms, maximum 2.3059 ms. This does not invalidate or explain the historical outlier, and does not establish a fix.

Across the other 22 queries, 101 waits exceeded 20 ms. Slow-statement records matched 76 of these by backend PID and timestamp; 25 lack a >=20 ms server record. Server durations below the threshold are not zero. All unmatched intervals remain unattributed. The slowest client await was 31.64 ms, overlapping a 31.12 ms GC pause, with a matched server execute duration of 21.67 ms. These intervals overlap; they cannot be added or treated as an exclusive causal decomposition.

The separate PostgreSQL sampler polled at 20 ms from another process, was armed before roots, and recorded no blockers or lock waits in matched slow-query samples. This is sampled absence, not proof against short or unsampled waits. GC overlap and event-loop maximum are retained per root.

## Exact cost inventory

Every measured workflow retained 38 captures, 60 actual Client.query submissions and 41 checkouts. Capture mapping retained 39 driver rows and 2,400 positional cells; 1,638 cells are the 42 inactive frontier slots across those rows. Prior exact-demand evidence distinguishes 26 different index ranges and eight different row packets, plus two separately fresh transaction-time captures, one ownership and one historical-identity capture. This campaign verified the same capture kinds/order/counts; it did not repeat the full previous demand hashing/write ledger. The metadata-key change did not change demand selection. The previous exact-demand ledger, rather than SQL count alone, supports zero proven removable business captures.

Observed root latency: median 250.23 ms, P95 270.77 ms, maximum 288.90 ms. Capture envelope: median 65.50 ms, P95 73.09 ms. The following are **exclusive mean elapsed milliseconds per workflow** over 100 roots; they add to the mean root, 253.24 ms. The analyzer partitions all boundaries and asserts equality for every root.

| Exclusive phase | Mean ms/workflow | Meaning |
| --- | ---: | --- |
| Capture driver awaits | 53.82 | PostgreSQL, transport, pg decoding and scheduling before query resolution |
| Other 22 driver awaits | 70.95 | Entry, OCC, application materialization and durable publication |
| Client work outside capture envelopes | 116.13 | Framework/business processing, logical write/result processing, contribution construction and settlement preparation; includes possible scheduling/GC |
| All 41 checkouts | 0.75 | Connection acquisition, excluding query waits |
| Capture preparation | 2.71 | Basis/selection/metadata interpretation before binding-object construction |
| Capture binding object | 0.24 | Placeholder overlay creation |
| Capture driver plumbing | 7.38 | Remaining implicit-driver/preparation/encoding/release intervals, excluding checkout/query/mapping |
| Capture mapping | 0.32 | Native scalar mapper and positional layout processing |
| Capture header acceptance | 0.90 | Ordered local acceptance after the query returns |
| Capture interpretation | 0.05 | Remaining capture result construction |

These are elapsed intervals, not exclusive CPU attribution. The 116.13 ms residual is an honest unassigned phase, not a proven removable CPU block. Driver-await intervals include client serialization/decoding and scheduling; their costs cannot all be charged to PostgreSQL.

Additional query ranking, medians across the same 100 roots:

| Dispatch | Actual operation, confirmed in separate statement-object lane | Driver wait ms |
| --- | --- | ---: |
| 52 | Current index-entry/revision dependency validation | 13.12 |
| 53 | `fx_accept_app_publication` | 6.72 |
| 56 | `fx_apply_app_publication` | 22.42 |
| 57 | `fx_write_scope_publication_prefix` | 9.29 |

The ranks do not prove redundant storage work or removable server cost. Mixed publication's binding freshness check remains required.

## Server, observers and client CPU

The first hook calibration kept the sampler in both lanes and always ran disabled then enabled; it is retained as a limited calibration, not the final observer estimate. The corrected 10-pair calibration alternated ordering and enabled the external sampler only for observed roots: median paired added elapsed time 8.30 ms, range -17.73 to +63.70 ms. This establishes observer variability; do not subtract 8.30 from individual requests or call the campaign quiet acceptance.

Three separate server-duration roots logged protocol durations without SQL text or parameters. All 38 capture statements were already prepared on the actual connection in every root, using five statement shapes. No repeated parse cache is missing. There were 76 capture server-duration events per root; their deduplicated sums exactly match all server events in the complete capture region: 40.029 / 38.945 / 38.646 ms. Capture client waits in those same roots: 57.369 / 54.046 / 53.497 ms. Differences: 17.340 / 15.101 / 14.851 ms. Correction: these are differences outside logged protocol stages, not client/transport-only residuals. They can include server implicit transaction completion and WAL I/O at Sync, as well as client serialization/decoding/scheduling, transport and boundary uncertainty. They are neither separately measured network cost nor client CPU. Log timestamps resolve 1 ms; per-query assignment allows 1 ms slack, while the region cross-check excludes per-query double counting. Whole-root logged protocol duration sums were 96.354 / 94.840 / 95.305 ms, not complete backend response times. This instrumented three-call cohort is separate from the 100-call campaign.

A fresh five-pair complete native comparison, with these hooks and sampler absent, measured native thread CPU median 31 ms, Flarex 156 ms, and paired added CPU median **125 ms**. Paired added values were 125/155/125/110/62 ms. Windows counters resolve roughly 16 ms. This supports continuing excess; it does not establish an improvement against a different cohort.

Five separate root-only profiles used no test-process transforms, demand hashing, driver observers or external sampler. Median sampled elapsed self-weights: Effect 46.59 ms, persistence-postgres 34.89 ms, flarex-protocol 17.30 ms, Node 9.32 ms, Drizzle 7.82 ms, Medusa 6.27 ms, pg 3.13 ms. These are location evidence, not native-subtracted exclusive CPU or removable time. Profile alignment uncertainty was 23.85–31.48 ms; median profile overhead was 15.24 ms. The 125 ms added CPU has **not** been exclusively assigned to functions. Idle/program/GC weights are separately retained and are not charged to those owners.

Two small value-cost lanes retained ordinary canonicalization and private JSON capture; the final lane added private canonical framework-frame capture. The final three calls each had:

- 80 ordinary canonicalizations, 56 distinct profile/content pairs, 24 repeated encodings. Total canonicalization elapsed time 13.75/11.24/9.78 ms; repetitions after the first equal content accounted for 6.66/1.68/2.65 ms. Input object identities differed. Equality proves repeated contents, not permission to bypass input validation or ownership checks.
- 478 private JSON capture calls; 105 already-issued input trees, including 100 borrowed and five detached. Total elapsed 9.42/6.97/7.15 ms. Counts are not 478 full tree walks: existing issued-value reuse remains active.
- Nine private canonical framework-frame captures, five distinct contents, four repeated captures, total 0.85/0.86/0.81 ms. After-first equal-content spans total 0.38/0.35/0.37 ms. **Zero metadata-contract hashes occurred inside these request roots**; projection construction is already prepared outside this root. Some ordinary repeats are test-generated authorization evidence and others are distinct foreign/input validations; do not claim all are runtime removals.

Value timers nest within larger phases and overlap each other; they must not be added to the exclusive table. Stack construction and test-only async wrappers make these observed bounds, not quiet causal savings.

## Concrete proposal, before implementation

**Recommended direction: remove pure per-item execution scaffolding at the existing logical working-set and point-commit preparation owners.** Do not add another business-result cache or transport cache.

The connected design should keep asynchronous/resource duties in Effect and evaluate synchronous immutable selection, row/evidence collection and comparisons as ordered Result passes within their real owners. Carry existing issuer-owned canonical rows and metadata keys through those passes. Convert the result at the existing operation boundary rather than constructing Effect.sync/fromResult/flatMap/exit chains for each pure item. `prepareFiniteSourceAcceptance` is a concrete source example: it currently schedules separate pure row validation and index/unique definition comparisons per item. It is an entry into this design, not a claim that this small function accounts for the profile's entire Effect weight.

The design removes repeated construction/evaluation of execution primitives and intermediate collections. It does **not** remove semantic validation of new/foreign values, policy budgets, observation charging, document-byte integrity, authority or lifetime checks. The same typed failure, defect and interruption behavior must survive, including the first failing item and source order. Existing owner-issued identities are the reuse criterion; equal JSON/hash or caller-authored brands grant no reuse. No new generic validation/cache authority is proposed.

Keep all actual fresh SQL checks and all 38 distinct/fresh captures for the first cutover. Preserve membership-before-body ordering, exact OCC dependencies, post-wait expiry/revocation/readiness/retention and the mixed fresh binding check. Keep the outer settlement owner, lock order, rollback-only behavior and publication atomicity. Do not hold SQL across untrusted execution.

The measurable target is the 116 ms client phase and the capture's roughly 11–12 ms non-query envelope; the 46.59 ms Effect profile weight helps select owners but is **not a savings estimate**. Exclusive cost of the removable pure subset remains unresolved. A focused preflight must enumerate the precise per-item primitives/collections and consumers being displaced before runtime edits; this diagnostic is not authorization to rewrite Effect broadly. If the pure subset proves small, reject that implementation scope and investigate the measured OCC/materialization/publication owners instead. Do not call another 1–3 ms cache a solution to 125 ms excess.

Required proof gates for a proposed cutover: exact foreign/malformed/refusal/budget ordering, failed hash/encoder defects, cancellation and owner disposal; PGlite and ordinary-role PostgreSQL; rollback and concurrent expiry/revocation/metadata/binding changes; affected native Application/Medusa and standalone/mixed graphs; both reviewers; displaced-path cleanup; then the complete five-graph matched CPU/quiet/count matrix with the unchanged <=16 ms added CPU and <=5/10 ms paired added median/P95 latency gates. No acceptance improvement is claimed here.

Ranked exclusions:

1. Generic capture-result reuse: zero proven removable business captures; distinct bounds/rows and fresh time prevent this shortcut.
2. Another prepared-statement cache: already implemented and observed in use for all 38.
3. Checkout reuse as the next performance deliverable: the entire measured acquisition envelope is about 0.75 ms; changing host/pool lifecycle is not justified.
4. Compact inactive capture frontier: 1,638 inactive cells are real, but the entire mapper costs about 0.32 ms. Even removing all mapping does not address the main CPU/latency excess. Wire savings were not isolated.
5. Blanket canonical-value cache: only a few milliseconds of equal-content re-encoding were observed, across different input identities and some fixture work. Preserve genuine foreign validation; do not infer broad savings.

## Follow-up: proposed pure preparation scope rejected

The focused source audit and numeric timing gate reject the proposed pure per-item cleanup as the next performance implementation. Developer-index, unique-key and relation lowering already use ordered `Result` passes. Activity preparation already has generation-based reuse. The remaining source-validation `Exit` values retain typed failures and defects until fresh publication validation reaches their original refusal boundary; deleting that choreography is not a free semantic change.

Twenty complete mixed workflows ran with unchanged authored sources and durable settings, alternating observed/off ordering (ten of each), after three warmups. No driver hooks, SQL sampler, value hashing or diagnostic stacks were used. The ignored test-process transform timed existing passes without changing their results. All requests and cleanup completed. `pure-cost/pure-ledger.json` and `pure-cost-breakdown.json` retain the raw spans and exact counts.

| Existing complete pass | Calls/workflow | Observed median elapsed ms/workflow |
| --- | ---: | ---: |
| Source acceptance, including row validation and definition comparisons | 1 | 0.241 |
| Relational output, matching, sorting and projection passes | 43 | 2.521 |
| Activity preparation, including existing cache hits | 18 | 0.833 |
| Complete finite settlement preparation, including source acceptance | 1 | 1.920 |
| Document settlement lowering, nested inside finite settlement | 1 | 1.325 |
| Finite definition preparation | 1 | 0.858 |

The analyzer asserts that result passes, activity preparation, definition preparation and complete finite settlement are disjoint in each observed root. Their combined entire envelope is median 6.185 ms, range 5.515–7.051 ms. That includes necessary validation, projection, lowering and instrumentation. It is not measured removable CPU or predicted quiet savings. Source acceptance and document lowering are nested inside settlement and must not be added again. Larger relational read/change envelopes include storage waits and are not pure-work removal candidates.

Paired observer elapsed differences have median +9.024 ms and range -12.011 to +60.247 ms. This variability prevents a causal quiet improvement claim or per-request subtraction. The initial transform failed before test execution because of newline matching; its log is preserved as `pure-cost-init-failure.log`. The corrected transform completed its single declared campaign; no failed runtime sample was excluded.

**Do not implement the proposed broad pure-preparation rewrite as a response to the 125 ms paired added CPU.** The source example costs about a quarter millisecond including its required validation. The broader selected envelope is also small and already substantially uses the proposed Result design. The earlier recommendation was a hypothesis; this gate rejects it. There is no supported remaining CPU-saving estimate for it.

The next proposal should be based on attribution at the measured current-index dependency validation, application acceptance/materialization and durable-prefix owners, alongside the still-unassigned client work. Their driver waits are already ranked above, but a driver wait is not exclusive server or client CPU. Establish exact nested statement work and same-request client/server costs before proposing removal; preserve locks, fresh authorization, original refusals, exact OCC and atomic settlement. This follow-up does not authorize a different publication contract or runtime rewrite.

No runtime source was changed, so rollback/concurrency regressions and the complete acceptance matrix were not rerun for a nonexistent cutover. The PostgreSQL fixture is stopped. The previous full acceptance result remains in force.

## Evidence and disposition

`cost-breakdown.json` retains every campaign root's exact exclusive partition, pricing span, GC overlap, sampled waits and matched slow server durations. `supplementary-breakdown.json` retains root counter pairs, CPU attribution limits, server duration cross-checks and value repetition groups. Raw SDK JSON, ledgers, profiles, logs and harness sources are retained in lane directories.

All successful lane SDK reports completed and drained owned resources. Initial configuration/startup mistakes and the first value hook's module-import initialization failure are retained separately; none is a failed runtime measurement silently replaced. Calibration-3 corrected the disclosed observer/order flaw; value-cost-3 extended the disclosed value instrumentation. No failed/slow measured sample was excluded or retried.

The owned PostgreSQL fixture is stopped. No runtime code was changed. All fixed complete performance gates remain open; this bounded diagnostic resolves several low-value removal hypotheses and leaves exclusive removable CPU attribution unresolved.
