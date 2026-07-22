import {
  captureDeploymentProjectScopeLookupBudgetV1,
  deploymentProjectScopeLookupBudgetFitsV1,
  type DeploymentProjectScopeLookupBudgetV1,
  type DeploymentProjectScopeLookupUsageV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Clock, Data, Effect, Result } from "effect";

import {
  type DeploymentProjectScopeLookupClientV1,
  DeploymentProjectScopeLookupBudgetV1Error,
  DeploymentProjectScopeLookupConfigurationV1Error,
  DeploymentProjectScopeLookupCorruptionV1Error,
  DeploymentProjectScopeLookupNotFoundV1Error,
  DeploymentProjectScopeLookupProjectMismatchV1Error,
  DeploymentProjectScopeLookupResourceV1Error,
  makeDeploymentProjectScopeLookupClientV1,
} from "./deploymentProjectScopeLookup";
import {
  requireProjectIdEffect,
  type ProjectRequiredParameterError,
} from "./project";
import type { Env } from "./types";
import {
  authorizePublicDeploymentPushMutationRequest,
  type PublicDeploymentPushAuthorizationError,
} from "./worker/PublicAnalyzedStartAuthorization";

export interface DeploymentProjectScopeAuthorizationBudgetV1 {
  readonly cumulative: DeploymentProjectScopeLookupBudgetV1;
  readonly command: DeploymentProjectScopeLookupBudgetV1;
}

export interface DeploymentProjectScopeAuthorizationInputV1 {
  readonly deploymentId: string;
  readonly budget: DeploymentProjectScopeAuthorizationBudgetV1;
}

export class DeploymentProjectScopeAuthorizationInputV1Error extends Data.TaggedError(
  "DeploymentProjectScopeAuthorizationInputV1Error",
)<{
  readonly field: "deploymentId" | "cumulativeBudget" | "commandBudget";
}> {}

export class DeploymentProjectScopeWitnessV1Error extends Data.TaggedError(
  "DeploymentProjectScopeWitnessV1Error",
)<{
  readonly reason:
    | "invalidWitness"
    | "wrongRequest"
    | "wrongDeployment"
    | "alreadyClaimed";
}> {}

export type DeploymentProjectScopeAuthorizationV1Error =
  | DeploymentProjectScopeAuthorizationInputV1Error
  | PublicDeploymentPushAuthorizationError
  | ProjectRequiredParameterError
  | DeploymentProjectScopeLookupNotFoundV1Error
  | DeploymentProjectScopeLookupProjectMismatchV1Error
  | DeploymentProjectScopeLookupResourceV1Error
  | DeploymentProjectScopeLookupCorruptionV1Error
  | DeploymentProjectScopeLookupBudgetV1Error;

const WITNESS_MARKER = Symbol("DeploymentProjectScopeWitnessV1");

export interface DeploymentProjectScopeWitnessV1 {
  readonly [WITNESS_MARKER]: true;
}

export interface ClaimedDeploymentProjectScopeWitnessV1 {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly deploymentCreatedAt: string;
  readonly issuerIdentity: string;
  readonly usage: DeploymentProjectScopeLookupUsageV1;
}

export interface DeploymentProjectScopeAuthorizerV1 {
  readonly authorize: (
    request: Request,
    input: DeploymentProjectScopeAuthorizationInputV1,
  ) => Effect.Effect<
    DeploymentProjectScopeWitnessV1,
    DeploymentProjectScopeAuthorizationV1Error,
    never
  >;
  readonly claim: (
    witness: unknown,
    request: Request,
    deploymentId: string,
  ) => Result.Result<
    ClaimedDeploymentProjectScopeWitnessV1,
    DeploymentProjectScopeWitnessV1Error
  >;
}

interface WitnessEvidence {
  readonly request: Request;
  readonly deploymentId: string;
  readonly projectId: string;
  readonly deploymentCreatedAt: string;
  readonly issuer: object;
  readonly issuerIdentity: string;
  readonly usage: DeploymentProjectScopeLookupUsageV1;
}

const ISSUER_IDENTITY_V1 = "flarex-backend/deployment-project-scope-authorizer/v1";

export function makeDeploymentProjectScopeAuthorizerV1(
  env: Env,
  lookupOverride?: DeploymentProjectScopeLookupClientV1,
): Result.Result<
  DeploymentProjectScopeAuthorizerV1,
  DeploymentProjectScopeLookupConfigurationV1Error
> {
  if (lookupOverride === undefined && env.FLAREX_EXECUTOR === undefined) {
    return Result.fail(new DeploymentProjectScopeLookupConfigurationV1Error({
      reason: "missingExecutorServiceBinding",
    }));
  }
  const lookupResult = lookupOverride === undefined
    ? makeDeploymentProjectScopeLookupClientV1(env)
    : Result.succeed(lookupOverride);
  if (Result.isFailure(lookupResult)) return Result.fail(lookupResult.failure);

  const lookup = lookupResult.success;
  const issuer = Object.freeze({});
  const evidenceByWitness = new WeakMap<object, WitnessEvidence>();
  const claimedWitnesses = new WeakSet<object>();

  const authorize = Effect.fn("DeploymentProjectScopeAuthorizer.authorize")(
    function* (
      request: Request,
      input: DeploymentProjectScopeAuthorizationInputV1,
    ): Effect.fn.Return<
      DeploymentProjectScopeWitnessV1,
      DeploymentProjectScopeAuthorizationV1Error
    > {
      const startedAt = yield* Clock.currentTimeNanos;
      const capturedInput = yield* Effect.fromResult(captureAuthorizationInput(input));

      yield* authorizePublicDeploymentPushMutationRequest(request, env);
      const projectId = yield* requireProjectIdEffect(env);

      const elapsedBeforeLookup = elapsedMilliseconds(
        startedAt,
        yield* Clock.currentTimeNanos,
      );
      const lookupBudget = yield* Effect.fromResult(
        remainingCommandBudget(capturedInput, elapsedBeforeLookup),
      );
      const match = yield* lookup.lookup({
        deploymentId: capturedInput.deploymentId,
        projectId,
        budget: lookupBudget,
      });
      const totalElapsed = elapsedMilliseconds(
        startedAt,
        yield* Clock.currentTimeNanos,
      );
      const usage = yield* Effect.fromResult(
        captureFinalUsage(match.usage, totalElapsed, capturedInput.budget.cumulative),
      );

      const witness = Object.freeze(Object.defineProperty({}, WITNESS_MARKER, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      })) as DeploymentProjectScopeWitnessV1;
      evidenceByWitness.set(witness, Object.freeze({
        request,
        deploymentId: match.deploymentId,
        projectId: match.projectId,
        deploymentCreatedAt: match.deploymentCreatedAt,
        issuer,
        issuerIdentity: ISSUER_IDENTITY_V1,
        usage,
      }));
      return witness;
    },
  );

  const claim = (
    witness: unknown,
    request: Request,
    deploymentId: string,
  ): Result.Result<
    ClaimedDeploymentProjectScopeWitnessV1,
    DeploymentProjectScopeWitnessV1Error
  > => {
    if ((typeof witness !== "object" || witness === null)) {
      return Result.fail(witnessFailure("invalidWitness"));
    }
    const evidence = evidenceByWitness.get(witness);
    if (evidence === undefined || evidence.issuer !== issuer) {
      return Result.fail(witnessFailure("invalidWitness"));
    }
    if (claimedWitnesses.has(witness)) {
      return Result.fail(witnessFailure("alreadyClaimed"));
    }
    if (evidence.request !== request) {
      return Result.fail(witnessFailure("wrongRequest"));
    }
    if (evidence.deploymentId !== deploymentId) {
      return Result.fail(witnessFailure("wrongDeployment"));
    }

    claimedWitnesses.add(witness);
    return Result.succeed(Object.freeze({
      deploymentId: evidence.deploymentId,
      projectId: evidence.projectId,
      deploymentCreatedAt: evidence.deploymentCreatedAt,
      issuerIdentity: evidence.issuerIdentity,
      usage: evidence.usage,
    }));
  };

  return Result.succeed(Object.freeze({ authorize, claim }));
}

function captureAuthorizationInput(
  input: DeploymentProjectScopeAuthorizationInputV1,
): Result.Result<
  Readonly<DeploymentProjectScopeAuthorizationInputV1>,
  DeploymentProjectScopeAuthorizationInputV1Error
> {
  if (!isNonEmptyString(input.deploymentId)) {
    return Result.fail(new DeploymentProjectScopeAuthorizationInputV1Error({
      field: "deploymentId",
    }));
  }
  return Result.gen(function* () {
    const cumulative = yield* Result.mapError(
      captureDeploymentProjectScopeLookupBudgetV1(input.budget.cumulative),
      () => new DeploymentProjectScopeAuthorizationInputV1Error({
        field: "cumulativeBudget",
      }),
    );
    const command = yield* Result.mapError(
      captureDeploymentProjectScopeLookupBudgetV1(input.budget.command),
      () => new DeploymentProjectScopeAuthorizationInputV1Error({
        field: "commandBudget",
      }),
    );
    if (!deploymentProjectScopeLookupBudgetFitsV1(command, cumulative)) {
      return yield* Result.fail(new DeploymentProjectScopeAuthorizationInputV1Error({
        field: "commandBudget",
      }));
    }
    return Object.freeze({
      deploymentId: input.deploymentId,
      budget: Object.freeze({ cumulative, command }),
    });
  });
}

function remainingCommandBudget(
  input: Readonly<DeploymentProjectScopeAuthorizationInputV1>,
  elapsed: number,
): Result.Result<
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupBudgetV1Error
> {
  const maximumElapsedMilliseconds =
    input.budget.command.maximumElapsedMilliseconds - elapsed;
  if (maximumElapsedMilliseconds < 0) {
    return Result.fail(new DeploymentProjectScopeLookupBudgetV1Error({
      field: "elapsedMilliseconds",
    }));
  }
  const captured = captureDeploymentProjectScopeLookupBudgetV1({
    ...input.budget.command,
    maximumElapsedMilliseconds,
  });
  return Result.isSuccess(captured)
    ? Result.succeed(captured.success)
    : Result.fail(new DeploymentProjectScopeLookupBudgetV1Error({
        field: "elapsedMilliseconds",
      }));
}

function captureFinalUsage(
  usage: DeploymentProjectScopeLookupUsageV1,
  elapsedMilliseconds: number,
  cumulative: DeploymentProjectScopeLookupBudgetV1,
): Result.Result<
  DeploymentProjectScopeLookupUsageV1,
  DeploymentProjectScopeLookupBudgetV1Error
> {
  const captured = Object.freeze({ ...usage, elapsedMilliseconds });
  const pairs = [
    ["lookupCalls", captured.lookupCalls, cumulative.maximumLookupCalls],
    ["inputBytes", captured.inputBytes, cumulative.maximumInputBytes],
    ["bodyBytes", captured.bodyBytes, cumulative.maximumBodyBytes],
    ["canonicalBytes", captured.canonicalBytes, cumulative.maximumCanonicalBytes],
    ["frameBytes", captured.frameBytes, cumulative.maximumFrameBytes],
    ["elapsedMilliseconds", captured.elapsedMilliseconds, cumulative.maximumElapsedMilliseconds],
  ] as const;
  for (const [field, used, maximum] of pairs) {
    if (used > maximum) {
      return Result.fail(new DeploymentProjectScopeLookupBudgetV1Error({ field }));
    }
  }
  return Result.succeed(captured);
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  const difference = endedAt - startedAt;
  if (difference <= 0n) return 0;
  const milliseconds = difference / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function witnessFailure(
  reason: DeploymentProjectScopeWitnessV1Error["reason"],
): DeploymentProjectScopeWitnessV1Error {
  return new DeploymentProjectScopeWitnessV1Error({ reason });
}
