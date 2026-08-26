import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import type {
  ApplicationActionAuthorityContextV1,
  DirectActionExecutionSubjectCapabilityV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import { Data } from "effect";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import {
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import {
  confirmApplicationChildMutationEffect as confirmActiveApplicationChildMutationEffectV1,
  declareApplicationExternalEffectDispatch as declareActiveApplicationExternalEffectDispatchV1,
  failApplicationExternalEffectBeforeDispatch as failActiveApplicationExternalEffectBeforeDispatchV1,
  markApplicationExternalEffectUncertain as markActiveApplicationExternalEffectUncertainV1,
  prepareApplicationChildMutationEffect as prepareActiveApplicationChildMutationEffectV1,
  type ApplicationActionEffectRunner as ActiveApplicationActionEffectRunnerV1,
} from "./ApplicationActionEvidence";
import type { EdgeActionHostSyscallSequencerV1 } from
  "./edgeActionHostSyscallSequencerV1";

const UTF8 = new TextEncoder();
const NO_CALLBACK_POISON = Symbol("FlarexEdgeActionNoCallbackPoison");

export interface EdgeActionCallbackInvocationV1 {
  readonly kind: "runQuery" | "runMutation";
  readonly ordinal: bigint;
  readonly functionPath: string;
  readonly arguments: unknown;
  readonly argumentSemanticBytes: number;
}

export interface EdgeActionCallbackSystemPortV1<Selection> {
  readonly runQuery: (
    selection: Selection,
    functionPath: string,
    argumentsValue: unknown,
    identity: ExecutionIdentity,
  ) => Promise<unknown>;
  readonly runMutation: (
    selection: Selection,
    functionPath: string,
    argumentsValue: unknown,
    requestKey: string,
    identity: ExecutionIdentity,
  ) => Promise<unknown>;
}

export interface EdgeActionCallbackEvidencePortV1 {
  readonly hash: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly prepare: (input: Readonly<{
    readonly stableEffectKey: string;
    readonly requestIdentitySha256: Uint8Array;
    readonly childMutationRequestKey: string;
    readonly childMutationFunctionPath: string;
    readonly childMutationArgumentsSha256: Uint8Array;
  }>) => Promise<Readonly<{ readonly effectOrdinal: bigint }>>;
  readonly declareDispatch: (effectOrdinal: bigint) => Promise<void>;
  readonly failBeforeDispatch: (
    effectOrdinal: bigint,
    terminalCode: string,
  ) => Promise<void>;
  readonly confirm: (
    effectOrdinal: bigint,
    childMutationOutcomeSha256: Uint8Array,
  ) => Promise<void>;
  readonly markUncertain: (
    effectOrdinal: bigint,
    terminalCode: string,
  ) => Promise<void>;
}

export interface EdgeActionCallbackBridgeV1Input<Selection> {
  readonly selection: Selection;
  readonly identity: ExecutionIdentity;
  readonly evidence: EdgeActionCallbackEvidencePortV1;
  readonly sequencer: EdgeActionHostSyscallSequencerV1;
  readonly parentRequestKey: string;
  readonly maximumSyscalls: number;
  readonly maximumArgumentBytes: number;
  readonly maximumResultBytes: number;
  readonly system: EdgeActionCallbackSystemPortV1<Selection>;
}

export class EdgeActionCallbackBridgeV1Error extends Data.TaggedError(
  "EdgeActionCallbackBridgeV1Error",
)<{
  readonly reason:
    | "closed"
    | "invalidRequest"
    | "sequenceMismatch"
    | "resourceExceeded"
    | "queryFailed"
    | "mutationFailed";
  readonly cause?: unknown;
}> {}

export interface EdgeActionCallbackBridgeV1 {
  readonly invoke: (request: unknown) => Promise<CanonicalFlarexRuntimeValueV1>;
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export function makeEdgeActionCallbackBridgeV1<Selection>(
  input: EdgeActionCallbackBridgeV1Input<Selection>,
): EdgeActionCallbackBridgeV1 {
  requireInput(input);
  let open = true;
  let lastOrdinal = 0n;
  let firstPoison: unknown | typeof NO_CALLBACK_POISON = NO_CALLBACK_POISON;
  const pending = new Set<Promise<CanonicalFlarexRuntimeValueV1>>();

  const invoke = (request: unknown) => {
    const operation = run(request);
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  };

  const run = async (
    requestInput: unknown,
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    if (!open) throw bridgeError("closed");
    const request = captureRequest(requestInput);
    const expectedOrdinal = lastOrdinal + 1n;
    if (
      request.ordinal !== expectedOrdinal ||
      request.ordinal > BigInt(input.maximumSyscalls)
    ) throw bridgeError("sequenceMismatch");
    const normalizedArguments = normalizeFlarexValueV1(request.arguments);
    if (
      !isCanonicalFlarexRuntimeObjectV1(normalizedArguments.value) ||
      normalizedArguments.semanticSizeBytes !== request.argumentSemanticBytes ||
      normalizedArguments.semanticSizeBytes > input.maximumArgumentBytes
    ) throw bridgeError("resourceExceeded");
    lastOrdinal = request.ordinal;
    let hostOrdinal: bigint;
    try {
      hostOrdinal = input.sequencer.next("callback");
    } catch (cause) {
      throw bridgeError("resourceExceeded", cause);
    }
    let result: unknown;
    if (request.kind === "runQuery") {
      try {
        result = await input.system.runQuery(
          input.selection,
          request.functionPath,
          normalizedArguments.value,
          input.identity,
        );
      } catch (cause) {
        throw bridgeError("queryFailed", cause);
      }
    } else {
      const canonicalArguments = await canonicalizeFlarexValueV1(
        normalizedArguments.value,
      );
      const requestKey = [
        input.parentRequestKey,
        "child",
        hostOrdinal.toString(10),
        request.functionPath,
        encodeBytesToLowercaseHex(canonicalArguments.sha256),
      ].join(":");
      const requestIdentitySha256 = await input.evidence.hash(
        childRequestIdentityBytes(
          requestKey,
          request.functionPath,
          canonicalArguments.sha256,
        ),
      );
      const prepared = await input.evidence.prepare({
          stableEffectKey: requestKey,
          requestIdentitySha256,
          childMutationRequestKey: requestKey,
          childMutationFunctionPath: request.functionPath,
          childMutationArgumentsSha256: canonicalArguments.sha256,
        }).catch(cause => Promise.reject(bridgeError("mutationFailed", cause)));
      try {
        await input.evidence.declareDispatch(prepared.effectOrdinal);
      } catch (cause) {
        await input.evidence.failBeforeDispatch(
          prepared.effectOrdinal,
          "edge_action_child_dispatch_not_declared",
        ).catch(() => {});
        throw bridgeError("mutationFailed", cause);
      }
      try {
        result = await input.system.runMutation(
          input.selection,
          request.functionPath,
          normalizedArguments.value,
          requestKey,
          input.identity,
        );
      } catch (cause) {
        await markChildMutationUncertain(
          input.evidence,
          prepared.effectOrdinal,
        );
        const failure = bridgeError("mutationFailed", cause);
        if (firstPoison === NO_CALLBACK_POISON) firstPoison = failure;
        throw failure;
      }
      let canonicalResult;
      try {
        canonicalResult = await canonicalizeFlarexValueV1(result);
        if (canonicalResult.semanticSizeBytes > input.maximumResultBytes) {
          throw bridgeError("resourceExceeded");
        }
        await input.evidence.confirm(
          prepared.effectOrdinal,
          canonicalResult.sha256,
        );
      } catch (cause) {
        await markChildMutationUncertain(
          input.evidence,
          prepared.effectOrdinal,
        );
        const failure = cause instanceof EdgeActionCallbackBridgeV1Error
          ? cause
          : bridgeError("mutationFailed", cause);
        if (firstPoison === NO_CALLBACK_POISON) firstPoison = failure;
        throw failure;
      }
    }
    const normalizedResult = normalizeFlarexValueV1(result);
    if (normalizedResult.semanticSizeBytes > input.maximumResultBytes) {
      throw bridgeError("resourceExceeded");
    }
    return normalizedResult.value;
  };

  return Object.freeze({
    invoke,
    close: () => { open = false; },
    drain: async () => {
      const outcomes = await Promise.allSettled(Array.from(pending));
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (rejected !== undefined) throw rejected.reason;
      if (firstPoison !== NO_CALLBACK_POISON) throw firstPoison;
    },
  });
}

function captureRequest(input: unknown): EdgeActionCallbackInvocationV1 {
  if (!isNonArrayRecord(input)) throw bridgeError("invalidRequest");
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== 5 ||
    ownKeys.some((key) => typeof key !== "string" ||
      !CALLBACK_REQUEST_KEYS.has(key))
  ) throw bridgeError("invalidRequest");
  const kind = input.kind;
  const ordinal = input.ordinal;
  const functionPath = input.functionPath;
  const argumentsValue = input.arguments;
  const argumentSemanticBytes = input.argumentSemanticBytes;
  if (
    (kind !== "runQuery" && kind !== "runMutation") ||
    typeof ordinal !== "bigint" ||
    typeof functionPath !== "string" || functionPath.trim().length === 0 ||
    typeof argumentSemanticBytes !== "number" ||
    !Number.isSafeInteger(argumentSemanticBytes)
  ) throw bridgeError("invalidRequest");
  return Object.freeze({
    kind,
    ordinal,
    functionPath,
    arguments: argumentsValue,
    argumentSemanticBytes,
  });
}

const CALLBACK_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "ordinal",
  "functionPath",
  "arguments",
  "argumentSemanticBytes",
]);

function requireInput<Selection>(
  input: EdgeActionCallbackBridgeV1Input<Selection>,
): void {
  if (
    input.parentRequestKey.trim().length === 0 ||
    !Number.isSafeInteger(input.maximumSyscalls) || input.maximumSyscalls < 1 ||
    !Number.isSafeInteger(input.maximumArgumentBytes) ||
    input.maximumArgumentBytes < 1 ||
    !Number.isSafeInteger(input.maximumResultBytes) ||
    input.maximumResultBytes < 1
  ) throw bridgeError("invalidRequest");
}

function childRequestIdentityBytes(
  requestKey: string,
  functionPath: string,
  argumentsSha256: Uint8Array,
): Uint8Array {
  return UTF8.encode([
    "flarex.system/edge-action-child-mutation-request/v1",
    requestKey,
    functionPath,
    encodeBytesToLowercaseHex(argumentsSha256),
  ].join("\0"));
}

async function markChildMutationUncertain(
  evidence: EdgeActionCallbackEvidencePortV1,
  effectOrdinal: bigint,
): Promise<void> {
  await evidence.markUncertain(
    effectOrdinal,
    "edge_action_child_mutation_uncertain",
  ).catch(() => {});
}

export function makeActiveApplicationEdgeActionCallbackEvidencePortV1<
  HashError,
>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  authority: ApplicationActionAuthorityContextV1<HashError>,
  runner: ActiveApplicationActionEffectRunnerV1,
): EdgeActionCallbackEvidencePortV1 {
  const port: EdgeActionCallbackEvidencePortV1 = {
    hash: bytes => runner.runPromise(authority.sha256.hash(bytes)),
    prepare: effect => runner.runPromise(
      prepareActiveApplicationChildMutationEffectV1(
        subject,
        effect,
        authority,
      ),
    ),
    declareDispatch: effectOrdinal => runner.runPromise(
      declareActiveApplicationExternalEffectDispatchV1(
        subject,
        effectOrdinal,
        authority,
      ),
    ).then(() => {}),
    failBeforeDispatch: (effectOrdinal, terminalCode) => runner.runPromise(
      failActiveApplicationExternalEffectBeforeDispatchV1(
        subject,
        effectOrdinal,
        terminalCode,
        authority,
      ),
    ).then(() => {}),
    confirm: (effectOrdinal, outcomeSha256) => runner.runPromise(
      confirmActiveApplicationChildMutationEffectV1(
        subject,
        effectOrdinal,
        outcomeSha256,
        authority,
      ),
    ).then(() => {}),
    markUncertain: (effectOrdinal, terminalCode) => runner.runPromise(
      markActiveApplicationExternalEffectUncertainV1(
        subject,
        effectOrdinal,
        terminalCode,
        authority,
      ),
    ).then(() => {}),
  };
  return Object.freeze(port);
}

function bridgeError(
  reason: EdgeActionCallbackBridgeV1Error["reason"],
  cause?: unknown,
): EdgeActionCallbackBridgeV1Error {
  return new EdgeActionCallbackBridgeV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
