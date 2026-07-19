import { Effect } from "effect";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeSampleId,
  probeSpanId,
  type ProbeSpanId,
} from "../src/identity";
import {
  decodeProbeSampleResultV1Effect,
  probeSampleIdentityV1,
  ProbeDurationMsSchema,
  PROBE_PROTOCOL_VERSION_V1,
  type ProbeSampleResultV1,
  type ProbeScenario,
  type ProbeSpanName,
  type ProbeStartupObservationsV1,
} from "../src/protocol";
import { PROBE_SCENARIO_TOPOLOGY } from "../src/trace";
import {
  ProbeSampleControlV1Schema,
  type ProbeControlledSampleResultV1,
  type ProbeMeasurementDisposition,
  type ProbeSyncWakeObservationV1,
} from "../src/runtimeProtocol";

const runId = Effect.runSync(decodeProbeRunIdEffect("test_run"));

export function validSample(
  scenario: ProbeScenario,
  overrides: Readonly<Record<string, unknown>> = {},
): ProbeSampleResultV1 {
  const expected = PROBE_SCENARIO_TOPOLOGY[scenario];
  const idByName = new Map<ProbeSpanName, ProbeSpanId>();
  for (const [index, [name]] of expected.entries()) {
    idByName.set(name, probeSpanId(ordinal(index)));
  }
  const dimensions = {
    codeMode: "stable" as const,
    concurrency: 1,
    journalEntries: scenario === "facet_journal" ? 1 : 0,
    payloadBytes: 0,
    sessionMode: scenario === "facet_finalizer_warm_invoke" ||
        scenario === "facet_finalizer_postgres_warm_invoke" ||
        scenario === "session_postgres_warm_invoke"
      ? "reuse-session" as const
      : "new-session" as const,
  };
  const raw = {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, ordinal(0)),
    scenario,
    dimensions,
    identity: probeSampleIdentityV1(
      runId,
      scenario,
      dimensions,
      ordinal(0),
    ),
    startup: startupForScenario(scenario),
    edgeColo: "SJC",
    outcome: { kind: "ok" },
    spans: expected.map(([name, parentName], index) => {
      const parentSpanId =
        parentName === null ? null : idByName.get(parentName);
      if (parentSpanId === undefined) {
        throw new Error(`Missing fixture parent span ${parentName}.`);
      }
      return {
        spanId: probeSpanId(ordinal(index)),
        parentSpanId,
        name,
        durationMs: 10 + index,
        outcome: { kind: "ok" },
      };
    }),
    ...overrides,
  };
  return Effect.runSync(decodeProbeSampleResultV1Effect(raw));
}

export function controlledSample(
  sample: ProbeSampleResultV1,
  overrides: {
    readonly phase?: "measurement" | "warmup";
    readonly measurementDisposition?: ProbeMeasurementDisposition;
    readonly observedOutstandingClaims?: number;
    readonly syncWake?: ProbeSyncWakeObservationV1;
  } = {},
): ProbeControlledSampleResultV1 {
  const phase = overrides.phase ?? "measurement";
  const syncWake = overrides.syncWake ??
    (sample.scenario === "commit_wake" ||
        sample.scenario === "full_invoke" ||
        sample.scenario === "executor_worker_invoke" ||
        sample.scenario === "facet_executor_invoke" ||
        sample.scenario === "facet_finalizer_invoke" ||
        sample.scenario === "facet_finalizer_warm_invoke" ||
        sample.scenario === "facet_finalizer_postgres_warm_invoke" ||
        sample.scenario === "session_postgres_warm_invoke" ||
        sample.scenario === "session_executor_invoke"
      ? { kind: "observed", disposition: "applied" } as const
      : { kind: "not-applicable" } as const);
  const measurementDisposition = overrides.measurementDisposition ??
    (phase === "warmup" ? "excluded-warmup" : "eligible");
  return {
    sample,
    control: ProbeSampleControlV1Schema.make({
      phase,
      terminalState: sample.outcome.kind === "ok" ? "completed" : "failed",
      measurementDisposition,
      configuredConcurrency: sample.dimensions.concurrency,
      observedOutstandingClaims: overrides.observedOutstandingClaims ?? 1,
      scenarioWindowDurationMs: ProbeDurationMsSchema.make(1),
      syncWake,
      externalRequestIncludesControlPlane: true,
    }),
  };
}

function startupForScenario(
  scenario: ProbeScenario,
): ProbeStartupObservationsV1 {
  switch (scenario) {
    case "edge_echo":
    case "session_echo":
    case "commit_wake":
      return { workerLoader: "not-applicable", facet: "not-applicable" } as const;
    case "dynamic_direct_echo":
      return { workerLoader: "callback-ran", facet: "not-applicable" } as const;
    case "facet_echo":
    case "facet_journal":
    case "full_invoke":
    case "executor_worker_invoke":
    case "facet_executor_invoke":
    case "facet_finalizer_invoke":
    case "session_executor_invoke":
    case "sync_rerun":
      return { workerLoader: "callback-ran", facet: "callback-ran" } as const;
    case "facet_finalizer_warm_invoke":
    case "facet_finalizer_postgres_warm_invoke":
    case "session_postgres_warm_invoke":
      return {
        workerLoader: "callback-ran",
        facet: "callback-ran",
        sessionActivation: "activation-observed",
      } as const;
    default:
      return exhaustiveScenario(scenario);
  }
}

function exhaustiveScenario(value: never): never {
  throw new Error(`unexpected probe scenario: ${String(value)}`);
}

function ordinal(value: number) {
  return Effect.runSync(decodeProbeOrdinalEffect(value));
}
