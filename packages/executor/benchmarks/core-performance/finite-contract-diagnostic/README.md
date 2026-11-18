# Finite Execution Owner Diagnostic

This focused mixed Product run retains the tracer's existing sanitized dispatch
groups alongside the previous summary. It uses one warmup, three measured
requests and one separate SQL diagnostic; it is not latency acceptance evidence.
Collector mode, SQL values, execution behavior and correctness gates are unchanged.
SQL groups preserve structure, counts and awaited intervals without parameter
values or SQL literals.

The diagnostic records 563 submissions and 50 transactions. Publication has
150 control and 69 target submissions. Control groups include 63 index-catalog
loads, 16 exact table loads, 15 scope/deployment lookups, three schema artifact
loads and three schema-identity lookups. The preparation phase includes nine
control transaction/installation-interlock groups. A group count does not show
that all invocations selected the same metadata identity or that a check can be
removed; source attribution and lifetime/barrier evidence remain required.

Before/after supplements verify the unchanged pinned native output inventory.
The original full five-scenario reports remain in `../finite-contract-direct`.
This diagnostic does not replace their samples or the failed native latency
acceptance in `../finite-contract-native`.
