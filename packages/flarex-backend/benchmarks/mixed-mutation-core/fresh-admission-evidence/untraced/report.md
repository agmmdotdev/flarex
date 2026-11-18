# Private mixed mutation performance baseline

Revision: `6e5cab99de498a8e8b8873dfbf2da5a046723ce8`; working diff SHA-256: `c5cea19dc66f79f28e87ae68127da18a4b111e95cf7f2aeb9f0bdde6a2ec5b16`; mode: **full**, observation: **untraced**.
Plan: 3 warmups, 20 measured warm samples, 3 cold samples per workload.

The outer invocation wall interval uses the same workload boundaries, from before fresh admission through authoritative publication and retained-outcome resolution. No SQL or phase observer is installed, so request trace spans, dispatches, awaits, transaction intervals and trace finalization are unavailable. The standalone graph has fewer root obligations; no native ORM parity or hosted transport claim is made.

## Environment

```json
{
  "postgres": {
    "serverVersion": "18.3",
    "fsync": "on",
    "synchronousCommit": "on",
    "fullPageWrites": "on",
    "sharedBuffers": "128MB",
    "role": "flarex_runtime_1790605293319_9nea6gd41kv",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "5a473ad6f2835075a04b1c811ef0655036651e784bbcb301c67bf287f3ee6aaa",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "e0df5ba6534a52199b11290a77ef6db7bb1a5af3f15977ceaf7cfc70eb94e462",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "f675c6876afe541c8f1e93ee15214164961a9e60dfac3c405e9604d43e39211a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "334292b9065fe1bc379c13683b7f0143c5f20aa361d91a456360fd00230c93f9",
    "packages/persistence-postgres/src/applicationActivation.ts": "97e98c832bd8691122199e089cea29ecfea473cdd41abaa6a403b9ff49dcd8c2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationReadiness.ts": "2d764741da4b91341f1ef14f2ff62a2ccea14feb60121a8c355d031150739923",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "612c1b55c904dd994f3a6647cc289b89378af5d671c7ce025931b0b267cbf932",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "3212ab7655f5189195cd56c07f8724f227f4b2ed8ae84c76b3b57daa01638fa0",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "51c456fdbcc2e0c3b8c2acda877748924ed6c62c6bb8cccaae941370c163b568",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "51b267a355032d262744ed401b094d264cca20fdac05a8d8c95ebcd1a050cfac",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "caa8f45162d2503dabca70e9913d3c1084818b1129dc2be669b09427f32a7158",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "7930c096ab16cdfd3f145977d3ac13a6d63b00f51511635b8a2ac33b793927e9",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "1759afc50aa0f6a65a3bd033183df1b5487929afa9b0cfd5f96d7da56f3da4ff",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "85c59a7568dc238394804dbeffb0f512f64a6b037b790a0fe8569448c1da383e",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "d13940817929d8109399741c40506d247b3746ed583860d4a675c193facb48e6",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "ef2fb898a3cfeda8da8963111b03e99bbcc24a8f9cfba18ff9c228267dc03591",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "86541a5150bbaeb44b1794feef4ea9b2d65ccaaed162debc571af07e2b128f4a",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "04ded904cc88862bc655b4e8a606f292f483d7b0e066f4683943a15291b2e207",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "c57e9802c1f088d23076b9bcb4664514e41eca1d882b75acaf0d24851fa4aa3c",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "d5b289e8d6231f6aa09aa7cdb226cc87421c55aef5c01a8545c769b30881d29d",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "c8d14428fdd40d2425ed8f858caf3fbeaec1b7f04979a02bbcd037d7de3f6720",
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
| product | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 1551.6 | 1516.6–1989.8 | 1868.6 | 83.6 | unavailable | unavailable | unavailable | unavailable | unavailable |
| product | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 1646.7 | 1527.0–1860.1 | unavailable | 81.3 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 2013.6 | 1957.5–2321.1 | 2142.7 | 79.3 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 2059.2 | 2049.3–2072.6 | unavailable | 79.1 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 4471.4 | 4357.5–4871.2 | 4743.6 | 84.0 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 4566.3 | 4468.3–4631.3 | unavailable | 86.5 | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 308.8 | 299.5–327.3 | 322.3 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 312.7 | 303.3–314.5 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10599.4 | 1052.9 | 2395.8 | 49859.3 | unavailable | 63908.1 |
| product | product-cold-0-0 | 12066.1 | 1152.2 | 2654.7 | 0.0 | unavailable | 15873.2 |
| product | product-cold-1-0 | 11300.2 | 1040.7 | 2282.6 | 0.0 | unavailable | 14623.5 |
| product | product-cold-2-0 | 10740.6 | 995.5 | 2308.0 | 0.0 | unavailable | 14044.2 |
| productPayload | productPayload-warm-0-0 | 10511.4 | 1307.0 | 2341.3 | 49684.6 | unavailable | 63844.4 |
| productPayload | productPayload-cold-0-0 | 9965.7 | 1295.8 | 2302.3 | 0.0 | unavailable | 13563.9 |
| productPayload | productPayload-cold-1-0 | 9926.0 | 1297.6 | 2385.7 | 0.0 | unavailable | 13609.3 |
| productPayload | productPayload-cold-2-0 | 10054.8 | 1368.3 | 2277.4 | 0.0 | unavailable | 13700.5 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14122.2 | 4585.4 | 2890.9 | 0.0 | unavailable | 21598.6 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14268.1 | 4585.5 | 2889.0 | 0.0 | unavailable | 21742.9 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 14102.7 | 4677.8 | 2880.4 | 0.0 | unavailable | 21660.9 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 14444.5 | 4585.1 | 2982.4 | 0.0 | unavailable | 22012.2 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 15981.3 | unavailable | unavailable | unavailable | 1674.0 | 17655.5 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 15912.0 | unavailable | unavailable | unavailable | 1686.7 | 17598.8 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 16060.8 | unavailable | unavailable | unavailable | 1652.0 | 17712.8 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 15929.4 | unavailable | unavailable | unavailable | 1650.0 | 17579.4 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12180.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 19401.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 34109.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |

## Failures and uncertainty

Failures: 0. Successful warm percentiles exclude failures; the raw file retains every attempted sample.

Unavailable or unmeasured metrics:
- PostgreSQL server execution time (driver await includes transport and scheduling).
- Exact native workflow child inclusive/exclusive spans; native steps are not instrumented, so SQL owner mapping is used instead.
- Exact inner OCC/materialization phase duration where the existing owner has no test observation hook.
- Exact scope-clock lock acquisition wait and lock-hold interval; transaction duration is only a BEGIN-to-settlement envelope.
- Sealed attempt bytes for failed attempts and standalone workflow; settled journal rows are removed, so inventory separately records only remaining live journal bytes.
- SQL dispatches, awaited time, phase spans, transaction intervals and trace coverage in untraced mode.
- Hosted Cloudflare transport, native ORM parity, and production capacity.

Interpretation notes:
- Standalone workflow includes the same selected Product/Pricing/Link/Tag graph but has no Application, Payload, journal or OCC obligations.
- The first warmup is excluded from warm distributions.
- Per-request test grant issuer/signing and private bridge overhead are included in mixed request admission and Worker intervals.
- Warm mixed samples reuse prepared modules, scope, and pools; every request creates, readies, invokes once, and disposes a fresh Worker under the exact runtime one-invocation guard.
- Signed business arguments are parsed by the fixed benchmark Worker source inside the measured request; that private test-harness cost is included.
- Workflow tags are unique: each graph is seeded immediately before its invocation and its launched tag is renamed outside measurement before the next seed. Product/Payload graphs are preseeded.
- No SQL or phase observer is installed. Outer invocation wall time uses the same workload boundaries and business checks as the traced series.
- Sealed attempt bytes come from the canonical journal at successful seal through a delegating test store port; the capture adds no database query.
