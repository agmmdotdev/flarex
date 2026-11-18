# Private mixed mutation performance baseline

Revision: `8e486128d70499f649ee424beed0b1eebba68bb2`; working diff SHA-256: `6ca9aa0ebf90f947784cf574efcf8680af34c2a0d155877da8a6ece5ad5db92b`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790786446968_6u0xb86nq3d",
    "superuser": false
  },
  "node": "v24.16.0",
  "pgDriver": "8.22.0",
  "platform": "win32",
  "architecture": "x64",
  "cpu": "AMD Ryzen 7 5700G with Radeon Graphics         ",
  "logicalCpus": 16,
  "totalMemoryBytes": 16421470208,
  "targetPoolMax": 10,
  "transport": "pg TCP socket; private Worker bridge is in-process test harness",
  "sourceHashes": {
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "59e136a8df57d55997960601149447bb06a4a924b0d15968c7ad95ba6846bc4b",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "5dd6a02b2ece07036eabf0921c04c868bfe9ed7f280a8b0d587f84d5d63ffbb5",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/drizzle/0120_immutable_target_metadata_protection.sql": "6ece58db6038056748737bc67cd39605166c0d76473dfd9d936cceb67415a2d3",
    "packages/persistence-postgres/src/appRows.ts": "0150bb1dc614b0303cf52743306e3b7578203feb387aa41ed6501afaf17aec41",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "d2f059b8c8b94c68d65d3d0ec328af207592cfe2fcca21d45af6591c2ff5905a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "6ae20222a735c1b9a70e3a7f108796a68b88b86706d0ceb93ab23b0bb4f3ed79",
    "packages/persistence-postgres/src/applicationActivation.ts": "b2fc333eae04535d03e995e005a1a21779edfbdda5939561c8f5b015a2ab5cc2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts": "ad072323693964f88fb6aee24a7b35abf039652992d70d00c81db4cd9e49f5d8",
    "packages/persistence-postgres/src/applicationReadiness.ts": "d21d7777eae2b9bab612a4f95b86752e2bbe821ca3b5621ae7bde189848edafd",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/boundedRequestLifetime.ts": "eb640b68d55a2a825e62a7838c46f40ef2c391009cbf6ccc1ab4584956a805c9",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "a230f80bf996f5f94db88ec1869698bc1c39f5f340e38368e5a9f3341d298d65",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "83602ba7abc1507298bfb714b132b0b1a4ce616f86cc41b17b6ceb0337f52579",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f7b59769ec3c2025fcd5f17b728cdf885d30a764246bb264915e0175af763950",
    "packages/persistence-postgres/src/commitPublication/publication.ts": "5fa1dfc72d1e0c421d405ea9a660b7b9f591a8cb986097b29ecb655ba7528ba4",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "22e2028f9dc5ae75aa21cb7fe359619b921e05658f1d45c3b19187ae441de0bd",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "9c0f377eb32aaf6ed5b2badcfd7215294801575ff90bcfdb91e2b0a4ef5007ef",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "68a442e4ecbf56cc4e61a9bb6f4f817c5b994db4c337c4ea39fc974d1f488116",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "4fe028417cac3de58d411a9034470417a7b0f60ded89266750f54c44a5009595",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "fca37d6e98289ca03131685342459dc11c80ec05fb0a6f40b0c1d5496ad153fd",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "ab9e2544222c091318fc2a87abf8628be71bc4b89473c5866d8e1bd2f65b80dc",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "0c12c73b9bf05774cd7c56e755aa07f2452f926da37fc80399210fbf2ad45169",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "692dbcc61809e2ff14c210df11d42b45c5e60c9f20cc9017ccf6a02423fabf20",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "378fc8d2b0215ea6e7da26cc4247d4b9548d2841c7ec038cdb5d3737280bc156",
    "packages/persistence-postgres/src/preparedHostRuntime.ts": "3db4fedaee228a00d076af5126880afeae740d16566efa199f633f5497839ad2",
    "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts": "09d426b05fcb79917a2499546298030d496283fb442defbf158c848cc8397401",
    "packages/persistence-postgres/src/scopeClock.ts": "9953046ac9f6c958f9c2723e1ebb3ad91f4fb33377343142b58294a74de24082",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "33246eaf44a449862bd92f2f1966a699ea46cbc5fe12b2dc6b0f857b39b3d1bb",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "d483bb8175e4aaf3bf80400f05a39670bf46a3f78f43748c57c3c2910688b15c",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "51dba87c82a84d463b6502a3fadf5b1d5ca89dd43b1f8d43a6f2b026f7f7d066",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts": "6e6aeb27355e9e94b4c1e52180dc837e3680a52c2288e0884bf3255763542d76",
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
| product | warm | 2/2 | 845.3 | 832.1–858.5 | unavailable | 846.3 | 833.0–859.5 | unavailable | 84.6 | 1.0 | 862.0 | 862.0 | 368.1 | 368.1 |
| product | cold | 1/1 | 863.9 | 863.9–863.9 | unavailable | 864.8 | 864.8–864.8 | unavailable | 88.3 | 1.0 | 866.0 | 866.0 | 381.7 | 381.7 |
| productPayload | warm | 2/2 | 1054.0 | 1043.8–1064.2 | unavailable | 1055.3 | 1045.0–1065.6 | unavailable | 86.5 | 1.3 | 1068.0 | 1068.0 | 473.2 | 473.2 |
| productPayload | cold | 1/1 | 1520.4 | 1520.4–1520.4 | unavailable | 1521.3 | 1521.3–1521.3 | unavailable | 287.1 | 0.9 | 1078.0 | 1078.0 | 747.1 | 747.1 |
| mixedWorkflow | warm | 2/2 | 1734.4 | 1710.6–1758.2 | unavailable | 1736.5 | 1712.6–1760.3 | unavailable | 87.5 | 2.1 | 1663.0 | 1663.0 | 755.2 | 755.2 |
| mixedWorkflow | cold | 1/1 | 2006.2 | 2006.2–2006.2 | unavailable | 2008.2 | 2008.2–2008.2 | unavailable | 86.2 | 2.0 | 1667.0 | 1667.0 | 1011.5 | 1011.5 |
| standaloneWorkflow | warm | 2/2 | 303.8 | 291.0–316.7 | unavailable | 304.2 | 291.3–317.1 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 112.5 | 112.5 |
| standaloneWorkflow | cold | 1/1 | 296.5 | 296.5–296.5 | unavailable | 296.9 | 296.9–296.9 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 114.7 | 114.7 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 12086.1 | 1166.2 | 2542.1 | 4839.2 | unavailable | 20634.3 |
| product | product-cold-0-0 | 10999.6 | 1113.1 | 2425.9 | 0.0 | unavailable | 14538.7 |
| productPayload | productPayload-warm-0-0 | 10848.7 | 1385.5 | 2467.4 | 4743.9 | unavailable | 19445.5 |
| productPayload | productPayload-cold-0-0 | 12214.3 | 1634.1 | 2759.7 | 0.0 | unavailable | 16608.1 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 18813.3 | 4814.8 | 3016.4 | 0.0 | unavailable | 26644.6 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 15509.8 | 4872.2 | 3211.9 | 0.0 | unavailable | 23593.9 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 21791.4 | unavailable | unavailable | unavailable | 1648.7 | 23440.4 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 19231.9 | unavailable | unavailable | unavailable | 1643.2 | 20875.0 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 44 | 863.6 | 10.5–25.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 599.5 | 16.2–22.7 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 594.8 | 15.6–21.5 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 581.5 | 1.5–278.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 577.2 | 15.3–21.5 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 401.1 | 1.5–32.5 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 323.5 | 1.1–162.9 |
| productPayload | target | invocation / request admission | commit | 24 | 211.4 | 1.7–30.4 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 170.9 | 1.0–86.3 |
| product | target | invocation / request admission | commit | 20 | 161.4 | 1.8–29.9 |
| product | target | invocation / authoritative publication | commit | 4 | 157.2 | 1.0–78.7 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 155.3 | 3.0–53.5 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 154.3 | 3.0–57.0 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 129.8 | 3.2–42.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 124.9 | 10.2–24.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 118.4 | 11.1–20.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 87.3 | 10.3–22.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 82.0 | 18.4–25.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 80.4 | 11.2–17.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 75.6 | 17.0–20.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 74.7 | 16.6–22.5 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 74.4 | 15.9–19.7 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 73.3 | 16.6–19.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 63.9 | 11.8–20.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 54.9 | 10.8–16.4 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.8 | 4.1–5.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.6 | 4.2–5.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.0 | 4.0–5.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.2 | 3.6–3.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.7 | 3.0–3.7 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.6 | 3.2–3.4 |
| productPayload | control | invocation / request admission | commit | 2 | 3.2 | 1.5–1.7 |
| product | control | invocation / request admission | commit | 2 | 3.2 | 1.5–1.7 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 2.9 | 1.4–1.6 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 2.7 | 1.4–1.4 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 894 | 894 | 0 | 464.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 688 | 688 | 0 | 332.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 688 | 688 | 0 | 330.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 684 | 684 | 0 | 311.2 |
| mixedWorkflow | unattributed | target | invocation / request admission | 500 | 500 | 0 | 247.2 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 440 | 440 | 0 | 154.8 |
| productPayload | unattributed | target | invocation / request admission | 314 | 314 | 0 | 142.6 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 404 | 404 | 0 | 141.4 |
| product | unattributed | target | invocation / request admission | 252 | 252 | 0 | 110.1 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 86.7 |
| productPayload | unattributed | target | invocation / authoritative publication | 258 | 258 | 0 | 82.8 |
| product | unattributed | target | invocation / authoritative publication | 246 | 246 | 0 | 77.0 |
| product | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 75.1 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 73.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 140 | 140 | 0 | 72.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 144 | 144 | 0 | 68.4 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 59.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 108 | 108 | 0 | 50.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 104 | 104 | 0 | 47.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 78 | 78 | 0 | 43.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 78 | 78 | 0 | 40.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 78 | 78 | 0 | 40.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 78 | 78 | 0 | 38.8 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 78 | 78 | 0 | 36.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 72 | 72 | 0 | 35.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 70 | 70 | 0 | 32.6 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 19.3 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 16.9 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 16.5 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 13.3 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 12.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 11.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 11.9 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 11.0 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 10.9 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 10.5 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 10.2 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.7 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 9.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 7.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 6.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 6.7 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.6 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 2.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.9 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.1 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.9 |
| product | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| product | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 88.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 46.7 | commit |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 28.1 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 27.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 20 | 20 | 0 | 22.7 | commit |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 14.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 12.9 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 10 | 10 | 0 | 12.8 | commit |
| product | `7ef3f44a37f92a1430fed551f186f03025e50a97bc5fafe9e662a337a07be1ef` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 12.8 | select "scope_uuid" , "session_id" , "attempt_fence" , "journal_format" , "execution_profile" , "state" , "last_syscall_ |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 11.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 11.5 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 11.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 93.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 45.9 | commit |
| productPayload | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 12 | 12 | 0 | 33.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 30.3 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 24 | 24 | 0 | 28.4 | commit |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 22.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 10 | 10 | 0 | 21.4 | commit |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 6 | 6 | 0 | 17.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 14.9 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 13.9 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 13.8 | commit |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 12.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 117.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 82.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 63.4 | commit |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 57.2 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 18 | 18 | 0 | 51.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 43.5 | commit |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 36 | 36 | 0 | 40.9 | commit |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 27.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 24.6 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `cee4f47101805ddfb136e3188b3df8fffc406750d74e79e86009acf9769284b9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 36 | 36 | 0 | 22.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | unattributed | target | invocation / authoritative publication | 52 | 52 | 0 | 21.6 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 20.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 24.0 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 13.9 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 13.0 | commit |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 9.5 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 5.9 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.3 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.3 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.1 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.1 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `95f7bea972ff4c054c1da49dc8eaadeacc861aab2e0bfa408d81f5dc6e2b2d02` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 3.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 845.3 | 0.6 |
| product | invocation / Worker execution | 552.6 | 0.9 |
| product | invocation / Worker execution / Worker construction and ready | 84.5 | 84.5 |
| product | invocation / Worker execution / Worker dispatch | 453.3 | 25.4 |
| product | invocation / Worker execution / Worker dispatch / Application point | 6.6 | 6.6 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 43.3 | 43.3 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 44.0 | 44.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 327.6 | 327.6 |
| product | invocation / Worker execution / Worker disposal | 13.8 | 13.8 |
| product | invocation / authoritative publication | 95.9 | 95.9 |
| product | invocation / journal seal and OCC verification | 89.1 | 89.1 |
| product | invocation / request admission | 107.1 | 107.1 |
| productPayload | invocation | 1054.0 | 0.7 |
| productPayload | invocation / Worker execution | 711.4 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 86.5 | 86.5 |
| productPayload | invocation / Worker execution / Worker dispatch | 606.5 | 29.9 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 6.4 | 6.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 43.9 | 43.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 44.3 | 44.3 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 326.9 | 326.9 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 48.9 | 48.9 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 32.8 | 32.8 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 32.7 | 32.7 |
| productPayload | invocation / Worker execution / Worker disposal | 17.6 | 17.6 |
| productPayload | invocation / authoritative publication | 104.4 | 104.4 |
| productPayload | invocation / journal seal and OCC verification | 104.9 | 104.9 |
| productPayload | invocation / request admission | 132.6 | 132.6 |
| mixedWorkflow | invocation | 1734.4 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 1201.5 | 1.7 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 87.5 | 87.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 1096.9 | 31.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.4 | 6.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 47.9 | 47.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 315.1 | 315.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 529.5 | 529.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 52.0 | 52.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 35.1 | 35.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 37.0 | 37.0 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 15.4 | 15.4 |
| mixedWorkflow | invocation / authoritative publication | 187.9 | 187.9 |
| mixedWorkflow | invocation / journal seal and OCC verification | 112.7 | 112.7 |
| mixedWorkflow | invocation / request admission | 231.7 | 231.7 |
| standaloneWorkflow | invocation | 303.8 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 303.8 | 303.8 |

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
