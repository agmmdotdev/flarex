import { describe, expect, it } from "vitest";
import { renderMixedMutationPerformanceReport, type PerformanceRawReport } from
  "./support/mixedMutationPerformanceReport";

describe("mixed mutation diagnostic report", () => {
  it("labels profiled smoke as non-acceptance and retains secondary profiler failures", () => {
    const raw: PerformanceRawReport = {
      format: "flarex.mixed-mutation-performance", revision: "revision",
      workingDiffSha256: "diff", mode: "smoke", observationMode: "untraced",
      diagnostic: { kind: "node-inspector-cpu", latencyAcceptance: false },
      planned: { warmups: 1, warm: 2, cold: 1 }, plannedWorkloads: ["mixedWorkflow"],
      environment: {}, interpretation: [], unavailable: [], sqlTemplates: [],
      setupFailures: [], ownerMappings: [], samples: [{
        id: "mixedWorkflow-warm-0-1", workload: "mixedWorkflow", temperature: "warm",
        index: 1, status: "error", failureName: "LogicalParticipantAdmissionError",
        failureStage: "invoke", failureCode: "40001", failureReason: "resourceFailure",
        failureDiagnosticTokens: [], cpuDiagnosticSecondaryFailures: [
          { stage: "stop", name: "Error" }, { stage: "disconnect", name: "Error" },
        ], wallMs: 12, requestWorkerConstructionMs: null, sealedJournalBytes: null,
        instrumentationFinalizationMs: null, construction: {
          setupTotalMs: null, provisioningMs: null, preparedModuleMs: null,
          initialSeedingMs: null, additionalSetupSeedingMs: null,
          standaloneRuntimeConstructionMs: null, seedingMs: null,
        }, inventoryBefore: null, inventoryAfter: null, trace: null,
      }],
    };
    const report = renderMixedMutationPerformanceReport(raw);
    expect(report).toContain("Node CPU diagnostic — excluded from latency acceptance");
    expect(report).toContain("profile window includes profiler start/stop sampling");
    expect(report).toContain("LogicalParticipantAdmissionError (40001), resourceFailure");
    expect(report).toContain("secondary CPU diagnostic failures stop:Error, disconnect:Error");
  });
});
