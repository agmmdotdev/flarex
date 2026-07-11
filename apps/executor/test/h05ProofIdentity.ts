declare const h05ProofRunIdBrand: unique symbol;

export type H05ProofRunId = string & {
  readonly [h05ProofRunIdBrand]: "H05ProofRunId";
};

export interface H05ProofIdentity {
  readonly deploymentId: string;
  readonly markerText: string;
  readonly projectId: string;
  readonly runId: H05ProofRunId;
}

export type H05ProofRunIdDecode =
  | { readonly ok: true; readonly value: H05ProofRunId }
  | { readonly ok: false; readonly message: string };

export const h05ProofRunIdMessage =
  "FLAREX_H05_RUN_ID must be 1-40 lowercase letters, digits, underscores, or hyphens and start with a letter or digit.";

export function decodeH05ProofRunId(
  value: string | undefined,
): H05ProofRunIdDecode {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return { ok: false, message: "FLAREX_H05_RUN_ID is required." };
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(normalized)) {
    return { ok: false, message: h05ProofRunIdMessage };
  }
  return { ok: true, value: normalized as H05ProofRunId };
}

export function h05ProofIdentity(runId: H05ProofRunId): H05ProofIdentity {
  return {
    runId,
    deploymentId: `deployment_h05_${runId}`,
    projectId: `project_h05_${runId}`,
    markerText: `h05:${runId}`,
  };
}
