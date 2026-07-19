import {
  createProbeGatewayWorker,
  type ProbeGatewayAdmissionPolicy,
  type ProbeGatewayEnv,
} from "./gateway";
import { canonicalProbeCampaignManifestV1 } from "./campaignProtocol";
import { PROBE_SESSION_POSTGRES_AB_MATRIX_V1 } from "./matrix";
import {
  OneShotProbeRuntimeRerunCapability,
  ProbeRuntimeRerunEntrypoint,
} from "./runtimeRerunEntrypoint";
import {
  ProbeSessionDOBase,
  type ProbeSessionEnv,
} from "./sessionDO";
import {
  finishPostgresRequestEffect,
  readPostgresSnapshotEffect,
} from "./postgresCommitWorker";

export class ProbeSessionDO extends ProbeSessionDOBase {
  constructor(ctx: DurableObjectState, env: ProbeSessionEnv) {
    super(ctx, env, {
      read: readPostgresSnapshotEffect,
      finish: finishPostgresRequestEffect,
    });
  }
}
export { ProbeRunDO } from "./probeRunDO";
export { ProbeCampaignDO } from "./probeCampaignDO";
export { ProbeSyncDO } from "./probeSyncDO";
export { MockPurgeEntrypoint } from "./mockCommitWorker";
export {
  PostgresFinishEntrypoint,
  PostgresReadEntrypoint,
} from "./postgresCommitWorker";
export { ProbeRuntimeRerunEntrypoint } from "./runtimeRerunEntrypoint";
export { ProbeSessionExecutorReadEntrypoint } from "./sessionExecutorReadEntrypoint";

const frozenManifest = canonicalProbeCampaignManifestV1(
  PROBE_SESSION_POSTGRES_AB_MATRIX_V1,
);
const frozenRunIds = new Set(
  PROBE_SESSION_POSTGRES_AB_MATRIX_V1.runs.map(run => run.runId),
);
const admission = {
  manifestIsAdmitted: (_env, manifest) =>
    canonicalProbeCampaignManifestV1(manifest) === frozenManifest,
  runIdIsAdmitted: (_env, runId) => frozenRunIds.has(runId),
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
