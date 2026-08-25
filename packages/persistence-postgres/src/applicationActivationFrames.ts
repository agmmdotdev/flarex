export type ApplicationActivationReadinessCommitment =
  | Readonly<{
      readonly kind: "legacy";
      readonly contractVersion: 1;
      readonly readinessSha256: string;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly contractVersion: 2;
      readonly readinessSha256: string;
      readonly relationSetReadinessSha256: string;
      readonly relationCount: number;
    }>;

export interface ApplicationActivationExpectedHeadFrame {
  readonly activationSequence: string;
  readonly headSha256: string;
}

export function applicationActivationRequestFrame(
  input: Readonly<{
    readonly scopeId: string;
    readonly revisionId: string;
    readonly readiness: ApplicationActivationReadinessCommitment;
    readonly expectedActiveHead: ApplicationActivationExpectedHeadFrame | null;
  }>,
): Readonly<Record<string, unknown>> {
  const common = {
    format: "flarex.application-activation-request",
    scopeId: input.scopeId,
    revisionId: input.revisionId,
    readinessSha256: input.readiness.readinessSha256,
    expectedActiveHead: input.expectedActiveHead,
  } as const;
  return input.readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        version: 1,
      })
    : Object.freeze({
        ...common,
        version: 2,
        readinessContractVersion: input.readiness.contractVersion,
        relationSetReadinessSha256:
          input.readiness.relationSetReadinessSha256,
        relationCount: input.readiness.relationCount,
      });
}

export function applicationActivationFrame(
  input: Readonly<{
    readonly scopeId: string;
    readonly activationSequence: string;
    readonly previousActivationSequence: string | null;
    readonly revisionId: string;
    readonly readiness: ApplicationActivationReadinessCommitment;
    readonly activationRequestSha256: string;
    readonly activatedAt: string;
  }>,
): Readonly<Record<string, unknown>> {
  const common = {
    format: "flarex.application-activation",
    scopeId: input.scopeId,
    activationSequence: input.activationSequence,
    previousActivationSequence: input.previousActivationSequence,
    revisionId: input.revisionId,
    readinessSha256: input.readiness.readinessSha256,
    activationRequestSha256: input.activationRequestSha256,
    activatedAt: input.activatedAt,
  } as const;
  return input.readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        version: 1,
      })
    : Object.freeze({
        ...common,
        version: 2,
        readinessContractVersion: input.readiness.contractVersion,
        relationSetReadinessSha256:
          input.readiness.relationSetReadinessSha256,
        relationCount: input.readiness.relationCount,
      });
}

export function applicationActiveHeadFrame(
  input: Readonly<{
    readonly scopeId: string;
    readonly activationSequence: string;
    readonly revisionId: string;
    readonly readiness: ApplicationActivationReadinessCommitment;
    readonly activationSha256: string;
  }>,
): Readonly<Record<string, unknown>> {
  const common = {
    format: "flarex.application-active-head",
    scopeId: input.scopeId,
    activationSequence: input.activationSequence,
    revisionId: input.revisionId,
    readinessSha256: input.readiness.readinessSha256,
    activationSha256: input.activationSha256,
  } as const;
  return input.readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        version: 1,
      })
    : Object.freeze({
        ...common,
        version: 2,
        readinessContractVersion: input.readiness.contractVersion,
        relationSetReadinessSha256:
          input.readiness.relationSetReadinessSha256,
        relationCount: input.readiness.relationCount,
      });
}
