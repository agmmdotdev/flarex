import { Effect, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import {
  TransactionRequestKeyV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import type { ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { captureCommerceJsonData } from "../commerceTransaction/request";
import { commerceError, commerceLimits, type CommerceTransactionError } from "../commerceTransaction/model";
import { commerceIdentityEvidence, commerceRequestHash, projectCommerceRequestFailure } from "../commerceTransaction/request";
import { requireCommerceAdmission, type CommerceAdmission } from "../commerceTransaction/admission";
import {
  getAtomicCommerceCommand,
  type AtomicCommerceCommand,
  type AtomicCommandDefinition,
} from "./commands";
import type { PreparedAtomicCommerceConfiguration } from "./configuration";

const decodeKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
export const hashAtomicCommerceBytes = (
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, CommerceTransactionError> =>
  commerceRequestHash(bytes, {
    maximumInputBytes: commerceLimits.commandBytes,
  });

export interface CapturedAtomicCommerceRequest {
  readonly key: typeof TransactionRequestKeyV1Schema.Type;
  readonly definition: AtomicCommandDefinition;
  readonly args: Json;
}

export interface AtomicCommerceRequestEvidence {
  readonly lookup: ResolveCommittedPointOutcomeInputV1;
  readonly bytes: number;
}

/** Authenticate the selected token before decoding and owning the request data. */
export const captureAtomicCommerceRequest = Effect.fn("AtomicCommerce.captureRequest")(function* (
  allowed: ReadonlySet<AtomicCommerceCommand>,
  commandBytes: number,
  requestKey: string,
  token: AtomicCommerceCommand,
  args: Json,
): Effect.fn.Return<CapturedAtomicCommerceRequest, CommerceTransactionError> {
  const definition = getAtomicCommerceCommand(token);
  if (definition === undefined || !allowed.has(token))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const key = yield* decodeKey(requestKey).pipe(
    Effect.mapError((cause) => commerceError("invalidInput", cause)),
  );
  if (!/^commerce\/atomic\/[a-zA-Z0-9/-]{1,100}$/.test(key))
    return yield* Effect.fail(commerceError("invalidInput"));
  const captured = yield* Effect.fromResult(captureCommerceJsonData(args, commandBytes));
  return { key, definition, args: captured.value };
});

/** Replay binds the captured request to the currently admitted scope and bindings. */
export const prepareAtomicCommerceRequestEvidence = Effect.fn("AtomicCommerce.prepareRequestEvidence")(
  function* (
    configuration: Pick<
      PreparedAtomicCommerceConfiguration<never>,
      "deploymentId" | "members" | "identityDigest"
    >,
    request: CapturedAtomicCommerceRequest,
    admission: CommerceAdmission,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ): Effect.fn.Return<AtomicCommerceRequestEvidence, CommerceTransactionError> {
    const { deploymentId, members, identityDigest } = configuration;
    const admitted = yield* requireCommerceAdmission(admission);
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId)).pipe(
      Effect.mapError(projectCommerceRequestFailure),
    );
    const evidence = yield* commerceIdentityEvidence("atomic-command", {
      deploymentId,
      scopeId: authority.scopeId,
      epoch: clock.epoch,
      generation: clock.storageGeneration,
      fence: clock.storageGenerationFence.toString(),
      bindingHead: admitted.head,
      operation: request.definition.name,
      args: request.args,
      participants: members.map((member) => ({
        name: member.name,
        installation: member.reference,
        contractSha256: member.descriptor.contractSha256,
        commands: member.commandNames,
      })),
    }, commerceLimits.commandBytes);
    const lookup = {
      scopeUuid: scope.scopeUuid,
      requestKey: request.key,
      expectedIdentityAccessPolicySha256: identityDigest,
      expectedFunctionPath: TransactionFunctionPathV1Schema.make(
        `__flarex_private_atomic_commerce/${request.definition.name}`,
      ),
      expectedRequestSha256: TransactionRequestSha256V1Schema.make(
        yield* hashAtomicCommerceBytes(evidence.canonicalBytes),
      ),
    };
    return { lookup, bytes: evidence.canonicalBytes.byteLength };
  },
);
