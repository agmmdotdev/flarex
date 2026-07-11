import type { H05ProofRunId } from "./proofIdentity";

declare const h05ProbeEndpointBrand: unique symbol;

export type H05ProbeEndpoint = string & {
  readonly [h05ProbeEndpointBrand]: "H05ProbeEndpoint";
};

export const h05ProbeHop = {
  header: "x-flarex-h05-hop",
  value: "probe-to-executor",
} as const;

export function h05ProbeEndpoint(runId: H05ProofRunId): H05ProbeEndpoint {
  return `/__flarex_h05/invoke/${runId}` as H05ProbeEndpoint;
}
