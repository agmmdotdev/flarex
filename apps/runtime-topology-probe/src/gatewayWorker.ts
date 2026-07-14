import { createProbeGatewayWorker, type ProbeGatewayEnv } from "./gateway";
import {
  OneShotProbeRuntimeRerunCapability,
  ProbeRuntimeRerunEntrypoint,
} from "./runtimeRerunEntrypoint";

export { ProbeSessionDO } from "./sessionDO";
export { ProbeRunDO } from "./probeRunDO";
export { ProbeRuntimeRerunEntrypoint } from "./runtimeRerunEntrypoint";

const gateway = createProbeGatewayWorker();

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
