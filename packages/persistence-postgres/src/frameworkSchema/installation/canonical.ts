import { isCanonicalIsoInstant } from "@flarex/time/iso-instant";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand, Effect, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type JsonObject,
} from "flarex-protocol/json";

import {
  capturePrivateCanonicalValue,
  verifyStoredPrivateCanonicalValue,
} from "../privateCanonicalValue";
import {
  capturedFrameworkMigrationTerminalMatchesAdmission,
  isCapturedFrameworkMigrationAttemptTerminal,
  isCapturedFrameworkMigrationPlanAdmission,
  isCapturedFreshRelationalMigrationPlan,
} from "../../migrationCoordination/canonical";
import type {
  CanonicalPositiveInt64,
  FrameworkSchemaAvailabilityHeadSha256,
  FrameworkSchemaAvailabilityHistorySha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaInstallationSha256,
  FrameworkSchemaReadinessSha256,
  FrameworkSchemaValidationSha256,
} from "../../migrationCoordination/identity";
import type { RelationalPhysicalCapabilityEvidence } from
  "../../relationalSchema/physical/model";
import {
  capturedAuthorityForFrameworkSchemaAvailabilityHistory,
  isCapturedFrameworkSchemaAvailabilityHistoryAuthority,
  isCapturedFrameworkSchemaInstallationAuthority,
  isCapturedFrameworkSchemaReadinessAuthority,
  registerCapturedFrameworkSchemaAvailabilityHead,
  registerCapturedFrameworkSchemaAvailabilityHistory,
  registerCapturedFrameworkSchemaInstallation,
  registerCapturedFrameworkSchemaReadiness,
} from "./authority";
import { FrameworkSchemaInstallationValueError } from "./errors";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
  FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
  FRAMEWORK_SCHEMA_READINESS_FORMAT,
  FRAMEWORK_SCHEMA_READINESS_VERSION,
  type CaptureFrameworkSchemaAvailabilityHistoryInput,
  type CaptureFrameworkSchemaInstallationInput,
  type CaptureFrameworkSchemaReadinessInput,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaAvailabilityHead,
  type FrameworkSchemaAvailabilityHeadFrame,
  type FrameworkSchemaAvailabilityHistoryFrame,
  type FrameworkSchemaAvailabilityStatus,
  type FrameworkSchemaAvailabilityToken,
  type FrameworkSchemaInstallationFrame,
  type FrameworkSchemaInstallationIdentity,
  type FrameworkSchemaInstallationIdentityPreimage,
  type FrameworkSchemaReadinessFrame,
  type RelationalResidualRequirement,
} from "./model";
import {
  isStoredInstallationFrame,
  isStoredInstallationIdentity,
} from "./storedValidation";

export const MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES = 4_194_304;
export const MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES = 1_048_576;

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const MAX_INT64 = 9_223_372_036_854_775_807n;
const brandInstallationSha256 =
  Brand.nominal<FrameworkSchemaInstallationSha256>();
const brandInstallationReceiptSha256 =
  Brand.nominal<FrameworkSchemaInstallationReceiptSha256>();
const brandValidationSha256 = Brand.nominal<FrameworkSchemaValidationSha256>();
const brandReadinessSha256 = Brand.nominal<FrameworkSchemaReadinessSha256>();
const brandAvailabilityHistorySha256 =
  Brand.nominal<FrameworkSchemaAvailabilityHistorySha256>();
const brandAvailabilityHeadSha256 =
  Brand.nominal<FrameworkSchemaAvailabilityHeadSha256>();
const brandPositiveInt64 = Brand.nominal<CanonicalPositiveInt64>();

export const captureFrameworkSchemaInstallation = Effect.fn(
  "FrameworkSchemaInstallation.capture",
)(function* (
  input: CaptureFrameworkSchemaInstallationInput,
): Effect.fn.Return<
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaInstallationFrame,
    FrameworkSchemaInstallationReceiptSha256
  >,
  FrameworkSchemaInstallationValueError
> {
  if (
    !isCapturedFreshRelationalMigrationPlan(input.plan) ||
    !isCapturedFrameworkMigrationPlanAdmission(input.admission) ||
    !isCapturedFrameworkMigrationAttemptTerminal(input.terminal) ||
    !capturedFrameworkMigrationTerminalMatchesAdmission(
      input.terminal,
      input.admission,
    ) ||
    input.admission.frame.planSha256 !== input.plan.migrationPlanSha256 ||
    input.terminal.frame.planSha256 !== input.plan.migrationPlanSha256 ||
    input.terminal.frame.outcome.kind !== "succeeded" ||
    input.installedStructureSha256 !== input.plan.physicalLayout.layoutSha256 ||
    !isCanonicalIsoInstant(input.installedAt)
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.evidenceMismatch(
        "captureInstallation",
      ),
    );
  }
  const installedPhysicalCapabilities = yield* Effect.fromResult(
    captureExactCapabilities(
      input.installedPhysicalCapabilities,
      input.plan.physicalLayout.frame.requiredPhysicalCapabilities,
      "captureInstallation",
    ),
  );
  const identity = yield* captureInstallationIdentity(input.plan);
  const frame = Object.freeze({
    format: FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
    version: FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
    identity,
    planAdmissionSha256: input.admission.sha256,
    terminalAttemptSha256: input.terminal.sha256,
    installedStructureSha256: input.plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities,
    installedAt: input.installedAt,
  } satisfies FrameworkSchemaInstallationFrame);
  const installation = yield* captureInstallationValue(
    frame,
    brandInstallationReceiptSha256,
    "captureInstallation",
  );
  registerCapturedFrameworkSchemaInstallation(installation, {
    plan: input.plan,
    admission: input.admission,
    terminal: input.terminal,
  });
  return installation;
});

export const captureFrameworkSchemaReadiness = Effect.fn(
  "FrameworkSchemaReadiness.capture",
)(function* (
  input: CaptureFrameworkSchemaReadinessInput,
): Effect.fn.Return<
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaReadinessFrame,
    FrameworkSchemaReadinessSha256
  >,
  FrameworkSchemaInstallationValueError
> {
  if (
    !isCapturedFrameworkSchemaInstallationAuthority(input.installation) ||
    !isSha256(input.validationSha256) ||
    input.validatedStructureSha256 !==
      input.installation.frame.installedStructureSha256 ||
    !isCanonicalIsoInstant(input.validatedAt)
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.evidenceMismatch(
        "captureReadiness",
      ),
    );
  }
  const validatedPhysicalCapabilities = yield* Effect.fromResult(
    captureExactCapabilities(
      input.validatedPhysicalCapabilities,
      input.installation.frame.installedPhysicalCapabilities,
      "captureReadiness",
    ),
  );
  const expectedResidual = residualRequirements(
    validatedPhysicalCapabilities,
  );
  const capturedResidual = yield* Effect.fromResult(captureExactResidual(
    input.residualRequirements,
    expectedResidual,
  ));
  const frame = Object.freeze({
    format: FRAMEWORK_SCHEMA_READINESS_FORMAT,
    version: FRAMEWORK_SCHEMA_READINESS_VERSION,
    installation: input.installation.frame.identity,
    installationReceiptSha256: input.installation.sha256,
    validationPolicy: "relational-postgres-exact-candidate-structure",
    validationSha256: brandValidationSha256(input.validationSha256),
    validatedStructureSha256:
      input.installation.frame.installedStructureSha256,
    validatedPhysicalCapabilities,
    residualRequirements: capturedResidual,
    validatedAt: input.validatedAt,
  } satisfies FrameworkSchemaReadinessFrame);
  const readiness = yield* captureInstallationValue(
    frame,
    brandReadinessSha256,
    "captureReadiness",
  );
  registerCapturedFrameworkSchemaReadiness(readiness, {
    installation: input.installation,
  });
  return readiness;
});

export const captureFrameworkSchemaAvailabilityHistory = Effect.fn(
  "FrameworkSchemaAvailabilityHistory.capture",
)(function* (
  input: CaptureFrameworkSchemaAvailabilityHistoryInput,
): Effect.fn.Return<
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  >,
  FrameworkSchemaInstallationValueError
> {
  if (
    !isCapturedFrameworkSchemaReadinessAuthority(input.readiness) ||
    (input.previous !== null &&
      !isCapturedFrameworkSchemaAvailabilityHistoryAuthority(
        input.previous,
      )) ||
    !isAvailabilityStatus(input.status) ||
    !isCanonicalIsoInstant(input.recordedAt)
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.invalidTransition(),
    );
  }
  const previous = input.previous;
  const previousAuthority = previous === null
    ? undefined
    : capturedAuthorityForFrameworkSchemaAvailabilityHistory(previous);
  if (
    previous !== null &&
    (
      previousAuthority?.readiness !== input.readiness ||
      previous.frame.readinessSha256 !== input.readiness.sha256 ||
      previous.frame.installation.installationSha256 !==
        input.readiness.frame.installation.installationSha256 ||
      previous.frame.status === input.status
    )
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.invalidTransition(),
    );
  }
  const first = previous === null;
  if (
    (first && (input.status !== "ready" || input.reasonSha256 !== null)) ||
    (!first && input.status === "ready" && input.reasonSha256 !== null) ||
    (!first && input.status !== "ready" && !isSha256(input.reasonSha256))
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.invalidTransition(),
    );
  }
  const reasonSha256 = input.reasonSha256 === null
    ? null
    : isSha256(input.reasonSha256)
    ? input.reasonSha256
    : yield* Effect.fail(
        FrameworkSchemaInstallationValueError.invalidTransition(),
      );
  const availabilitySequence = yield* Effect.fromResult(nextSequence(previous));
  const frame = Object.freeze({
    format: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
    version: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
    installation: input.readiness.frame.installation,
    readinessSha256: input.readiness.sha256,
    availabilitySequence,
    previousAvailability: previous === null
      ? null
      : availabilityToken(previous),
    status: input.status,
    reasonSha256,
    recordedAt: input.recordedAt,
  } satisfies FrameworkSchemaAvailabilityHistoryFrame);
  const history = yield* captureInstallationValue(
    frame,
    brandAvailabilityHistorySha256,
    "captureAvailability",
    MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  );
  registerCapturedFrameworkSchemaAvailabilityHistory(history, {
    readiness: input.readiness,
    previous,
  });
  return history;
});

export const captureFrameworkSchemaAvailabilityHead = Effect.fn(
  "FrameworkSchemaAvailabilityHead.capture",
)(function* (
  history: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  >,
): Effect.fn.Return<
  FrameworkSchemaAvailabilityHead,
  FrameworkSchemaInstallationValueError
> {
  const historyAuthority =
    capturedAuthorityForFrameworkSchemaAvailabilityHistory(history);
  if (historyAuthority === undefined) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.invalidTransition(),
    );
  }
  const frame = Object.freeze({
    format: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
    version: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
    installation: history.frame.installation,
    readinessSha256: history.frame.readinessSha256,
    availabilitySequence: history.frame.availabilitySequence,
    historySha256: history.sha256,
    status: history.frame.status,
  } satisfies FrameworkSchemaAvailabilityHeadFrame);
  const head = yield* captureInstallationValue(
    frame,
    brandAvailabilityHeadSha256,
    "captureAvailability",
    MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  );
  registerCapturedFrameworkSchemaAvailabilityHead(head, {
    readiness: historyAuthority.readiness,
    history,
  });
  return head;
});

export type StoredFrameworkSchemaInstallationValueKind =
  | "installation"
  | "readiness"
  | "availabilityHistory"
  | "availabilityHead";

export interface VerifyStoredFrameworkSchemaInstallationValueInput {
  readonly kind: StoredFrameworkSchemaInstallationValueKind;
  readonly canonicalBytes: unknown;
  readonly sha256Hex: unknown;
}

export const verifyStoredFrameworkSchemaInstallationValue = Effect.fn(
  "FrameworkSchemaInstallation.verifyStored",
)(function* (
  input: VerifyStoredFrameworkSchemaInstallationValueInput,
): Effect.fn.Return<JsonObject, FrameworkSchemaInstallationValueError> {
  const contract = storedContract(input.kind);
  const frame = yield* verifyStoredPrivateCanonicalValue({
    canonicalBytes: input.canonicalBytes,
    sha256Hex: input.sha256Hex,
    expectedFormat: contract.format,
    expectedVersion: contract.version,
    maximumCanonicalBytes: contract.maximumBytes,
    expectedKeys: contract.keys,
    validateFrame: candidate => isStoredInstallationFrame(
      input.kind,
      candidate,
    ),
  }, {
    storedCorruption: FrameworkSchemaInstallationValueError.storedStateCorrupt,
    hashFailure: cause =>
      FrameworkSchemaInstallationValueError.resourceFailure(
        "decodeStoredValue",
        cause,
      ),
  });
  if (
    !isStoredInstallationFrame(input.kind, frame) ||
    !(yield* validateStoredInstallationIdentity(input.kind, frame))
  ) {
    return yield* Effect.fail(
      FrameworkSchemaInstallationValueError.storedStateCorrupt(),
    );
  }
  return frame;
});

const validateStoredInstallationIdentity = Effect.fn(
  "FrameworkSchemaInstallation.validateStoredIdentity",
)(function* (
  kind: StoredFrameworkSchemaInstallationValueKind,
  frame: JsonObject,
): Effect.fn.Return<boolean, FrameworkSchemaInstallationValueError> {
  const identity = kind === "installation" ? frame.identity : frame.installation;
  if (
    !isStoredInstallationIdentity(identity) ||
    !isJsonObjectFromUnknown(identity.artifact) ||
    !isJsonObjectFromUnknown(identity.physicalLocator) ||
    !isJsonObjectFromUnknown(identity.targetNamespace)
  ) return false;
  const preimage = Object.freeze({
    artifact: identity.artifact,
    physicalLocator: identity.physicalLocator,
    targetNamespace: identity.targetNamespace,
    migrationPlanSha256: identity.migrationPlanSha256,
  });
  const captured = yield* capturePrivateCanonicalValue(
    preimage,
    MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
    {
      invalidInput: FrameworkSchemaInstallationValueError.storedStateCorrupt,
      hashFailure: cause =>
        FrameworkSchemaInstallationValueError.resourceFailure(
          "decodeStoredValue",
          cause,
        ),
    },
  );
  return captured.sha256Hex === identity.installationSha256;
});

function captureInstallationIdentity(
  plan: import("../../migrationCoordination/model").FreshRelationalMigrationPlan,
): Effect.Effect<
  FrameworkSchemaInstallationIdentity,
  FrameworkSchemaInstallationValueError
> {
  const preimage = Object.freeze({
    artifact: plan.frame.artifact,
    physicalLocator: plan.frame.physicalLocator,
    targetNamespace: plan.frame.targetNamespace,
    migrationPlanSha256: plan.migrationPlanSha256,
  } satisfies FrameworkSchemaInstallationIdentityPreimage);
  return Effect.map(
    capturePrivateCanonicalValue(
      preimage,
      MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
      installationErrorPolicy("captureInstallation"),
    ),
    captured => Object.freeze({
      ...preimage,
      installationSha256: brandInstallationSha256(captured.sha256Hex),
    }),
  );
}

function captureInstallationValue<Frame extends JsonObject, Sha>(
  frame: Frame,
  brand: (value: string) => Sha,
  operation:
    | "captureInstallation"
    | "captureReadiness"
    | "captureAvailability",
  maximumBytes = MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
): Effect.Effect<
  CapturedFrameworkSchemaInstallationValue<Frame, Sha>,
  FrameworkSchemaInstallationValueError
> {
  return Effect.map(
    capturePrivateCanonicalValue(
      frame,
      maximumBytes,
      installationErrorPolicy(operation),
    ),
    captured => Object.freeze({
      frame,
      sha256: brand(captured.sha256Hex),
      canonicalJson: captured.canonicalJson,
    }),
  );
}

function captureExactCapabilities(
  input: readonly unknown[],
  expected: readonly RelationalPhysicalCapabilityEvidence[],
  operation: "captureInstallation" | "captureReadiness",
): Result.Result<
  readonly RelationalPhysicalCapabilityEvidence[],
  FrameworkSchemaInstallationValueError
> {
  try {
    if (!Array.isArray(input) || input.length !== expected.length) {
      return Result.fail(
        FrameworkSchemaInstallationValueError.evidenceMismatch(operation),
      );
    }
    const ordered = [...input].toSorted((left, right) => compareUtf16Strings(
      capabilitySortKey(left),
      capabilitySortKey(right),
    ));
    for (let index = 0; index < ordered.length; index += 1) {
      const candidate = ordered[index];
      const required = expected[index];
      if (
        required === undefined ||
        !isJsonObjectFromUnknown(candidate) ||
        canonicalJson(candidate) !== canonicalJson(required)
      ) {
        return Result.fail(
          FrameworkSchemaInstallationValueError.evidenceMismatch(operation),
        );
      }
    }
    return Result.succeed(Object.freeze([...expected]));
  } catch {
    return Result.fail(
      FrameworkSchemaInstallationValueError.evidenceMismatch(operation),
    );
  }
}

function residualRequirements(
  capabilities: readonly RelationalPhysicalCapabilityEvidence[],
): readonly RelationalResidualRequirement[] {
  return Object.freeze(capabilities.map(capability => Object.freeze({
    capability: capability.identity,
    requirement: capability.residualRequirement,
  })).toSorted((left, right) => compareUtf16Strings(
    left.capability.capabilityId,
    right.capability.capabilityId,
  )));
}

function captureExactResidual(
  input: readonly unknown[],
  expected: readonly RelationalResidualRequirement[],
): Result.Result<
  readonly RelationalResidualRequirement[],
  FrameworkSchemaInstallationValueError
> {
  try {
    if (!Array.isArray(input) || input.length !== expected.length) {
      return Result.fail(
        FrameworkSchemaInstallationValueError.evidenceMismatch(
          "captureReadiness",
        ),
      );
    }
    const ordered = [...input].toSorted((left, right) => compareUtf16Strings(
      residualSortKey(left),
      residualSortKey(right),
    ));
    for (let index = 0; index < ordered.length; index += 1) {
      const candidate = ordered[index];
      const required = expected[index];
      if (
        required === undefined ||
        !isJsonObjectFromUnknown(candidate) ||
        canonicalJson(candidate) !== canonicalJson(required)
      ) {
        return Result.fail(
          FrameworkSchemaInstallationValueError.evidenceMismatch(
            "captureReadiness",
          ),
        );
      }
    }
    return Result.succeed(Object.freeze([...expected]));
  } catch {
    return Result.fail(
      FrameworkSchemaInstallationValueError.evidenceMismatch(
        "captureReadiness",
      ),
    );
  }
}

function nextSequence(
  previous: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  > | null,
): Result.Result<CanonicalPositiveInt64, FrameworkSchemaInstallationValueError> {
  const next = previous === null
    ? 1n
    : BigInt(previous.frame.availabilitySequence) + 1n;
  return next <= MAX_INT64
    ? Result.succeed(brandPositiveInt64(String(next)))
    : Result.fail(FrameworkSchemaInstallationValueError.invalidTransition());
}

function availabilityToken(
  history: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  >,
): FrameworkSchemaAvailabilityToken {
  return Object.freeze({
    availabilitySequence: history.frame.availabilitySequence,
    historySha256: history.sha256,
    status: history.frame.status,
  });
}

function isAvailabilityStatus(
  input: unknown,
): input is FrameworkSchemaAvailabilityStatus {
  return input === "ready" || input === "withdrawn" ||
    input === "superseded" || input === "quarantined";
}

function isSha256(input: unknown): input is string {
  return typeof input === "string" && LOWERCASE_SHA256.test(input);
}

function capabilitySortKey(input: unknown): string {
  return isJsonObjectFromUnknown(input) &&
      isJsonObjectFromUnknown(input.identity) &&
      typeof input.identity.capabilityId === "string"
    ? input.identity.capabilityId
    : "";
}

function residualSortKey(input: unknown): string {
  return isJsonObjectFromUnknown(input) &&
      isJsonObjectFromUnknown(input.capability) &&
      typeof input.capability.capabilityId === "string"
    ? input.capability.capabilityId
    : "";
}

function canonicalJson(input: JsonObject): string {
  return encodeCanonicalJson(input, () => {
    throw new Error("Validated installation JSON became invalid");
  });
}

function storedContract(kind: StoredFrameworkSchemaInstallationValueKind) {
  switch (kind) {
    case "installation":
      return Object.freeze({
        format: FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
        version: FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
        maximumBytes: MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "identity",
          "planAdmissionSha256",
          "terminalAttemptSha256",
          "installedStructureSha256",
          "installedPhysicalCapabilities",
          "installedAt",
        ]),
      });
    case "readiness":
      return Object.freeze({
        format: FRAMEWORK_SCHEMA_READINESS_FORMAT,
        version: FRAMEWORK_SCHEMA_READINESS_VERSION,
        maximumBytes: MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "installation",
          "installationReceiptSha256",
          "validationPolicy",
          "validationSha256",
          "validatedStructureSha256",
          "validatedPhysicalCapabilities",
          "residualRequirements",
          "validatedAt",
        ]),
      });
    case "availabilityHistory":
      return Object.freeze({
        format: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
        version: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
        maximumBytes: MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "installation",
          "readinessSha256",
          "availabilitySequence",
          "previousAvailability",
          "status",
          "reasonSha256",
          "recordedAt",
        ]),
      });
    case "availabilityHead":
      return Object.freeze({
        format: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
        version: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
        maximumBytes: MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "installation",
          "readinessSha256",
          "availabilitySequence",
          "historySha256",
          "status",
        ]),
      });
  }
}

function installationErrorPolicy(
  operation:
    | "captureInstallation"
    | "captureReadiness"
    | "captureAvailability",
) {
  return Object.freeze({
    invalidInput: () =>
      FrameworkSchemaInstallationValueError.invalidInput(operation),
    hashFailure: (cause: unknown) =>
      FrameworkSchemaInstallationValueError.resourceFailure(operation, cause),
  });
}
