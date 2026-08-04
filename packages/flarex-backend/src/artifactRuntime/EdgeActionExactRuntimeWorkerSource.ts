import {
  EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
  type EdgeActionExactRuntimeArtifactRefV1,
  type EdgeActionExactRuntimeFunctionV1,
} from "flarex-protocol/edge-action-exact-runtime";

export function edgeActionExactRuntimeWorkerConfigurationSourceV1(
  input: Readonly<{
    readonly runtimeTargetSha256Hex: string;
    readonly hostPolicySha256Hex: string;
    readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
    readonly function: EdgeActionExactRuntimeFunctionV1;
    readonly moduleTime: number;
    readonly maximumArgumentBytes: number;
    readonly maximumResultBytes: number;
    readonly maximumSyscalls: number;
    readonly maximumCallbackArgumentBytes: number;
    readonly maximumCallbackResultBytes: number;
  }>,
): string {
  return `// Generated for one candidate-bound edge-action Worker.
export const exactEdgeActionRuntimeConfigurationV1 = Object.freeze(${JSON.stringify({
    requestFormat: EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
    requestVersion: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    resultFormat: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
    resultVersion: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
    runtimeTargetSha256Hex: input.runtimeTargetSha256Hex,
    hostPolicySha256Hex: input.hostPolicySha256Hex,
    artifact: input.artifact,
    function: input.function,
    moduleEvaluationTime: input.moduleTime,
    maximumArgumentBytes: input.maximumArgumentBytes,
    maximumResultBytes: input.maximumResultBytes,
    maximumSyscalls: input.maximumSyscalls,
    maximumCallbackArgumentBytes: input.maximumCallbackArgumentBytes,
    maximumCallbackResultBytes: input.maximumCallbackResultBytes,
  })});
`;
}

export function edgeActionExactRuntimeExecutionBridgeSourceV1(
  artifactExecutionModule: string,
  exportName: string,
  functionPath: string,
): string {
  const separator = functionPath.indexOf(":");
  if (separator <= 0 || separator !== functionPath.lastIndexOf(":")) {
    throw new Error("Exact edge-action function path is invalid.");
  }
  const moduleName = functionPath.slice(0, separator);
  return `// Generated from an authenticated candidate-bound edge-action entry.
import * as applicationModuleV1 from ${JSON.stringify(`../${artifactExecutionModule}`)};
const handlerV1 = applicationModuleV1[${JSON.stringify(exportName)}];
const functionV1 = Object.freeze({ isAction: true, isPublic: true, _handler: handlerV1 });
export default Object.freeze({ ${JSON.stringify(moduleName)}: Object.freeze({ ${JSON.stringify(exportName)}: functionV1 }) });
`;
}
