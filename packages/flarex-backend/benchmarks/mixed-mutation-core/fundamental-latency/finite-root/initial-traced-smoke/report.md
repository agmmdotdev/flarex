# Private mixed mutation performance baseline

Revision: `e704b60d332e645251aa508f62fc7c0a3b6ee4b0`; working diff SHA-256: `6d7675081bdf046863d7ce570f972b90999a66e571a6fcb8f78bce3998326ab5`; mode: **smoke**, observation: **traced**.
Plan: 1 warmups, 2 measured warm samples, 1 cold samples per workload.

The request interval starts before fresh admission and ends after authoritative publication and retained-outcome resolution. The outer invocation wall envelope includes trace finalization, which is reported separately. SQL awaited time includes driver and database wait; it is not server execution time. Nested phases and overlapping query waits are non-additive. The standalone graph has fewer root obligations, so its latency delta does not isolate framework overhead. No native ORM parity or hosted transport claim is made.

## Environment

```json
{
  "postgres": {
    "serverVersion": "18.3",
    "fsync": "on",
    "synchronousCommit": "on",
    "fullPageWrites": "on",
    "sharedBuffers": "128MB",
    "role": "flarex_runtime_1790590397284_qfs7usz93a",
    "superuser": false
  },
  "node": "v24.16.0",
  "pgDriver": "8.22.0",
  "platform": "win32",
  "architecture": "x64",
  "cpu": "AMD Ryzen 7 5700G with Radeon Graphics         ",
  "logicalCpus": 16,
  "totalMemoryBytes": 16422113280,
  "targetPoolMax": 10,
  "transport": "pg TCP socket; private Worker bridge is in-process test harness",
  "sourceHashes": {
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "9e2df1da667b0995745d31d1b1e91ed46aabd5b6916dd6f01acb4c5d509527ac",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "e0df5ba6534a52199b11290a77ef6db7bb1a5af3f15977ceaf7cfc70eb94e462",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "27cbb62d616c3c6a9413bab17903a3975da1edc7821f911a27048bd541676fd5",
    "packages/persistence-postgres/src/applicationActivation.ts": "af29252779772604269b21a36ff19f200a46cc686918be7c29dd7d673bf7db8d",
    "packages/persistence-postgres/src/applicationReadiness.ts": "54cab5b3fe5f570ddaac5e8858794418c192eedd16e24d7a2c5996b604bfa219",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "ba5b30d3338f1b5301ce4c0dcc77f3c7ef7bb58bc7701ce2561d572fb68d9735",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "5cc33d2363d4d551413b74e68af735dcc2188d7728c4693c0c659810b34685fe",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "d2f8f5f6952d3beb0f4ecc191ac4f8c8a948f8dfaa48f8ea1fe570fcd037eeee",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/indexBuildStates.ts": "717297da4b03f890c18698bb488a4a21f5f90fb1ca286c46b16dbc214e68a299",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "7930c096ab16cdfd3f145977d3ac13a6d63b00f51511635b8a2ac33b793927e9",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "d13940817929d8109399741c40506d247b3746ed583860d4a675c193facb48e6",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "d25fffcb1347647790fcbbf07b4f701e0e6446728ad110b0bf00abbc0fc4d446",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "d93c09c2faa661749de858679fdb1261441bcbcfcf4ec92f7b65ff68b60f9958",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "c57e9802c1f088d23076b9bcb4664514e41eca1d882b75acaf0d24851fa4aa3c",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "d5b289e8d6231f6aa09aa7cdb226cc87421c55aef5c01a8545c769b30881d29d",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "10753c91f0c1f18a8317ba2eb98304f8f746f1c5fe6b1af8b2a5b90d56cd54e8",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "d483bb8175e4aaf3bf80400f05a39670bf46a3f78f43748c57c3c2910688b15c",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "c62ba508dd4bcb9833a4dc23a0dd56282eceb34403dbab74146203151260532e",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts": "a633ba98dfcc3c0b786a0b95e269510bc2ca2f54903c1e3812ba89445f522476"
  },
  "profileSelections": {
    "product": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "productPayload": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a",
        "payload": "eaf05dafbae93c965ecb31d1117f9f4711eaad1b36cc6552746a06c190ec1fd5"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "mixedWorkflow": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a",
        "payload": "eaf05dafbae93c965ecb31d1117f9f4711eaad1b36cc6552746a06c190ec1fd5",
        "workflow": "7d1042151826a402a133cfd4cd874caf936297c8c54a9647d4ea1e56e12b19a2"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "standaloneWorkflow": {
      "revision": "1a96a482575bf54c470730539a926e067ecb1dd24ee853adf63ef33f85aa3241",
      "resourceCalls": 128
    }
  }
}
```

## Sample distributions

| Workload | Series | Successful / observed | Request median (ms) | Range (ms) | Descriptive p95 (ms) | Outer invocation wall median (ms) | Outer range (ms) | Outer descriptive p95 (ms) | Fresh Worker startup median (ms) | Trace finalization median (ms) | Dispatch median | Known statement median | Awaited DB median (ms) | DB wait interval union median (ms) |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | warm | 2/2 | 1897.3 | 1851.4–1943.1 | unavailable | 1899.6 | 1853.7–1945.6 | unavailable | 89.9 | 2.4 | 2748.0 | 2748.0 | 908.0 | 908.0 |
| product | cold | 1/1 | 1922.7 | 1922.7–1922.7 | unavailable | 1925.4 | 1925.4–1925.4 | unavailable | 93.7 | 2.7 | 2752.0 | 2752.0 | 926.9 | 926.9 |
| productPayload | warm | 2/2 | 2458.0 | 2420.0–2496.0 | unavailable | 2461.5 | 2423.4–2499.5 | unavailable | 80.7 | 3.4 | 3802.0 | 3802.0 | 1193.6 | 1193.6 |
| productPayload | cold | 1/1 | 2551.1 | 2551.1–2551.1 | unavailable | 2554.2 | 2554.2–2554.2 | unavailable | 86.5 | 3.1 | 3809.0 | 3809.0 | 1255.0 | 1255.0 |
| mixedWorkflow | warm | 2/2 | 12960.3 | 5417.1–20503.5 | unavailable | 12967.8 | 5424.9–20510.7 | unavailable | 86.7 | 7.5 | 7228.0 | 7228.0 | 4091.7 | 4091.7 |
| mixedWorkflow | cold | 1/1 | 6629.4 | 6629.4–6629.4 | unavailable | 6636.2 | 6636.2–6636.2 | unavailable | 89.1 | 6.7 | 7232.0 | 7232.0 | 3172.3 | 3172.3 |
| standaloneWorkflow | warm | 2/2 | 326.4 | 324.8–327.9 | unavailable | 326.8 | 325.2–328.4 | unavailable | unavailable | 0.5 | 470.0 | 470.0 | 127.4 | 127.4 |
| standaloneWorkflow | cold | 1/1 | 336.9 | 336.9–336.9 | unavailable | 337.6 | 337.6–337.6 | unavailable | unavailable | 0.7 | 470.0 | 470.0 | 133.6 | 133.6 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 15640.6 | 1068.2 | 2407.8 | 4681.4 | unavailable | 23798.7 |
| product | product-cold-0-0 | 10619.4 | 1061.7 | 2401.9 | 0.0 | unavailable | 14083.2 |
| productPayload | productPayload-warm-0-0 | 10290.5 | 1330.2 | 2412.6 | 4676.1 | unavailable | 18709.6 |
| productPayload | productPayload-cold-0-0 | 10040.3 | 1381.4 | 2345.1 | 0.0 | unavailable | 13767.1 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14594.8 | 4964.9 | 3107.5 | 0.0 | unavailable | 22667.3 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 26479.0 | 4643.2 | 3077.8 | 0.0 | unavailable | 34200.2 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16453.2 | unavailable | unavailable | unavailable | 1738.1 | 18191.5 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16886.8 | unavailable | unavailable | unavailable | 1751.0 | 18637.9 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12095.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 19305.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 34020.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 188 | 6836.0 | 21.8–893.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 100 | 2590.5 | 21.5–103.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 100 | 2176.6 | 19.4–29.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 100 | 2075.2 | 18.7–39.4 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 996.7 | 1.1–565.4 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 629.4 | 0.8–297.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 18 | 537.0 | 22.3–54.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 20 | 534.7 | 21.9–46.5 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 403.7 | 1.0–201.9 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 14 | 396.6 | 21.9–56.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 20 | 392.9 | 18.5–21.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 18 | 374.4 | 18.8–26.0 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 346.6 | 0.8–26.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 12 | 337.8 | 22.2–42.4 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 323.9 | 2.6–177.6 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 14 | 299.9 | 19.3–31.2 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 14 | 287.5 | 19.4–22.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 14 | 285.1 | 18.9–22.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 14 | 281.4 | 19.1–21.6 |
| product | target | invocation / authoritative publication | commit | 4 | 237.3 | 1.0–118.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 12 | 237.0 | 18.8–20.7 |
| productPayload | target | invocation / request admission | commit | 24 | 169.9 | 0.9–21.0 |
| product | target | invocation / request admission | commit | 20 | 147.6 | 0.9–29.8 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 97.6 | 2.4–28.6 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 90.3 | 2.6–24.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 28.4 | 4.3–15.2 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 17.8 | 4.1–5.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 17.5 | 4.0–5.2 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.3 | 3.2–4.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.1 | 3.1–4.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.0 | 3.5–3.5 |
| product | control | invocation / request admission | commit | 2 | 1.7 | 0.8–1.0 |
| productPayload | control | invocation / request admission | commit | 2 | 1.7 | 0.7–1.0 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.6 | 0.7–0.9 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.4 | 0.7–0.7 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 6552 | 6552 | 0 | 4604.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3476 | 3476 | 0 | 1400.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3484 | 3484 | 0 | 1182.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3484 | 3484 | 0 | 1132.6 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 1176 | 1176 | 0 | 531.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 618 | 618 | 0 | 339.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 684 | 684 | 0 | 321.6 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 244.6 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 478 | 478 | 0 | 218.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 684 | 684 | 0 | 215.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 410 | 410 | 0 | 209.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 618 | 618 | 0 | 204.3 |
| mixedWorkflow | unattributed | target | invocation / request admission | 634 | 634 | 0 | 194.0 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 642 | 642 | 0 | 191.2 |
| productPayload | unattributed | target | invocation / authoritative publication | 696 | 696 | 0 | 184.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 478 | 478 | 0 | 162.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 478 | 478 | 0 | 159.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 478 | 478 | 0 | 156.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 478 | 478 | 0 | 153.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 410 | 410 | 0 | 129.1 |
| product | unattributed | target | invocation / authoritative publication | 414 | 414 | 0 | 113.3 |
| productPayload | unattributed | target | invocation / request admission | 364 | 364 | 0 | 102.9 |
| product | unattributed | target | invocation / request admission | 274 | 274 | 0 | 89.5 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 256 | 256 | 0 | 55.2 |
| product | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 48.8 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 48.1 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 32.4 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 26.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 21.4 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 17.9 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 17.0 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 14.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 10.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 10.8 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.2 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 8.7 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 8.4 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 7.8 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 7.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 7.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 2.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.9 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 1.9 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.7 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.7 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.4 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.5 |
| product | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 255.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 80.4 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 70.5 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 300 | 300 | 0 | 67.7 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| product | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 300 | 300 | 0 | 60.3 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 47.9 | commit |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 47.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 45.7 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 45.5 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 42.2 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| product | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 40.0 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 38.2 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 253.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 77.9 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 64.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 300 | 300 | 0 | 61.8 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| productPayload | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 300 | 300 | 0 | 56.4 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 20 | 20 | 0 | 48.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 48.1 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 18 | 18 | 0 | 44.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 42.4 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| productPayload | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 40.6 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 40.4 | commit |
| productPayload | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 39.0 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 2257.3 | commit |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 485.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 192 | 192 | 0 | 260.8 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 259.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 179.3 | commit |
| mixedWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 384 | 384 | 0 | 139.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 100 | 100 | 0 | 135.4 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 576 | 576 | 0 | 130.6 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 576 | 576 | 0 | 128.0 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 18 | 18 | 0 | 128.0 | commit |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 192 | 192 | 0 | 118.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 20 | 20 | 0 | 89.2 | commit |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 23.1 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `75536164c67dda9cd26c18f1c366f100cb8ee42931e66ff77c5bd73b8db259cc` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 74 | 74 | 0 | 18.6 | update "fx_system_index_build_state" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) where (  |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 15.9 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 100 | 100 | 0 | 15.4 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 8.6 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 32 | 32 | 0 | 7.8 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `8ea8d5b22b1f7e46a005e45d34baf72202467700759672f98df650a96caa836e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 26 | 26 | 0 | 6.8 | update "fx_system_unique_constraint_build" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) wh |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 30 | 30 | 0 | 6.5 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 5.8 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.2 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 1897.3 | 0.6 |
| product | invocation / Worker execution | 1590.7 | 1.0 |
| product | invocation / Worker execution / Worker construction and ready | 89.8 | 89.8 |
| product | invocation / Worker execution / Worker dispatch | 1484.1 | 27.4 |
| product | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 153.8 | 153.8 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 160.5 | 160.5 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 1129.9 | 1129.9 |
| product | invocation / Worker execution / Worker disposal | 15.8 | 15.8 |
| product | invocation / authoritative publication | 134.7 | 134.7 |
| product | invocation / journal seal and OCC verification | 68.8 | 68.8 |
| product | invocation / request admission | 102.4 | 102.4 |
| productPayload | invocation | 2458.0 | 0.7 |
| productPayload | invocation / Worker execution | 2054.0 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 80.7 | 80.7 |
| productPayload | invocation / Worker execution / Worker dispatch | 1959.3 | 33.8 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.8 | 5.8 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 150.8 | 150.8 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 152.8 | 152.8 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 1078.8 | 1078.8 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 199.6 | 199.6 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 102.9 | 102.9 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 125.2 | 125.2 |
| productPayload | invocation / Worker execution / Worker disposal | 13.1 | 13.1 |
| productPayload | invocation / authoritative publication | 218.6 | 218.6 |
| productPayload | invocation / journal seal and OCC verification | 75.3 | 75.3 |
| productPayload | invocation / request admission | 109.4 | 109.4 |
| mixedWorkflow | invocation | 12960.3 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 11958.2 | 1.0 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 86.6 | 86.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 5885.4 | 32.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.4 | 6.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 209.8 | 209.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 1336.7 | 1336.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 3553.5 | 3553.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 282.3 | 282.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 135.7 | 135.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 175.7 | 175.7 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 5985.1 | 5985.1 |
| mixedWorkflow | invocation / authoritative publication | 548.1 | 548.1 |
| mixedWorkflow | invocation / journal seal and OCC verification | 247.5 | 247.5 |
| mixedWorkflow | invocation / request admission | 205.9 | 205.9 |
| standaloneWorkflow | invocation | 326.4 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 326.3 | 326.3 |

## Failures and uncertainty

Failures: 0. Successful warm percentiles exclude failures; the raw file retains every attempted sample.

Unavailable or unmeasured metrics:
- PostgreSQL server execution time (driver await includes transport and scheduling).
- Exact native workflow child inclusive/exclusive spans; native steps are not instrumented, so SQL owner mapping is used instead.
- Exact inner OCC/materialization phase duration where the existing owner has no test observation hook.
- Exact scope-clock lock acquisition wait and lock-hold interval; transaction duration is only a BEGIN-to-settlement envelope.
- Sealed attempt bytes for failed attempts and standalone workflow; settled journal rows are removed, so inventory separately records only remaining live journal bytes.
- Client SQL that loses trace context during an active invocation is detected and invalidates that sample, but SQL through uninstrumented pools or outside the invocation cannot be counted; named phase checks do not prove universal SQL coverage.
- Hosted Cloudflare transport, native ORM parity, and production capacity.

Interpretation notes:
- Standalone workflow includes the same selected Product/Pricing/Link/Tag graph but has no Application, Payload, journal or OCC obligations.
- The first warmup is reconnaissance for owner attribution and is excluded from warm distributions.
- Per-request test grant issuer/signing and private bridge overhead are included in mixed request admission and Worker intervals.
- Warm mixed samples reuse prepared modules, scope, and pools; every request creates, readies, invokes once, and disposes a fresh Worker under the exact runtime one-invocation guard.
- Signed business arguments are parsed by the fixed benchmark Worker source inside the measured request; that private test-harness cost is included.
- Workflow tags are unique: each graph is seeded immediately before its invocation and its launched tag is renamed outside measurement before the next seed. Product/Payload graphs are preseeded.
- The trace's DB wait union is a union of observed awaited intervals, not a server critical-path or network round-trip count.
- Request duration is the inner trace span; outer wall also includes trace aggregation. Their difference is reported separately.
- Sealed attempt bytes come from the canonical journal at successful seal through a delegating test store port; the capture adds no database query.
