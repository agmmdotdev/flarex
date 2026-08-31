import { copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Duration, Effect, Encoding, Option, Result } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { copyCapturedFrameworkSchemaArtifactEvidence } from "./canonical";
import {
  hasFrameworkSchemaArtifactControlSessionComposition,
  failFrameworkSchemaArtifactControlDeadline,
  remainingFrameworkSchemaArtifactControlMilliseconds,
  runFrameworkSchemaArtifactControlEffect,
  runFrameworkSchemaArtifactControlInitialReadEffect,
  runFrameworkSchemaArtifactControlReadEffect,
  startFrameworkSchemaArtifactControlDeadline,
  withFrameworkSchemaArtifactRawControlSessionTransactionEffect,
  type FrameworkSchemaArtifactControlSessionDeadlineIssue,
  type FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  type FrameworkSchemaArtifactControlSessionResourceIssue,
  type FrameworkSchemaArtifactControlSessionStarter,
  type FrameworkSchemaArtifactControlSessionTransaction,
  type FrameworkSchemaArtifactControlDeadline,
  type FrameworkSchemaArtifactControlDecision,
  type FrameworkSchemaArtifactControlResult,
} from "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
  FrameworkSchemaArtifactRepositoryConfigurationError,
} from "./errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactIdentity,
} from "./model";

const preparedFrameworkSchemaArtifactAdmissionBrand: unique symbol = Symbol(
  "FlarexDB/PreparedFrameworkSchemaArtifactAdmission",
);
const frameworkSchemaArtifactRepositoryBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkSchemaArtifactRepository",
);
const frameworkSchemaArtifactControlTransactionBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkSchemaArtifactControlTransaction",
);
const MAXIMUM_FRAMEWORK_SCHEMA_ARTIFACT_TIMEOUT_MILLISECONDS = 60_000;

export interface PreparedFrameworkSchemaArtifactAdmission {
  readonly [preparedFrameworkSchemaArtifactAdmissionBrand]: true;
}

export interface FrameworkSchemaArtifactAdmissionEvidence {
  readonly artifact: FrameworkSchemaArtifact;
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly dependencyEvidence:
    readonly FrameworkSchemaArtifactAdmissionDependencyEvidence[];
  readonly artifactSha256Bytes: Uint8Array;
  readonly canonicalByteLength: number;
  readonly canonicalBytes: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_ARTIFACT_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_ARTIFACT_VERSION;
}

export interface FrameworkSchemaArtifactAdmissionDependencyEvidence {
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly artifactSha256Bytes: Uint8Array;
}

export interface FrameworkSchemaArtifactRepositoryTimeoutPolicy {
  readonly readTimeoutMilliseconds: number;
  readonly attemptTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
}

export interface MakeFrameworkSchemaArtifactRepositoryInput
  extends FrameworkSchemaArtifactRepositoryTimeoutPolicy
{
  readonly controlDb: FlarexMetadataDatabase;
  readonly controlSessionStarter:
    FrameworkSchemaArtifactControlSessionStarter;
}

export interface FrameworkSchemaArtifactRepository {
  readonly [frameworkSchemaArtifactRepositoryBrand]: true;
}

export interface FrameworkSchemaArtifactControlTransaction {
  readonly [frameworkSchemaArtifactControlTransactionBrand]: true;
}

export interface FrameworkSchemaArtifactRepositoryReadWork<
  Preparation,
  Detached,
  Value,
  Failure,
> {
  readonly prepareEffect: () => Effect.Effect<Preparation, Failure, never>;
  readonly queryAndDetachEffect: (
    database: FlarexMetadataDatabase,
    preparation: Preparation,
  ) => Effect.Effect<Detached, Failure, never>;
  readonly reconstructEffect: (
    detached: Detached,
    preparation: Preparation,
  ) => Effect.Effect<Value, Failure, never>;
}

export interface FrameworkSchemaArtifactRepositoryAdmissionWork<
  Preparation,
  Detached,
  Value,
  Failure,
> {
  readonly prepareEffect: () => Effect.Effect<Preparation, Failure, never>;
  readonly queryAndDetachOptimisticEffect: (
    database: FlarexMetadataDatabase,
    preparation: Preparation,
  ) => Effect.Effect<Detached, Failure, never>;
  readonly reconstructOptimisticEffect: (
    detached: Detached,
    preparation: Preparation,
  ) => Effect.Effect<Option.Option<Value>, Failure, never>;
  readonly runLockedEffect: (
    transaction: FrameworkSchemaArtifactControlTransaction,
    preparation: Preparation,
    attempt: "initial" | "recovery",
  ) => Effect.Effect<
    FrameworkSchemaArtifactControlDecision<Value>,
    Failure,
    never
  >;
  readonly resolveExistingEffect: (
    database: FlarexMetadataDatabase,
    preparation: Preparation,
  ) => Effect.Effect<Value, Failure, never>;
}

export class FrameworkSchemaArtifactRepositoryInvariantDefect extends
  Data.TaggedError("FrameworkSchemaArtifactRepositoryInvariantDefect")<{
    readonly reason:
      | "invalidRepository"
      | "invalidControlTransaction"
      | "crossRepositoryControlTransaction"
      | "closedControlTransaction";
  }>
{}

interface PreparedFrameworkSchemaArtifactAdmissionState
  extends FrameworkSchemaArtifactAdmissionEvidence {}

interface FrameworkSchemaArtifactRepositoryState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly controlSessionStarter:
    FrameworkSchemaArtifactControlSessionStarter;
  readonly timeoutPolicy: FrameworkSchemaArtifactRepositoryTimeoutPolicy;
}

interface FrameworkSchemaArtifactControlTransactionState {
  readonly repository: FrameworkSchemaArtifactRepository;
  readonly rawTransaction: FlarexMetadataTransaction;
  active: boolean;
}

const preparedFrameworkSchemaArtifactAdmissionStates = new WeakMap<
  PreparedFrameworkSchemaArtifactAdmission,
  PreparedFrameworkSchemaArtifactAdmissionState
>();
const frameworkSchemaArtifactRepositoryStates = new WeakMap<
  object,
  FrameworkSchemaArtifactRepositoryState
>();
const frameworkSchemaArtifactControlTransactionStates = new WeakMap<
  object,
  FrameworkSchemaArtifactControlTransactionState
>();

/** Construct one opaque repository identity after validating its fixed policy. */
export function makeFrameworkSchemaArtifactRepository(
  input: MakeFrameworkSchemaArtifactRepositoryInput,
): Result.Result<
  FrameworkSchemaArtifactRepository,
  FrameworkSchemaArtifactRepositoryConfigurationError
> {
  const timeoutPolicy = {
    readTimeoutMilliseconds: input.readTimeoutMilliseconds,
    attemptTimeoutMilliseconds: input.attemptTimeoutMilliseconds,
    recoveryTimeoutMilliseconds: input.recoveryTimeoutMilliseconds,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
  } satisfies FrameworkSchemaArtifactRepositoryTimeoutPolicy;
  if (!isFrameworkSchemaArtifactRepositoryTimeoutPolicy(timeoutPolicy)) {
    return Result.fail(
      FrameworkSchemaArtifactRepositoryConfigurationError
        .invalidTimeoutPolicy(),
    );
  }

  const controlDb = input.controlDb;
  const controlSessionStarter = input.controlSessionStarter;
  if (!hasFrameworkSchemaArtifactControlSessionComposition(
    controlSessionStarter,
    controlDb,
  )) {
    return Result.fail(
      FrameworkSchemaArtifactRepositoryConfigurationError
        .invalidControlSessionComposition(),
    );
  }

  const frozenTimeoutPolicy = Object.freeze(timeoutPolicy);
  const state = Object.freeze({
    controlDb,
    controlSessionStarter,
    timeoutPolicy: frozenTimeoutPolicy,
  } satisfies FrameworkSchemaArtifactRepositoryState);
  const repository = Object.freeze({
    [frameworkSchemaArtifactRepositoryBrand]: true,
  } satisfies FrameworkSchemaArtifactRepository);
  frameworkSchemaArtifactRepositoryStates.set(repository, state);
  return Result.succeed(repository);
}

/**
 * Issue and revoke the only transaction capability accepted by locked
 * repository primitives. The raw transaction stays inside this closure.
 */
export function withFrameworkSchemaArtifactControlTransactionEffect<
  Value,
  Failure,
>(
  repository: FrameworkSchemaArtifactRepository,
  sessionTransaction: FrameworkSchemaArtifactControlSessionTransaction,
  work: (
    transaction: FrameworkSchemaArtifactControlTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    const repositoryState = frameworkSchemaArtifactRepositoryStates.get(
      repository,
    );
    if (repositoryState === undefined) {
      return Effect.die(
        new FrameworkSchemaArtifactRepositoryInvariantDefect({
          reason: "invalidRepository",
        }),
      );
    }

    return withFrameworkSchemaArtifactRawControlSessionTransactionEffect(
      sessionTransaction,
      repositoryState.controlSessionStarter,
      rawTransaction => Effect.suspend(() => {
        const state: FrameworkSchemaArtifactControlTransactionState = {
          repository,
          rawTransaction,
          active: true,
        };
        const transaction = Object.freeze({
          [frameworkSchemaArtifactControlTransactionBrand]: true,
        } satisfies FrameworkSchemaArtifactControlTransaction);
        frameworkSchemaArtifactControlTransactionStates.set(transaction, state);

        return Effect.suspend(() => work(transaction)).pipe(
          Effect.ensuring(Effect.sync(() => {
            state.active = false;
          })),
        );
      }),
    );
  });
}

/**
 * Authenticate one repository, release its read session after detached query
 * work, then bound reconstruction with the same absolute deadline.
 */
export const runFrameworkSchemaArtifactRepositoryReadEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.read",
)(<Preparation, Detached, Value, Failure>(
  repository: FrameworkSchemaArtifactRepository,
  work: FrameworkSchemaArtifactRepositoryReadWork<
    Preparation,
    Detached,
    Value,
    Failure
  >,
): Effect.Effect<
  Value,
  | Failure
  | FrameworkSchemaArtifactControlSessionDeadlineIssue
  | FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> => Effect.suspend(() => {
  const repositoryState = frameworkSchemaArtifactRepositoryStates.get(
    repository,
  );
  if (repositoryState === undefined) {
    return Effect.die(
      new FrameworkSchemaArtifactRepositoryInvariantDefect({
        reason: "invalidRepository",
      }),
    );
  }

  return Effect.gen(function* () {
    const preparation = yield* Effect.suspend(work.prepareEffect);
    const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
      "read",
      repositoryState.timeoutPolicy.readTimeoutMilliseconds,
    );
    const detached = yield* runFrameworkSchemaArtifactControlReadEffect(
      repositoryState.controlSessionStarter,
      { deadline },
      database => Effect.suspend(() =>
        work.queryAndDetachEffect(database, preparation)
      ),
    );
    return yield* runBoundedReconstructionEffect(
      deadline,
      () => work.reconstructEffect(detached, preparation),
    );
  });
}));

/** Own one optimistic read and the complete locked admission lifecycle. */
export const runFrameworkSchemaArtifactRepositoryAdmissionEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.admit",
)(<Preparation, Detached, Value, Failure>(
  repository: FrameworkSchemaArtifactRepository,
  work: FrameworkSchemaArtifactRepositoryAdmissionWork<
    Preparation,
    Detached,
    Value,
    Failure
  >,
): Effect.Effect<
  FrameworkSchemaArtifactControlResult<Value>,
  | Failure
  | FrameworkSchemaArtifactControlSessionDeadlineIssue
  | FrameworkSchemaArtifactControlSessionResourceIssue
  | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  never
> => Effect.suspend(() => {
  const repositoryState = frameworkSchemaArtifactRepositoryStates.get(
    repository,
  );
  if (repositoryState === undefined) {
    return Effect.die(
      new FrameworkSchemaArtifactRepositoryInvariantDefect({
        reason: "invalidRepository",
      }),
    );
  }

  return Effect.gen(function* () {
    const preparation = yield* Effect.suspend(work.prepareEffect);
    const initialDeadline = yield* startFrameworkSchemaArtifactControlDeadline(
      "initial",
      repositoryState.timeoutPolicy.attemptTimeoutMilliseconds,
    );
    const detached = yield*
      runFrameworkSchemaArtifactControlInitialReadEffect(
        repositoryState.controlSessionStarter,
        { deadline: initialDeadline },
        database => Effect.suspend(() =>
          work.queryAndDetachOptimisticEffect(database, preparation)
        ),
      );
    const optimistic = yield* runBoundedReconstructionEffect(
      initialDeadline,
      () => work.reconstructOptimisticEffect(detached, preparation),
    );
    if (Option.isSome(optimistic)) {
      return Object.freeze({
        status: "existing" as const,
        value: optimistic.value,
      });
    }

    return yield* runFrameworkSchemaArtifactControlEffect(
      repositoryState.controlSessionStarter,
      {
        initialDeadline,
        lockTimeoutMilliseconds:
          repositoryState.timeoutPolicy.lockTimeoutMilliseconds,
        recoveryTimeoutMilliseconds:
          repositoryState.timeoutPolicy.recoveryTimeoutMilliseconds,
      },
      {
        runLockedEffect: (sessionTransaction, attempt) =>
          withFrameworkSchemaArtifactControlTransactionEffect(
            repository,
            sessionTransaction,
            transaction => Effect.suspend(() =>
              work.runLockedEffect(
                transaction,
                preparation,
                attempt,
              )
            ),
          ),
        resolveExistingEffect: database => Effect.suspend(() =>
          work.resolveExistingEffect(database, preparation)
        ),
      },
    );
  });
}));

/** Authenticate a scoped token before a locked primitive can construct SQL. */
export function withFrameworkSchemaArtifactRawControlTransactionEffect<
  Value,
  Failure,
>(
  repository: FrameworkSchemaArtifactRepository,
  transaction: FrameworkSchemaArtifactControlTransaction,
  work: (
    rawTransaction: FlarexMetadataTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    if (!frameworkSchemaArtifactRepositoryStates.has(repository)) {
      return Effect.die(
        new FrameworkSchemaArtifactRepositoryInvariantDefect({
          reason: "invalidRepository",
        }),
      );
    }
    const state = frameworkSchemaArtifactControlTransactionStates.get(
      transaction,
    );
    if (state === undefined) {
      return Effect.die(
        new FrameworkSchemaArtifactRepositoryInvariantDefect({
          reason: "invalidControlTransaction",
        }),
      );
    }
    if (state.repository !== repository) {
      return Effect.die(
        new FrameworkSchemaArtifactRepositoryInvariantDefect({
          reason: "crossRepositoryControlTransaction",
        }),
      );
    }
    if (!state.active) {
      return Effect.die(
        new FrameworkSchemaArtifactRepositoryInvariantDefect({
          reason: "closedControlTransaction",
        }),
      );
    }
    return work(state.rawTransaction);
  });
}

/** Exact same-factory control-database composition check. */
export function hasFrameworkSchemaArtifactRepositoryComposition(
  repository: unknown,
  controlDb: FlarexMetadataDatabase,
): repository is FrameworkSchemaArtifactRepository {
  if (typeof repository !== "object" || repository === null) return false;
  const state = frameworkSchemaArtifactRepositoryStates.get(repository);
  return state?.controlDb === controlDb;
}

/** Authenticate and snapshot one captured artifact before any SQL is built. */
export function prepareFrameworkSchemaArtifactAdmission(
  artifact: FrameworkSchemaArtifact,
): Result.Result<
  PreparedFrameworkSchemaArtifactAdmission,
  FrameworkSchemaArtifactError
> {
  const captured = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (captured === undefined) {
    return Result.fail(
      FrameworkSchemaArtifactError.admissionInputInvalid(),
    );
  }

  const state = Object.freeze({
    artifact,
    identity: snapshotFrameworkSchemaArtifactIdentity(artifact.identity),
    dependencies: snapshotFrameworkSchemaArtifactIdentities(
      artifact.dependencies,
    ),
    dependencyEvidence: snapshotFrameworkSchemaArtifactAdmissionDependencies(
      artifact.dependencies,
    ),
    artifactSha256Bytes: copyBytes(captured.artifactSha256Bytes),
    canonicalByteLength: captured.canonicalBytes.byteLength,
    canonicalBytes: copyBytes(captured.canonicalBytes),
    frameFormat: FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
    frameVersion: FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  } satisfies PreparedFrameworkSchemaArtifactAdmissionState);
  const prepared = Object.freeze({
    [preparedFrameworkSchemaArtifactAdmissionBrand]: true,
  } satisfies PreparedFrameworkSchemaArtifactAdmission);
  preparedFrameworkSchemaArtifactAdmissionStates.set(prepared, state);
  return Result.succeed(prepared);
}

/** Package-private detached evidence for future repository query construction. */
export function getPreparedFrameworkSchemaArtifactAdmissionEvidence(
  prepared: PreparedFrameworkSchemaArtifactAdmission,
): Result.Result<
  FrameworkSchemaArtifactAdmissionEvidence,
  FrameworkSchemaArtifactError
> {
  const state = preparedFrameworkSchemaArtifactAdmissionStates.get(prepared);
  if (state === undefined) {
    return Result.fail(
      FrameworkSchemaArtifactError.admissionInputInvalid(),
    );
  }
  return Result.succeed(Object.freeze({
    artifact: state.artifact,
    identity: snapshotFrameworkSchemaArtifactIdentity(state.identity),
    dependencies: snapshotFrameworkSchemaArtifactIdentities(
      state.dependencies,
    ),
    dependencyEvidence: snapshotFrameworkSchemaArtifactAdmissionDependencies(
      state.dependencyEvidence.map(dependency => dependency.identity),
    ),
    artifactSha256Bytes: copyBytes(state.artifactSha256Bytes),
    canonicalByteLength: state.canonicalByteLength,
    canonicalBytes: copyBytes(state.canonicalBytes),
    frameFormat: state.frameFormat,
    frameVersion: state.frameVersion,
  }));
}

function snapshotFrameworkSchemaArtifactIdentity(
  identity: FrameworkSchemaArtifactIdentity,
): FrameworkSchemaArtifactIdentity {
  return Object.freeze({
    deploymentId: identity.deploymentId,
    owner: identity.owner,
    lineageId: identity.lineageId,
    artifactSha256: identity.artifactSha256,
  });
}

function snapshotFrameworkSchemaArtifactIdentities(
  identities: readonly FrameworkSchemaArtifactIdentity[],
): readonly FrameworkSchemaArtifactIdentity[] {
  return Object.freeze(identities.map(
    snapshotFrameworkSchemaArtifactIdentity,
  ));
}

function snapshotFrameworkSchemaArtifactAdmissionDependencies(
  dependencies: readonly FrameworkSchemaArtifactIdentity[],
): readonly FrameworkSchemaArtifactAdmissionDependencyEvidence[] {
  return Object.freeze(dependencies.map((dependency) => {
    const stableArtifactSha256Bytes = Encoding.decodeHex(
      dependency.artifactSha256,
    ).pipe(Result.match({
      onFailure: () => {
        throw new FrameworkSchemaArtifactInvariantDefect({
          reason: "ownedSnapshotInvalid",
        });
      },
      onSuccess: copyBytes,
    }));
    return Object.freeze({
      identity: snapshotFrameworkSchemaArtifactIdentity(dependency),
      get artifactSha256Bytes(): Uint8Array {
        return copyBytes(stableArtifactSha256Bytes);
      },
    });
  }));
}

const runBoundedReconstructionEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.reconstructBounded",
)(function*<Value, Failure>(
  deadline: FrameworkSchemaArtifactControlDeadline,
  reconstructEffect: () => Effect.Effect<Value, Failure, never>,
): Effect.fn.Return<
  Value,
  Failure | FrameworkSchemaArtifactControlSessionDeadlineIssue
> {
  const remainingMilliseconds = yield*
    remainingFrameworkSchemaArtifactControlMilliseconds(deadline, "read");
  const reconstructionResult = yield* Effect.raceFirst(
    Effect.result(Effect.suspend(reconstructEffect)),
    Effect.sleep(Duration.millis(remainingMilliseconds)).pipe(
      Effect.andThen(
        failFrameworkSchemaArtifactControlDeadline(deadline, "read"),
      ),
    ),
  );
  yield* remainingFrameworkSchemaArtifactControlMilliseconds(
    deadline,
    "read",
  );
  return yield* Effect.fromResult(reconstructionResult);
});

function isFrameworkSchemaArtifactRepositoryTimeoutPolicy(
  policy: FrameworkSchemaArtifactRepositoryTimeoutPolicy,
): boolean {
  return isFrameworkSchemaArtifactTimeout(policy.readTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.attemptTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.recoveryTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.lockTimeoutMilliseconds) &&
    policy.lockTimeoutMilliseconds <= policy.attemptTimeoutMilliseconds &&
    policy.lockTimeoutMilliseconds <= policy.recoveryTimeoutMilliseconds;
}

function isFrameworkSchemaArtifactTimeout(value: unknown): value is number {
  return isPositiveSafeInteger(value) &&
    value <= MAXIMUM_FRAMEWORK_SCHEMA_ARTIFACT_TIMEOUT_MILLISECONDS;
}
