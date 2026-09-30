# Private mixed mutation performance baseline

Revision: `8107872a8e1071c5a6766088f1455062d459cd26`; working diff SHA-256: `b9e03f03c55401140c233b1e11120a32a8089f3e8be1bc392ee942bb505dbe16`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790793693547_ecvym78hus",
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
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "5eb68ffb2f7d5cb8ae8067e0208e0593279aabab95432904b44fc45e768fb170",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e47905dc333d93fcfcbec5da203b5de2d466f212c6fff9515abd043cebc2e203",
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
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "2ddf1f705d4c0d86d749b65ce876fee097a3480ee5ad06034e340e02dbdc9f7b",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "fd01dba6a6a2d162490a6d32a9950511dba2176ff6db66f26bb773ceb9f2e4c0",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f22b77f82ab567fca2443ca404711c2bdaa92803692082283297c4155e022c48",
    "packages/persistence-postgres/src/commitPublication/publication.ts": "5fa1dfc72d1e0c421d405ea9a660b7b9f591a8cb986097b29ecb655ba7528ba4",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "22e2028f9dc5ae75aa21cb7fe359619b921e05658f1d45c3b19187ae441de0bd",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "773b0ba0a634e0b59ab57c76bf08644de17274e8c7262c0d44294539d15f19e2",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "48d1dc4822b253dd84f6834cb6b45ddb3a64aca9b6238d051333849a0e3d09f4",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "0474041407536e071d34c43feb6088e33edae3b8106df3081de812d69b36b558",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "fca37d6e98289ca03131685342459dc11c80ec05fb0a6f40b0c1d5496ad153fd",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "c3715ebacf48b9178bab45cd224a388b9adbba57c345dd3745356878ba6725a8",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "0c12c73b9bf05774cd7c56e755aa07f2452f926da37fc80399210fbf2ad45169",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "692dbcc61809e2ff14c210df11d42b45c5e60c9f20cc9017ccf6a02423fabf20",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "378fc8d2b0215ea6e7da26cc4247d4b9548d2841c7ec038cdb5d3737280bc156",
    "packages/persistence-postgres/src/preparedHostRuntime.ts": "3db4fedaee228a00d076af5126880afeae740d16566efa199f633f5497839ad2",
    "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts": "09d426b05fcb79917a2499546298030d496283fb442defbf158c848cc8397401",
    "packages/persistence-postgres/src/scopeClock.ts": "9953046ac9f6c958f9c2723e1ebb3ad91f4fb33377343142b58294a74de24082",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "cfb999a145ea99051b404d08df2632b15567cd2e914e0971ced1a7a900a1f596",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "d483bb8175e4aaf3bf80400f05a39670bf46a3f78f43748c57c3c2910688b15c",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "addffad7469d505e6d64bca49923c07341d17cdf7f52e2d02cda9203e32d6fa1",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts": "dde413833778386bc5f2dbd1d8c896f7955a5df9b76e441027a4b2f342ad51ad",
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
| product | warm | 2/2 | 810.8 | 742.7–878.9 | unavailable | 811.7 | 743.6–879.8 | unavailable | 83.9 | 0.9 | 643.0 | 643.0 | 370.0 | 370.0 |
| product | cold | 1/1 | 721.3 | 721.3–721.3 | unavailable | 722.2 | 722.2–722.2 | unavailable | 86.9 | 0.9 | 647.0 | 647.0 | 288.8 | 288.8 |
| productPayload | warm | 2/2 | 742.9 | 735.9–749.8 | unavailable | 743.6 | 736.7–750.5 | unavailable | 82.5 | 0.8 | 670.0 | 670.0 | 293.8 | 293.8 |
| productPayload | cold | 1/1 | 760.9 | 760.9–760.9 | unavailable | 761.6 | 761.6–761.6 | unavailable | 84.9 | 0.7 | 676.0 | 676.0 | 306.9 | 306.9 |
| mixedWorkflow | warm | 2/2 | 1253.5 | 1199.5–1307.5 | unavailable | 1254.7 | 1200.7–1308.6 | unavailable | 88.3 | 1.1 | 1034.0 | 1034.0 | 498.6 | 498.6 |
| mixedWorkflow | cold | 1/1 | 1321.3 | 1321.3–1321.3 | unavailable | 1322.4 | 1322.4–1322.4 | unavailable | 87.8 | 1.1 | 1038.0 | 1038.0 | 569.7 | 569.7 |
| standaloneWorkflow | warm | 2/2 | 415.3 | 306.3–524.3 | unavailable | 415.7 | 306.7–524.7 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 210.1 | 210.1 |
| standaloneWorkflow | cold | 1/1 | 371.2 | 371.2–371.2 | unavailable | 371.6 | 371.6–371.6 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 138.5 | 138.5 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 13377.8 | 1271.0 | 2902.0 | 5187.8 | unavailable | 22739.3 |
| product | product-cold-0-0 | 13072.5 | 1527.7 | 2578.5 | 0.0 | unavailable | 17178.8 |
| productPayload | productPayload-warm-0-0 | 12280.2 | 1441.3 | 2560.9 | 5005.7 | unavailable | 21288.2 |
| productPayload | productPayload-cold-0-0 | 11335.5 | 1428.4 | 2430.4 | 0.0 | unavailable | 15194.4 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 15990.5 | 4935.0 | 3261.7 | 0.0 | unavailable | 24187.3 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 18166.7 | 5231.7 | 3496.3 | 0.0 | unavailable | 26894.9 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 18206.0 | unavailable | unavailable | unavailable | 1722.5 | 19928.7 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 22975.1 | unavailable | unavailable | unavailable | 1783.1 | 24758.2 |

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
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 804.5 | 1.4–325.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 26 | 583.2 | 19.5–30.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 20 | 455.0 | 17.3–80.2 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 20 | 453.9 | 20.0–29.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 20 | 425.6 | 18.6–26.2 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 336.9 | 1.1–171.8 |
| product | target | invocation / request admission | commit | 16 | 303.8 | 1.8–149.0 |
| product | target | invocation / authoritative publication | commit | 4 | 180.2 | 1.2–89.0 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 174.1 | 1.0–87.5 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 164.4 | 3.2–58.2 |
| productPayload | target | invocation / request admission | commit | 16 | 160.9 | 1.7–31.4 |
| mixedWorkflow | target | invocation / request admission | commit | 16 | 158.9 | 1.5–32.4 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 154.8 | 3.4–47.5 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 146.2 | 3.0–48.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 2 | 36.0 | 17.6–18.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 2 | 34.6 | 16.8–17.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 19.3 | 4.2–5.2 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 19.0 | 4.6–4.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 17.0 | 4.2–4.3 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.5 | 3.7–3.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.9 | 3.4–3.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.7 | 3.3–3.4 |
| productPayload | control | invocation / request admission | commit | 2 | 3.2 | 1.6–1.6 |
| product | control | invocation / request admission | commit | 2 | 3.1 | 1.5–1.6 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 2.9 | 1.4–1.5 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 2.8 | 1.4–1.4 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 560 | 560 | 0 | 306.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 454 | 454 | 0 | 267.8 |
| product | unattributed | target | invocation / request admission | 216 | 216 | 0 | 249.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 458 | 458 | 0 | 240.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 458 | 458 | 0 | 232.4 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 220.4 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 440 | 440 | 0 | 189.5 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 404 | 404 | 0 | 150.6 |
| productPayload | unattributed | target | invocation / request admission | 216 | 216 | 0 | 107.9 |
| mixedWorkflow | unattributed | target | invocation / request admission | 216 | 216 | 0 | 102.9 |
| product | unattributed | target | invocation / authoritative publication | 246 | 246 | 0 | 91.3 |
| product | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 89.6 |
| productPayload | unattributed | target | invocation / authoritative publication | 258 | 258 | 0 | 84.0 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 81.3 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 158 | 158 | 0 | 76.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 38 | 38 | 0 | 22.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 22.7 |
| product | unattributed | control | invocation / request admission | 58 | 58 | 0 | 17.7 |
| productPayload | unattributed | control | invocation / request admission | 58 | 58 | 0 | 16.8 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 15.9 |
| mixedWorkflow | unattributed | control | invocation / request admission | 58 | 58 | 0 | 15.5 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 14.1 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 12.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 12.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 11.4 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 10.7 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 10.5 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 10.3 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 10.0 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 8.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 7.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 7.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 6.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 5.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.2 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.9 |
| product | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| product | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.5 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 16 | 16 | 0 | 156.4 | commit |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 61.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 30.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 24.9 | commit |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 18.7 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 12.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `7ef3f44a37f92a1430fed551f186f03025e50a97bc5fafe9e662a337a07be1ef` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 10.8 | select "scope_uuid" , "session_id" , "attempt_fence" , "journal_format" , "execution_profile" , "state" , "last_syscall_ |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 10 | 10 | 0 | 10.1 | commit |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / authoritative publication | 4 | 4 | 0 | 8.8 | commit |
| product | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 8.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 8.4 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 8.4 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 60.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 33.2 | commit |
| productPayload | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 29.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 18.9 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 16 | 16 | 0 | 18.4 | commit |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 10 | 10 | 0 | 11.0 | commit |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 10.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 10.4 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | unattributed | target | invocation / authoritative publication | 22 | 22 | 0 | 10.2 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 7.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 7.4 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| productPayload | `1640ee04592543d0907c11dd6744a188ebb68b0552ff212d925b146da49f7758` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 7.1 | select "fx_system_index_build_state" . "scope_id" , "fx_system_index_build_state" . "index_definition_id" , "fx_system_i |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 81.6 | commit |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 26 | 26 | 0 | 74.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 58.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 26 | 26 | 0 | 39.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 26 | 26 | 0 | 36.1 | commit |
| mixedWorkflow | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 28.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 16 | 16 | 0 | 19.5 | commit |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 20 | 20 | 0 | 19.0 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | unattributed | target | invocation / authoritative publication | 52 | 52 | 0 | 18.3 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| mixedWorkflow | `cee4f47101805ddfb136e3188b3df8fffc406750d74e79e86009acf9769284b9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 26 | 26 | 0 | 15.3 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | unattributed | target | invocation / authoritative publication | 30 | 30 | 0 | 13.9 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| mixedWorkflow | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 26 | 26 | 0 | 13.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 168.6 | commit |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 29.7 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 19.7 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 10.7 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 9.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.8 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 7.4 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 6.7 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 6.5 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 5.1 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.7 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.5 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 810.8 | 0.6 |
| product | invocation / Worker execution | 412.7 | 1.1 |
| product | invocation / Worker execution / Worker construction and ready | 83.8 | 83.8 |
| product | invocation / Worker execution / Worker dispatch | 311.8 | 27.8 |
| product | invocation / Worker execution / Worker dispatch / Application point | 6.8 | 6.8 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 7.7 | 7.7 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 7.9 | 7.9 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 255.1 | 255.1 |
| product | invocation / Worker execution / Worker disposal | 15.9 | 15.9 |
| product | invocation / authoritative publication | 109.3 | 109.3 |
| product | invocation / journal seal and OCC verification | 108.1 | 108.1 |
| product | invocation / request admission | 180.1 | 180.1 |
| productPayload | invocation | 742.9 | 0.7 |
| productPayload | invocation / Worker execution | 426.5 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 82.5 | 82.5 |
| productPayload | invocation / Worker execution / Worker dispatch | 330.0 | 31.3 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 7.2 | 7.2 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.9 | 6.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 239.4 | 239.4 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 24.7 | 24.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.5 | 2.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 3.4 | 3.4 |
| productPayload | invocation / Worker execution / Worker disposal | 13.1 | 13.1 |
| productPayload | invocation / authoritative publication | 105.7 | 105.7 |
| productPayload | invocation / journal seal and OCC verification | 102.3 | 102.3 |
| productPayload | invocation / request admission | 107.7 | 107.7 |
| mixedWorkflow | invocation | 1253.5 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 833.9 | 1.1 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 88.3 | 88.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 728.4 | 30.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.8 | 6.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 7.0 | 7.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 255.4 | 255.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 387.6 | 387.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 25.9 | 25.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.4 | 2.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 3.5 | 3.5 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 16.1 | 16.1 |
| mixedWorkflow | invocation / authoritative publication | 195.2 | 195.2 |
| mixedWorkflow | invocation / journal seal and OCC verification | 119.3 | 119.3 |
| mixedWorkflow | invocation / request admission | 104.5 | 104.5 |
| standaloneWorkflow | invocation | 415.3 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 415.3 | 415.3 |

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
