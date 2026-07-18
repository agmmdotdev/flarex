import {
  createProbeGatewayWorker,
  type ProbeGatewayAdmissionPolicy,
  type ProbeGatewayEnv,
} from "./gateway";
import { canonicalProbeCampaignManifestV1 } from "./campaignProtocol";
import { PROBE_ACTIVE_CAMPAIGN_MATRIX_V1 } from "./matrix";
import {
  OneShotProbeRuntimeRerunCapability,
  ProbeRuntimeRerunEntrypoint,
} from "./runtimeRerunEntrypoint";

export { ProbeSessionDO } from "./sessionDO";
export { ProbeRunDO } from "./probeRunDO";
export { ProbeCampaignDO } from "./probeCampaignDO";
export { ProbeRuntimeRerunEntrypoint } from "./runtimeRerunEntrypoint";
export { ProbeSessionExecutorReadEntrypoint } from "./sessionExecutorReadEntrypoint";

const frozenManifest = canonicalProbeCampaignManifestV1(
  PROBE_ACTIVE_CAMPAIGN_MATRIX_V1,
);
const frozenRunIds = new Set(
  PROBE_ACTIVE_CAMPAIGN_MATRIX_V1.runs.map(run => run.runId),
);
const admission = {
  manifestIsAdmitted: (env, manifest) =>
    testUnfrozenAdmissionEnabled(env) ||
    canonicalProbeCampaignManifestV1(manifest) === frozenManifest,
  runIdIsAdmitted: (env, runId) =>
    testUnfrozenAdmissionEnabled(env) || frozenRunIds.has(runId),
} satisfies ProbeGatewayAdmissionPolicy;
const gateway = createProbeGatewayWorker(admission);

export default {
  fetch(request, env, ctx) {
    return gateway.fetch(
      request,
      env,
      runtimeRequest =>
        new OneShotProbeRuntimeRerunCapability(
          ctx.exports.ProbeRuntimeRerunEntrypoint,
          runtimeRequest,
        ),
    );
  },
} satisfies ExportedHandler<ProbeGatewayEnv>;

function testUnfrozenAdmissionEnabled(env: ProbeGatewayEnv): boolean {
  return env.RUNTIME_TOPOLOGY_PROBE_TEST_UNFROZEN_ADMISSION ===
    "explicit-test-only";
}
