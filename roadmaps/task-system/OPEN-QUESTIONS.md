# Task Replacement Open Questions

Status: **open unresolved queue within the paused goal**. The first source
challenge may refine these boundaries; do not treat an unproved recommendation
as an accepted runtime guarantee. [DECISIONS](./DECISIONS.md) owns selected choices.

| Question | Affected work | Required disposition |
| --- | --- | --- |
| Which translated core bootstrap/operation/persistence contract serves private Task schemas? | Next integration slice | Derive it from the pinned mechanisms and physical translation together; current candidate/envelope/clock APIs are replaceable, and no new Task authority may duplicate the core |
| Does the selected cutover require old physical writers to coexist? | Fresh namespace admission | Preserve the actual orphan/racing-writer witnesses; current fresh-generation option is unproved. Choose shared target fencing and explicit old-writer/data disposition before extending a transitional lease-column proposal |
| Which further lifecycle/source closures must be promoted? | Source promotion | Attempt start/snapshot/reached cap failure are adopted and mapped in the new package; independently challenge creation/claims/completion/retry/waits before extending it |
| How does trusted system schema admission bootstrap without Application analysis? | Task installation | Extend existing authenticated producer/target/catalog/readiness owners; label/digest alone is insufficient |
| Which shared core operations preserve fresh claims and waitpoint races? | Store/transaction integration | Prove locks, database time, fences, READ COMMITTED visibility and uncertain-outcome reconciliation without adopting Application OCC implicitly |
| How is the Task lock graph composed without a scope-clock lock upgrade? | Shared logical writes/publication | Existing Task SHARE then run-lock cannot acquire ordinary-write clock NO KEY UPDATE late; derive the shared owner graph and concurrent two-run proof |
| How does fresh subject issuance authenticate logical runs? | Wait/resume and callbacks | Migrate the existing physical-table-reading subject owner coherently; no second metadata/cache-based issuer |
| Which shared-reader edits are handed off from the active core refactor? | System admission/readiness/source binding | Agree ownership of dirty readiness/publication paths before dispatching persisted root-shape or reader migrations |
| What bounds and durable continuation are required for waits/children/repair? | Cancellation, resume and discovery | Specify admitted numeric row/byte/work limits and persisted progress against actual consumers |
| What is the native checkpoint mapping and winner/control-authority contract? | Product/Fulfillment workflow migration | Preserve actual codec, confirm/timeout/cancel outcomes, child receipts and compensation without process-suspension assumptions |
| How do Task writers participate in shared index/cache publication? | Eligible DO cache reuse | Close every admitted writer/maintenance path and prove stale candidates, absence, eviction and restart |
| Which concrete development records/identities survive cutover? | Physical retirement | Inventory named environments and choose migration/reset explicitly before destructive operations |
| How are stale legacy provenance/boundary receipts retired? | Legacy source guards | Current legacy target hashes/attribution and host import admissions already fail the unchanged HEAD guards; preserve these witnesses, validate the new fork independently, and reconcile or remove each legacy receipt with its consumer cutover rather than weaken its checks |

Resolve only prerequisites for the current connected slice. Keep independent
authorized work progressing; pause only the path affected by an unresolved
guarantee. Do not broaden general schema evolution, public APIs or production
activation through this queue.
