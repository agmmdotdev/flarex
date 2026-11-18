# Full-source issuer correction: failed performance candidate

This preserved run measures the full-source issuer correction before the explicit
pin/frame API split. Its directory name is historical; it is not the final source
or an accepted performance result. The [raw report](./mixed-workflow.json) and
[command receipt](./command.json) remain unchanged.

`pnpm perf:core --scenario mixed-workflow --full --sql` ran three warmups, twenty
quiet fresh requests with real settlement, and one separate SQL diagnostic on
ordinary-role PostgreSQL. All requests succeeded semantically. Quiet median was
**871.883 ms**, P95 **1,906.934 ms**, and range **824.962–3,189.867 ms**. The command
took **123.026 s**. Keep the tail samples; they are not discarded as outliers.

The diagnostic submitted **872 statements in 63 transactions**, compared with
736/63 in the [initial candidate](../frontier-candidate-full/README.md). The extra
136 statements occur in completion: freeze/seal adds 24, publication adds 112.
The correction unnecessarily reacquired Application issuers for frame-only full
verification. The subsequent explicit source-owned pin method separates genuine
finite correlation capture from that verification. This report does not measure
that replacement or prove the cause of its whole-request timing distribution.

No open transaction, query error, lost context, unknown/unobserved dispatch or
incomplete diagnostic span remained. Fewer SQL statements, a successful graph and
the direct request distribution do not prove the fixed native additive budget or
the unchanged metadata-scaling matrix. Both remain separate acceptance gates.
