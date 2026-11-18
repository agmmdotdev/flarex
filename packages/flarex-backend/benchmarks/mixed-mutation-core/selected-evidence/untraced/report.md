# Private mixed mutation performance baseline

Revision: `4afceadda203e32f20ff42ced933a46246efe9c8`; working diff SHA-256: `381be1f7c0f956bba4a8cdfbcd15debcd229299558064ef61042808c62d9c9fd`; mode: **full**, observation: **untraced**.
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
    "role": "flarex_workflow_test",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "7900b3eb41e587b37f3a95036003ff6eaef1b26291ee5504d8f8ad9385e5de85",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "299b0b9a2b87610c1837bfea19b5c00c74b5fa1930659d3c852440fb4fd84887",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "a76f10c870d360d4117d30afa509ee6bbb11a345dea640b3473b6879fcea060d",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "27cbb62d616c3c6a9413bab17903a3975da1edc7821f911a27048bd541676fd5",
    "packages/persistence-postgres/src/applicationActivation.ts": "af29252779772604269b21a36ff19f200a46cc686918be7c29dd7d673bf7db8d",
    "packages/persistence-postgres/src/applicationReadiness.ts": "b74697ade7ef0112031b90d56b740cace179715480f0665b8873e39d8e3a36b5",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/indexBuildStates.ts": "717297da4b03f890c18698bb488a4a21f5f90fb1ca286c46b16dbc214e68a299",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "8872e57cdfa37474c5a710e4eb58a1cc23f796ad73031ba3e40ad9530a051d52",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "d93c09c2faa661749de858679fdb1261441bcbcfcf4ec92f7b65ff68b60f9958",
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
| product | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 2271.3 | 2199.0–2393.8 | 2389.1 | 84.2 | unavailable | unavailable | unavailable | unavailable | unavailable |
| product | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 2219.6 | 2203.9–2409.5 | unavailable | 82.9 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 3303.2 | 3225.4–3502.0 | 3455.7 | 83.1 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 3324.3 | 3257.6–3599.7 | unavailable | 90.3 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 6698.6 | 6574.6–7393.1 | 7002.4 | 84.9 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 6841.6 | 6840.1–6947.6 | unavailable | 81.8 | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 338.2 | 321.6–393.6 | 370.9 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 340.3 | 323.4–354.7 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11353.9 | 1080.6 | 2540.7 | 52236.2 | unavailable | 67212.1 |
| product | product-cold-0-0 | 16736.0 | 1081.6 | 2528.3 | 0.0 | unavailable | 20346.3 |
| product | product-cold-1-0 | 15592.4 | 1039.2 | 2343.5 | 0.0 | unavailable | 18975.0 |
| product | product-cold-2-0 | 11115.6 | 1018.8 | 2374.5 | 0.0 | unavailable | 14509.0 |
| productPayload | productPayload-warm-0-0 | 9977.8 | 1377.9 | 2528.9 | 52433.8 | unavailable | 66318.5 |
| productPayload | productPayload-cold-0-0 | 16312.2 | 1351.1 | 2643.6 | 0.0 | unavailable | 20307.1 |
| productPayload | productPayload-cold-1-0 | 14015.2 | 1388.1 | 2762.1 | 0.0 | unavailable | 18165.5 |
| productPayload | productPayload-cold-2-0 | 9670.2 | 1332.8 | 2337.7 | 0.0 | unavailable | 13340.7 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14106.2 | 4791.9 | 3000.2 | 0.0 | unavailable | 21898.3 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14457.8 | 4740.1 | 3217.5 | 0.0 | unavailable | 22415.5 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 14181.3 | 4729.9 | 3054.1 | 0.0 | unavailable | 21965.4 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 14742.8 | 4989.4 | 3217.8 | 0.0 | unavailable | 22950.0 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16741.3 | unavailable | unavailable | unavailable | 1764.0 | 18505.6 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 17458.0 | unavailable | unavailable | unavailable | 1758.4 | 19216.5 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 17044.5 | unavailable | unavailable | unavailable | 1713.5 | 18758.1 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 18656.1 | unavailable | unavailable | unavailable | 1710.7 | 20366.8 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 13049.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 20848.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 38213.0 | 0.0 |
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
