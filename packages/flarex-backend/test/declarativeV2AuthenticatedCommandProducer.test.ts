import { createHash } from "node:crypto";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import {
  decodeDeclarativeV2AuthenticatedCommandRequestV1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  type DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  type DeclarativeV2AuthenticatedCommandTransportBudgetV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-v1";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Cause, Effect, Exit, Fiber, Layer, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1,
  DeclarativeV2AuthenticatedCommandProducerV1,
  DeclarativeV2AuthenticatedCommandProofIssuerV1,
  DeclarativeV2AuthenticatedCommandReadSessionsV1,
  DeclarativeV2AuthenticatedCommandSha256V1,
  makeDeclarativeV2AuthenticatedCommandProducerLayerV1,
  type DeclarativeV2AuthenticatedCommandProducerApiV1,
  type DeclarativeV2AuthenticatedCommandProducerInputV1,
  type DeclarativeV2AuthenticatedCommandSelectionV1,
} from "../src/declarativeV2/AuthenticatedCommandProducer";
import {
  makeDeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1,
} from "../src/declarativeV2/AuthenticatedCommandReservationPreparation";
import {
  DeclarativeV2AuthenticatedReadSessionInputError,
  type DeclarativeV2AuthenticatedByteCursorV1,
  type DeclarativeV2AuthenticatedModuleV1,
  type DeclarativeV2AuthenticatedReadSessionFactoryV1,
  type DeclarativeV2AuthenticatedReadSessionReceiptV1,
  type DeclarativeV2AuthenticatedReadSessionV1,
} from "../src/declarativeV2/AuthenticatedVerifierReadSession";
import type {
  SemanticArtifactV1FinalizedSourceProof,
  SemanticArtifactV1FinalizedSourceProofFactory,
  SemanticArtifactV1FinalizedSourceProofInput,
} from "../src/semanticArtifactV1/FinalizedSourceProof";

const encoder = new TextEncoder();
const HASH_BYTE = 0x5a;
const HASH = new Uint8Array(32).fill(HASH_BYTE);
const MAXIMUM = 2_000_000;
const PROOF_INPUT =
  Object.freeze({}) as SemanticArtifactV1FinalizedSourceProofInput;
const transportBudget = Object.freeze({
  maximumBodyBytes: MAXIMUM,
  maximumCanonicalBytes: MAXIMUM,
  maximumFrameBytes: MAXIMUM,
  maximumPayloadBytes: MAXIMUM,
  maximumFrames: DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  maximumTransitions: MAXIMUM,
}) satisfies DeclarativeV2AuthenticatedCommandTransportBudgetV1;

interface FixtureModule {
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
  readonly pathText: string;
  readonly source: Uint8Array;
  readonly reportedSourceByteLength: number;
}

interface Fixture {
  readonly order: string[];
  readonly reads: string[];
  readonly proofs: Pick<SemanticArtifactV1FinalizedSourceProofFactory, "issue">;
  readonly sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1;
  readonly hash: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, never, never>;
}

describe("authenticated Declarative V2 command producer", () => {
  it.each([
    {
      selection: Object.freeze({
        kind: "source_page",
        firstModuleOrdinal: 0n,
        moduleCount: 1n,
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
      expectedKinds: [
        "command_header",
        "module_metadata",
        "command_terminal",
      ],
    },
    {
      selection: Object.freeze({
        kind: "parse_module",
        moduleOrdinal: 0n,
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
      expectedKinds: [
        "command_header",
        "module_metadata",
        "source_bytes",
        "command_terminal",
      ],
    },
    {
      selection: Object.freeze({
        kind: "registration_page",
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
      expectedKinds: [
        "command_header",
        "semantic_bytes",
        "command_terminal",
      ],
    },
    {
      selection: Object.freeze({
        kind: "link_page",
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
      expectedKinds: ["command_header", "command_terminal"],
    },
  ])("produces the strict $selection.kind grammar after fresh authentication", async ({
    selection,
    expectedKinds,
  }) => {
    const fixture = makeFixture();
    const output = await produceOwned(fixture, selection, transportBudget, 7);
    const decoded = decode(output.bytes, transportBudget);

    expect(decoded.request.frames.map(frame => frame.kind)).toEqual(expectedKinds);
    expect(decoded.request.frames[0]).toMatchObject({
      kind: "command_header",
      reservation: {
        commandKind: selection.kind,
        sequence: 7n,
      },
    });
    const header = decoded.request.frames[0];
    if (header?.kind !== "command_header") {
      throw new Error("expected command header");
    }
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      expect(header.commandBudget[dimension]).toBe(10_000_000n);
    }
    expect(header.reservation).toMatchObject({
      commandBudgetSha256: HASH,
      commandInputSha256: HASH,
      freshAuthenticatedInputSha256: HASH,
      analyzerIdentitySha256: HASH,
      verifierIdentitySha256: HASH,
      rangeAndPredecessorTailsSha256: HASH,
    });
    expect(output.receipt).toMatchObject({
      commandKind: selection.kind,
      sequence: 7n,
      canonicalByteLength: output.bytes.byteLength,
    });
    if (selection.kind === "parse_module") {
      expect(output.receipt.contentRead.commandUsage).toMatchObject({
        calls: 1n,
        outputBytes: BigInt(
          encoder.encode("export function ready() { return 1; }").byteLength,
        ),
      });
    }
    expect(fixture.order.slice(0, 3)).toEqual(["issue", "open", "receipt"]);
    expect(fixture.order.indexOf("hash")).toBeGreaterThan(
      fixture.order.indexOf("open"),
    );
    expect(fixture.order.at(-1)).toBe("close");
    if (selection.kind === "parse_module") {
      expect(fixture.reads).toEqual(["source:0"]);
    } else if (selection.kind === "registration_page") {
      expect(fixture.reads).toEqual(["semantic:0"]);
    } else {
      expect(fixture.reads).toEqual([]);
    }
  });

  it("is byte-identical across cold producer Layers and output read sizes", async () => {
    const firstFixture = makeFixture();
    const secondFixture = makeFixture();
    const selection = Object.freeze({
      kind: "parse_module",
      moduleOrdinal: 0n,
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const first = await produceOwned(firstFixture, selection, transportBudget, 9, 1);
    const second = await produceOwned(
      secondFixture,
      selection,
      transportBudget,
      9,
      65_536,
    );
    expect(first.bytes).toEqual(second.bytes);
    expect(first.receipt).toEqual(second.receipt);
    first.bytes.fill(0);
    const third = await produceOwned(
      makeFixture(),
      selection,
      transportBudget,
      9,
      13,
    );
    expect(third.bytes).toEqual(second.bytes);
  });

  it("accepts exact transport usage and rejects one-less before payload reads", async () => {
    const selection = Object.freeze({
      kind: "parse_module",
      moduleOrdinal: 0n,
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const baseline = await produceOwned(
      makeFixture(),
      selection,
      transportBudget,
      1,
    );
    const exact = Object.freeze({
      maximumBodyBytes: baseline.receipt.transport.bodyBytes,
      maximumCanonicalBytes: baseline.receipt.transport.canonicalBytes,
      maximumFrameBytes: baseline.receipt.transport.frameBytes,
      maximumPayloadBytes: baseline.receipt.transport.payloadBytes,
      maximumFrames: baseline.receipt.transport.frames,
      maximumTransitions: baseline.receipt.transport.transitions,
    }) satisfies DeclarativeV2AuthenticatedCommandTransportBudgetV1;
    await expect(
      produceOwned(makeFixture(), selection, exact, 1),
    ).resolves.toMatchObject({ bytes: baseline.bytes });

    const oneLessFixture = makeFixture();
    const oneLess = Object.freeze({
      ...exact,
      maximumBodyBytes: exact.maximumBodyBytes - 1,
    });
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        oneLessFixture,
        producer => producer.produce(
          new Request("https://producer.test/exact-minus-one"),
          PROOF_INPUT,
          producerInput(selection, oneLess, 1),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({
      reason: "budgetExceeded",
      path: "transport.bodyBytes",
    });
    expect(oneLessFixture.reads).toEqual([]);

    const frameFixture = makeFixture();
    const frameExit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        frameFixture,
        producer => producer.produce(
          new Request("https://producer.test/frame-exact-minus-one"),
          PROOF_INPUT,
          producerInput(
            selection,
            Object.freeze({
              ...exact,
              maximumFrameBytes: exact.maximumFrameBytes - 1,
            }),
            1,
          ),
        ),
      ),
    ));
    expect(failure(frameExit)).toMatchObject({
      reason: "budgetExceeded",
      path: "transport.frameBytes",
    });
    expect(frameFixture.reads).toEqual([]);
  });

  it("binds the A1b1 read budget to the accepted 26-dimensional command budget", async () => {
    const fixture = makeFixture();
    const input = producerInput(
      Object.freeze({ kind: "link_page" }),
      transportBudget,
      1,
    );
    const readSession = input.readSession as ReturnType<typeof readSessionInput>;
    const divergent = Object.freeze({
      ...readSession,
      budget: Object.freeze({
        ...readSession.budget,
        command: Object.freeze({
          ...readSession.budget.command,
          calls: readSession.budget.command.calls + 1n,
        }),
      }),
    });
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        fixture,
        producer => producer.produce(
          new Request("https://producer.test/divergent-read-budget"),
          PROOF_INPUT,
          Object.freeze({ ...input, readSession: divergent }),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({
      reason: "contentMismatch",
      path: "readSession.budget.command",
    });
    expect(fixture.order).toEqual([]);
  });

  it("admits exactly 1,024 frames and rejects the next module before encoding", async () => {
    const exactFixture = makeFixture({ moduleCount: 1_022 });
    const selection = Object.freeze({
      kind: "source_page",
      firstModuleOrdinal: 0n,
      moduleCount: 1_022n,
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const exact = await produceOwned(exactFixture, selection, transportBudget, 2);
    expect(decode(exact.bytes, transportBudget).request.frames).toHaveLength(
      1_024,
    );

    const overFixture = makeFixture({ moduleCount: 1_023 });
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        overFixture,
        producer => producer.produce(
          new Request("https://producer.test/frame-plus-one"),
          PROOF_INPUT,
          producerInput(Object.freeze({
            kind: "source_page",
            firstModuleOrdinal: 0n,
            moduleCount: 1_023n,
          }), transportBudget, 2),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({
      reason: "budgetExceeded",
      path: "modules",
      maximum: 1_022n,
    });
  });

  it.each([
    { maximumFrames: 0, expectedReason: "budgetExceeded" },
    { maximumFrames: 1, expectedReason: "budgetExceeded" },
    { maximumFrames: 1_025, expectedReason: "invalidInput" },
  ])("fails closed at the $maximumFrames configured-frame boundary", async ({
    maximumFrames,
    expectedReason,
  }) => {
    const fixture = makeFixture();
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        fixture,
        producer => producer.produce(
          new Request(`https://producer.test/frame-bound-${maximumFrames}`),
          PROOF_INPUT,
          producerInput(
            Object.freeze({ kind: "link_page" }),
            Object.freeze({ ...transportBudget, maximumFrames }),
            2,
          ),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({ reason: expectedReason });
    expect(fixture.reads).toEqual([]);
  });

  it("splits a full payload quantum and its next byte without rescanning", async () => {
    const source = new Uint8Array(65_537);
    for (let index = 0; index < source.byteLength; index += 1) {
      source[index] = index % 251;
    }
    const fixture = makeFixture({ source });
    const output = await produceOwned(
      fixture,
      Object.freeze({ kind: "parse_module", moduleOrdinal: 0n }),
      transportBudget,
      8,
    );
    const frames = decode(output.bytes, transportBudget).request.frames;
    const payload = frames.filter(frame => frame.kind === "source_bytes");
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ offset: 0n });
    expect(payload[1]).toMatchObject({ offset: 65_536n });
    expect(join(payload.map(frame => frame.bytes))).toEqual(source);
    expect(fixture.reads).toEqual(["source:0", "source:0"]);
  });

  it.each([
    {
      name: "module",
      options: {
        reportedSourceByteLength: 65_536 * 1_022,
      },
      selection: Object.freeze({
        kind: "parse_module",
        moduleOrdinal: 0n,
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
    },
    {
      name: "semantic stream",
      options: {
        reportedSemanticByteLength: 65_536 * 1_023,
      },
      selection: Object.freeze({
        kind: "registration_page",
      }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1,
    },
  ])("fails an oversized $name without hidden pagination or cursor reads", async ({
    options,
    selection,
  }) => {
    const fixture = makeFixture(options);
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        fixture,
        producer => producer.produce(
          new Request("https://producer.test/oversized"),
          PROOF_INPUT,
          producerInput(selection, transportBudget, 3),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({
      reason: "budgetExceeded",
      path: "transport.frames",
    });
    expect(fixture.reads).toEqual([]);
  });

  it("rejects an oversized module path before copying or hashing", async () => {
    const fixture = makeFixture({ pathText: "a".repeat(65_537) });
    const exit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        fixture,
        producer => producer.produce(
          new Request("https://producer.test/oversized-path"),
          PROOF_INPUT,
          producerInput(
            Object.freeze({
              kind: "source_page",
              firstModuleOrdinal: 0n,
              moduleCount: 1n,
            }),
            transportBudget,
            3,
          ),
        ),
      ),
    ));
    expect(failure(exit)).toMatchObject({
      reason: "budgetExceeded",
      path: "modules.0.path",
      observed: 65_537n,
      maximum: 65_536n,
    });
    expect(fixture.order).not.toContain("hash");
    expect(fixture.reads).toEqual([]);
  });

  it("rejects hostile input and commitment mismatch in the typed channel", async () => {
    const hostileFixture = makeFixture();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileExit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        hostileFixture,
        producer => producer.produce(
          new Request("https://producer.test/hostile"),
          PROOF_INPUT,
          revoked.proxy,
        ),
      ),
    ));
    expect(failure(hostileExit)).toMatchObject({
      reason: "invalidInput",
      path: "input",
    });
    expect(hostileFixture.order).toEqual([]);

    const mismatchFixture = makeFixture();
    const mismatch = producerInput(
      Object.freeze({ kind: "link_page" }),
      transportBudget,
      4,
    );
    const reservation = {
      ...(mismatch.reservation as DeclarativeV2VerifierCommandReservationFrameV2),
      commandInputSha256: digest(0x11),
    };
    const mismatchExit = await Effect.runPromiseExit(Effect.scoped(
      withProducer(
        mismatchFixture,
        producer => producer.produce(
          new Request("https://producer.test/mismatch"),
          PROOF_INPUT,
          Object.freeze({
            ...mismatch,
            reservation: Object.freeze(reservation),
          }),
        ),
      ),
    ));
    expect(failure(mismatchExit)).toMatchObject({
      reason: "commitmentMismatch",
      commitment: "commandInputSha256",
    });
  });

  it("prepares authenticated commitments once and retries exact reservation bytes", async () => {
    const fixture = makeFixture();
    const request = new Request("https://producer.test/prepared");
    const selection = Object.freeze({
      kind: "parse_module",
      moduleOrdinal: 0n,
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const fullInput = producerInput(selection, transportBudget, 4);
    await Effect.runPromise(Effect.scoped(
      withProducer(
        fixture,
        producer =>
          Effect.gen(function* () {
            const preparation = yield* producer.prepare(
              request,
              PROOF_INPUT,
              {
                readSession: fullInput.readSession,
                commandBudget: fullInput.commandBudget,
                transportBudget: fullInput.transportBudget,
                selection: fullInput.selection,
              },
            );
            expect(fixture.reads).toEqual([]);
            expect(Result.getOrThrow(
              producer.commitments(request, preparation),
            )).toEqual({
              commandBudgetSha256: HASH,
              commandInputSha256: HASH,
              freshAuthenticatedInputSha256: HASH,
              analyzerIdentitySha256: HASH,
              verifierIdentitySha256: HASH,
            });
            expect(producer.commitments(
              new Request(request.url),
              preparation,
            )).toMatchObject({
              failure: { reason: "wrongRequest" },
            });
            const [first, replay] = yield* Effect.all([
              producer.producePrepared(
                request,
                preparation,
                fullInput.reservation,
              ),
              producer.producePrepared(
                request,
                preparation,
                fullInput.reservation,
              ),
            ], { concurrency: "unbounded" });
            expect(replay).toBe(first);
            expect(fixture.reads).toEqual(["source:0"]);
            const contradictory = yield* Effect.exit(
              producer.producePrepared(
                request,
                preparation,
                {
                  ...(fullInput.reservation as
                    DeclarativeV2VerifierCommandReservationFrameV2),
                  sequence: 5n,
                },
              ),
            );
            expect(failure(contradictory)).toMatchObject({
              reason: "commitmentMismatch",
              path: "reservation",
            });
          }),
      ),
    ));
    expect(fixture.order.filter(entry => entry === "open")).toHaveLength(1);
    expect(fixture.order.filter(entry => entry === "close")).toHaveLength(1);
  });

  it("keeps result and cursor authority same-service, exact-request, and terminal", async () => {
    const fixture = makeFixture();
    const otherFixture = makeFixture();
    const request = new Request("https://producer.test/authority");
    await Effect.runPromise(Effect.scoped(
      withProducer(
        fixture,
        producer =>
          withProducer(
            otherFixture,
            other =>
              Effect.gen(function* () {
                const result = yield* producer.produce(
                  request,
                  PROOF_INPUT,
                  producerInput(
                    Object.freeze({ kind: "link_page" }),
                    transportBudget,
                    5,
                  ),
                );
                expect(other.receipt(request, result)).toMatchObject({
                  failure: { reason: "invalidAuthority" },
                });
                expect(producer.receipt(
                  new Request(request.url),
                  result,
                )).toMatchObject({ failure: { reason: "wrongRequest" } });
                const cursor = Result.getOrThrow(
                  producer.cursor(request, result),
                );
                expect(producer.cursor(request, result)).toMatchObject({
                  failure: { reason: "cursorAlreadyIssued" },
                });
                const read = Result.getOrThrow(
                  producer.read(request, cursor, 65_536),
                );
                expect(read.status).toBe("complete");
                expect(producer.read(request, cursor, 1)).toMatchObject({
                  failure: { reason: "closed" },
                });
                Result.getOrThrow(producer.close(request, result));
                expect(producer.receipt(request, result)).toMatchObject({
                  failure: { reason: "closed" },
                });
              }),
          ),
      ),
    ));
  });

  it("closes the authenticated session when interrupted during hashing", async () => {
    const fixture = makeFixture();
    let enteredHash: (() => void) | undefined;
    const entered = new Promise<void>(resolve => {
      enteredHash = resolve;
    });
    const fiber = Effect.runFork(Effect.scoped(
      withProducer(
        fixture,
        producer => producer.produce(
          new Request("https://producer.test/interrupted"),
          PROOF_INPUT,
          producerInput(
            Object.freeze({ kind: "link_page" }),
            transportBudget,
            6,
          ),
        ),
        () => {
          enteredHash?.();
          return Effect.never;
        },
      ),
    ));
    await entered;
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("expected interruption");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(fixture.order.filter(entry => entry === "close")).toHaveLength(1);
    expect(fixture.order.at(-1)).toBe("close");
  });

  it("binds all six commitments to exact persistence lineage and consumes the authority once", async () => {
    const fixture = makeFixture();
    const request = new Request("https://producer.test/prepared-reservation");
    const selection = Object.freeze({
      kind: "link_page",
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const fullInput = producerInput(selection, transportBudget, 2);
    await Effect.runPromise(Effect.scoped(withProducer(
      fixture,
      producer =>
        Effect.gen(function* () {
          const preparation = yield* producer.prepare(
            request,
            PROOF_INPUT,
            {
              readSession: fullInput.readSession,
              commandBudget: fullInput.commandBudget,
              transportBudget: fullInput.transportBudget,
              selection,
            },
          );
          const lineage = Object.freeze({
            attemptSha256: digest(1),
            candidateSha256: digest(2),
            commandKind: "link_page" as const,
            sequence: 2n,
            currentProgressSha256: digest(3),
            predecessorReceiptSha256: digest(4),
          });
          const prepared = yield* producer.bindReservation(
            request,
            preparation,
            lineage,
          );
          expect(
            producer.claimPreparedReservation(prepared, {
              ...lineage,
              sequence: 3n,
            }),
          ).toMatchObject({
            failure: {
              operation: "claimReservation",
              reason: "commitmentMismatch",
              path: "lineage",
            },
          });
          const claim =
            yield* makeDeclarativeV2AuthenticatedCommandPreparedReservationClaimPortV1(
              producer,
            ).claim(
              prepared,
              lineage,
            );
          expect(claim.commitments).toEqual({
            commandBudgetSha256: HASH,
            commandInputSha256: HASH,
            freshAuthenticatedInputSha256: HASH,
            analyzerIdentitySha256: HASH,
            verifierIdentitySha256: HASH,
            rangeAndPredecessorTailsSha256: HASH,
          });
          expect(
            producer.claimPreparedReservation(prepared, lineage),
          ).toMatchObject({
            failure: {
              operation: "claimReservation",
              reason: "invalidAuthority",
            },
          });
          const reservation = Object.freeze({
            kind: "command_reservation" as const,
            ...lineage,
            ...claim.commitments,
          });
          const result = yield* producer.producePrepared(
            request,
            preparation,
            reservation,
          );
          expect(Result.getOrThrow(producer.receipt(request, result))).toMatchObject({
            commandKind: "link_page",
            sequence: 2n,
            rangeAndPredecessorTailsSha256: HASH,
          });
        }),
    )));
  });

  it("issues one definition-correlated registration capability and binds the exact terminal receipt", async () => {
    const definition = registrationDefinition();
    const module = definition.artifactIngressPlan.source.modules[0];
    if (module === undefined) throw new Error("Expected one materialized module.");
    const fixture = makeFixture({
      source: module.sourceBytes,
      semantic: definition.artifactIngressPlan.semantic.bytes,
      pathText: module.path,
      roles: module.roles,
      liveSha256: true,
    });
    const request = new Request("https://producer.test/registration-evidence");
    const selection = Object.freeze({
      kind: "registration_page",
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const fullInput = producerInput(selection, transportBudget, 1);
    const result = await Effect.runPromise(Effect.scoped(withProducer(
      fixture,
      producer =>
        Effect.gen(function* () {
          const preparation = yield* producer.prepare(
            request,
            PROOF_INPUT,
            {
              readSession: fullInput.readSession,
              commandBudget: fullInput.commandBudget,
              transportBudget: fullInput.transportBudget,
              selection,
            },
          );
          const [evidence, concurrentEvidence] = yield* Effect.all([
            producer.issueRegistrationEvidence(
              request,
              preparation,
              definition,
            ),
            producer.issueRegistrationEvidence(
              request,
              preparation,
              definition,
            ),
          ], { concurrency: "unbounded" });
          const evidenceReplay = yield* producer.issueRegistrationEvidence(
            request,
            preparation,
            definition,
          );
          const contradictoryIssue = yield* Effect.exit(
            producer.issueRegistrationEvidence(
              request,
              preparation,
              registrationDefinition(),
            ),
          );
          const candidate = yield* Effect.fromResult(
            producer.claimRegistrationCandidate(definition, evidence),
          );
          const clonedAuthority = producer.claimRegistrationCandidate(
            definition,
            Object.freeze({ ...evidence }),
          );
          const wrongDefinition = producer.claimRegistrationCandidate(
            registrationDefinition(),
            evidence,
          );
          candidate.deploymentAnalysisSha256.fill(0);
          const isolatedCandidate = yield* Effect.fromResult(
            producer.claimRegistrationCandidate(definition, evidence),
          );
          const produceForPreparation = (
            ownedRequest: Request,
            ownedPreparation: unknown,
            candidateByte: number,
          ) =>
            Effect.gen(function* () {
              const ownedLineage = Object.freeze({
                attemptSha256: digest(candidateByte + 1),
                candidateSha256: digest(candidateByte),
                commandKind: "registration_page" as const,
                sequence: 1n,
                currentProgressSha256: digest(3),
                predecessorReceiptSha256: null,
              });
              const ownedReservation = yield* producer.bindReservation(
                ownedRequest,
                ownedPreparation,
                ownedLineage,
              );
              const ownedClaim = yield* Effect.fromResult(
                producer.claimPreparedReservation(
                  ownedReservation,
                  ownedLineage,
                ),
              );
              return yield* producer.producePrepared(
                ownedRequest,
                ownedPreparation,
                Object.freeze({
                  kind: "command_reservation" as const,
                  ...ownedLineage,
                  ...ownedClaim.commitments,
                }),
              );
            });
          const foreignPreparation = yield* producer.prepare(
            request,
            PROOF_INPUT,
            {
              readSession: fullInput.readSession,
              commandBudget: fullInput.commandBudget,
              transportBudget: fullInput.transportBudget,
              selection,
            },
          );
          const foreignResult = yield* produceForPreparation(
            request,
            foreignPreparation,
            0x71,
          );
          const otherRequest = new Request(
            "https://producer.test/registration-evidence-other",
          );
          const otherPreparation = yield* producer.prepare(
            otherRequest,
            PROOF_INPUT,
            {
              readSession: fullInput.readSession,
              commandBudget: fullInput.commandBudget,
              transportBudget: fullInput.transportBudget,
              selection,
            },
          );
          const otherResult = yield* produceForPreparation(
            otherRequest,
            otherPreparation,
            0x73,
          );
          const registrationPreparation = Object.freeze({});
          const crossPreparation = producer.bindRegistrationEvidence(
            evidence,
            request,
            foreignResult,
            registrationPreparation,
          );
          const crossRequest = producer.bindRegistrationEvidence(
            evidence,
            otherRequest,
            otherResult,
            registrationPreparation,
          );
          const lineage = Object.freeze({
            attemptSha256: digest(1),
            candidateSha256: digest(2),
            commandKind: "registration_page" as const,
            sequence: 1n,
            currentProgressSha256: digest(3),
            predecessorReceiptSha256: null,
          });
          const prepared = yield* producer.bindReservation(
            request,
            preparation,
            lineage,
          );
          const claim = yield* Effect.fromResult(
            producer.claimPreparedReservation(prepared, lineage),
          );
          const commandResult = yield* producer.producePrepared(
            request,
            preparation,
            Object.freeze({
              kind: "command_reservation" as const,
              ...lineage,
              ...claim.commitments,
            }),
          );
          yield* Effect.fromResult(producer.bindRegistrationEvidence(
            evidence,
            request,
            commandResult,
            registrationPreparation,
          ));
          const command = yield* Effect.fromResult(
            producer.claimRegistrationCommand(
              registrationPreparation,
              evidence,
            ),
          );
          command.reservationSha256.fill(0);
          const isolatedCommand = yield* Effect.fromResult(
            producer.claimRegistrationCommand(
              registrationPreparation,
              evidence,
            ),
          );
          const wrongContext = producer.claimRegistrationCommand(
            Object.freeze({}),
            evidence,
          );
          const replay = producer.bindRegistrationEvidence(
            evidence,
            request,
            commandResult,
            registrationPreparation,
          );
          const contradiction = producer.bindRegistrationEvidence(
            evidence,
            request,
            commandResult,
            Object.freeze({}),
          );
          return {
            candidate: isolatedCandidate,
            clonedAuthority,
            command: isolatedCommand,
            contradiction,
            contradictoryIssue,
            concurrentEvidenceIsSame: concurrentEvidence === evidence,
            crossPreparation,
            crossRequest,
            evidenceReplayIsSame: evidenceReplay === evidence,
            replay,
            wrongContext,
            wrongDefinition,
          };
      }),
      fixture.hash,
    )));
    expect(result.candidate).toMatchObject({
      deploymentAnalysisCodecIdentity:
        DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1,
      deploymentCodegenAnalysisCodecIdentity:
        DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1,
      semanticByteLength:
        definition.artifactIngressPlan.semantic.bytes.byteLength,
      sourceModules: [{
        ordinal: 0,
        artifactModulePath: module.path,
        roles: module.roles,
        sourceByteLength: module.sourceBytes.byteLength,
      }],
    });
    expect(result.candidate.deploymentAnalysisSha256)
      .not.toEqual(new Uint8Array(32));
    expect(result.candidate.deploymentCodegenAnalysisSha256)
      .not.toEqual(result.candidate.deploymentAnalysisSha256);
    expect(Buffer.from(result.candidate.deploymentAnalysisSha256)
      .toString("hex")).toBe(
        "20958028bd8430b3dd1ba3f55e465af513922c33f9d829459131ae102dc9ea29",
      );
    expect(Buffer.from(result.candidate.deploymentCodegenAnalysisSha256)
      .toString("hex")).toBe(
        "f5eaa7dad8060db8f331286fa62d247e1a781a1238e9a2c7f1ae9bdc1913e787",
      );
    expect(result.command).toMatchObject({
      commandKind: "registration_page",
      sequence: 1n,
    });
    expect(result.command.reservationSha256).not.toEqual(new Uint8Array(32));
    expect(result.evidenceReplayIsSame).toBe(true);
    expect(result.concurrentEvidenceIsSame).toBe(true);
    expect(result.crossPreparation).toMatchObject({
      failure: { reason: "contentMismatch", path: "result.preparation" },
    });
    expect(result.crossRequest).toMatchObject({
      failure: { reason: "contentMismatch", path: "result.preparation" },
    });
    expect(failure(result.contradictoryIssue)).toMatchObject({
      reason: "contentMismatch",
      path: "definition",
    });
    expect(result.clonedAuthority).toMatchObject({
      failure: { reason: "invalidAuthority" },
    });
    expect(result.wrongDefinition).toMatchObject({
      failure: { reason: "contentMismatch", path: "definition" },
    });
    expect(result.wrongContext).toMatchObject({
      failure: {
        reason: "contentMismatch",
        path: "registrationPreparation",
      },
    });
    expect(Result.isSuccess(result.replay)).toBe(true);
    expect(result.contradiction).toMatchObject({
      failure: { reason: "contentMismatch", path: "registrationCommand" },
    });
    expect(fixture.reads).toEqual([
      "semantic:0",
      "semantic:0",
      "semantic:0",
      "semantic:0",
    ]);
  });

  it("pins registration identity vectors across cold reconstruction and source perturbation", async () => {
    const definition = registrationDefinition();
    const coldFirst = await issueRegistrationCandidate(definition);
    const coldSecond = await issueRegistrationCandidate(definition);
    const changedDefinition = registrationDefinition(
      "export function ready() { return 2; }\n",
    );
    const changed = await issueRegistrationCandidate(
      changedDefinition,
      digest(0x6b),
    );

    expect(coldSecond).toEqual(coldFirst);
    expect(coldFirst.deploymentAnalysisCodecIdentity).toBe(
      "flarex.backend/standard-application-deployment-analysis/canonical-json-v1",
    );
    expect(coldFirst.deploymentCodegenAnalysisCodecIdentity).toBe(
      "flarex.backend/standard-application-deployment-codegen-analysis/canonical-json-v1",
    );
    expect(changed.deploymentAnalysisSha256)
      .not.toEqual(coldFirst.deploymentAnalysisSha256);
    expect(changed.deploymentCodegenAnalysisSha256)
      .not.toEqual(coldFirst.deploymentCodegenAnalysisSha256);
    expect(changed.sourceModules[0]?.sourceSha256)
      .not.toEqual(coldFirst.sourceModules[0]?.sourceSha256);
  });

  it("interrupts registration evidence derivation and closes its scoped read session", async () => {
    const definition = registrationDefinition();
    const module = definition.artifactIngressPlan.source.modules[0];
    if (module === undefined) throw new Error("Expected one materialized module.");
    const fixture = makeFixture({
      source: module.sourceBytes,
      semantic: definition.artifactIngressPlan.semantic.bytes,
      pathText: module.path,
      roles: module.roles,
      liveSha256: true,
    });
    let blockEvidenceHash = false;
    let enteredHash: (() => void) | undefined;
    const entered = new Promise<void>(resolve => {
      enteredHash = resolve;
    });
    const request = new Request(
      "https://producer.test/registration-evidence-interrupted",
    );
    const selection = Object.freeze({
      kind: "registration_page",
    }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
    const input = producerInput(selection, transportBudget, 1);
    const fiber = Effect.runFork(Effect.scoped(withProducer(
      fixture,
      producer =>
        Effect.gen(function* () {
          const preparation = yield* producer.prepare(
            request,
            PROOF_INPUT,
            {
              readSession: input.readSession,
              commandBudget: input.commandBudget,
              transportBudget: input.transportBudget,
              selection,
            },
          );
          blockEvidenceHash = true;
          return yield* producer.issueRegistrationEvidence(
            request,
            preparation,
            definition,
          );
        }),
      bytes => {
        if (!blockEvidenceHash) return Effect.succeed(sha256Bytes(bytes));
        enteredHash?.();
        return Effect.never;
      },
    )));
    await entered;
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("expected interruption");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(fixture.order.filter(entry => entry === "close")).toHaveLength(1);
  });
});

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

function registrationDefinition(
  sourceText = "export function ready() { return 1; }\n",
): PreparedStandardApplicationDefinitionV1 {
  const source = encoder.encode(sourceText);
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 64,
      maximumValidatorDepth: 16,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "functions/main",
        functions: [{
          exportName: "ready",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 32_768,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_192,
      maximumSemanticStreamBytes: 32_768,
    },
    graphInput: {
      modules: [{
        path: "functions/main.js",
        roles: ["function", "execution"],
        sourceBytes: source,
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "functions/main",
        artifactModulePath: "functions/main.js",
      }],
      executionPath: "functions/main.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

async function issueRegistrationCandidate(
  definition: PreparedStandardApplicationDefinitionV1,
  sourceRootSha256 = digest(11),
) {
  const module = definition.artifactIngressPlan.source.modules[0];
  if (module === undefined) throw new Error("Expected one materialized module.");
  const fixture = makeFixture({
    source: module.sourceBytes,
    semantic: definition.artifactIngressPlan.semantic.bytes,
    pathText: module.path,
    roles: module.roles,
    liveSha256: true,
    sourceRootSha256,
  });
  const request = new Request("https://producer.test/registration-cold");
  const selection = Object.freeze({
    kind: "registration_page",
  }) satisfies DeclarativeV2AuthenticatedCommandSelectionV1;
  const input = producerInput(selection, transportBudget, 1);
  return Effect.runPromise(Effect.scoped(withProducer(
    fixture,
    producer =>
      Effect.gen(function* () {
        const preparation = yield* producer.prepare(
          request,
          PROOF_INPUT,
          {
            readSession: input.readSession,
            commandBudget: input.commandBudget,
            transportBudget: input.transportBudget,
            selection,
          },
        );
        const evidence = yield* producer.issueRegistrationEvidence(
          request,
          preparation,
          definition,
        );
        return yield* Effect.fromResult(
          producer.claimRegistrationCandidate(definition, evidence),
        );
      }),
    fixture.hash,
  )));
}

function withProducer<A, E, R>(
  fixture: Fixture,
  use: (
    producer: DeclarativeV2AuthenticatedCommandProducerApiV1,
  ) => Effect.Effect<A, E, R>,
  sha256 = fixture.hash,
): Effect.Effect<A, E, R> {
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
      DeclarativeV2AuthenticatedCommandSha256V1.of({ sha256 }),
    )),
  );

  return DeclarativeV2AuthenticatedCommandProducerV1.pipe(
    Effect.flatMap(use),
    Effect.provide(layer),
  );
}

async function produceOwned(
  fixture: Fixture,
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  budget: DeclarativeV2AuthenticatedCommandTransportBudgetV1,
  sequence: number,
  readSize = 65_536,
) {
  const request = new Request(`https://producer.test/${sequence}`);
  return Effect.runPromise(Effect.scoped(
    withProducer(
      fixture,
      producer =>
        Effect.gen(function* () {
          const result = yield* producer.produce(
            request,
            PROOF_INPUT,
            producerInput(selection, budget, sequence),
          );
          const receipt = Result.getOrThrow(
            producer.receipt(request, result),
          );
          const cursor = Result.getOrThrow(producer.cursor(request, result));
          const chunks: Uint8Array[] = [];
          for (let iteration = 0; iteration < 1_024; iteration += 1) {
            const read = Result.getOrThrow(
              producer.read(request, cursor, readSize),
            );
            chunks.push(read.bytes);
            if (read.status === "complete") {
              return Object.freeze({ receipt, bytes: join(chunks) });
            }
          }
          throw new Error("test-only output iteration ceiling exceeded");
        }),
    ),
  ));
}

function producerInput(
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  budget: DeclarativeV2AuthenticatedCommandTransportBudgetV1,
  sequence: number,
): DeclarativeV2AuthenticatedCommandProducerInputV1 {
  const budgetFrame = commandBudget();
  return Object.freeze({
    readSession: readSessionInput(budgetFrame),
    reservation: reservation(selection.kind, BigInt(sequence)),
    commandBudget: budgetFrame,
    transportBudget: budget,
    selection,
  });
}

function readSessionInput(
  command: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  },
) {
  return Object.freeze({
    command: Object.freeze({
      semanticUploadId: "semantic-upload",
      deploymentId: "deployment",
      expectedGeneration: 3,
      expectedMutationFence: 4,
      commandId: "authenticated-command",
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
      ceilings: budgetFrame("attempt_ceilings", 10_000_000n),
      usage: budgetFrame("attempt_usage", 0n),
      command,
    }),
  });
}

function reservation(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  sequence: bigint,
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return Object.freeze({
    kind: "command_reservation",
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    commandKind,
    sequence,
    currentProgressSha256: digest(3),
    predecessorReceiptSha256: sequence === 1n ? null : digest(4),
    commandBudgetSha256: digest(HASH_BYTE),
    commandInputSha256: digest(HASH_BYTE),
    freshAuthenticatedInputSha256: digest(HASH_BYTE),
    analyzerIdentitySha256: digest(HASH_BYTE),
    verifierIdentitySha256: digest(HASH_BYTE),
    rangeAndPredecessorTailsSha256: digest(HASH_BYTE),
  });
}

function commandBudget(): DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "command_budget";
} {
  const frame: Record<string, bigint | string> = { kind: "command_budget" };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    frame[dimension] = 10_000_000n;
  }
  return Object.freeze(frame) as unknown as
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" };
}

function usageBudget(): DeclarativeV2VerifierBudgetFrameV2 {
  return budgetFrame("attempt_usage", 0n);
}

function budgetFrame(
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

function makeFixture(options: Readonly<{
  readonly moduleCount?: number;
  readonly pathText?: string;
  readonly source?: Uint8Array;
  readonly semantic?: Uint8Array;
  readonly roles?: number;
  readonly liveSha256?: boolean;
  readonly sourceRootSha256?: Uint8Array;
  readonly rootConfiguration?: typeof REGISTRATION_ROOT_CONFIGURATION;
  readonly reportedSourceByteLength?: number;
  readonly reportedSemanticByteLength?: number;
}> = {}): Fixture {
  const order: string[] = [];
  const reads: string[] = [];
  const source =
    options.source ?? encoder.encode("export function ready() { return 1; }");
  const semantic = options.semantic ?? encoder.encode(
    '{"kind":"handler","modulePath":"functions/main.js","exportName":"ready"}\n',
  );
  const moduleCount = options.moduleCount ?? 1;
  const pathText = options.pathText ?? "functions/main.js";
  const path = modulePath(pathText);
  const modules: FixtureModule[] = Array.from({ length: moduleCount }, () =>
    Object.freeze({
      path,
      pathText,
      source,
      reportedSourceByteLength:
        options.reportedSourceByteLength ?? source.byteLength,
    })
  );
  const proof = Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof;
  const proofs = Object.freeze({
    issue: (
      _request: Request,
      _input: SemanticArtifactV1FinalizedSourceProofInput,
    ) => {
      order.push("issue");
      return Effect.succeed(proof);
    },
  });
  const session = Object.freeze({}) as DeclarativeV2AuthenticatedReadSessionV1;
  const moduleHandles = modules.map(() =>
    Object.freeze({}) as DeclarativeV2AuthenticatedModuleV1
  );
  const modulesByHandle = new WeakMap<object, number>();
  moduleHandles.forEach((handle, ordinal) => modulesByHandle.set(handle, ordinal));
  const cursors = new WeakMap<object, {
    readonly label: string;
    readonly bytes: Uint8Array;
    offset: number;
  }>();
  let readCalls = 0n;
  let readBytes = 0n;
  const receipt = () => makeReceipt(
    moduleCount,
    options.reportedSemanticByteLength ?? semantic.byteLength,
    readCalls,
    readBytes,
    options.sourceRootSha256,
    options.rootConfiguration,
  );
  const sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1 =
    Object.freeze({
      open: (
        _request: Request,
        receivedProof: SemanticArtifactV1FinalizedSourceProof,
      ) => {
        order.push("open");
        return receivedProof === proof
          ? Effect.succeed(session)
          : Effect.fail(accessError("open", "invalidAuthority"));
      },
      receipt: () => {
        order.push("receipt");
        return Result.succeed(receipt());
      },
      moduleCount: () => Result.succeed(moduleCount),
      moduleAt: (_request: Request, _session: unknown, ordinal: unknown) =>
        typeof ordinal === "number" && moduleHandles[ordinal] !== undefined
          ? Result.succeed(moduleHandles[ordinal])
          : Result.fail(accessError("module", "invalidInput")),
      moduleView: (_request: Request, module: unknown) => {
        const ordinal = module !== null && typeof module === "object"
          ? modulesByHandle.get(module)
          : undefined;
        if (ordinal === undefined) {
          return Result.fail(accessError("module", "invalidAuthority"));
        }
        const value = modules[ordinal]!;
        return Result.succeed(Object.freeze({
          ordinal,
          roles: options.roles ?? 1,
          frameSha256: digest(10 + (ordinal % 20)),
          sourceSha256: options.liveSha256
            ? sha256Bytes(value.source)
            : digest(40 + (ordinal % 20)),
          sourceByteLength: value.reportedSourceByteLength,
          path: value.path,
        }));
      },
      sourceCursor: (_request: Request, module: unknown) => {
        const ordinal = module !== null && typeof module === "object"
          ? modulesByHandle.get(module)
          : undefined;
        if (ordinal === undefined) {
          return Result.fail(accessError("cursor", "invalidAuthority"));
        }
        const handle =
          Object.freeze({}) as DeclarativeV2AuthenticatedByteCursorV1;
        cursors.set(handle, {
          label: `source:${ordinal}`,
          bytes: modules[ordinal]!.source,
          offset: 0,
        });
        return Result.succeed(handle);
      },
      semanticCursor: () => {
        const handle =
          Object.freeze({}) as DeclarativeV2AuthenticatedByteCursorV1;
        cursors.set(handle, { label: "semantic:0", bytes: semantic, offset: 0 });
        return Result.succeed(handle);
      },
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
          return Result.fail(accessError("read", "invalidInput"));
        }
        reads.push(state.label);
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
      close: () => {
        order.push("close");
        return Result.succeed(undefined);
      },
    });
  return Object.freeze({
    order,
    reads,
    proofs,
    sessions,
    hash: (bytes: Uint8Array) => {
      order.push("hash");
      return Effect.succeed(
        options.liveSha256 ? sha256Bytes(bytes) : digest(HASH_BYTE),
      );
    },
  });
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function makeReceipt(
  moduleCount: number,
  semanticByteLength: number,
  readCalls: bigint,
  readBytes: bigint,
  sourceRootSha256 = digest(11),
  rootConfiguration = REGISTRATION_ROOT_CONFIGURATION,
): DeclarativeV2AuthenticatedReadSessionReceiptV1 {
  const usage = budgetFrame("attempt_usage", 0n, {
    calls: readCalls,
    outputBytes: readBytes,
  });
  return Object.freeze({
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-26T00:00:00.000Z",
    sourceUploadId: "source-upload",
    sourceGeneration: 1,
    sourceMutationFence: 2,
    sourceRootSha256,
    sourceSelectorSha256: digest(12),
    semanticUploadId: "semantic-upload",
    semanticGeneration: 3,
    semanticMutationFence: 4,
    semanticRootSha256: digest(13),
    semanticSelectorSha256: digest(14),
    semanticAttemptIdentitySha256: digest(15),
    rootConfiguration,
    moduleCount,
    semanticByteLength,
    budget: Object.freeze({ usage, commandUsage: usage }),
  });
}

function modulePath(text: string): DeclarativeV2ArtifactModulePathHandleV1 {
  const bytes = encoder.encode(text);
  const validator = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      bytes.byteLength + 4,
      bytes.byteLength,
      bytes.byteLength,
    ),
  );
  let offset = 0;
  while (offset < bytes.byteLength) {
    const length = Math.min(1_024, bytes.byteLength - offset);
    Result.getOrThrow(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
        validator,
        bytes.subarray(offset, offset + length),
        length,
      ),
    );
    offset += length;
  }
  const result = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(validator, 4),
  );
  if ("status" in result) throw new Error("module path did not settle");
  return result;
}

function decode(
  bytes: Uint8Array,
  budget: DeclarativeV2AuthenticatedCommandTransportBudgetV1,
): DeclarativeV2AuthenticatedCommandEncodedRequestV1 {
  return Result.getOrThrow(
    decodeDeclarativeV2AuthenticatedCommandRequestV1(bytes, budget),
  );
}

function failure(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) throw new Error("expected failure");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error("expected typed failure");
  return error.value;
}

function accessError(
  operation: DeclarativeV2AuthenticatedReadSessionInputError["operation"],
  reason: DeclarativeV2AuthenticatedReadSessionInputError["reason"],
): DeclarativeV2AuthenticatedReadSessionInputError {
  return new DeclarativeV2AuthenticatedReadSessionInputError({
    operation,
    reason,
  });
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
