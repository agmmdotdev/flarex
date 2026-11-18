# Private mixed mutation performance baseline

Revision: `e704b60d332e645251aa508f62fc7c0a3b6ee4b0`; working diff SHA-256: `6d7675081bdf046863d7ce570f972b90999a66e571a6fcb8f78bce3998326ab5`; mode: **full**, observation: **untraced**.
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
    "role": "flarex_runtime_1790590723717_908ec5j6q7p",
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
| product | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 1758.7 | 1698.9–1851.1 | 1815.9 | 84.1 | unavailable | unavailable | unavailable | unavailable | unavailable |
| product | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 1754.2 | 1728.4–1792.3 | unavailable | 84.4 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 2420.2 | 2319.9–2775.9 | 2682.7 | 83.1 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 2703.5 | 2605.7–4162.6 | unavailable | 81.3 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 5284.0 | 5090.7–5573.6 | 5533.7 | 85.4 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 5896.5 | 5219.9–5979.1 | unavailable | 87.7 | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 342.7 | 326.1–408.2 | 386.1 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 350.8 | 330.2–358.7 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10510.6 | 1065.1 | 2493.0 | 51299.3 | unavailable | 65368.8 |
| product | product-cold-0-0 | 10005.3 | 1021.1 | 2338.2 | 0.0 | unavailable | 13364.9 |
| product | product-cold-1-0 | 10198.2 | 1027.9 | 2346.6 | 0.0 | unavailable | 13572.7 |
| product | product-cold-2-0 | 10200.0 | 1003.0 | 2278.4 | 0.0 | unavailable | 13481.5 |
| productPayload | productPayload-warm-0-0 | 14274.6 | 1334.5 | 2320.9 | 50998.2 | unavailable | 68928.4 |
| productPayload | productPayload-cold-0-0 | 10730.3 | 1380.0 | 2495.6 | 0.0 | unavailable | 14606.1 |
| productPayload | productPayload-cold-1-0 | 10791.9 | 1379.6 | 2394.8 | 0.0 | unavailable | 14566.3 |
| productPayload | productPayload-cold-2-0 | 11137.8 | 1473.7 | 2538.4 | 0.0 | unavailable | 15149.9 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 15047.8 | 4876.9 | 3122.8 | 0.0 | unavailable | 23047.5 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14600.8 | 4776.9 | 3007.7 | 0.0 | unavailable | 22385.5 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 14713.6 | 4915.3 | 3190.3 | 0.0 | unavailable | 22819.2 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 16572.5 | 4995.7 | 3253.8 | 0.0 | unavailable | 24822.1 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 17146.3 | unavailable | unavailable | unavailable | 1736.7 | 18883.3 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 15908.3 | unavailable | unavailable | unavailable | 1767.5 | 17675.8 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 15868.8 | unavailable | unavailable | unavailable | 1741.2 | 17610.0 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 16770.3 | unavailable | unavailable | unavailable | 1737.0 | 18507.3 |

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
