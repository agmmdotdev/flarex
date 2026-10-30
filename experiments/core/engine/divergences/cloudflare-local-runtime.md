# Local Cloudflare runtime selection

Design status: **Selected host adaptation for actual-DO validation**.
Implementation status: **Selected default dependency integrated with bounded local host conformance**.
Measurement status: **No capacity or hosted deployment claim**.
Owner: [actual DO query composition](../slices/03-application-query-do-host.md).

## Pinned reference and necessary difference

Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5` owns its production
[runtime](../../../../../../crates/runtime/src/prod.rs). Flarex keeps the portable
query/cache owners and injects the Cloudflare host; its local execution proof
therefore also depends on workerd's native object and stream lifetimes.

The previous local dependency, `workerd@1.20260611.1`, identifies source
`b9df84ad68884a8ec2b4ac8e06576dbfdd653f40`. Its `newCppHeap()` requests atomic
sweeping, but the pinned V8 `14.8.180` overwrites that request, and its patch set
has no correction. Upstream [e5803288](https://github.com/cloudflare/workerd/commit/e5803288aef5315a69cfcb759cfec11311464586)
restores that constraint and adds regression coverage for finalization involving
Response/R2 stream objects during isolate shutdown.

The first published release containing that correction is
[`workerd@1.20260929.1`](https://github.com/cloudflare/workerd/releases/tag/v1.20260929.1),
source `82b85cf9f6de50c921b83a4d3b8a005ced8b513a`.
The June host has produced native access-violation exits during the actual
Application scenario. No native fault stack attributes those exits to this
specific bug; a passing comparison cannot establish that attribution.

## Selected integration

Pin the existing Miniflare dependency's workerd resolution to `1.20260929.1`
through a scoped workspace override of `workerd@1.20260611.1`. Keep Miniflare,
the authored compatibility date, driver, database and query semantics unchanged.
Use one selected default runtime for these existing consumers rather than a
test-only executable override that leaves normal validation on the failing host.

This selects a source-corrected runtime with a complete bounded functional proof;
it does not weaken failure handling, add an error filter or replace the
PostgreSQL-specific transport end contract. The
[socket owner](./pg-cloudflare-shutdown.md) still joins every exposed cleanup
outcome before query cache publication.

The affected consumers are the private query DO and existing local Miniflare
Application fixtures. No production route is activated, no application data is
reset, and PostgreSQL remains the only committed application-data authority.
DO restart still discards optional RAM cache state and reconstructs from PostgreSQL.

## Required proof and remaining limits

The default Miniflare lookup selects the installed September executable; the
executor and node-postgres resolve the same patched socket package. The
[DO scenario](../../../../apps/executor/test/applicationDO.postgres.test.ts),
[native cancellation witness](../../../../apps/executor/test/pgCloudflareSocket.native.test.ts)
and [STARTTLS witness](../../../../apps/executor/test/pgCloudflareSocket.postgres.test.ts)
exercise that selected runtime. Existing Application query, mutation, action and
authority regressions retain separate PGlite and ordinary PostgreSQL evidence.
Package/binary identities and validation receipts belong in Git; the isolated
comparison executable is not required by normal test execution.

Hosted Hyperdrive, managed eviction, production activation, complete-request
capacity and native framework hosting remain separate gates. The source-backed
runtime selection does not establish the precise cause of the previous native
access violation or general Windows runtime correctness.
