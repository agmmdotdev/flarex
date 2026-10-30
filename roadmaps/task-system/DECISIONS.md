# Task Replacement Decisions

Status: **accepted goal and architecture; first source challenge converged;
runtime boundary under refinement**.
[Design notes](../../design-notes/task-system/README.md) own architecture; this
register records implementation decisions without duplicating their full text.
[OPEN-QUESTIONS](./OPEN-QUESTIONS.md) owns unsettled guarantees.

| Decision | Status | Owner / consequence |
| --- | --- | --- |
| One independently maintained Trigger core fork | Accepted | Adopt actual connected methods/tests into one private package; no full Trigger product or upstream-sync obligation |
| Complete custom Task and physical Task retirement | Accepted | Goal completes only after consumer migration, explicit durable-data disposition and deletion of displaced lifecycle/storage/setup paths |
| Shared logical DB and four-consumer schema lifecycle | Accepted | Existing core owners supply installation/evolution, indexes, eligible cache reuse, settlement and publication; no Task-specific DB/cache/installer |
| Goal/workflow modeled on current core coordination | Accepted | Independent challenges and evidence exchange precede owned workers; significant code still needs both project reviewers |
| First engine proof profile | Accepted bounded proof direction | One queue/capacity policy, single-run transitions, zero explicit Task children, one manual/native wait and opaque checkpoint; not general Task hierarchy or workflow coverage |
| First installation/engine runtime boundary | Under refinement | System-root issuer/target, coherent reader/subject migration, shared lock graph and numeric operation budgets must be specified before runtime assignments |
| Existing core work remains separately owned | Accepted | No overlapping runtime edits or broad staging without explicit ownership coordination; ordinary in-scope fixes use the correct shared owner |

Accepted does not imply implemented or measured. Mark superseded choices with
their replacement, record necessary mechanism changes under
[divergences](./divergences/README.md), and resolve ordinary implementation
questions in the owning slice. Unresolved changes to supported guarantees need
a disposition before that affected runtime path proceeds.
