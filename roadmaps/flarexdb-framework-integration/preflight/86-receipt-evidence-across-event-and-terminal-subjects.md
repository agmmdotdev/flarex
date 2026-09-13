# Receipt Evidence Across Event and Terminal Subjects

Status: implemented slice within approved preflights 76 and 84. Normal steps
already use record 85. This slice concerns the retained full read operation.

The displaced event read restored its receipt subjects and then separately
restored the terminal's complete receipt prefix, each with its own receipt graph.
Even with shared attempts, exhausting the optional memo causes the same receipt
and its edges to be issued twice. A complete prefix inventory remains necessary:
event membership cannot establish the absence of omitted or future receipts.

The receipt repository owns an explicit per-plan working graph for one event
read. The event assembler passes that same graph to receipt-subject and terminal
prefix restoration. The prefix still reads its complete bounded root inventory,
decodes the actual rows and checks fence, ordinal, count and tail. Its matching
nodes reuse the already issued receipts and exact dependency evidence. Root
inventory transport is distinct from receipt/edge issuance and is measured
separately. The graph is bound to its raw read transaction, remains source-private,
and is neither a cached installation result nor restored authority by itself.

This reuses the existing receipt closure/context owner. It does not grow the
optional memo, reorder receipt failures behind terminal failures, infer receipt
membership from events, or remove independent terminal/reference contracts.
Contexts are indexed by plan because step identifiers may repeat across plans.
Sparse terminal histories still resolve their actual prerequisite references.
No schema, canonical identity, protection, transaction or activation change is
introduced. Remaining admission/publication/restart paths retain their gates.

Retain complete inventory queries, exact root/sidecar decoding, producer ancestry,
fork rejection, terminal prefix handles and canonical codecs. Replace separate
event/terminal receipt working graphs in the connected event reader. Independent
receipt and terminal readers retain local working graphs for their own read.

Validation measures receipt issuance and dependency edges with the optional memo
exhausted, increasing steps and attempts, and sparse event membership. Existing
malformed, extra, omitted, future-fence, duplicate and fork witnesses remain.
Run affected owner and coordinator tests, both database lanes and installation
consumers, typechecks/lint and both scoped reviews before the scoped commit.
Logical retained-storage witnesses bound one raw root and one issued node per
receipt in each tested plan, alongside the shared sidecar map; canonical payload
storage is proportional to those roots. A/B/A traversal separately exercises
independent and connected per-plan contexts. These are structural bounds, not
process-heap or production peak-memory measurements. Exact cached-root canonical
JSON and digest agreement prevents an altered valid inventory row from being
hidden by a previously issued receipt.

This slice alone does not complete full installation linearity or record 74's
frozen timing acceptance.
