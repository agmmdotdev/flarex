import { createHash } from "node:crypto";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "@flarex/analysis/internal/system-test/declarative-v2-verifier-v1";
import {
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandDecodedCapabilityV1,
  type DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  type DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandTransportBudgetV1,
} from "@flarex/executor-http/internal/system-test/declarative-v2-authenticated-command-v1";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Effect, Layer, Result } from "effect";
import type { Scope } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DeclarativeV2AuthenticatedCommandProducerV1,
  DeclarativeV2AuthenticatedCommandProofIssuerV1,
  DeclarativeV2AuthenticatedCommandReadSessionsV1,
  DeclarativeV2AuthenticatedCommandSha256V1,
  makeDeclarativeV2AuthenticatedCommandProducerLayerV1,
  type DeclarativeV2AuthenticatedCommandPreparationV1,
  type DeclarativeV2AuthenticatedCommandPreparedReservationV1,
  type DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
  type DeclarativeV2AuthenticatedCommandProducerApiV1,
  type DeclarativeV2AuthenticatedCommandProducerReceiptV1,
  type DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
  DeclarativeV2AuthenticatedCommandProducerV1Error,
  type DeclarativeV2AuthenticatedCommandReservationLineageV1,
  type DeclarativeV2AuthenticatedCommandSelectionV1,
  type DeclarativeV2AuthenticatedCommandStableCommitmentsV1,
  type DeclarativeV2AuthenticatedRegistrationEvidenceV1,
} from "flarex-backend/internal/system-test/declarative-v2-authenticated-command-producer-v1";
import {
  makeDeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1,
  type DeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1,
} from "flarex-backend/internal/system-test/declarative-v2-authenticated-application-revision-evidence-v1";
import {
  makeDeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1,
  type DeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1,
} from
  "flarex-backend/internal/system-test/declarative-v2-authenticated-command-reservation-preparation-v1";
import {
  DeclarativeV2AuthenticatedReadSessionInputError,
  type DeclarativeV2AuthenticatedByteCursorV1,
  type DeclarativeV2AuthenticatedModuleV1,
  type DeclarativeV2AuthenticatedReadSessionFactoryV1,
  type DeclarativeV2AuthenticatedReadSessionReceiptV1,
  type DeclarativeV2AuthenticatedReadSessionV1,
} from "flarex-backend/internal/system-test/declarative-v2-authenticated-verifier-read-session-v1";
import type {
  SemanticArtifactV1FinalizedSourceProof,
  SemanticArtifactV1FinalizedSourceProofFactory,
  SemanticArtifactV1FinalizedSourceProofInput,
} from "flarex-backend/internal/system-test/semantic-artifact-v1-finalized-source-proof";

export type {
  DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
} from "flarex-backend/internal/system-test/declarative-v2-authenticated-command-producer-v1";

const UTF8 = new TextEncoder();
const MAXIMUM = 2_000_000;
const PROOF_INPUT =
  Object.freeze({}) as SemanticArtifactV1FinalizedSourceProofInput;
const TRANSPORT_BUDGET = Object.freeze({
  maximumBodyBytes: MAXIMUM,
  maximumCanonicalBytes: MAXIMUM,
  maximumFrameBytes: MAXIMUM,
  maximumPayloadBytes: MAXIMUM,
  maximumFrames: DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  maximumTransitions: MAXIMUM,
}) satisfies DeclarativeV2AuthenticatedCommandTransportBudgetV1;
const INCREMENTAL_BUDGET = Object.freeze({
  ...TRANSPORT_BUDGET,
  maximumAllocationBytes: MAXIMUM * 4,
  maximumCopyBytes: MAXIMUM * 4,
}) satisfies DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
const REGISTRATION_ROOT_CONFIGURATION = Object.freeze({
  semanticModelIdentity: "flarex.declarative-v2",
  semanticCodecIdentity: "flarex.semantic-artifact-v1/ndjson-v1",
  semanticPolicyIdentity: "flarex.standard-application/v1",
  coreLanguageIdentity: "javascript",
  abiIdentity: "flarex.dynamic-worker/v1",
  grammarIdentity: "ecmascript",
  unicodeIdentity: "unicode-15.1",
  parserTableIdentity: "flarex.parser/v1",
  trustedToolingIdentity: "flarex.standard-tooling/v1",
  ingressProtocolIdentity: "flarex.semantic-ingress/v1",
  ingressConfigurationIdentity: "flarex.semantic-ingress-config/v1",
});

export interface AuthenticatedApplicationRevisionEvidenceTestDriverV1 {
  readonly request: Request;
  readonly preparation: DeclarativeV2AuthenticatedCommandPreparationV1;
  readonly port:
    DeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1;
  readonly bindReservation: (
    lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error,
    never
  >;
  readonly produce: (
    reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  ) => Effect.Effect<
    unknown,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    never
  >;
  readonly preparedReservations:
    DeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1;
  readonly restartCommitments: Readonly<{
    readonly sourceCommitmentSha256: Uint8Array;
    readonly semanticCommitmentSha256: Uint8Array;
  }>;
  readonly prepareCommand: (
    selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  ) => Effect.Effect<
    AuthenticatedDeclarativeV2PreparedCommandTestDriverV1,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    Scope.Scope
  >;
}

export interface AuthenticatedDeclarativeV2PreparedCommandTestDriverV1 {
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commitments:
    DeclarativeV2AuthenticatedCommandStableCommitmentsV1;
  readonly bindReservation: (
    lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandPreparedReservationV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error,
    never
  >;
  readonly produce: (
    reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  ) => Effect.Effect<
    Readonly<{
      readonly result: unknown;
      readonly receipt: DeclarativeV2AuthenticatedCommandProducerReceiptV1;
      readonly commandFactory:
        DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1;
      readonly capability:
        DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
      readonly transportBudget:
        DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
    }>,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    Scope.Scope
  >;
}

export interface AuthenticatedApplicationRevisionEvidenceTestIdentityV1 {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly commandBudgetMaximum?: bigint;
}

/**
 * Test-only real backend composition used by FSV02-A1's persistence proofs.
 * It owns the authenticated Source/Semantic read session and keeps the
 * producer, proof, and session authority scoped inside the supplied effect.
 */
export function withAuthenticatedApplicationRevisionEvidenceTestDriverV1<
  A,
  E,
  R,
>(
  definition: PreparedStandardApplicationDefinitionV1,
  identity: AuthenticatedApplicationRevisionEvidenceTestIdentityV1,
  use: (
    driver: AuthenticatedApplicationRevisionEvidenceTestDriverV1,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
  R | Scope.Scope
> {
  const fixture = makeFixture(definition, identity);
  const layer = makeDeclarativeV2AuthenticatedCommandProducerLayerV1().pipe(
    Layer.provide(Layer.succeed(
      DeclarativeV2AuthenticatedCommandProofIssuerV1,
      DeclarativeV2AuthenticatedCommandProofIssuerV1.of(fixture.proofs),
    )),
    Layer.provide(Layer.succeed(
      DeclarativeV2AuthenticatedCommandReadSessionsV1,
      DeclarativeV2AuthenticatedCommandReadSessionsV1.of(fixture.sessions),
    )),
    Layer.provide(Layer.succeed(
      DeclarativeV2AuthenticatedCommandSha256V1,
      DeclarativeV2AuthenticatedCommandSha256V1.of({
        sha256: bytes => Effect.succeed(sha256(bytes)),
      }),
    )),
  );
  const request = new Request(
    "https://backend.test/private-registration-evidence",
  );
  const commandBudget = budget(
    "command_budget",
    identity.commandBudgetMaximum ?? 10_000n,
  ) as DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  const readSession = Object.freeze({
    command: Object.freeze({
      semanticUploadId: "semantic-upload",
      deploymentId: identity.deploymentId,
      expectedGeneration: 3,
      expectedMutationFence: 4,
      commandId: "registration-evidence",
      admission: Object.freeze({
        calls: 10_000,
        blockBytes: 10_000_000,
        canonicalBytes: 10_000_000,
        frameBytes: 10_000_000,
        hashBytes: 10_000_000,
        timeMilliseconds: 10_000,
      }),
    }),
    budget: Object.freeze({
      ceilings: budget(
        "attempt_ceilings",
        identity.commandBudgetMaximum ?? 10_000n,
      ),
      usage: budget("attempt_usage", 0n),
      command: commandBudget,
    }),
  });

  return DeclarativeV2AuthenticatedCommandProducerV1.pipe(
    Effect.flatMap(producer =>
      Effect.gen(function* () {
        const preparation = yield* producer.prepare(
          request,
          PROOF_INPUT,
          Object.freeze({
            readSession,
            commandBudget,
            transportBudget: TRANSPORT_BUDGET,
            selection: Object.freeze({ kind: "registration_page" as const }),
          }),
        );
        const prepareCommand = Effect.fn(
          "AuthenticatedRegistrationEvidenceTestDriver.prepareCommand",
        )(function* (
          selection: DeclarativeV2AuthenticatedCommandSelectionV1,
        ) {
          const commandPreparation = selection.kind === "registration_page"
            ? preparation
            : yield* producer.prepare(
              request,
              PROOF_INPUT,
              Object.freeze({
                readSession,
                commandBudget,
                transportBudget: TRANSPORT_BUDGET,
                selection,
              }),
            );
          const commitments = yield* Effect.fromResult(
            producer.commitments(request, commandPreparation),
          );
          return Object.freeze({
            commandBudget,
            commitments,
            bindReservation: (
              lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1,
            ) =>
              producer.bindReservation(
                request,
                commandPreparation,
                lineage,
              ),
            produce: Effect.fn(
              "AuthenticatedRegistrationEvidenceTestDriver.produceCommand",
            )(function* (
              reservation: DeclarativeV2VerifierCommandReservationFrameV2,
            ) {
              const result = yield* producer.producePrepared(
                request,
                commandPreparation,
                reservation,
              );
              const receipt = yield* Effect.fromResult(
                producer.receipt(request, result),
              );
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  const closed = producer.close(request, result);
                  if (Result.isFailure(closed) &&
                    closed.failure.reason !== "closed") {
                    throw closed.failure;
                  }
                })
              );
              const decoded = yield* Effect.fromResult(
                decodeProducedCommand(producer, request, result, receipt),
              );
              return Object.freeze({ result, receipt, ...decoded });
            }),
          }) satisfies AuthenticatedDeclarativeV2PreparedCommandTestDriverV1;
        });
        const port =
          makeDeclarativeV2AuthenticatedApplicationRevisionEvidencePortV1(
            producer,
          );
        return yield* use(Object.freeze({
          request,
          preparation,
          port,
          preparedReservations:
            makeDeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1(
              producer,
            ),
          restartCommitments: Object.freeze({
            sourceCommitmentSha256: new Uint8Array(
              fixture.restartCommitments.sourceCommitmentSha256,
            ),
            semanticCommitmentSha256: new Uint8Array(
              fixture.restartCommitments.semanticCommitmentSha256,
            ),
          }),
          prepareCommand,
          bindReservation: Effect.fn(
            "AuthenticatedRegistrationEvidenceTestDriver.bindReservation",
          )(function* (lineage) {
            const authority = yield* producer.bindReservation(
              request,
              preparation,
              lineage,
            );
            return yield* Effect.fromResult(
              producer.claimPreparedReservation(authority, lineage),
            );
          }),
          produce: (
            reservation: DeclarativeV2VerifierCommandReservationFrameV2,
          ) =>
            producer.producePrepared(request, preparation, reservation),
        }));
      })
    ),
    Effect.provide(layer),
  );
}

function decodeProducedCommand(
  producer: DeclarativeV2AuthenticatedCommandProducerApiV1,
  request: Request,
  result: unknown,
  receipt: DeclarativeV2AuthenticatedCommandProducerReceiptV1,
): Result.Result<
  Readonly<{
    readonly commandFactory:
      DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1;
    readonly capability:
      DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
    readonly transportBudget:
      DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
  }>,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const cursor = yield* producer.cursor(request, result);
    const canonicalBytes = new Uint8Array(receipt.canonicalByteLength);
    let offset = 0;
    for (;;) {
      const read = yield* producer.read(
        request,
        cursor,
        Math.max(1, receipt.canonicalByteLength - offset),
      );
      canonicalBytes.set(read.bytes, offset);
      offset += read.bytes.byteLength;
      if (read.status === "complete") break;
      if (read.bytes.byteLength === 0) {
        return yield* Result.fail(
          new DeclarativeV2AuthenticatedCommandProducerV1Error({
            operation: "read",
            reason: "contentMismatch",
            path: "commandBytes",
          }),
        );
      }
    }
    if (offset !== canonicalBytes.byteLength) {
      return yield* Result.fail(
        new DeclarativeV2AuthenticatedCommandProducerV1Error({
          operation: "read",
          reason: "contentMismatch",
          path: "canonicalByteLength",
        }),
      );
    }
    const commandFactory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    const created = yield* commandFactory.create({
      bodyByteLength: canonicalBytes.byteLength,
      budget: INCREMENTAL_BUDGET,
    }).pipe(Result.mapError(cause =>
      new DeclarativeV2AuthenticatedCommandProducerV1Error({
        operation: "read",
        reason: "contentMismatch",
        ...(cause.path === undefined ? {} : { path: cause.path }),
      })
    ));
    let consumed = 0;
    while (consumed < canonicalBytes.byteLength) {
      const stepped = yield* commandFactory.step(
        created.decoder,
        canonicalBytes.subarray(consumed),
        1_024,
      ).pipe(Result.mapError(cause =>
        new DeclarativeV2AuthenticatedCommandProducerV1Error({
          operation: "read",
          reason: "contentMismatch",
          ...(cause.path === undefined ? {} : { path: cause.path }),
        })
      ));
      if (stepped.consumedBytes === 0) {
        return yield* Result.fail(
          new DeclarativeV2AuthenticatedCommandProducerV1Error({
            operation: "read",
            reason: "contentMismatch",
            path: "decoderProgress",
          }),
        );
      }
      consumed += stepped.consumedBytes;
    }
    for (;;) {
      const finished = yield* commandFactory.finish(
        created.decoder,
        1_024,
      ).pipe(Result.mapError(cause =>
        new DeclarativeV2AuthenticatedCommandProducerV1Error({
          operation: "read",
          reason: "contentMismatch",
          ...(cause.path === undefined ? {} : { path: cause.path }),
        })
      ));
      if (finished.status === "complete") {
        return Object.freeze({
          commandFactory,
          capability: finished.capability,
          transportBudget: INCREMENTAL_BUDGET,
        });
      }
    }
  });
}

interface Fixture {
  readonly proofs: Pick<SemanticArtifactV1FinalizedSourceProofFactory, "issue">;
  readonly sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1;
  readonly restartCommitments: Readonly<{
    readonly sourceCommitmentSha256: Uint8Array;
    readonly semanticCommitmentSha256: Uint8Array;
  }>;
}

function makeFixture(
  definition: PreparedStandardApplicationDefinitionV1,
  identity: AuthenticatedApplicationRevisionEvidenceTestIdentityV1,
): Fixture {
  const modules = definition.artifactIngressPlan.source.modules;
  const semantic = definition.artifactIngressPlan.semantic.bytes;
  const proof = Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof;
  const session = Object.freeze({}) as DeclarativeV2AuthenticatedReadSessionV1;
  const moduleHandles = modules.map(() =>
    Object.freeze({}) as DeclarativeV2AuthenticatedModuleV1
  );
  const modulesByHandle = new WeakMap<object, number>();
  moduleHandles.forEach((handle, ordinal) =>
    modulesByHandle.set(handle, ordinal)
  );
  const cursors = new WeakMap<object, {
    readonly bytes: Uint8Array;
    offset: number;
  }>();
  let readCalls = 0n;
  let readBytes = 0n;
  const receipt = (): DeclarativeV2AuthenticatedReadSessionReceiptV1 => {
    const usage = budget("attempt_usage", 0n, {
      calls: readCalls,
      outputBytes: readBytes,
    });
    return Object.freeze({
      projectId: identity.projectId,
      deploymentId: identity.deploymentId,
      deploymentCreatedAt: identity.deploymentCreatedAt,
      sourceUploadId: "source-upload",
      sourceGeneration: 1,
      sourceMutationFence: 2,
      sourceRootSha256: digest(0x11),
      sourceSelectorSha256: digest(0x12),
      semanticUploadId: "semantic-upload",
      semanticGeneration: 3,
      semanticMutationFence: 4,
      semanticRootSha256: digest(0x13),
      semanticSelectorSha256: digest(0x14),
      semanticAttemptIdentitySha256: digest(0x15),
      rootConfiguration: REGISTRATION_ROOT_CONFIGURATION,
      moduleCount: modules.length,
      semanticByteLength: semantic.byteLength,
      budget: Object.freeze({ usage, commandUsage: usage }),
    });
  };
  const proofs = Object.freeze({
    issue: (
      _request: Request,
      _input: SemanticArtifactV1FinalizedSourceProofInput,
    ) => Effect.succeed(proof),
  });
  const sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1 =
    Object.freeze({
      open: (
        _request: Request,
        receivedProof: SemanticArtifactV1FinalizedSourceProof,
      ) =>
        receivedProof === proof
          ? Effect.succeed(session)
          : Effect.fail(inputError("open", "invalidAuthority")),
      receipt: () => Result.succeed(receipt()),
      moduleCount: () => Result.succeed(modules.length),
      moduleAt: (_request: Request, _session: unknown, ordinal: unknown) =>
        typeof ordinal === "number" && moduleHandles[ordinal] !== undefined
          ? Result.succeed(moduleHandles[ordinal])
          : Result.fail(inputError("module", "invalidInput")),
      moduleView: (_request: Request, module: unknown) => {
        const ordinal = module !== null && typeof module === "object"
          ? modulesByHandle.get(module)
          : undefined;
        const value = ordinal === undefined ? undefined : modules[ordinal];
        if (ordinal === undefined || value === undefined) {
          return Result.fail(inputError("module", "invalidAuthority"));
        }
        return Result.succeed(Object.freeze({
          ordinal,
          roles: value.roles,
          frameSha256: digest(0x20 + ordinal),
          sourceSha256: sha256(value.sourceBytes),
          sourceByteLength: value.sourceBytes.byteLength,
          path: modulePath(value.path),
        }));
      },
      sourceCursor: (_request: Request, module: unknown) => {
        const ordinal = module !== null && typeof module === "object"
          ? modulesByHandle.get(module)
          : undefined;
        const value = ordinal === undefined ? undefined : modules[ordinal];
        return value === undefined
          ? Result.fail(inputError("cursor", "invalidAuthority"))
          : Result.succeed(cursorFor(cursors, value.sourceBytes));
      },
      semanticCursor: () => Result.succeed(cursorFor(cursors, semantic)),
      readCursor: (
        _request: Request,
        cursor: unknown,
        maximumBytes: unknown,
      ) => {
        const state = cursor !== null && typeof cursor === "object"
          ? cursors.get(cursor)
          : undefined;
        if (
          state === undefined ||
          typeof maximumBytes !== "number" ||
          maximumBytes < 1
        ) {
          return Result.fail(inputError("read", "invalidInput"));
        }
        const bytes = state.bytes.slice(
          state.offset,
          state.offset + maximumBytes,
        );
        state.offset += bytes.byteLength;
        readCalls += 1n;
        readBytes += BigInt(bytes.byteLength);
        return Result.succeed(Object.freeze({
          status: state.offset === state.bytes.byteLength
            ? "complete" as const
            : "pending" as const,
          offset: state.offset,
          bytes,
        }));
      },
      close: () => Result.succeed(undefined),
    });
  return Object.freeze({
    proofs,
    sessions,
    restartCommitments: Object.freeze({
      sourceCommitmentSha256: digest(0x11),
      semanticCommitmentSha256: digest(0x13),
    }),
  });
}

function cursorFor(
  cursors: WeakMap<object, { readonly bytes: Uint8Array; offset: number }>,
  bytes: Uint8Array,
): DeclarativeV2AuthenticatedByteCursorV1 {
  const cursor = Object.freeze({}) as DeclarativeV2AuthenticatedByteCursorV1;
  cursors.set(cursor, { bytes, offset: 0 });
  return cursor;
}

function modulePath(text: string): DeclarativeV2ArtifactModulePathHandleV1 {
  const bytes = UTF8.encode(text);
  const validator = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      bytes.byteLength + 4,
      bytes.byteLength,
      bytes.byteLength,
    ),
  );
  Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      validator,
      bytes,
      bytes.byteLength,
    ),
  );
  const result = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(validator, 4),
  );
  if ("status" in result) {
    throw new Error("Test artifact module path did not settle.");
  }
  return result;
}

function inputError(
  operation: DeclarativeV2AuthenticatedReadSessionInputError["operation"],
  reason: DeclarativeV2AuthenticatedReadSessionInputError["reason"],
): DeclarativeV2AuthenticatedReadSessionInputError {
  return new DeclarativeV2AuthenticatedReadSessionInputError({
    operation,
    reason,
  });
}

function budget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  initial: bigint,
  overrides: Readonly<Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >>> = {},
): DeclarativeV2VerifierBudgetFrameV2 {
  const frame: Record<string, bigint | string> = { kind };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    frame[dimension] = overrides[dimension] ?? initial;
  }
  return Object.freeze(frame) as unknown as DeclarativeV2VerifierBudgetFrameV2;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
