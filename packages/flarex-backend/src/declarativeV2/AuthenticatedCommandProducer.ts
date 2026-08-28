import {
  capturePrivateAnalyzerReleaseTupleV1,
  installedPrivateAnalyzerReleaseTupleV1,
  type PrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/system-test/private-analyzer-release-v1";
import {
  installedPrivateAnalyzerVerifierIdentitiesV1,
} from "@flarex/analysis/internal/system-test/private-analyzer-verification-v1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "@flarex/analysis/internal/system-test/declarative-v2-verifier-v1";
import {
  captureDeclarativeV2AuthenticatedCommandTransportBudgetV1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1,
  encodeDeclarativeV2AuthenticatedCommandRequestV1,
  type DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  type DeclarativeV2AuthenticatedCommandFrameV1,
  type DeclarativeV2AuthenticatedCommandTransportBudgetV1,
  type DeclarativeV2AuthenticatedCommandTransportUsageV1,
  type DeclarativeV2AuthenticatedCommandV1Error,
} from "@flarex/executor-http/internal/system-test/declarative-v2-authenticated-command-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import {
  Context,
  Data,
  Effect,
  Layer,
  Result,
  Scope,
  Semaphore,
} from "effect";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierProgressV2Error,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

import type {
  DeclarativeV2AuthenticatedReadSessionFactoryV1,
  DeclarativeV2AuthenticatedReadSessionOpenError,
  DeclarativeV2AuthenticatedReadSessionReceiptV1,
} from "./AuthenticatedVerifierReadSession";
import type {
  SemanticArtifactV1RootConfiguration,
} from "../semanticArtifactV1/RootConfiguration";
import type {
  SemanticArtifactV1FinalizedSourceProofFactory,
  SemanticArtifactV1FinalizedSourceProofInput,
  SemanticArtifactV1FinalizedSourceProofIssueError,
} from "../semanticArtifactV1/FinalizedSourceProof";

const RESULT_MARKER = Symbol("DeclarativeV2AuthenticatedCommandResultV1");
const PREPARATION_MARKER =
  Symbol("DeclarativeV2AuthenticatedCommandPreparationV1");
const PREPARED_RESERVATION_MARKER =
  Symbol("DeclarativeV2AuthenticatedCommandPreparedReservationV1");
const CURSOR_MARKER = Symbol("DeclarativeV2AuthenticatedCommandCursorV1");
const SHA256_BYTES = 32;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 9_223_372_036_854_775_807n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PROGRESS_FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 65_536,
  maximumCanonicalBytes: 65_536,
});
const UTF8_ENCODER = new TextEncoder();
const REQUEST_PREFIX_BYTES =
  4 +
  UTF8_ENCODER.encode(
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1,
  ).byteLength +
  4 +
  4;

const FRESH_INPUT_DOMAIN =
  "flarex.backend/declarative-v2-authenticated-command/fresh-input/v1";
const COMMAND_INPUT_DOMAIN =
  "flarex.backend/declarative-v2-authenticated-command/command-input/v1";
const RANGE_DOMAIN =
  "flarex.backend/declarative-v2-authenticated-command/range-lineage/v1";
const ANALYZER_IDENTITY_DOMAIN =
  "flarex.backend/declarative-v2-authenticated-command/analyzer-identity/v1";
const VERIFIER_IDENTITY_DOMAIN =
  "flarex.backend/declarative-v2-authenticated-command/verifier-identity/v1";
export const DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1 =
  "flarex.backend/standard-application-deployment-analysis/canonical-json-v1";
export const DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1 =
  "flarex.backend/standard-application-deployment-codegen-analysis/canonical-json-v1";
const DEPLOYMENT_ANALYSIS_FORMAT_V1 =
  "flarex.standard-application-deployment-analysis";
const DEPLOYMENT_CODEGEN_ANALYSIS_FORMAT_V1 =
  "flarex.standard-application-deployment-codegen-analysis";

type Operation =
  | "prepare"
  | "commitments"
  | "bindReservation"
  | "claimReservation"
  | "produce"
  | "receipt"
  | "cursor"
  | "read"
  | "close"
  | "issueRegistrationEvidence"
  | "bindRegistrationEvidence"
  | "claimRegistrationCandidate"
  | "claimRegistrationCommand";
type Commitment =
  | "commandBudgetSha256"
  | "commandInputSha256"
  | "freshAuthenticatedInputSha256"
  | "analyzerIdentitySha256"
  | "verifierIdentitySha256"
  | "rangeAndPredecessorTailsSha256";

export interface DeclarativeV2AuthenticatedCommandResultV1 {
  readonly [RESULT_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedCommandPreparationV1 {
  readonly [PREPARATION_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedCommandPreparedReservationV1 {
  readonly [PREPARED_RESERVATION_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedRegistrationEvidenceV1 {
  readonly _tag: "DeclarativeV2AuthenticatedRegistrationEvidenceV1";
}

export interface DeclarativeV2AuthenticatedRegistrationSourceModuleV1 {
  readonly ordinal: number;
  readonly artifactModulePath: string;
  readonly roles: number;
  readonly sourceByteLength: number;
  readonly sourceSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedRegistrationCandidateV1 {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly sourceModules:
    ReadonlyArray<DeclarativeV2AuthenticatedRegistrationSourceModuleV1>;
  readonly semanticByteLength: number;
  readonly semanticStreamSha256: Uint8Array;
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly deploymentAnalysisCodecIdentity:
    typeof DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1;
  readonly deploymentAnalysisByteLength: bigint;
  readonly deploymentAnalysisSha256: Uint8Array;
  readonly deploymentCodegenAnalysisCodecIdentity:
    typeof DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1;
  readonly deploymentCodegenAnalysisByteLength: bigint;
  readonly deploymentCodegenAnalysisSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedRegistrationCommandV1 {
  readonly commandKind: "registration_page";
  readonly sequence: bigint;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly requestSha256: Uint8Array;
  readonly canonicalByteLength: number;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandPreparationInputV1 {
  readonly readSession: unknown;
  readonly commandBudget: unknown;
  readonly transportBudget: unknown;
  readonly selection: unknown;
}

export interface DeclarativeV2AuthenticatedCommandStableCommitmentsV1 {
  readonly commandBudgetSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

/**
 * Process-local projection of persistence-owned reservation lineage. This is
 * not a wire contract and carries no authority by itself; persistence must
 * revalidate it against the opaque proposal before reserving work.
 */
export interface DeclarativeV2AuthenticatedCommandReservationLineageV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorReceiptSha256: Uint8Array | null;
}

export interface DeclarativeV2AuthenticatedCommandReservationCommitmentsV1
  extends DeclarativeV2AuthenticatedCommandStableCommitmentsV1 {
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1 {
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commitments:
    DeclarativeV2AuthenticatedCommandReservationCommitmentsV1;
}

export interface DeclarativeV2AuthenticatedCommandCursorV1 {
  readonly [CURSOR_MARKER]: true;
}

export type DeclarativeV2AuthenticatedCommandSelectionV1 =
  | Readonly<{
    readonly kind: "source_page";
    readonly firstModuleOrdinal: bigint;
    readonly moduleCount: bigint;
  }>
  | Readonly<{
    readonly kind: "parse_module";
    readonly moduleOrdinal: bigint;
  }>
  | Readonly<{ readonly kind: "registration_page" }>
  | Readonly<{ readonly kind: "link_page" }>;

export interface DeclarativeV2AuthenticatedCommandProducerInputV1 {
  readonly readSession: unknown;
  readonly reservation: unknown;
  readonly commandBudget: unknown;
  readonly transportBudget: unknown;
  readonly selection: unknown;
}

export interface DeclarativeV2AuthenticatedCommandProducerReceiptV1 {
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly requestSha256: Uint8Array;
  readonly canonicalByteLength: number;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly contentRead:
    DeclarativeV2AuthenticatedReadSessionReceiptV1["budget"];
  readonly transport: DeclarativeV2AuthenticatedCommandTransportUsageV1;
}

export interface DeclarativeV2AuthenticatedCommandReadV1 {
  readonly status: "pending" | "complete";
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export class DeclarativeV2AuthenticatedCommandProducerV1Error
  extends Data.TaggedError("DeclarativeV2AuthenticatedCommandProducerV1Error")<{
    readonly operation: Operation;
    readonly reason:
      | "invalidInput"
      | "invalidAuthority"
      | "wrongRequest"
      | "closed"
      | "cursorAlreadyIssued"
      | "commitmentMismatch"
      | "budgetExceeded"
      | "contentMismatch";
    readonly path?: string;
    readonly commitment?: Commitment;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }> {}

export type DeclarativeV2AuthenticatedCommandProducerOpenErrorV1 =
  | SemanticArtifactV1FinalizedSourceProofIssueError
  | DeclarativeV2AuthenticatedReadSessionOpenError
  | DeclarativeV2AuthenticatedCommandProducerV1Error
  | DeclarativeV2VerifierProgressV2Error
  | DeclarativeV2AuthenticatedCommandV1Error;

export interface DeclarativeV2AuthenticatedCommandProducerApiV1 {
  readonly prepare: (
    request: Request,
    proofInput: SemanticArtifactV1FinalizedSourceProofInput,
    input: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandPreparationV1,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    Scope.Scope
  >;
  readonly commitments: (
    request: Request,
    preparation: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandStableCommitmentsV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly bindReservation: (
    request: Request,
    preparation: unknown,
    lineage: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandPreparedReservationV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error,
    never
  >;
  readonly claimPreparedReservation: (
    authority: unknown,
    lineage: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandPreparedReservationClaimV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly producePrepared: (
    request: Request,
    preparation: unknown,
    reservation: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandResultV1,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    never
  >;
  readonly produce: (
    request: Request,
    proofInput: SemanticArtifactV1FinalizedSourceProofInput,
    input: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedCommandResultV1,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    Scope.Scope
  >;
  readonly receipt: (
    request: Request,
    result: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandProducerReceiptV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly cursor: (
    request: Request,
    result: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandCursorV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly read: (
    request: Request,
    cursor: unknown,
    maximumBytes: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandReadV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly close: (
    request: Request,
    result: unknown,
  ) => Result.Result<
    void,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly issueRegistrationEvidence: (
    request: Request,
    preparation: unknown,
    definition: PreparedStandardApplicationDefinitionV1,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedRegistrationEvidenceV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error,
    never
  >;
  readonly bindRegistrationEvidence: (
    evidence: unknown,
    request: Request,
    result: unknown,
    registrationPreparation: object,
  ) => Result.Result<
    DeclarativeV2AuthenticatedRegistrationEvidenceV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly claimRegistrationCandidate: (
    definition: PreparedStandardApplicationDefinitionV1,
    evidence: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedRegistrationCandidateV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly claimRegistrationCommand: (
    registrationPreparation: object,
    evidence: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedRegistrationCommandV1,
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
}

export class DeclarativeV2AuthenticatedCommandProofIssuerV1
  extends Context.Service<
    DeclarativeV2AuthenticatedCommandProofIssuerV1,
    Pick<SemanticArtifactV1FinalizedSourceProofFactory, "issue">
  >()(
    "flarex-backend/declarativeV2/DeclarativeV2AuthenticatedCommandProofIssuerV1",
  ) {}

export class DeclarativeV2AuthenticatedCommandReadSessionsV1
  extends Context.Service<
    DeclarativeV2AuthenticatedCommandReadSessionsV1,
    DeclarativeV2AuthenticatedReadSessionFactoryV1
  >()(
    "flarex-backend/declarativeV2/DeclarativeV2AuthenticatedCommandReadSessionsV1",
  ) {}

export interface DeclarativeV2AuthenticatedCommandSha256ApiV1 {
  readonly sha256: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, never, never>;
}

export class DeclarativeV2AuthenticatedCommandSha256V1
  extends Context.Service<
    DeclarativeV2AuthenticatedCommandSha256V1,
    DeclarativeV2AuthenticatedCommandSha256ApiV1
  >()(
    "flarex-backend/declarativeV2/DeclarativeV2AuthenticatedCommandSha256V1",
  ) {}

export class DeclarativeV2AuthenticatedCommandProducerV1
  extends Context.Service<
    DeclarativeV2AuthenticatedCommandProducerV1,
    DeclarativeV2AuthenticatedCommandProducerApiV1
  >()(
    "flarex-backend/declarativeV2/DeclarativeV2AuthenticatedCommandProducerV1",
  ) {}

export interface DeclarativeV2AuthenticatedCommandProducerLayerOptionsV1 {
  readonly expectedAnalyzerRelease?: PrivateAnalyzerReleaseTupleV1;
}

export function makeDeclarativeV2AuthenticatedCommandProducerLayerV1(
  options: DeclarativeV2AuthenticatedCommandProducerLayerOptionsV1 = {},
) {
  return Layer.effect(
    DeclarativeV2AuthenticatedCommandProducerV1,
    Effect.gen(function* () {
      const proofs = yield* DeclarativeV2AuthenticatedCommandProofIssuerV1;
      const sessions =
        yield* DeclarativeV2AuthenticatedCommandReadSessionsV1;
      const sha256 = yield* DeclarativeV2AuthenticatedCommandSha256V1;

      return DeclarativeV2AuthenticatedCommandProducerV1.of(
        makeDeclarativeV2AuthenticatedCommandProducerV1({
          proofs,
          sessions,
          sha256: sha256.sha256,
          ...(options.expectedAnalyzerRelease === undefined
            ? {}
            : { expectedAnalyzerRelease: options.expectedAnalyzerRelease }),
        }),
      );
    }),
  );
}

interface CapturedInput {
  readonly readSession: unknown;
  readonly reservation: unknown;
  readonly commandBudget: unknown;
  readonly transportBudget:
    Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>;
  readonly selection: DeclarativeV2AuthenticatedCommandSelectionV1;
}

interface CapturedReadSession {
  readonly input: unknown;
  readonly commandBudget: CommandBudgetFrame;
}

interface ModuleMetadata {
  readonly ordinal: number;
  readonly roles: number;
  readonly frameSha256: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: number;
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
  readonly pathByteLength: number;
}

interface OwnedModuleMetadata extends ModuleMetadata {
  readonly pathBytes: Uint8Array;
}

interface ResultState {
  readonly request: Request;
  readonly preparation: PreparationState;
  readonly canonicalBytes: Uint8Array;
  readonly receipt: DeclarativeV2AuthenticatedCommandProducerReceiptV1;
  cursor: object | undefined;
  closed: boolean;
}

interface PreparationState {
  readonly request: Request;
  readonly session: unknown;
  readonly receipt: DeclarativeV2AuthenticatedReadSessionReceiptV1;
  readonly modules: readonly OwnedModuleMetadata[];
  readonly commandBudget: CommandBudgetFrame;
  readonly commandBudgetBytes: Uint8Array;
  readonly transportBudget:
    Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>;
  readonly selection: DeclarativeV2AuthenticatedCommandSelectionV1;
  readonly stable:
    DeclarativeV2AuthenticatedCommandStableCommitmentsV1;
  readonly productionGate: ReturnType<typeof Semaphore.makeUnsafe>;
  result: DeclarativeV2AuthenticatedCommandResultV1 | undefined;
  reservationBytes: Uint8Array | undefined;
  registrationEvidence:
    DeclarativeV2AuthenticatedRegistrationEvidenceV1 | undefined;
  closed: boolean;
}

interface RegistrationEvidenceState {
  readonly handle: DeclarativeV2AuthenticatedRegistrationEvidenceV1;
  readonly preparation: PreparationState;
  readonly definition: PreparedStandardApplicationDefinitionV1;
  readonly candidate: DeclarativeV2AuthenticatedRegistrationCandidateV1;
  command:
    | Readonly<{
      readonly registrationPreparation: object;
      readonly receipt: DeclarativeV2AuthenticatedRegistrationCommandV1;
    }>
    | undefined;
}

interface PreparedReservationState {
  readonly preparation: PreparationState;
  readonly lineage: DeclarativeV2AuthenticatedCommandReservationLineageV1;
  readonly commitments:
    DeclarativeV2AuthenticatedCommandReservationCommitmentsV1;
  claimed: boolean;
}

interface CursorState {
  readonly request: Request;
  readonly result: object;
  offset: number;
  closed: boolean;
}

interface PreflightUsage {
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly payloadBytes: number;
  readonly frames: number;
  readonly transitions: number;
}

interface EncodedProgress {
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly reservationBytes: Uint8Array;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commandBudgetBytes: Uint8Array;
}

type CommandBudgetFrame = DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "command_budget";
};

const producerError = (
  operation: Operation,
  reason: DeclarativeV2AuthenticatedCommandProducerV1Error["reason"],
  evidence?: Readonly<{
    readonly path?: string;
    readonly commitment?: Commitment;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }>,
): DeclarativeV2AuthenticatedCommandProducerV1Error =>
  new DeclarativeV2AuthenticatedCommandProducerV1Error({
    operation,
    reason,
    ...(evidence?.path === undefined ? {} : { path: evidence.path }),
    ...(evidence?.commitment === undefined
      ? {}
      : { commitment: evidence.commitment }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });

function makeDeclarativeV2AuthenticatedCommandProducerV1(
  options: Readonly<{
    readonly proofs: Pick<
      SemanticArtifactV1FinalizedSourceProofFactory,
      "issue"
    >;
    readonly sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1;
    readonly sha256: (
      bytes: Uint8Array,
    ) => Effect.Effect<Uint8Array, never, never>;
    readonly expectedAnalyzerRelease?: PrivateAnalyzerReleaseTupleV1;
  }>,
): DeclarativeV2AuthenticatedCommandProducerApiV1 {
  const results = new WeakMap<object, ResultState>();
  const cursors = new WeakMap<object, CursorState>();
  const preparations = new WeakMap<object, PreparationState>();
  const preparedReservations =
    new WeakMap<object, PreparedReservationState>();
  const registrationEvidence =
    new WeakMap<object, RegistrationEvidenceState>();
  const configuredAnalyzerRelease =
    options.expectedAnalyzerRelease ?? installedPrivateAnalyzerReleaseTupleV1();
  const capturedAnalyzerRelease = capturePrivateAnalyzerReleaseTupleV1(
    configuredAnalyzerRelease,
  );
  if (Result.isFailure(capturedAnalyzerRelease)) {
    throw new Error("Authenticated command analyzer identity is malformed.", {
      cause: capturedAnalyzerRelease.failure,
    });
  }
  const expectedAnalyzerRelease = capturedAnalyzerRelease.success;
  const verifierIdentities = installedPrivateAnalyzerVerifierIdentitiesV1();

  const hash = Effect.fn("DeclarativeV2AuthenticatedCommandProducer.hash")(
    function* (bytes: Uint8Array) {
      const digest = yield* options.sha256(bytes);
      if (!isUint8ArrayWithByteLength(digest, SHA256_BYTES)) {
        return yield* Effect.die(
          new Error("Authenticated command SHA-256 dependency returned invalid bytes."),
        );
      }
      return copyBytes(digest);
    },
  );

  const prepare: DeclarativeV2AuthenticatedCommandProducerApiV1["prepare"] =
    Effect.fn(
      "DeclarativeV2AuthenticatedCommandProducer.prepare",
    )(function* (
      request,
      proofInput,
      rawInput,
    ) {
      const input = yield* Effect.fromResult(
        capturePreparationInput(rawInput),
      );
      const proof = yield* options.proofs.issue(request, proofInput);
      const session = yield* Effect.acquireRelease(
        options.sessions.open(request, proof, input.readSession),
        opened =>
          Effect.fromResult(options.sessions.close(request, opened)).pipe(
            Effect.orDie,
          ),
        { interruptible: true },
      );
      const receipt = yield* Effect.fromResult(
        options.sessions.receipt(request, session),
      );
      const modules = yield* Effect.fromResult(
        captureModuleMetadata(options.sessions, request, session),
      );
      const ownedModules = yield* Effect.fromResult(
        ownModuleMetadata(
          modules,
          input.transportBudget.maximumCanonicalBytes,
        ),
      );
      const encodedBudget = yield* Effect.fromResult(
        encodeDeclarativeV2VerifierProgressFrameV2(
          input.commandBudget,
          PROGRESS_FRAME_BUDGET,
        ),
      );
      const freshAuthenticatedInputSha256 = yield* hash(
        canonicalPreimage(
          FRESH_INPUT_DOMAIN,
          freshInputJson(receipt, ownedModules),
        ),
      );
      const commandBudgetSha256 = yield* hash(encodedBudget.canonicalBytes);
      const commandInputSha256 = yield* hash(
        canonicalPreimage(
          COMMAND_INPUT_DOMAIN,
          commandInputJson(
            input.selection,
            receipt,
            ownedModules,
            freshAuthenticatedInputSha256,
          ),
        ),
      );
      const analyzerIdentitySha256 = yield* hash(
        canonicalPreimage(
          ANALYZER_IDENTITY_DOMAIN,
          analyzerIdentityJson(expectedAnalyzerRelease),
        ),
      );
      const verifierIdentitySha256 = yield* hash(
        canonicalPreimage(
          VERIFIER_IDENTITY_DOMAIN,
          verifierIdentityJson(verifierIdentities),
        ),
      );
      const preparation = Object.freeze({
        [PREPARATION_MARKER]: true as const,
      }) satisfies DeclarativeV2AuthenticatedCommandPreparationV1;
      const state: PreparationState = {
        request,
        session,
        receipt,
        modules: ownedModules,
        commandBudget: input.commandBudget,
        commandBudgetBytes: copyBytes(encodedBudget.canonicalBytes),
        transportBudget: input.transportBudget,
        selection: input.selection,
        stable: ownStableCommitments({
          commandBudgetSha256,
          commandInputSha256,
          freshAuthenticatedInputSha256,
          analyzerIdentitySha256,
          verifierIdentitySha256,
        }),
        productionGate: Semaphore.makeUnsafe(1),
        result: undefined,
        reservationBytes: undefined,
        registrationEvidence: undefined,
        closed: false,
      };
      preparations.set(preparation, state);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (state.result !== undefined) {
            const resultState = results.get(state.result);
            if (resultState !== undefined) {
              closeResultState(resultState, cursors);
            }
          }
          state.closed = true;
          preparations.delete(preparation);
        }),
      );
      return preparation;
    });

  const commitments:
    DeclarativeV2AuthenticatedCommandProducerApiV1["commitments"] =
      (request, preparation) =>
        Result.map(
          getPreparation(preparations, request, preparation, "commitments"),
          state => ownStableCommitments(state.stable),
        );

  const bindReservation:
    DeclarativeV2AuthenticatedCommandProducerApiV1["bindReservation"] =
      Effect.fn(
        "DeclarativeV2AuthenticatedCommandProducer.bindReservation",
      )(function* (request, preparation, rawLineage) {
        const state = yield* Effect.fromResult(
          getPreparation(
            preparations,
            request,
            preparation,
            "bindReservation",
          ),
        );
        const lineage = yield* Effect.fromResult(
          captureReservationLineage(rawLineage, "bindReservation"),
        );
        if (lineage.commandKind !== state.selection.kind) {
          return yield* producerError("bindReservation", "contentMismatch", {
            path: "lineage.commandKind",
          });
        }
        const rangeAndPredecessorTailsSha256 = yield* hash(
          canonicalPreimage(
            RANGE_DOMAIN,
            rangeJson(state.selection, lineage),
          ),
        );
        const authority = Object.freeze({
          [PREPARED_RESERVATION_MARKER]: true as const,
        }) satisfies DeclarativeV2AuthenticatedCommandPreparedReservationV1;
        preparedReservations.set(authority, {
          preparation: state,
          lineage,
          commitments: ownReservationCommitments({
            ...state.stable,
            rangeAndPredecessorTailsSha256,
          }),
          claimed: false,
        });
        return authority;
      });

  const claimPreparedReservation:
    DeclarativeV2AuthenticatedCommandProducerApiV1["claimPreparedReservation"] =
      (rawAuthority, rawLineage) =>
        Result.gen(function* () {
          const state =
            rawAuthority !== null && typeof rawAuthority === "object"
              ? preparedReservations.get(rawAuthority)
              : undefined;
          if (
            state === undefined ||
            state.claimed ||
            state.preparation.closed
          ) {
            return yield* Result.fail(
              producerError("claimReservation", "invalidAuthority"),
            );
          }
          const lineage = yield* captureReservationLineage(
            rawLineage,
            "claimReservation",
          );
          if (!reservationLineageEqual(state.lineage, lineage)) {
            return yield* Result.fail(
              producerError("claimReservation", "commitmentMismatch", {
                path: "lineage",
              }),
            );
          }
          state.claimed = true;
          preparedReservations.delete(rawAuthority as object);
          return Object.freeze({
            commandBudget: ownBudget(state.preparation.commandBudget) as
              CommandBudgetFrame,
            commitments: ownReservationCommitments(state.commitments),
          });
        });

  const producePrepared:
    DeclarativeV2AuthenticatedCommandProducerApiV1["producePrepared"] =
      Effect.fn(
        "DeclarativeV2AuthenticatedCommandProducer.producePrepared",
      )(function* (request, preparation, rawReservation) {
        const state = yield* Effect.fromResult(
          getPreparation(
            preparations,
            request,
            preparation,
            "produce",
          ),
        );
        return yield* state.productionGate.withPermit(Effect.gen(function* () {
          yield* Effect.fromResult(
            getPreparation(
              preparations,
              request,
              preparation,
              "produce",
            ),
          );
        const reservationSnapshot = yield* Effect.fromResult(
          captureReservationSnapshot(rawReservation),
        );
        const progress = yield* Effect.fromResult(
          captureProgressFrames(
            reservationSnapshot,
            state.commandBudget,
          ),
        );
        if (state.result !== undefined) {
          if (
            state.reservationBytes === undefined ||
            !bytesEqualFullScan(
              state.reservationBytes,
              progress.reservationBytes,
            )
          ) {
            return yield* producerError("produce", "commitmentMismatch", {
              path: "reservation",
            });
          }
          return state.result;
        }
        yield* Effect.fromResult(validateSelection(
          state.selection,
          progress.reservation,
          state.modules,
          state.receipt.semanticByteLength,
        ));
        const preflightInput: CapturedInput = Object.freeze({
          readSession: null,
          reservation: reservationSnapshot,
          commandBudget: state.commandBudget,
          transportBudget: state.transportBudget,
          selection: state.selection,
        });
        const planned = yield* Effect.fromResult(preflightTransport(
          preflightInput,
          progress,
          state.modules,
          state.receipt.semanticByteLength,
        ));
        const rangeAndPredecessorTailsSha256 = yield* hash(
          canonicalPreimage(
            RANGE_DOMAIN,
            rangeJson(state.selection, progress.reservation),
          ),
        );
        const comparisons = [
          [
            progress.reservation.commandBudgetSha256,
            state.stable.commandBudgetSha256,
            "commandBudgetSha256",
          ],
          [
            progress.reservation.freshAuthenticatedInputSha256,
            state.stable.freshAuthenticatedInputSha256,
            "freshAuthenticatedInputSha256",
          ],
          [
            progress.reservation.commandInputSha256,
            state.stable.commandInputSha256,
            "commandInputSha256",
          ],
          [
            progress.reservation.rangeAndPredecessorTailsSha256,
            rangeAndPredecessorTailsSha256,
            "rangeAndPredecessorTailsSha256",
          ],
          [
            progress.reservation.analyzerIdentitySha256,
            state.stable.analyzerIdentitySha256,
            "analyzerIdentitySha256",
          ],
          [
            progress.reservation.verifierIdentitySha256,
            state.stable.verifierIdentitySha256,
            "verifierIdentitySha256",
          ],
        ] as const;
        for (const [expected, actual, commitment] of comparisons) {
          yield* Effect.fromResult(
            compareCommitment(expected, actual, commitment),
          );
        }
        const frames = yield* buildFrames(
          options.sessions,
          request,
          state.session,
          state.selection,
          progress,
          state.modules,
          state.receipt.semanticByteLength,
        );
        const finalReceipt = yield* Effect.fromResult(
          options.sessions.receipt(request, state.session),
        );
        yield* Effect.fromResult(
          requireReceiptIdentityMatches(state.receipt, finalReceipt),
        );
        yield* Effect.fromResult(
          requireContentReadWithinCommandBudget(
            finalReceipt,
            progress.commandBudget,
          ),
        );
        yield* Effect.yieldNow;
        const encoded = yield* Effect.fromResult(
          encodeDeclarativeV2AuthenticatedCommandRequestV1(
            Object.freeze({ frames: Object.freeze(frames) }),
            state.transportBudget,
          ),
        );
        yield* Effect.fromResult(requireUsageMatches(planned, encoded));
        yield* Effect.yieldNow;
        const reservationSha256 = yield* hash(progress.reservationBytes);
        const requestSha256 = yield* hash(encoded.canonicalBytes);
        const result = makeResultHandle();
        const resultReceipt = ownReceipt({
          commandKind: progress.reservation.commandKind,
          sequence: progress.reservation.sequence,
          attemptSha256: progress.reservation.attemptSha256,
          candidateSha256: progress.reservation.candidateSha256,
          reservationSha256,
          requestSha256,
          canonicalByteLength: encoded.canonicalBytes.byteLength,
          ...state.stable,
          rangeAndPredecessorTailsSha256,
          contentRead: finalReceipt.budget,
          transport: encoded.usage,
        });
        results.set(result, {
          request,
          preparation: state,
          canonicalBytes: copyBytes(encoded.canonicalBytes),
          receipt: resultReceipt,
          cursor: undefined,
          closed: false,
        });
        state.result = result;
        state.reservationBytes = copyBytes(progress.reservationBytes);
        return result;
        }));
      });

  const produce = Effect.fn(
    "DeclarativeV2AuthenticatedCommandProducer.produce",
  )(function* (
    request: Request,
    proofInput: SemanticArtifactV1FinalizedSourceProofInput,
    rawInput: unknown,
  ): Effect.fn.Return<
    DeclarativeV2AuthenticatedCommandResultV1,
    DeclarativeV2AuthenticatedCommandProducerOpenErrorV1,
    Scope.Scope
  > {
    const input = yield* Effect.fromResult(captureInput(rawInput));
    const preparation = yield* prepare(request, proofInput, {
      readSession: input.readSession,
      commandBudget: input.commandBudget,
      transportBudget: input.transportBudget,
      selection: input.selection,
    });
    return yield* producePrepared(request, preparation, input.reservation);
  });

  const receipt:
    DeclarativeV2AuthenticatedCommandProducerApiV1["receipt"] =
      (request, result) =>
        Result.map(getResult(results, request, result, "receipt"), state =>
          ownReceipt(state.receipt)
        );

  const cursor:
    DeclarativeV2AuthenticatedCommandProducerApiV1["cursor"] =
      (request, result) =>
        Result.gen(function* () {
          const state = yield* getResult(results, request, result, "cursor");
          if (state.cursor !== undefined) {
            return yield* Result.fail(
              producerError("cursor", "cursorAlreadyIssued"),
            );
          }
          const handle = makeCursorHandle();
          state.cursor = handle;
          cursors.set(handle, {
            request,
            result: result as object,
            offset: 0,
            closed: false,
          });
          return handle;
        });

  const read:
    DeclarativeV2AuthenticatedCommandProducerApiV1["read"] =
      (request, cursorValue, maximumBytes) =>
        Result.gen(function* () {
          if (
            !isNonNegativeSafeInteger(maximumBytes) ||
            maximumBytes === 0 ||
            maximumBytes >
              DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1
          ) {
            return yield* Result.fail(producerError("read", "invalidInput"));
          }
          const state = cursorValue !== null && typeof cursorValue === "object"
            ? cursors.get(cursorValue)
            : undefined;
          if (state === undefined) {
            return yield* Result.fail(
              producerError("read", "invalidAuthority"),
            );
          }
          if (state.request !== request) {
            return yield* Result.fail(producerError("read", "wrongRequest"));
          }
          if (state.closed) {
            return yield* Result.fail(producerError("read", "closed"));
          }
          const resultState = yield* getResult(
            results,
            request,
            state.result,
            "read",
          );
          const length = Math.min(
            maximumBytes,
            resultState.canonicalBytes.byteLength - state.offset,
          );
          const bytes = resultState.canonicalBytes.slice(
            state.offset,
            state.offset + length,
          );
          state.offset += length;
          if (state.offset === resultState.canonicalBytes.byteLength) {
            state.closed = true;
          }
          return Object.freeze({
            status: state.closed ? "complete" as const : "pending" as const,
            offset: state.offset,
            bytes,
          });
        });

  const close:
    DeclarativeV2AuthenticatedCommandProducerApiV1["close"] =
      (request, result) =>
        Result.map(getResult(results, request, result, "close"), state => {
          closeResultState(state, cursors);
        });

  const issueRegistrationEvidence:
    DeclarativeV2AuthenticatedCommandProducerApiV1[
      "issueRegistrationEvidence"
    ] = Effect.fn(
      "DeclarativeV2AuthenticatedCommandProducer.issueRegistrationEvidence",
    )(function* (request, preparation, definition) {
      const state = yield* Effect.fromResult(
        getPreparation(
          preparations,
          request,
          preparation,
          "issueRegistrationEvidence",
        ),
      );
      return yield* state.productionGate.withPermit(Effect.gen(function* () {
        yield* Effect.fromResult(
          getPreparation(
            preparations,
            request,
            preparation,
            "issueRegistrationEvidence",
          ),
        );
      if (state.registrationEvidence !== undefined) {
        const existing = registrationEvidence.get(state.registrationEvidence);
        if (existing === undefined) {
          return yield* Effect.die(
            new Error(
              "Authenticated registration evidence state disappeared before scope release.",
            ),
          );
        }
        if (existing.definition !== definition) {
          return yield* producerError(
            "issueRegistrationEvidence",
            "contentMismatch",
            { path: "definition" },
          );
        }
        return existing.handle;
      }
      const semanticBytes = yield* Effect.fromResult(
        readAuthenticatedSemanticBytes(
          options.sessions,
          request,
          state.session,
          state.receipt.semanticByteLength,
        ),
      );
      const candidate = yield* makeAuthenticatedRegistrationCandidateV1(
        state,
        definition,
        semanticBytes,
        state.receipt.rootConfiguration,
        hash,
      );
      const evidence = Object.freeze({
        _tag: "DeclarativeV2AuthenticatedRegistrationEvidenceV1" as const,
      }) satisfies DeclarativeV2AuthenticatedRegistrationEvidenceV1;
      registrationEvidence.set(evidence, {
        handle: evidence,
        preparation: state,
        definition,
        candidate,
        command: undefined,
      });
      state.registrationEvidence = evidence;
      return evidence;
      }));
    });

  const bindRegistrationEvidence:
    DeclarativeV2AuthenticatedCommandProducerApiV1[
      "bindRegistrationEvidence"
    ] = (evidence, request, result, registrationPreparation) =>
      Result.gen(function* () {
        const evidenceState = yield* getRegistrationEvidence(
          registrationEvidence,
          evidence,
          "bindRegistrationEvidence",
        );
        const resultState = yield* getResult(
          results,
          request,
          result,
          "bindRegistrationEvidence",
        );
        const receipt = resultState.receipt;
        if (resultState.preparation !== evidenceState.preparation) {
          return yield* Result.fail(producerError(
            "bindRegistrationEvidence",
            "contentMismatch",
            { path: "result.preparation" },
          ));
        }
        if (receipt.commandKind !== "registration_page") {
          return yield* Result.fail(producerError(
            "bindRegistrationEvidence",
            "contentMismatch",
            { path: "receipt.commandKind" },
          ));
        }
        yield* requireRegistrationReceiptMatchesEvidence(
          evidenceState,
          receipt,
        );
        const captured = ownRegistrationCommandReceipt(receipt);
        if (evidenceState.command !== undefined) {
          return evidenceState.command.registrationPreparation ===
              registrationPreparation &&
              registrationCommandReceiptsEqual(
                evidenceState.command.receipt,
                captured,
              )
            ? evidenceState.handle
            : yield* Result.fail(producerError(
              "bindRegistrationEvidence",
              "contentMismatch",
              { path: "registrationCommand" },
            ));
        }
        evidenceState.command = Object.freeze({
          registrationPreparation,
          receipt: captured,
        });
        return evidenceState.handle;
      });

  const claimRegistrationCandidate:
    DeclarativeV2AuthenticatedCommandProducerApiV1[
      "claimRegistrationCandidate"
    ] = (definition, evidence) =>
      Result.gen(function* () {
        const state = yield* getRegistrationEvidence(
          registrationEvidence,
          evidence,
          "claimRegistrationCandidate",
        );
        if (state.definition !== definition) {
          return yield* Result.fail(producerError(
            "claimRegistrationCandidate",
            "contentMismatch",
            { path: "definition" },
          ));
        }
        return ownAuthenticatedRegistrationCandidate(state.candidate);
      });

  const claimRegistrationCommand:
    DeclarativeV2AuthenticatedCommandProducerApiV1[
      "claimRegistrationCommand"
    ] = (registrationPreparation, evidence) =>
      Result.gen(function* () {
        const state = yield* getRegistrationEvidence(
          registrationEvidence,
          evidence,
          "claimRegistrationCommand",
        );
        if (
          state.command === undefined ||
          state.command.registrationPreparation !== registrationPreparation
        ) {
          return yield* Result.fail(producerError(
            "claimRegistrationCommand",
            "contentMismatch",
            { path: "registrationPreparation" },
          ));
        }
        return ownRegistrationCommandReceipt(state.command.receipt);
      });

  return Object.freeze({
    prepare,
    commitments,
    bindReservation,
    claimPreparedReservation,
    producePrepared,
    produce,
    receipt,
    cursor,
    read,
    close,
    issueRegistrationEvidence,
    bindRegistrationEvidence,
    claimRegistrationCandidate,
    claimRegistrationCommand,
  });
}

function readAuthenticatedSemanticBytes(
  sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1,
  request: Request,
  session: unknown,
  expectedByteLength: number,
): Result.Result<
  Uint8Array,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    if (!isNonNegativeSafeInteger(expectedByteLength)) {
      return yield* Result.fail(producerError(
        "issueRegistrationEvidence",
        "contentMismatch",
        { path: "readSession.semanticByteLength" },
      ));
    }
    const cursor = yield* sessions.semanticCursor(request, session).pipe(
      Result.mapError(() => producerError(
        "issueRegistrationEvidence",
        "contentMismatch",
        { path: "readSession.semanticCursor" },
      )),
    );
    const bytes = new Uint8Array(expectedByteLength);
    let offset = 0;
    for (;;) {
      const maximumBytes = Math.max(
        1,
        Math.min(
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
          expectedByteLength - offset,
        ),
      );
      const read = yield* sessions.readCursor(
        request,
        cursor,
        maximumBytes,
      ).pipe(
        Result.mapError(() => producerError(
          "issueRegistrationEvidence",
          "contentMismatch",
          { path: "readSession.semanticBytes" },
        )),
      );
      if (
        read.offset !== offset + read.bytes.byteLength ||
        read.offset > expectedByteLength ||
        read.bytes.byteLength === 0 && read.status !== "complete"
      ) {
        return yield* Result.fail(producerError(
          "issueRegistrationEvidence",
          "contentMismatch",
          { path: "readSession.semanticBytes" },
        ));
      }
      bytes.set(read.bytes, offset);
      offset = read.offset;
      if (read.status === "complete") {
        if (offset !== expectedByteLength) {
          return yield* Result.fail(producerError(
            "issueRegistrationEvidence",
            "contentMismatch",
            { path: "readSession.semanticByteLength" },
          ));
        }
        return bytes;
      }
    }
  });
}

const makeAuthenticatedRegistrationCandidateV1 = Effect.fn(
  "DeclarativeV2AuthenticatedCommandProducer.makeRegistrationCandidate",
)(function* (
  state: PreparationState,
  definition: PreparedStandardApplicationDefinitionV1,
  semanticBytes: Uint8Array,
  rootConfiguration: SemanticArtifactV1RootConfiguration,
  hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, never, never>,
): Effect.fn.Return<
  DeclarativeV2AuthenticatedRegistrationCandidateV1,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const plan = definition.artifactIngressPlan;
  if (
    plan.source.modules.length !== state.modules.length ||
    plan.semantic.bytes.byteLength !== semanticBytes.byteLength ||
    !bytesEqualFullScan(plan.semantic.bytes, semanticBytes)
  ) {
    return yield* producerError(
      "issueRegistrationEvidence",
      "contentMismatch",
      { path: "definition.artifactIngressPlan" },
    );
  }
  const sourceModules:
    DeclarativeV2AuthenticatedRegistrationSourceModuleV1[] = [];
  for (let ordinal = 0; ordinal < state.modules.length; ordinal += 1) {
    const authenticated = state.modules[ordinal];
    const materialized = plan.source.modules[ordinal];
    if (authenticated === undefined || materialized === undefined) {
      return yield* producerError(
        "issueRegistrationEvidence",
        "contentMismatch",
        { path: `definition.artifactIngressPlan.source.modules[${ordinal}]` },
      );
    }
    const pathBytes = UTF8_ENCODER.encode(materialized.path);
    const sourceSha256 = yield* hash(materialized.sourceBytes);
    if (
      authenticated.ordinal !== ordinal ||
      authenticated.roles !== materialized.roles ||
      authenticated.sourceByteLength !== materialized.sourceBytes.byteLength ||
      !bytesEqualFullScan(authenticated.pathBytes, pathBytes) ||
      !bytesEqualFullScan(authenticated.sourceSha256, sourceSha256)
    ) {
      return yield* producerError(
        "issueRegistrationEvidence",
        "contentMismatch",
        { path: `definition.artifactIngressPlan.source.modules[${ordinal}]` },
      );
    }
    sourceModules.push(Object.freeze({
      ordinal,
      artifactModulePath: materialized.path,
      roles: authenticated.roles,
      sourceByteLength: authenticated.sourceByteLength,
      sourceSha256: copyBytes(authenticated.sourceSha256),
    }));
  }
  const semanticStreamSha256 = yield* hash(semanticBytes);
  const authority = registrationAuthorityJson(state);
  const deploymentAnalysisBytes = canonicalRegistrationIdentityBytes(
    deploymentAnalysisJson(definition, authority),
  );
  const deploymentCodegenAnalysisBytes = canonicalRegistrationIdentityBytes(
    deploymentCodegenAnalysisJson(definition, sourceModules, authority),
  );
  const deploymentAnalysisSha256 = yield* hash(deploymentAnalysisBytes);
  const deploymentCodegenAnalysisSha256 =
    yield* hash(deploymentCodegenAnalysisBytes);
  return ownAuthenticatedRegistrationCandidate(Object.freeze({
    projectId: state.receipt.projectId,
    deploymentId: state.receipt.deploymentId,
    deploymentCreatedAt: state.receipt.deploymentCreatedAt,
    sourceRootSha256: state.receipt.sourceRootSha256,
    sourceSelectorSha256: state.receipt.sourceSelectorSha256,
    semanticRootSha256: state.receipt.semanticRootSha256,
    semanticSelectorSha256: state.receipt.semanticSelectorSha256,
    semanticAttemptIdentitySha256:
      state.receipt.semanticAttemptIdentitySha256,
    sourceModules,
    semanticByteLength: semanticBytes.byteLength,
    semanticStreamSha256,
    semanticModelIdentity: rootConfiguration.semanticModelIdentity,
    semanticCodecIdentity: rootConfiguration.semanticCodecIdentity,
    semanticPolicyIdentity: rootConfiguration.semanticPolicyIdentity,
    coreLanguageIdentity: rootConfiguration.coreLanguageIdentity,
    abiIdentity: rootConfiguration.abiIdentity,
    grammarIdentity: rootConfiguration.grammarIdentity,
    unicodeIdentity: rootConfiguration.unicodeIdentity,
    parserTableIdentity: rootConfiguration.parserTableIdentity,
    analyzerIdentitySha256: state.stable.analyzerIdentitySha256,
    verifierIdentitySha256: state.stable.verifierIdentitySha256,
    deploymentAnalysisCodecIdentity:
      DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1,
    deploymentAnalysisByteLength: BigInt(deploymentAnalysisBytes.byteLength),
    deploymentAnalysisSha256,
    deploymentCodegenAnalysisCodecIdentity:
      DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1,
    deploymentCodegenAnalysisByteLength:
      BigInt(deploymentCodegenAnalysisBytes.byteLength),
    deploymentCodegenAnalysisSha256,
  }));
});

function registrationAuthorityJson(state: PreparationState): Json {
  return Object.freeze({
    projectId: state.receipt.projectId,
    deploymentId: state.receipt.deploymentId,
    deploymentCreatedAt: state.receipt.deploymentCreatedAt,
    sourceRootSha256: hex(state.receipt.sourceRootSha256),
    sourceSelectorSha256: hex(state.receipt.sourceSelectorSha256),
    semanticRootSha256: hex(state.receipt.semanticRootSha256),
    semanticSelectorSha256: hex(state.receipt.semanticSelectorSha256),
    semanticAttemptIdentitySha256:
      hex(state.receipt.semanticAttemptIdentitySha256),
    analyzerIdentitySha256: hex(state.stable.analyzerIdentitySha256),
    verifierIdentitySha256: hex(state.stable.verifierIdentitySha256),
  });
}

function deploymentAnalysisJson(
  definition: PreparedStandardApplicationDefinitionV1,
  authority: Json,
): Json {
  return Object.freeze({
    format: DEPLOYMENT_ANALYSIS_FORMAT_V1,
    version: 1,
    authority,
    programFormat: definition.program.format,
    programVersion: definition.program.version,
    schema: Object.freeze({
      tables: definition.program.schema.tables.map(table => Object.freeze({
        logicalName: table.logicalName,
        definition: table.definition,
      })),
      indexes: definition.program.schema.indexes.map(index => Object.freeze({
        tableLogicalName: index.tableLogicalName,
        descriptor: index.descriptor,
        fields: Object.freeze([...index.fields]),
      })),
    }),
    functions: definition.program.modules.flatMap(module =>
      module.functions.map(fn => Object.freeze({
        path: fn.exportName === "default"
          ? module.modulePath
          : `${module.modulePath}:${fn.exportName}`,
        modulePath: module.modulePath,
        exportName: fn.exportName,
        kind: fn.kind,
        visibility: fn.visibility,
        argsValidator: fn.argsValidator,
        returnsValidator: fn.returnsValidator,
      }))
    ),
  });
}

function deploymentCodegenAnalysisJson(
  definition: PreparedStandardApplicationDefinitionV1,
  sourceModules:
    ReadonlyArray<DeclarativeV2AuthenticatedRegistrationSourceModuleV1>,
  authority: Json,
): Json {
  const artifactModuleByLogicalPath = new Map(
    definition.artifactIngressPlan.source.functionEntries.map(binding => [
      binding.logicalModulePath,
      binding.artifactModulePath,
    ]),
  );
  return Object.freeze({
    format: DEPLOYMENT_CODEGEN_ANALYSIS_FORMAT_V1,
    version: 1,
    authority,
    executionPath: definition.artifactIngressPlan.source.executionPath,
    sourceModules: sourceModules.map(module => Object.freeze({
      ordinal: module.ordinal,
      artifactModulePath: module.artifactModulePath,
      roles: module.roles,
      sourceByteLength: module.sourceByteLength,
      sourceSha256: hex(module.sourceSha256),
    })),
    modules: definition.program.modules.map(module => Object.freeze({
      modulePath: module.modulePath,
      artifactModulePath:
        artifactModuleByLogicalPath.get(module.modulePath) ?? null,
      functions: module.functions.map(fn => Object.freeze({
        exportName: fn.exportName,
        kind: fn.kind,
        visibility: fn.visibility,
        argsValidator: fn.argsValidator,
        returnsValidator: fn.returnsValidator,
      })),
    })),
  });
}

function canonicalRegistrationIdentityBytes(value: Json): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(value, issue => {
    throw new Error(
      `Authenticated registration identity invariant: ${issue.reason}`,
    );
  }));
}

function getRegistrationEvidence(
  evidence:
    WeakMap<object, RegistrationEvidenceState>,
  value: unknown,
  operation:
    | "bindRegistrationEvidence"
    | "claimRegistrationCandidate"
    | "claimRegistrationCommand",
): Result.Result<
  RegistrationEvidenceState,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const state = value !== null && typeof value === "object"
    ? evidence.get(value)
    : undefined;
  if (state === undefined) {
    return Result.fail(producerError(operation, "invalidAuthority"));
  }
  return state.preparation.closed
    ? Result.fail(producerError(operation, "closed"))
    : Result.succeed(state);
}

function requireRegistrationReceiptMatchesEvidence(
  evidence: RegistrationEvidenceState,
  receipt: DeclarativeV2AuthenticatedCommandProducerReceiptV1,
): Result.Result<
  void,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const comparisons = [
    ["freshAuthenticatedInputSha256", receipt.freshAuthenticatedInputSha256,
      evidence.preparation.stable.freshAuthenticatedInputSha256],
    ["analyzerIdentitySha256", receipt.analyzerIdentitySha256,
      evidence.candidate.analyzerIdentitySha256],
    ["verifierIdentitySha256", receipt.verifierIdentitySha256,
      evidence.candidate.verifierIdentitySha256],
  ] as const;
  for (const [path, actual, expected] of comparisons) {
    if (!bytesEqualFullScan(actual, expected)) {
      return Result.fail(producerError(
        "bindRegistrationEvidence",
        "commitmentMismatch",
        { path: `receipt.${path}`, commitment: path },
      ));
    }
  }
  return Result.succeed(undefined);
}

function ownAuthenticatedRegistrationCandidate(
  candidate: DeclarativeV2AuthenticatedRegistrationCandidateV1,
): DeclarativeV2AuthenticatedRegistrationCandidateV1 {
  return Object.freeze({
    ...candidate,
    sourceRootSha256: copyBytes(candidate.sourceRootSha256),
    sourceSelectorSha256: copyBytes(candidate.sourceSelectorSha256),
    semanticRootSha256: copyBytes(candidate.semanticRootSha256),
    semanticSelectorSha256: copyBytes(candidate.semanticSelectorSha256),
    semanticAttemptIdentitySha256:
      copyBytes(candidate.semanticAttemptIdentitySha256),
    sourceModules: Object.freeze(candidate.sourceModules.map(module =>
      Object.freeze({
        ...module,
        sourceSha256: copyBytes(module.sourceSha256),
      })
    )),
    semanticStreamSha256: copyBytes(candidate.semanticStreamSha256),
    analyzerIdentitySha256: copyBytes(candidate.analyzerIdentitySha256),
    verifierIdentitySha256: copyBytes(candidate.verifierIdentitySha256),
    deploymentAnalysisSha256:
      copyBytes(candidate.deploymentAnalysisSha256),
    deploymentCodegenAnalysisSha256:
      copyBytes(candidate.deploymentCodegenAnalysisSha256),
  });
}

function ownRegistrationCommandReceipt(
  receipt:
    | DeclarativeV2AuthenticatedCommandProducerReceiptV1
    | DeclarativeV2AuthenticatedRegistrationCommandV1,
): DeclarativeV2AuthenticatedRegistrationCommandV1 {
  if (receipt.commandKind !== "registration_page") {
    throw new Error(
      "Authenticated registration command receipt must be registration_page.",
    );
  }
  return Object.freeze({
    commandKind: receipt.commandKind,
    sequence: receipt.sequence,
    attemptSha256: copyBytes(receipt.attemptSha256),
    candidateSha256: copyBytes(receipt.candidateSha256),
    reservationSha256: copyBytes(receipt.reservationSha256),
    requestSha256: copyBytes(receipt.requestSha256),
    canonicalByteLength: receipt.canonicalByteLength,
    freshAuthenticatedInputSha256:
      copyBytes(receipt.freshAuthenticatedInputSha256),
    commandInputSha256: copyBytes(receipt.commandInputSha256),
    rangeAndPredecessorTailsSha256:
      copyBytes(receipt.rangeAndPredecessorTailsSha256),
    analyzerIdentitySha256: copyBytes(receipt.analyzerIdentitySha256),
    verifierIdentitySha256: copyBytes(receipt.verifierIdentitySha256),
  });
}

function registrationCommandReceiptsEqual(
  left: DeclarativeV2AuthenticatedRegistrationCommandV1,
  right: DeclarativeV2AuthenticatedRegistrationCommandV1,
): boolean {
  return left.commandKind === right.commandKind &&
    left.sequence === right.sequence &&
    left.canonicalByteLength === right.canonicalByteLength &&
    bytesEqualFullScan(left.attemptSha256, right.attemptSha256) &&
    bytesEqualFullScan(left.candidateSha256, right.candidateSha256) &&
    bytesEqualFullScan(left.reservationSha256, right.reservationSha256) &&
    bytesEqualFullScan(left.requestSha256, right.requestSha256) &&
    bytesEqualFullScan(
      left.freshAuthenticatedInputSha256,
      right.freshAuthenticatedInputSha256,
    ) &&
    bytesEqualFullScan(left.commandInputSha256, right.commandInputSha256) &&
    bytesEqualFullScan(
      left.rangeAndPredecessorTailsSha256,
      right.rangeAndPredecessorTailsSha256,
    ) &&
    bytesEqualFullScan(
      left.analyzerIdentitySha256,
      right.analyzerIdentitySha256,
    ) &&
    bytesEqualFullScan(
      left.verifierIdentitySha256,
      right.verifierIdentitySha256,
    );
}

function captureInput(
  input: unknown,
): Result.Result<CapturedInput, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(input, [
      "readSession",
      "reservation",
      "commandBudget",
      "transportBudget",
      "selection",
    ] as const, "produce", "input");
    const transportBudget = yield*
      captureDeclarativeV2AuthenticatedCommandTransportBudgetV1(
        record.transportBudget,
      ).pipe(
        Result.mapError(() =>
          producerError("produce", "invalidInput", { path: "transportBudget" })
        ),
      );
    const selection = yield* captureSelection(record.selection);
    const reservation = yield* captureReservationSnapshot(record.reservation);
    const commandBudget = yield*
      captureCommandBudgetSnapshot(
        record.commandBudget,
        "commandBudget",
      );
    const readSession = yield* captureReadSessionSnapshot(record.readSession);
    if (!budgetFramesEqual(readSession.commandBudget, commandBudget)) {
      return yield* Result.fail(
        producerError("produce", "contentMismatch", {
          path: "readSession.budget.command",
        }),
      );
    }
    return Object.freeze({
      readSession: readSession.input,
      reservation,
      commandBudget,
      transportBudget,
      selection,
    });
  });
}

function capturePreparationInput(
  input: unknown,
): Result.Result<
  Readonly<{
    readonly readSession: unknown;
    readonly commandBudget: CommandBudgetFrame;
    readonly transportBudget:
      Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>;
    readonly selection: DeclarativeV2AuthenticatedCommandSelectionV1;
  }>,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(input, [
      "readSession",
      "commandBudget",
      "transportBudget",
      "selection",
    ] as const, "prepare", "input");
    const transportBudget = yield*
      captureDeclarativeV2AuthenticatedCommandTransportBudgetV1(
        record.transportBudget,
      ).pipe(
        Result.mapError(() =>
          producerError("prepare", "invalidInput", {
            path: "transportBudget",
          })
        ),
      );
    const selection = yield* captureSelection(record.selection);
    const commandBudget = yield* captureCommandBudgetSnapshot(
      record.commandBudget,
      "commandBudget",
    );
    const readSession = yield* captureReadSessionSnapshot(record.readSession);
    if (!budgetFramesEqual(readSession.commandBudget, commandBudget)) {
      return yield* Result.fail(
        producerError("prepare", "contentMismatch", {
          path: "readSession.budget.command",
        }),
      );
    }
    return Object.freeze({
      readSession: readSession.input,
      commandBudget,
      transportBudget,
      selection,
    });
  });
}

function getPreparation(
  preparations: WeakMap<object, PreparationState>,
  request: Request,
  preparation: unknown,
  operation:
    | "commitments"
    | "bindReservation"
    | "produce"
    | "issueRegistrationEvidence",
): Result.Result<
  PreparationState,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const state = preparation !== null && typeof preparation === "object"
    ? preparations.get(preparation)
    : undefined;
  if (state === undefined) {
    return Result.fail(producerError(operation, "invalidAuthority"));
  }
  if (state.request !== request) {
    return Result.fail(producerError(operation, "wrongRequest"));
  }
  return state.closed
    ? Result.fail(producerError(operation, "closed"))
    : Result.succeed(state);
}

const RESERVATION_LINEAGE_KEYS = [
  "attemptSha256",
  "candidateSha256",
  "commandKind",
  "sequence",
  "currentProgressSha256",
  "predecessorReceiptSha256",
] as const;

function captureReservationLineage(
  input: unknown,
  operation: "bindReservation" | "claimReservation",
): Result.Result<
  DeclarativeV2AuthenticatedCommandReservationLineageV1,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      RESERVATION_LINEAGE_KEYS,
      operation,
      "lineage",
    );
    const commandKind = record.commandKind;
    if (
      commandKind !== "source_page" &&
      commandKind !== "parse_module" &&
      commandKind !== "link_page" &&
      commandKind !== "registration_page"
    ) {
      return yield* Result.fail(
        producerError(operation, "invalidInput", {
          path: "lineage.commandKind",
        }),
      );
    }
    if (
      !isUint8ArrayWithByteLength(record.attemptSha256, SHA256_BYTES) ||
      !isUint8ArrayWithByteLength(record.candidateSha256, SHA256_BYTES) ||
      !isUint8ArrayWithByteLength(
        record.currentProgressSha256,
        SHA256_BYTES,
      ) ||
      (
        record.predecessorReceiptSha256 !== null &&
        !isUint8ArrayWithByteLength(
          record.predecessorReceiptSha256,
          SHA256_BYTES,
        )
      ) ||
      typeof record.sequence !== "bigint" ||
      record.sequence <= 0n ||
      record.sequence > U64_MAX
    ) {
      return yield* Result.fail(
        producerError(operation, "invalidInput", { path: "lineage" }),
      );
    }
    return Object.freeze({
      attemptSha256: copyBytes(record.attemptSha256),
      candidateSha256: copyBytes(record.candidateSha256),
      commandKind,
      sequence: record.sequence,
      currentProgressSha256: copyBytes(record.currentProgressSha256),
      predecessorReceiptSha256:
        record.predecessorReceiptSha256 === null
          ? null
          : copyBytes(record.predecessorReceiptSha256),
    });
  });
}

function reservationLineageEqual(
  left: DeclarativeV2AuthenticatedCommandReservationLineageV1,
  right: DeclarativeV2AuthenticatedCommandReservationLineageV1,
): boolean {
  return left.commandKind === right.commandKind &&
    left.sequence === right.sequence &&
    bytesEqualFullScan(left.attemptSha256, right.attemptSha256) &&
    bytesEqualFullScan(left.candidateSha256, right.candidateSha256) &&
    bytesEqualFullScan(
      left.currentProgressSha256,
      right.currentProgressSha256,
    ) &&
    (
      left.predecessorReceiptSha256 === null
        ? right.predecessorReceiptSha256 === null
        : right.predecessorReceiptSha256 !== null &&
          bytesEqualFullScan(
            left.predecessorReceiptSha256,
            right.predecessorReceiptSha256,
          )
    );
}

function ownReservationCommitments(
  input: DeclarativeV2AuthenticatedCommandReservationCommitmentsV1,
): DeclarativeV2AuthenticatedCommandReservationCommitmentsV1 {
  return Object.freeze({
    ...ownStableCommitments(input),
    rangeAndPredecessorTailsSha256:
      copyBytes(input.rangeAndPredecessorTailsSha256),
  });
}

function ownStableCommitments(
  input: DeclarativeV2AuthenticatedCommandStableCommitmentsV1,
): DeclarativeV2AuthenticatedCommandStableCommitmentsV1 {
  return Object.freeze({
    commandBudgetSha256: copyBytes(input.commandBudgetSha256),
    commandInputSha256: copyBytes(input.commandInputSha256),
    freshAuthenticatedInputSha256:
      copyBytes(input.freshAuthenticatedInputSha256),
    analyzerIdentitySha256: copyBytes(input.analyzerIdentitySha256),
    verifierIdentitySha256: copyBytes(input.verifierIdentitySha256),
  });
}

const RESERVATION_KEYS = [
  "kind",
  "attemptSha256",
  "candidateSha256",
  "commandKind",
  "sequence",
  "currentProgressSha256",
  "predecessorReceiptSha256",
  "commandBudgetSha256",
  "commandInputSha256",
  "freshAuthenticatedInputSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "rangeAndPredecessorTailsSha256",
] as const;

const SESSION_COMMAND_KEYS = [
  "semanticUploadId",
  "deploymentId",
  "expectedGeneration",
  "expectedMutationFence",
  "commandId",
  "admission",
] as const;

const SESSION_ADMISSION_KEYS = [
  "calls",
  "blockBytes",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "timeMilliseconds",
] as const;

function captureReservationSnapshot(
  input: unknown,
): Result.Result<
  unknown,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.map(
    captureOwnDataRecord(
      input,
      RESERVATION_KEYS,
      "produce",
      "reservation",
    ),
    record => {
      const output = Object.create(null) as Record<string, unknown>;
      for (const key of RESERVATION_KEYS) {
        const value = record[key];
        output[key] = isUint8Array(value) ? copyBytes(value) : value;
      }
      return Object.freeze(output);
    },
  );
}

function captureCommandBudgetSnapshot(
  input: unknown,
  path: string,
): Result.Result<
  CommandBudgetFrame,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2] as const,
      "produce",
      path,
    );
    if (record.kind !== "command_budget") {
      return yield* Result.fail(
        producerError("produce", "invalidInput", { path: `${path}.kind` }),
      );
    }
    const output: Record<string, bigint | string> = {
      kind: "command_budget",
    };
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const value = record[dimension];
      if (
        typeof value !== "bigint" ||
        value < 0n ||
        value > U64_MAX
      ) {
        return yield* Result.fail(
          producerError("produce", "invalidInput", {
            path: `${path}.${dimension}`,
          }),
        );
      }
      output[dimension] = value;
    }
    return Object.freeze(output) as CommandBudgetFrame;
  });
}

function captureReadSessionSnapshot(
  input: unknown,
): Result.Result<
  CapturedReadSession,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const session = yield* captureOwnDataRecord(
      input,
      ["command", "budget"] as const,
      "produce",
      "readSession",
    );
    const command = yield* captureOwnDataRecord(
      session.command,
      SESSION_COMMAND_KEYS,
      "produce",
      "readSession.command",
    );
    const admission = yield* captureOwnDataRecord(
      command.admission,
      SESSION_ADMISSION_KEYS,
      "produce",
      "readSession.command.admission",
    );
    const budget = yield* captureOwnDataRecord(
      session.budget,
      ["ceilings", "usage", "command"] as const,
      "produce",
      "readSession.budget",
    );
    const ceilings = yield* captureBudgetFrameSnapshot(
      budget.ceilings,
      "attempt_ceilings",
      "readSession.budget.ceilings",
    );
    const usage = yield* captureBudgetFrameSnapshot(
      budget.usage,
      "attempt_usage",
      "readSession.budget.usage",
    );
    const commandBudget = yield* captureCommandBudgetSnapshot(
      budget.command,
      "readSession.budget.command",
    );
    return Object.freeze({
      input: Object.freeze({
        command: Object.freeze({
          semanticUploadId: command.semanticUploadId,
          deploymentId: command.deploymentId,
          expectedGeneration: command.expectedGeneration,
          expectedMutationFence: command.expectedMutationFence,
          commandId: command.commandId,
          admission: Object.freeze({ ...admission }),
        }),
        budget: Object.freeze({
          ceilings,
          usage,
          command: commandBudget,
        }),
      }),
      commandBudget,
    });
  });
}

function captureBudgetFrameSnapshot(
  input: unknown,
  expectedKind: "attempt_ceilings" | "attempt_usage",
  path: string,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2] as const,
      "produce",
      path,
    );
    if (record.kind !== expectedKind) {
      return yield* Result.fail(
        producerError("produce", "invalidInput", { path: `${path}.kind` }),
      );
    }
    const output: Record<string, bigint | string> = { kind: expectedKind };
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const value = record[dimension];
      if (
        typeof value !== "bigint" ||
        value < 0n ||
        value > U64_MAX
      ) {
        return yield* Result.fail(
          producerError("produce", "invalidInput", {
            path: `${path}.${dimension}`,
          }),
        );
      }
      output[dimension] = value;
    }
    return Object.freeze(output) as DeclarativeV2VerifierBudgetFrameV2;
  });
}

function budgetFramesEqual(
  left: CommandBudgetFrame,
  right: CommandBudgetFrame,
): boolean {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (left[dimension] !== right[dimension]) return false;
  }
  return true;
}

function captureSelection(
  input: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedCommandSelectionV1,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const kindRecord = captureOwnDataRecordAtLeastKind(input);
  if (Result.isFailure(kindRecord)) return Result.fail(kindRecord.failure);
  switch (kindRecord.success.kind) {
    case "source_page":
      return Result.gen(function* () {
        const value = yield* captureOwnDataRecord(input, [
          "kind",
          "firstModuleOrdinal",
          "moduleCount",
        ] as const, "produce", "selection");
        if (
          value.kind !== "source_page" ||
          !isNonNegativeSafeBigInt(value.firstModuleOrdinal) ||
          !isPositiveSafeBigInt(value.moduleCount)
        ) {
          return yield* Result.fail(
            producerError("produce", "invalidInput", { path: "selection" }),
          );
        }
        return Object.freeze({
          kind: "source_page" as const,
          firstModuleOrdinal: value.firstModuleOrdinal,
          moduleCount: value.moduleCount,
        });
      });
    case "parse_module":
      return Result.gen(function* () {
        const value = yield* captureOwnDataRecord(input, [
          "kind",
          "moduleOrdinal",
        ] as const, "produce", "selection");
        if (
          value.kind !== "parse_module" ||
          !isNonNegativeSafeBigInt(value.moduleOrdinal)
        ) {
          return yield* Result.fail(
            producerError("produce", "invalidInput", { path: "selection" }),
          );
        }
        return Object.freeze({
          kind: "parse_module" as const,
          moduleOrdinal: value.moduleOrdinal,
        });
      });
    case "registration_page":
      return Result.flatMap(
        captureOwnDataRecord(input, ["kind"] as const, "produce", "selection"),
        value =>
          value.kind === "registration_page"
            ? Result.succeed(Object.freeze({ kind: "registration_page" as const }))
            : Result.fail(
              producerError("produce", "invalidInput", { path: "selection.kind" }),
            ),
      );
    case "link_page":
      return Result.flatMap(
        captureOwnDataRecord(input, ["kind"] as const, "produce", "selection"),
        value =>
          value.kind === "link_page"
            ? Result.succeed(Object.freeze({ kind: "link_page" as const }))
            : Result.fail(
              producerError("produce", "invalidInput", { path: "selection.kind" }),
            ),
      );
    default:
      return Result.fail(
        producerError("produce", "invalidInput", { path: "selection.kind" }),
      );
  }
}

function captureOwnDataRecordAtLeastKind(
  input: unknown,
): Result.Result<
  Readonly<{ readonly kind: unknown }>,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return Result.fail(
        producerError("produce", "invalidInput", { path: "selection" }),
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (descriptor === undefined || !("value" in descriptor)) {
      return Result.fail(
        producerError("produce", "invalidInput", { path: "selection.kind" }),
      );
    }
    return Result.succeed(Object.freeze({ kind: descriptor.value }));
  } catch {
    return Result.fail(
      producerError("produce", "invalidInput", { path: "selection" }),
    );
  }
}

function captureOwnDataRecord<const Keys extends readonly string[]>(
  input: unknown,
  expectedKeys: Keys,
  operation: Operation,
  path: string,
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return Result.fail(producerError(operation, "invalidInput", { path }));
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) =>
        typeof key !== "string" || !expectedKeys.includes(key)
      )
    ) {
      return Result.fail(producerError(operation, "invalidInput", { path }));
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor)
      ) {
        return Result.fail(
          producerError(operation, "invalidInput", { path: `${path}.${key}` }),
        );
      }
      output[key] = descriptor.value;
    }
    return Result.succeed(
      Object.freeze(output) as Readonly<Record<Keys[number], unknown>>,
    );
  } catch {
    return Result.fail(producerError(operation, "invalidInput", { path }));
  }
}

function captureProgressFrames(
  reservationInput: unknown,
  commandBudgetInput: unknown,
): Result.Result<
  EncodedProgress,
  | DeclarativeV2VerifierProgressV2Error
  | DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    const reservation = yield* encodeDeclarativeV2VerifierProgressFrameV2(
      reservationInput,
      PROGRESS_FRAME_BUDGET,
    );
    const commandBudget = yield* encodeDeclarativeV2VerifierProgressFrameV2(
      commandBudgetInput,
      PROGRESS_FRAME_BUDGET,
    );
    if (
      reservation.frame.kind !== "command_reservation" ||
      !isCommandBudgetFrame(commandBudget.frame)
    ) {
      return yield* Result.fail(
        producerError("produce", "invalidInput", {
          path: "reservationOrCommandBudget",
        }),
      );
    }
    return Object.freeze({
      reservation: reservation.frame,
      reservationBytes: reservation.canonicalBytes,
      commandBudget: commandBudget.frame,
      commandBudgetBytes: commandBudget.canonicalBytes,
    });
  });
}

function isCommandBudgetFrame(
  frame: DeclarativeV2VerifierProgressFrameV2,
): frame is CommandBudgetFrame {
  return frame.kind === "command_budget";
}

function captureModuleMetadata(
  sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1,
  request: Request,
  session: unknown,
): Result.Result<
  readonly ModuleMetadata[],
  | DeclarativeV2AuthenticatedCommandProducerV1Error
  | import("./AuthenticatedVerifierReadSession").DeclarativeV2AuthenticatedReadSessionAccessError
> {
  return Result.gen(function* () {
    const count = yield* sessions.moduleCount(request, session);
    if (
      !isNonNegativeSafeInteger(count) ||
      count > DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 - 2
    ) {
      return yield* Result.fail(
        producerError("produce", "budgetExceeded", {
          path: "modules",
          observed: typeof count === "number" && Number.isSafeInteger(count)
            ? BigInt(count)
            : 0n,
          maximum: BigInt(
            DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 - 2,
          ),
        }),
      );
    }
    const modules: ModuleMetadata[] = [];
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const module = yield* sessions.moduleAt(request, session, ordinal);
      const view = yield* sessions.moduleView(request, module);
      const pathByteLength = yield*
        DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteLength(view.path).pipe(
          Result.mapError(() =>
            producerError("produce", "contentMismatch", {
              path: `modules.${ordinal}.path`,
            })
          ),
        );
      if (
        pathByteLength < 1 ||
        pathByteLength >
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1
      ) {
        return yield* Result.fail(
          producerError("produce", "budgetExceeded", {
            path: `modules.${ordinal}.path`,
            observed: BigInt(pathByteLength),
            maximum: BigInt(
              DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
            ),
          }),
        );
      }
      if (
        view.ordinal !== ordinal ||
        !isNonNegativeSafeInteger(view.roles) ||
        view.roles > U32_MAX ||
        !isUint8ArrayWithByteLength(view.frameSha256, SHA256_BYTES) ||
        !isUint8ArrayWithByteLength(view.sourceSha256, SHA256_BYTES) ||
        !isNonNegativeSafeInteger(view.sourceByteLength)
      ) {
        return yield* Result.fail(
          producerError("produce", "contentMismatch", {
            path: `modules.${ordinal}`,
          }),
        );
      }
      modules.push(Object.freeze({
        ordinal,
        roles: view.roles,
        frameSha256: view.frameSha256,
        sourceSha256: view.sourceSha256,
        sourceByteLength: view.sourceByteLength,
        path: view.path,
        pathByteLength,
      }));
    }
    return Object.freeze(modules);
  });
}

function ownModuleMetadata(
  modules: readonly ModuleMetadata[],
  maximumCanonicalBytes: number,
): Result.Result<
  readonly OwnedModuleMetadata[],
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  return Result.gen(function* () {
    let total = 0;
    for (const module of modules) {
      if (
        module.pathByteLength > maximumCanonicalBytes - total
      ) {
        return yield* Result.fail(producerError("produce", "budgetExceeded", {
          path: "modulePaths",
          observed: BigInt(total) + BigInt(module.pathByteLength),
          maximum: BigInt(maximumCanonicalBytes),
        }));
      }
      total += module.pathByteLength;
    }
    const output: OwnedModuleMetadata[] = [];
    for (const module of modules) {
      const pathBytes = new Uint8Array(module.pathByteLength);
      for (let offset = 0; offset < pathBytes.byteLength; offset += 1) {
        const byte = yield*
          DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteAt(module.path, offset)
            .pipe(
              Result.mapError(() =>
                producerError("produce", "contentMismatch", {
                  path: `modules.${module.ordinal}.path`,
                })
              ),
            );
        if (byte === undefined) {
          return yield* Result.fail(
            producerError("produce", "contentMismatch", {
              path: `modules.${module.ordinal}.path`,
            }),
          );
        }
        pathBytes[offset] = byte;
      }
      output.push(Object.freeze({
        ...module,
        frameSha256: copyBytes(module.frameSha256),
        sourceSha256: copyBytes(module.sourceSha256),
        pathBytes,
      }));
    }
    return Object.freeze(output);
  });
}

function validateSelection(
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  modules: readonly ModuleMetadata[],
  semanticByteLength: number,
): Result.Result<void, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  if (selection.kind !== reservation.commandKind) {
    return Result.fail(
      producerError("produce", "contentMismatch", { path: "selection.kind" }),
    );
  }
  if (!isNonNegativeSafeInteger(semanticByteLength)) {
    return Result.fail(
      producerError("produce", "contentMismatch", {
        path: "semanticByteLength",
      }),
    );
  }
  switch (selection.kind) {
    case "source_page": {
      const first = Number(selection.firstModuleOrdinal);
      const count = Number(selection.moduleCount);
      if (first + count > modules.length) {
        return Result.fail(
          producerError("produce", "contentMismatch", {
            path: "selection.moduleRange",
          }),
        );
      }
      return Result.succeed(undefined);
    }
    case "parse_module":
      return Number(selection.moduleOrdinal) < modules.length
        ? Result.succeed(undefined)
        : Result.fail(
          producerError("produce", "contentMismatch", {
            path: "selection.moduleOrdinal",
          }),
        );
    case "registration_page":
    case "link_page":
      return Result.succeed(undefined);
  }
}

function preflightTransport(
  input: CapturedInput,
  progress: EncodedProgress,
  modules: readonly ModuleMetadata[],
  semanticByteLength: number,
): Result.Result<
  PreflightUsage,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const frameLengths: number[] = [
    1 + 4 + progress.reservationBytes.byteLength +
      4 + progress.commandBudgetBytes.byteLength,
  ];
  let payloadBytes =
    progress.reservationBytes.byteLength + progress.commandBudgetBytes.byteLength;
  switch (input.selection.kind) {
    case "source_page": {
      const first = Number(input.selection.firstModuleOrdinal);
      const count = Number(input.selection.moduleCount);
      for (let index = first; index < first + count; index += 1) {
        const module = modules[index]!;
        frameLengths.push(1 + 8 + 4 + 4 + module.pathByteLength + 32 + 32 + 8);
        payloadBytes += module.pathByteLength;
      }
      break;
    }
    case "parse_module": {
      const module = modules[Number(input.selection.moduleOrdinal)]!;
      frameLengths.push(
        1 + 8 + 4 + 4 + module.pathByteLength + 32 + 32 + 8,
      );
      payloadBytes += module.pathByteLength + module.sourceByteLength;
      if (
        !appendPayloadFrameLengths(
          frameLengths,
          module.sourceByteLength,
          1 + 8 + 8 + 4,
        )
      ) {
        return tooManyFrames(input.transportBudget.maximumFrames);
      }
      break;
    }
    case "registration_page":
      payloadBytes += semanticByteLength;
      if (
        !appendPayloadFrameLengths(
          frameLengths,
          semanticByteLength,
          1 + 8 + 4,
        )
      ) {
        return tooManyFrames(input.transportBudget.maximumFrames);
      }
      break;
    case "link_page":
      break;
  }
  frameLengths.push(1 + (5 * 8));
  const frames = frameLengths.length;
  const budget = input.transportBudget;
  if (
    frames > DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 ||
    frames > budget.maximumFrames
  ) {
    return Result.fail(producerError("produce", "budgetExceeded", {
      path: "transport.frames",
      observed: BigInt(frames),
      maximum: BigInt(Math.min(
        budget.maximumFrames,
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
      )),
    }));
  }
  const largestFrame = Math.max(...frameLengths);
  if (largestFrame > budget.maximumFrameBytes) {
    return Result.fail(producerError("produce", "budgetExceeded", {
      path: "transport.frameBytes",
      observed: BigInt(largestFrame),
      maximum: BigInt(budget.maximumFrameBytes),
    }));
  }
  if (payloadBytes > budget.maximumPayloadBytes) {
    return Result.fail(producerError("produce", "budgetExceeded", {
      path: "transport.payloadBytes",
      observed: BigInt(payloadBytes),
      maximum: BigInt(budget.maximumPayloadBytes),
    }));
  }
  const frameBytes = frameLengths.reduce(
    (sum, length) => sum + 4 + length,
    0,
  );
  const bodyBytes = REQUEST_PREFIX_BYTES + frameBytes;
  const transitions = bodyBytes + frames;
  const checks = [
    ["transport.bodyBytes", bodyBytes, budget.maximumBodyBytes],
    ["transport.canonicalBytes", bodyBytes, budget.maximumCanonicalBytes],
    ["transport.frameBytes", frameBytes, budget.maximumFrameBytes],
    ["transport.transitions", transitions, budget.maximumTransitions],
  ] as const;
  for (const [path, observed, maximum] of checks) {
    if (observed > maximum) {
      return Result.fail(producerError("produce", "budgetExceeded", {
        path,
        observed: BigInt(observed),
        maximum: BigInt(maximum),
      }));
    }
  }
  return Result.succeed(Object.freeze({
    bodyBytes,
    canonicalBytes: bodyBytes,
    frameBytes,
    payloadBytes,
    frames,
    transitions,
  }));
}

function appendPayloadFrameLengths(
  lengths: number[],
  totalBytes: number,
  fixedBytes: number,
): boolean {
  const chunkCount = Math.ceil(
    totalBytes /
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
  );
  if (
    !Number.isSafeInteger(chunkCount) ||
    chunkCount >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 -
        lengths.length -
        1
  ) {
    return false;
  }
  let remaining = totalBytes;
  while (remaining > 0) {
    const length = Math.min(
      remaining,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
    );
    lengths.push(fixedBytes + length);
    remaining -= length;
  }
  return true;
}

function tooManyFrames(
  configuredMaximum: number,
): Result.Result<never, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  return Result.fail(producerError("produce", "budgetExceeded", {
    path: "transport.frames",
    observed: BigInt(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 + 1,
    ),
    maximum: BigInt(Math.min(
      configuredMaximum,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
    )),
  }));
}

function compareCommitment(
  expected: Uint8Array,
  actual: Uint8Array,
  commitment: Commitment,
): Result.Result<void, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  return bytesEqualFullScan(expected, actual)
    ? Result.succeed(undefined)
    : Result.fail(producerError("produce", "commitmentMismatch", {
      commitment,
      path: `reservation.${commitment}`,
    }));
}

function canonicalPreimage(domain: string, value: Json): Uint8Array {
  const json = encodeCanonicalJson(
    Object.freeze({ domain, version: 1, value }),
    issue => {
      throw new Error(
        `Authenticated command canonical preimage invariant: ${issue.reason}`,
      );
    },
  );
  return UTF8_ENCODER.encode(json);
}

function freshInputJson(
  receipt: DeclarativeV2AuthenticatedReadSessionReceiptV1,
  modules: readonly OwnedModuleMetadata[],
): Json {
  return Object.freeze({
    projectId: receipt.projectId,
    deploymentId: receipt.deploymentId,
    deploymentCreatedAt: receipt.deploymentCreatedAt,
    sourceUploadId: receipt.sourceUploadId,
    sourceGeneration: receipt.sourceGeneration,
    sourceMutationFence: receipt.sourceMutationFence,
    sourceRootSha256: hex(receipt.sourceRootSha256),
    sourceSelectorSha256: hex(receipt.sourceSelectorSha256),
    semanticUploadId: receipt.semanticUploadId,
    semanticGeneration: receipt.semanticGeneration,
    semanticMutationFence: receipt.semanticMutationFence,
    semanticRootSha256: hex(receipt.semanticRootSha256),
    semanticSelectorSha256: hex(receipt.semanticSelectorSha256),
    semanticAttemptIdentitySha256:
      hex(receipt.semanticAttemptIdentitySha256),
    moduleCount: String(receipt.moduleCount),
    semanticByteLength: String(receipt.semanticByteLength),
    modules: modules.map(module => moduleJson(module)),
  });
}

function moduleJson(module: OwnedModuleMetadata): Json {
  return Object.freeze({
    ordinal: String(module.ordinal),
    roles: module.roles,
    path: hex(module.pathBytes),
    frameSha256: hex(module.frameSha256),
    sourceSha256: hex(module.sourceSha256),
    sourceByteLength: String(module.sourceByteLength),
  });
}

function commandInputJson(
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  receipt: DeclarativeV2AuthenticatedReadSessionReceiptV1,
  modules: readonly OwnedModuleMetadata[],
  freshAuthenticatedInputSha256: Uint8Array,
): Json {
  const common = {
    commandKind: selection.kind,
    freshAuthenticatedInputSha256: hex(freshAuthenticatedInputSha256),
  };
  switch (selection.kind) {
    case "source_page": {
      const first = Number(selection.firstModuleOrdinal);
      const count = Number(selection.moduleCount);
      return Object.freeze({
        ...common,
        firstModuleOrdinal: selection.firstModuleOrdinal.toString(),
        moduleCount: selection.moduleCount.toString(),
        modules: modules.slice(first, first + count).map(moduleJson),
      });
    }
    case "parse_module":
      return Object.freeze({
        ...common,
        module: moduleJson(modules[Number(selection.moduleOrdinal)]!),
      });
    case "registration_page":
      return Object.freeze({
        ...common,
        semanticRootSha256: hex(receipt.semanticRootSha256),
        semanticSelectorSha256: hex(receipt.semanticSelectorSha256),
        semanticAttemptIdentitySha256:
          hex(receipt.semanticAttemptIdentitySha256),
        semanticByteLength: String(receipt.semanticByteLength),
      });
    case "link_page":
      return Object.freeze({
        ...common,
        sourceRootSha256: hex(receipt.sourceRootSha256),
        semanticRootSha256: hex(receipt.semanticRootSha256),
        moduleCount: String(receipt.moduleCount),
      });
  }
}

function rangeJson(
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  reservation: Pick<
    DeclarativeV2VerifierCommandReservationFrameV2,
    | "sequence"
    | "currentProgressSha256"
    | "predecessorReceiptSha256"
  >,
): Json {
  const selected = selection.kind === "source_page"
    ? {
      firstModuleOrdinal: selection.firstModuleOrdinal.toString(),
      moduleCount: selection.moduleCount.toString(),
    }
    : selection.kind === "parse_module"
    ? { moduleOrdinal: selection.moduleOrdinal.toString() }
    : {};
  return Object.freeze({
    commandKind: selection.kind,
    sequence: reservation.sequence.toString(),
    currentProgressSha256: hex(reservation.currentProgressSha256),
    predecessorReceiptSha256: reservation.predecessorReceiptSha256 === null
      ? null
      : hex(reservation.predecessorReceiptSha256),
    selection: Object.freeze(selected),
  });
}

function analyzerIdentityJson(release: PrivateAnalyzerReleaseTupleV1): Json {
  return Object.freeze({
    protocolIdentity: release.protocolIdentity,
    protocolVersion: release.protocolVersion,
    implementationIdentity: release.implementationIdentity,
    configurationIdentity: release.configurationIdentity,
  });
}

function verifierIdentityJson(
  identities: ReturnType<typeof installedPrivateAnalyzerVerifierIdentitiesV1>,
): Json {
  return Object.freeze({ ...identities });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!;
    output += "0123456789abcdef"[byte >>> 4]!;
    output += "0123456789abcdef"[byte & 0x0f]!;
  }
  return output;
}

const buildFrames = Effect.fn(
  "DeclarativeV2AuthenticatedCommandProducer.buildFrames",
)(function* (
  sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1,
  request: Request,
  session: unknown,
  selection: DeclarativeV2AuthenticatedCommandSelectionV1,
  progress: EncodedProgress,
  modules: readonly OwnedModuleMetadata[],
  semanticByteLength: number,
): Effect.fn.Return<
  readonly DeclarativeV2AuthenticatedCommandFrameV1[],
  | DeclarativeV2AuthenticatedCommandProducerV1Error
  | import("./AuthenticatedVerifierReadSession").DeclarativeV2AuthenticatedReadSessionAccessError,
  never
> {
  const frames: DeclarativeV2AuthenticatedCommandFrameV1[] = [
    Object.freeze({
      kind: "command_header" as const,
      reservation: progress.reservation,
      commandBudget: progress.commandBudget,
    }),
  ];
  let firstModuleOrdinal = 0n;
  let moduleCount = 0n;
  let sourceByteLength = 0n;
  let semanticLength = 0n;
  switch (selection.kind) {
    case "source_page": {
      firstModuleOrdinal = selection.firstModuleOrdinal;
      moduleCount = selection.moduleCount;
      const first = Number(selection.firstModuleOrdinal);
      const count = Number(selection.moduleCount);
      for (let index = first; index < first + count; index += 1) {
        frames.push(moduleFrame(modules[index]!));
      }
      break;
    }
    case "parse_module": {
      const ordinal = Number(selection.moduleOrdinal);
      const metadata = modules[ordinal]!;
      firstModuleOrdinal = selection.moduleOrdinal;
      moduleCount = 1n;
      sourceByteLength = BigInt(metadata.sourceByteLength);
      frames.push(moduleFrame(metadata));
      if (metadata.sourceByteLength > 0) {
        const module = yield* Effect.fromResult(
          sessions.moduleAt(request, session, ordinal),
        );
        const cursor = yield* Effect.fromResult(
          sessions.sourceCursor(request, module),
        );
        let offset = 0;
        while (offset < metadata.sourceByteLength) {
          const read = yield* Effect.fromResult(sessions.readCursor(
            request,
            cursor,
            Math.min(
              metadata.sourceByteLength - offset,
              DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
            ),
          ));
          if (
            read.offset !== offset + read.bytes.byteLength ||
            read.bytes.byteLength === 0
          ) {
            return yield* new DeclarativeV2AuthenticatedCommandProducerV1Error({
              operation: "produce",
              reason: "contentMismatch",
              path: "sourceCursor",
            });
          }
          frames.push(Object.freeze({
            kind: "source_bytes" as const,
            moduleOrdinal: selection.moduleOrdinal,
            offset: BigInt(offset),
            bytes: copyBytes(read.bytes),
          }));
          offset = read.offset;
          if (read.status === "complete" && offset !== metadata.sourceByteLength) {
            return yield* new DeclarativeV2AuthenticatedCommandProducerV1Error({
              operation: "produce",
              reason: "contentMismatch",
              path: "sourceCursor",
            });
          }
          yield* Effect.yieldNow;
        }
      }
      break;
    }
    case "registration_page": {
      semanticLength = BigInt(semanticByteLength);
      if (semanticByteLength > 0) {
        const cursor = yield* Effect.fromResult(
          sessions.semanticCursor(request, session),
        );
        let offset = 0;
        while (offset < semanticByteLength) {
          const read = yield* Effect.fromResult(sessions.readCursor(
            request,
            cursor,
            Math.min(
              semanticByteLength - offset,
              DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
            ),
          ));
          if (
            read.offset !== offset + read.bytes.byteLength ||
            read.bytes.byteLength === 0
          ) {
            return yield* new DeclarativeV2AuthenticatedCommandProducerV1Error({
              operation: "produce",
              reason: "contentMismatch",
              path: "semanticCursor",
            });
          }
          frames.push(Object.freeze({
            kind: "semantic_bytes" as const,
            offset: BigInt(offset),
            bytes: copyBytes(read.bytes),
          }));
          offset = read.offset;
          if (read.status === "complete" && offset !== semanticByteLength) {
            return yield* new DeclarativeV2AuthenticatedCommandProducerV1Error({
              operation: "produce",
              reason: "contentMismatch",
              path: "semanticCursor",
            });
          }
          yield* Effect.yieldNow;
        }
      }
      break;
    }
    case "link_page":
      break;
  }
  frames.push(Object.freeze({
    kind: "command_terminal" as const,
    firstModuleOrdinal,
    moduleCount,
    sourceByteLength,
    semanticByteLength: semanticLength,
    payloadFrameCount: BigInt(frames.length - 1),
  }));
  return Object.freeze(frames);
});

function moduleFrame(
  module: OwnedModuleMetadata,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return Object.freeze({
    kind: "module_metadata",
    moduleOrdinal: BigInt(module.ordinal),
    roles: module.roles,
    modulePathBytes: copyBytes(module.pathBytes),
    frameSha256: copyBytes(module.frameSha256),
    sourceSha256: copyBytes(module.sourceSha256),
    sourceByteLength: BigInt(module.sourceByteLength),
  });
}

function requireUsageMatches(
  expected: PreflightUsage,
  actual: DeclarativeV2AuthenticatedCommandEncodedRequestV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  const keys = [
    "bodyBytes",
    "canonicalBytes",
    "frameBytes",
    "payloadBytes",
    "frames",
    "transitions",
  ] as const;
  for (const key of keys) {
    if (expected[key] !== actual.usage[key]) {
      return Result.fail(
        producerError("produce", "contentMismatch", {
          path: `transportUsage.${key}`,
        }),
      );
    }
  }
  return Result.succeed(undefined);
}

function requireReceiptIdentityMatches(
  initial: DeclarativeV2AuthenticatedReadSessionReceiptV1,
  final: DeclarativeV2AuthenticatedReadSessionReceiptV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  const scalarKeys = [
    "projectId",
    "deploymentId",
    "deploymentCreatedAt",
    "sourceUploadId",
    "sourceGeneration",
    "sourceMutationFence",
    "semanticUploadId",
    "semanticGeneration",
    "semanticMutationFence",
    "moduleCount",
    "semanticByteLength",
  ] as const;
  for (const key of scalarKeys) {
    if (initial[key] !== final[key]) {
      return Result.fail(producerError("produce", "contentMismatch", {
        path: `finalReceipt.${key}`,
      }));
    }
  }
  const digestKeys = [
    "sourceRootSha256",
    "sourceSelectorSha256",
    "semanticRootSha256",
    "semanticSelectorSha256",
    "semanticAttemptIdentitySha256",
  ] as const;
  for (const key of digestKeys) {
    if (!bytesEqualFullScan(initial[key], final[key])) {
      return Result.fail(producerError("produce", "contentMismatch", {
        path: `finalReceipt.${key}`,
      }));
    }
  }
  return Result.succeed(undefined);
}

function requireContentReadWithinCommandBudget(
  receipt: DeclarativeV2AuthenticatedReadSessionReceiptV1,
  commandBudget: CommandBudgetFrame,
): Result.Result<void, DeclarativeV2AuthenticatedCommandProducerV1Error> {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const observed = receipt.budget.commandUsage[dimension];
    const maximum = commandBudget[dimension];
    if (observed > maximum) {
      return Result.fail(producerError("produce", "budgetExceeded", {
        path: `contentRead.${dimension}`,
        observed,
        maximum,
      }));
    }
  }
  return Result.succeed(undefined);
}

function ownReceipt(
  receipt: DeclarativeV2AuthenticatedCommandProducerReceiptV1,
): DeclarativeV2AuthenticatedCommandProducerReceiptV1 {
  return Object.freeze({
    ...receipt,
    attemptSha256: copyBytes(receipt.attemptSha256),
    candidateSha256: copyBytes(receipt.candidateSha256),
    reservationSha256: copyBytes(receipt.reservationSha256),
    requestSha256: copyBytes(receipt.requestSha256),
    freshAuthenticatedInputSha256:
      copyBytes(receipt.freshAuthenticatedInputSha256),
    commandInputSha256: copyBytes(receipt.commandInputSha256),
    rangeAndPredecessorTailsSha256:
      copyBytes(receipt.rangeAndPredecessorTailsSha256),
    analyzerIdentitySha256: copyBytes(receipt.analyzerIdentitySha256),
    verifierIdentitySha256: copyBytes(receipt.verifierIdentitySha256),
    contentRead: Object.freeze({
      usage: ownBudget(receipt.contentRead.usage),
      commandUsage: ownBudget(receipt.contentRead.commandUsage),
    }),
    transport: Object.freeze({ ...receipt.transport }),
  });
}

function ownBudget(
  value: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({ ...value });
}

function getResult(
  results: WeakMap<object, ResultState>,
  request: Request,
  value: unknown,
  operation: Operation,
): Result.Result<
  ResultState,
  DeclarativeV2AuthenticatedCommandProducerV1Error
> {
  const state = value !== null && typeof value === "object"
    ? results.get(value)
    : undefined;
  if (state === undefined) {
    return Result.fail(producerError(operation, "invalidAuthority"));
  }
  if (state.request !== request) {
    return Result.fail(producerError(operation, "wrongRequest"));
  }
  if (state.closed) {
    return Result.fail(producerError(operation, "closed"));
  }
  return Result.succeed(state);
}

function closeResultState(
  state: ResultState,
  cursors: WeakMap<object, CursorState>,
): void {
  state.closed = true;
  if (state.cursor !== undefined) {
    const cursor = cursors.get(state.cursor);
    if (cursor !== undefined) cursor.closed = true;
  }
}

function makeResultHandle(): DeclarativeV2AuthenticatedCommandResultV1 {
  return Object.freeze(Object.defineProperty({}, RESULT_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })) as DeclarativeV2AuthenticatedCommandResultV1;
}

function makeCursorHandle(): DeclarativeV2AuthenticatedCommandCursorV1 {
  return Object.freeze(Object.defineProperty({}, CURSOR_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })) as DeclarativeV2AuthenticatedCommandCursorV1;
}

function isNonNegativeSafeBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_SAFE_BIGINT;
}

function isPositiveSafeBigInt(value: unknown): value is bigint {
  return isNonNegativeSafeBigInt(value) && value > 0n && value <= U64_MAX;
}
