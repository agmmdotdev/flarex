# Explicit cache and admission budgets on the DO host

Design status: **Accepted within the authorized runtime translation**.
Implementation status: **Implemented for the bounded fresh Application profile**.
Measurement status: **Required gates unmet**; production capacity unselected.

## Ownership and decision

The [snapshot/index-cache slice](../slices/06d-snapshot-index-cache.md) owns this
bounded adaptation under the [goal](../GOAL.md). Portable cache semantics stay in
core; Standard invocation owns function admission and nested permit borrowing.
The DO host injects private settings for its admitted workload. No public
contract, native replay profile or durable-data disposition changes here.

## Pinned mechanism and current challenge

At `db914cf06e2b06ee985646611b9e12ed7a770318`, common knobs select a configurable
512 MiB shared index cache, 16 MiB operation cache and verification percentage
defaulting to 100. The shared cache is weighted Moka, not explicitly strict LRU.
FunctionRouter owns separate top-level query/mutation admission; nested calls
reuse their outer invocation. Read budgets and transport pool bounds are not
aggregate operation-memory budgets.

Current fresh execution has an unbounded database borrow set, DO request map and
read-session callback queue. System metadata is not covered by the 16 MiB user
read cap. Snapshot roots and write-log retention have additional memory costs.
All three independent challengers identified this gap; cache eviction alone
cannot establish host memory safety.

## Why the adaptation is necessary

Cloudflare limits memory to 128 MB per isolate; multiple DOs may share an
isolate. It is not a per-app allocation. The Rust server cache default cannot
be treated as a DO allocation. Sources: [Workers memory limits](https://developers.cloudflare.com/workers/platform/limits/#memory)
and [DO in-memory state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/).

The smallest adaptation is explicit host configuration, retaining configurable
source mechanisms and bounded admission rather than inventing a production
number from the platform ceiling. A generic document cache, raw shared global
cache or transport pool limit would not meet these semantics.

## Replacement and preserved guarantees

Require an explicit private workload configuration at DO composition. Validate
settings at construction; bind shared cache state to the owned physical source
and lifetime. Root admission includes bounded active and queued requests,
deadline/cancellation and close release. Bound the retained open query handles and untrusted callback backlog
at its existing owner; overflow retains its real failure and poisons the root
where appropriate. Nested calls do not start a new root permit.

Verification 0 and 100 remain source-supported branches. Test allocations are
test allocations, not production defaults. Source-local portable defaults may
remain available for non-DO construction, but the DO cannot inherit the server
cache size implicitly. No stronger per-hit retention rule is introduced.

No hard whole-isolate memory guarantee follows: retained registry roots,
original/decoded documents, pending batches, in-flight pages, soft write-log
retention, source/bridge buffers, sockets and other DOs still require measured
headroom. Production activation stays gated on the admitted workload and whole
request measurements. Full GC/bounded history remains a separate goal gate.

## Witnesses and remaining limits

Exercise configured capacity, eviction and cancellation; bounded active/queued
root calls; queue deadline; failed setup; nested calls at full admission; callback
overflow; close while queued/active; separate apps and cold reopen. Run actual
workerd plus both database lanes for connected behavior. SQL counts cannot be
reported as capacity or throughput proof. No deployed Cloudflare, Hyperdrive or
managed-eviction evidence is established by this record.
