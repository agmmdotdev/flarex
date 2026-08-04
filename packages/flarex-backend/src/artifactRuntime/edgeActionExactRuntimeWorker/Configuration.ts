import type {
  EdgeActionExactRuntimeArtifactRefV1,
  EdgeActionExactRuntimeFunctionV1,
} from "flarex-protocol/edge-action-exact-runtime";

export interface EdgeActionExactRuntimeWorkerConfigurationV1 {
  readonly requestFormat: "flarex.edge-action-exact-runtime";
  readonly requestVersion: 1;
  readonly resultFormat: "flarex.edge-action-exact-runtime-result";
  readonly resultVersion: 1;
  readonly runtimeTargetSha256Hex: string;
  readonly hostPolicySha256Hex: string;
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
  readonly moduleEvaluationTime: number;
  readonly maximumSyscalls: number;
  readonly maximumArgumentBytes: number;
  readonly maximumResultBytes: number;
  readonly maximumCallbackArgumentBytes: number;
  readonly maximumCallbackResultBytes: number;
}
