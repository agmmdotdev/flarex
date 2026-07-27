import { createHash } from "node:crypto";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1,
  decodeDeclarativeV2ArtifactUploadCommandV1,
  decodeDeclarativeV2ArtifactUploadResponseV1,
  declarativeV2ArtifactUploadCommandMediaTypeV1,
  declarativeV2ArtifactUploadResponseMediaTypeV1,
  encodeDeclarativeV2ArtifactUploadCommandV1,
  encodeDeclarativeV2ArtifactUploadResponseV1,
  type DeclarativeV2ArtifactUploadTransportBudgetV1,
} from "../src/declarative-v2-artifact-upload-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
} from "../src/declarative-v2-source-artifact-v2";

const SOURCE_UPLOAD_ID = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
const SEMANTIC_UPLOAD_ID = "118f22e2-58cc-7b2a-91d8-f3f3401a0874";
const SOURCE_COMMAND_KEY = "218f22e2-58cc-7b2a-91d8-f3f3401a0874";
const SEMANTIC_COMMAND_KEY = "318f22e2-58cc-7b2a-91d8-f3f3401a0874";
const DIGEST_A = "11".repeat(32);
const DIGEST_B = "22".repeat(32);
const DIGEST_C = "33".repeat(32);
const DIGEST_D = "44".repeat(32);

const transportBudget: DeclarativeV2ArtifactUploadTransportBudgetV1 =
  Object.freeze({
    maximumRequestCalls: 1,
    maximumMetadataBytes: 64_000,
    maximumPayloadBytes: 64_000,
    maximumFrameBytes: 128_000,
    maximumResponseBytes: 64_000,
    maximumElapsedMilliseconds: 5_000,
  });

const sourceCeilings = Object.freeze({
  calls: 40,
  blockBytes: 100_000,
  modules: 20,
  sourceMaps: 20,
  canonicalBytes: 200_000,
  frameBytes: 300_000,
  hashBytes: 200_000,
  timeMilliseconds: 10_000,
});

const sourceAdmission = Object.freeze({
  calls: 1,
  blockBytes: 10_000,
  modules: 1,
  sourceMaps: 1,
  canonicalBytes: 20_000,
  frameBytes: 30_000,
  hashBytes: 20_000,
  timeMilliseconds: 1_000,
});

const semanticCeilings = Object.freeze({
  calls: 1_000,
  blockBytes: 1_000_000,
  canonicalBytes: 1_000_000,
  frameBytes: 1_000_000,
  hashBytes: 1_000_000,
  timeMilliseconds: 100_000,
});

const semanticAdmission = Object.freeze({
  calls: 100,
  blockBytes: 100_000,
  canonicalBytes: 100_000,
  frameBytes: 100_000,
  hashBytes: 100_000,
  timeMilliseconds: 10_000,
});

const scopeLookupCumulative = Object.freeze({
  maximumLookupCalls: 4,
  maximumInputBytes: 4_000,
  maximumBodyBytes: 8_000,
  maximumCanonicalBytes: 8_000,
  maximumFrameBytes: 12_000,
  maximumElapsedMilliseconds: 2_000,
});

const scopeLookupCommand = Object.freeze({
  maximumLookupCalls: 2,
  maximumInputBytes: 2_000,
  maximumBodyBytes: 4_000,
  maximumCanonicalBytes: 4_000,
  maximumFrameBytes: 6_000,
  maximumElapsedMilliseconds: 1_000,
});

const sourceReadCumulative = Object.freeze({
  maximumCalls: 8,
  maximumInputBytes: 8_000,
  maximumBodyBytes: 16_000,
  maximumCanonicalBytes: 16_000,
  maximumFrameBytes: 24_000,
  maximumHashBytes: 16_000,
  maximumElapsedMilliseconds: 4_000,
});

const sourceReadCommand = Object.freeze({
  maximumCalls: 4,
  maximumInputBytes: 4_000,
  maximumBodyBytes: 8_000,
  maximumCanonicalBytes: 8_000,
  maximumFrameBytes: 12_000,
  maximumHashBytes: 8_000,
  maximumElapsedMilliseconds: 2_000,
});

describe("Declarative V2 private artifact upload protocol V1", () => {
  it("pins the private media types and intentional package subpath", async () => {
    expect(DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1).toBe(1);
    expect(declarativeV2ArtifactUploadCommandMediaTypeV1).toBe(
      "application/vnd.flarex.declarative-v2-artifact-upload-command-v1",
    );
    expect(declarativeV2ArtifactUploadResponseMediaTypeV1).toBe(
      "application/vnd.flarex.declarative-v2-artifact-upload-response-v1+json",
    );
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-artifact-upload-v1",
      "./src/declarative-v2-artifact-upload-v1.ts",
    );
    expect(root).not.toHaveProperty(
      "encodeDeclarativeV2ArtifactUploadCommandV1",
    );
  });

  it("round-trips every command with deterministic framing and golden digests", () => {
    const commands = makeCommands();
    const firstDigests: string[] = [];
    const secondDigests: string[] = [];
    for (const command of commands) {
      const first = success(
        encodeDeclarativeV2ArtifactUploadCommandV1(command, transportBudget),
      );
      const second = success(
        encodeDeclarativeV2ArtifactUploadCommandV1(command, transportBudget),
      );
      const decoded = success(
        decodeDeclarativeV2ArtifactUploadCommandV1(
          first.canonicalBytes,
          transportBudget,
        ),
      );
      expect(second.canonicalBytes).toEqual(first.canonicalBytes);
      expect(decoded.canonicalBytes).toEqual(first.canonicalBytes);
      expect(decoded.canonicalBytes).not.toBe(first.canonicalBytes);
      expect(decoded.command).toEqual(first.command);
      expect(first.usage.frameBytes).toBe(
        4 + first.usage.metadataBytes + first.usage.payloadBytes,
      );
      firstDigests.push(sha256Hex(first.canonicalBytes));
      secondDigests.push(sha256Hex(second.canonicalBytes));
    }
    expect(secondDigests).toEqual(firstDigests);
    expect(firstDigests).toEqual([
      "a07e0d7ec7a51764f511e50c594a5750aed024be0bc8817ec81911600e1055b0",
      "6ca5877324b9136a33d2d614c1766800a5e49cc055072fdbff26453ab04d6945",
      "1217c5e2ba6a77c46e6eb2419dcd242143a1238797e66395b144bbe0c369fb91",
      "52dc9273df73ed31abffbe5575b7dd174bb712ea04069746e54ff167b234fade",
      "ee916300a6030ee663769b41b6ad0580a825c18e274436b1f022752a6a93e32b",
      "d08dbfff45a774db0f98d6d0a48592f52c1418632edc05daed4accb5ae7785c2",
      "d5a20be944fbd19be3b4ec909b74c1f7f0b2de7d2f71261513b7862bae4e1eca",
      "db37fcb140c1d492d482ece1ade1ca115b855fa13615e9f2de54a1a6094cc4ee",
      "2d6be4b32ad1930550a666e7672306659c770722a9dbe5a665f25f275783765b",
      "022b72d88ac9aa6fb92dd9d57683fabcfdc525e0849f000e497740c4b03091fe",
      "286fdb954cad167680a46d49d4f98c21b7a952dad9a23eec2c92849fc8d7b508",
      "146d8e26b4eb659b8ff64afaff58cdddbc4368fde1bccd3bd1a5f37a2ab44ae7",
    ]);
  });

  it("keeps raw payload outside canonical metadata and owns every byte view", () => {
    const inputPayload = Uint8Array.of(0, 1, 2, 255);
    const command = sourceCommand("appendBlock", {
      admission: sourceAdmission,
      blockIndex: 0,
      expectedFence: 3,
      generation: 1,
      payloadBytes: inputPayload,
      stream: "source",
    });
    const encoded = success(
      encodeDeclarativeV2ArtifactUploadCommandV1(command, transportBudget),
    );
    const metadataLength = new DataView(
      encoded.canonicalBytes.buffer,
      encoded.canonicalBytes.byteOffset,
      4,
    ).getUint32(0, false);
    const metadataText = new TextDecoder().decode(
      encoded.canonicalBytes.slice(4, 4 + metadataLength),
    );
    expect(metadataText).not.toContain("payloadBytes");
    expect(metadataText).not.toContain("AAEC/w");
    expect(encoded.canonicalBytes.slice(4 + metadataLength)).toEqual(
      Uint8Array.of(0, 1, 2, 255),
    );

    inputPayload.fill(9);
    expect(encoded.command.operation).toBe("appendBlock");
    if (encoded.command.operation !== "appendBlock") {
      throw new Error("Expected source append block.");
    }
    expect(encoded.command.payloadBytes).toEqual(Uint8Array.of(0, 1, 2, 255));

    const decoded = success(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        encoded.canonicalBytes,
        transportBudget,
      ),
    );
    encoded.canonicalBytes.fill(7);
    expect(decoded.command.operation).toBe("appendBlock");
    if (decoded.command.operation !== "appendBlock") {
      throw new Error("Expected decoded source append block.");
    }
    expect(decoded.command.payloadBytes).toEqual(Uint8Array.of(0, 1, 2, 255));
    expect(decoded.canonicalBytes).not.toEqual(encoded.canonicalBytes);
  });

  it("enforces exact byte ceilings and rejects missing or trailing payloads", () => {
    const append = success(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("appendBlock", {
          admission: sourceAdmission,
          blockIndex: 0,
          expectedFence: 0,
          generation: 1,
          payloadBytes: Uint8Array.of(1, 2, 3),
          stream: "source",
        }),
        transportBudget,
      ),
    );
    expect(Result.isSuccess(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        append.canonicalBytes,
        exactCommandBudget(append),
      ),
    )).toBe(true);
    for (const budget of [
      {
        ...exactCommandBudget(append),
        maximumMetadataBytes: append.usage.metadataBytes - 1,
      },
      {
        ...exactCommandBudget(append),
        maximumPayloadBytes: append.usage.payloadBytes - 1,
      },
      {
        ...exactCommandBudget(append),
        maximumFrameBytes: append.usage.frameBytes - 1,
      },
    ]) {
      expect(Result.isFailure(
        decodeDeclarativeV2ArtifactUploadCommandV1(
          append.canonicalBytes,
          budget,
        ),
      )).toBe(true);
    }

    const missingPayload = append.canonicalBytes.slice(
      0,
      append.canonicalBytes.byteLength - append.usage.payloadBytes,
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        missingPayload,
        transportBudget,
      ),
      "invalidInput",
      "payloadBytes",
    );

    const metadataOnly = success(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("observe", {
          budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
        }),
        transportBudget,
      ),
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        concat(metadataOnly.canonicalBytes, Uint8Array.of(1)),
        transportBudget,
      ),
      "invalidInput",
      "payloadBytes",
    );
  });

  it("fails malformed lengths, UTF-8, noncanonical JSON, and extra fields closed", () => {
    const encoded = success(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("observe", {
          budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
        }),
        transportBudget,
      ),
    );
    for (const malformed of [
      new Uint8Array(),
      Uint8Array.of(0, 0, 0),
      withU32Prefix(encoded.canonicalBytes, 0),
      withU32Prefix(encoded.canonicalBytes, encoded.canonicalBytes.byteLength),
    ]) {
      expect(Result.isFailure(
        decodeDeclarativeV2ArtifactUploadCommandV1(
          malformed,
          transportBudget,
        ),
      )).toBe(true);
    }

    const invalidUtf8 = frame(Uint8Array.of(0xc3, 0x28));
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        invalidUtf8,
        transportBudget,
      ),
      "malformedBytes",
      "metadata",
    );

    const metadata = metadataObject(encoded.canonicalBytes);
    const canonicalMetadata = new TextDecoder().decode(
      encoded.canonicalBytes.slice(
        4,
        4 + new DataView(
          encoded.canonicalBytes.buffer,
          encoded.canonicalBytes.byteOffset,
          4,
        ).getUint32(0, false),
      ),
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        frame(utf8(` ${JSON.stringify(metadata)}`)),
        transportBudget,
      ),
      "nonCanonicalBytes",
      "metadata",
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        frame(utf8(canonicalMetadata.replace(
          '"artifactKind":"source"',
          '"artifactKind":"source","artifactKind":"source"',
        ))),
        transportBudget,
      ),
      "nonCanonicalBytes",
      "metadata",
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        frame(utf8(JSON.stringify({ ...metadata, secret: "must-not-pass" }))),
        transportBudget,
      ),
      "invalidInput",
      "command",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        { ...sourceCommand("observe", {
          budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
        }), uploadId: SOURCE_UPLOAD_ID.toUpperCase() },
        transportBudget,
      ),
      "invalidInput",
      "uploadId",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        { ...sourceCommand("observe", {
          budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
        }), deploymentId: "\ud800" },
        transportBudget,
      ),
      "invalidInput",
      "deploymentId",
    );
  });

  it("validates attempt and nested semantic budgets without inventing defaults", () => {
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("begin", {
          admission: { ...sourceAdmission, calls: 2 },
          ceilings: sourceCeilings,
        }),
        transportBudget,
      ),
      "invalidInput",
      "admission.calls",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("begin", {
          admission: { ...sourceAdmission, blockBytes: 100_001 },
          ceilings: sourceCeilings,
        }),
        transportBudget,
      ),
      "invalidInput",
      "admission.blockBytes",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("appendBlock", {
          admission: { ...sourceAdmission, blockBytes: 2 },
          blockIndex: 0,
          expectedFence: 0,
          generation: 1,
          payloadBytes: Uint8Array.of(1, 2, 3),
          stream: "source",
        }),
        transportBudget,
      ),
      "invalidInput",
      "admission.blockBytes",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        semanticCommand("begin", {
          ...semanticBeginFields(),
          authorizationBudget: {
            cumulative: scopeLookupCumulative,
            command: {
              ...scopeLookupCommand,
              maximumLookupCalls: scopeLookupCumulative.maximumLookupCalls + 1,
            },
          },
        }),
        transportBudget,
      ),
      "invalidInput",
      "authorizationBudget.command.maximumLookupCalls",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        semanticCommand("begin", {
          ...semanticBeginFields(),
          finalizedSourceReadBudget: {
            cumulative: sourceReadCumulative,
            command: {
              ...sourceReadCommand,
              maximumHashBytes: sourceReadCumulative.maximumHashBytes + 1,
            },
          },
        }),
        transportBudget,
      ),
      "invalidInput",
      "finalizedSourceReadBudget.command.maximumHashBytes",
    );
    expectFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        makeCommands()[0],
        { ...transportBudget, maximumRequestCalls: 0 },
      ),
      "invalidBudget",
      "budget.maximumRequestCalls",
    );
    const normalizedZero = success(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("appendBlock", {
          admission: sourceAdmission,
          blockIndex: -0,
          expectedFence: -0,
          generation: 1,
          payloadBytes: Uint8Array.of(1),
          stream: "source",
        }),
        transportBudget,
      ),
    );
    expect(normalizedZero.command.operation).toBe("appendBlock");
    if (normalizedZero.command.operation !== "appendBlock") {
      throw new Error("Expected normalized append command.");
    }
    expect(Object.is(normalizedZero.command.blockIndex, -0)).toBe(false);
    expect(Object.is(normalizedZero.command.expectedFence, -0)).toBe(false);
    expect(success(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        normalizedZero.canonicalBytes,
        transportBudget,
      ),
    ).command).toEqual(normalizedZero.command);
  });

  it("round-trips bounded checkpoint and redacted wire-error responses", () => {
    const responses: readonly unknown[] = [
      sourceSuccessResponse(),
      semanticSuccessResponse(),
      {
        codecVersion: 1,
        kind: "error",
        operation: "append",
        commandKey: SEMANTIC_COMMAND_KEY,
        error: {
          class: "resourceUncertain",
          reason: "settlement",
          retryDisposition: "exactAfterObserve",
          artifactKind: "semantic",
          uploadId: SEMANTIC_UPLOAD_ID,
        },
      },
      {
        codecVersion: 1,
        kind: "error",
        operation: null,
        commandKey: null,
        error: {
          class: "invalidCommand",
          reason: "malformedFrame",
          retryDisposition: "never",
          artifactKind: null,
          uploadId: null,
        },
      },
    ];
    const digests = responses.map((response) => {
      const first = success(
        encodeDeclarativeV2ArtifactUploadResponseV1(
          response,
          transportBudget,
        ),
      );
      const second = success(
        decodeDeclarativeV2ArtifactUploadResponseV1(
          first.canonicalBytes,
          transportBudget,
        ),
      );
      expect(second.response).toEqual(first.response);
      expect(second.canonicalBytes).toEqual(first.canonicalBytes);
      expect(second.canonicalBytes).not.toBe(first.canonicalBytes);
      return sha256Hex(first.canonicalBytes);
    });
    expect(digests).toEqual([
      "a2fb24e501b401e0b7d4bc1bae6045556e69cae7310e407bb209a301729cc274",
      "98aa2c3dcb522604a891a8bc14b26ff3e0ac1a5e38036fc8aa61d3ee52398c68",
      "3b48f1c6fd6a4aeb88e651413a4332c4bf49824f5c38574fb1902e569fec171b",
      "aac23423b3eed987a6c25ee9ede9ddff1f8e39acd5d5af9beaf193183cf234d8",
    ]);
  });

  it("binds response operation, command identity, lifecycle, and retry authority", () => {
    expectResponseInvalid({
      ...sourceSuccessResponse(),
      commandKey: SEMANTIC_COMMAND_KEY,
    });
    expectResponseInvalid({
      ...sourceSuccessResponse(),
      operation: "append",
    });
    const observed = sourceSuccessResponse();
    expect(Result.isSuccess(
      encodeDeclarativeV2ArtifactUploadResponseV1({
        ...observed,
        operation: "observe",
        commandKey: SEMANTIC_COMMAND_KEY,
      }, transportBudget),
    )).toBe(true);
    const openSource = sourceSuccessResponse();
    expectResponseInvalid({
      ...openSource,
      checkpoint: {
        ...openSource.checkpoint,
        completed: null,
        lifecycle: "open",
      },
    });
    const openWithCompleted = sourceSuccessResponse();
    expectResponseInvalid({
      ...openWithCompleted,
      checkpoint: { ...openWithCompleted.checkpoint, lifecycle: "open" },
    });
    expectResponseInvalid({
      ...sourceSuccessResponse(),
      checkpoint: {
        ...sourceSuccessResponse().checkpoint,
        currentModule: {
          nextSourceBlockIndex: 0,
          nextSourceMapBlockIndex: 0,
          path: "orders.js",
          sourceMapStarted: false,
        },
      },
    });
    const openCheckpoint = {
      ...sourceSuccessResponse().checkpoint,
      completed: null,
      currentModule: {
        nextSourceBlockIndex: 0,
        nextSourceMapBlockIndex: 0,
        path: "orders.js",
        sourceMapStarted: false,
      },
      lifecycle: "open",
    };
    expectResponseInvalid({
      ...sourceSuccessResponse(),
      operation: "begin",
      checkpoint: openCheckpoint,
    });
    for (const operation of ["beginModule", "appendBlock"] as const) {
      expectResponseInvalid({
        ...sourceSuccessResponse(),
        operation,
        checkpoint: { ...openCheckpoint, currentModule: null },
      });
    }
    expectResponseInvalid({
      ...sourceSuccessResponse(),
      operation: "closeModule",
      checkpoint: openCheckpoint,
    });
    for (const currentModule of [
      {
        ...openCheckpoint.currentModule,
        nextSourceMapBlockIndex: 1,
        sourceMapStarted: false,
      },
      {
        ...openCheckpoint.currentModule,
        nextSourceMapBlockIndex: 0,
        sourceMapStarted: true,
      },
    ]) {
      expectResponseInvalid({
        ...sourceSuccessResponse(),
        operation: "appendBlock",
        checkpoint: { ...openCheckpoint, currentModule },
      });
    }
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: "appendBlock",
      commandKey: SOURCE_COMMAND_KEY,
      error: {
        class: "resourceUncertain",
        reason: "confirmedRollback",
        retryDisposition: "exactNow",
        artifactKind: "source",
        uploadId: SOURCE_UPLOAD_ID,
      },
    });
    expect(Result.isSuccess(
      encodeDeclarativeV2ArtifactUploadResponseV1({
        codecVersion: 1,
        kind: "error",
        operation: "append",
        commandKey: SEMANTIC_COMMAND_KEY,
        error: {
          class: "resourceUncertain",
          reason: "confirmedRollback",
          retryDisposition: "exactNow",
          artifactKind: "semantic",
          uploadId: SEMANTIC_UPLOAD_ID,
        },
      }, transportBudget),
    )).toBe(true);
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: "append",
      commandKey: SEMANTIC_COMMAND_KEY,
      error: {
        class: "resourceUncertain",
        reason: "resource",
        retryDisposition: "exactNow",
        artifactKind: "semantic",
        uploadId: SEMANTIC_UPLOAD_ID,
      },
    });
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: "append",
      commandKey: SEMANTIC_COMMAND_KEY,
      error: {
        class: "invalidCommand",
        reason: "malformedFrame",
        retryDisposition: "never",
        artifactKind: "semantic",
        uploadId: SEMANTIC_UPLOAD_ID,
        message: "secret",
        cause: "foreign",
      },
    });
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: null,
      commandKey: null,
      error: {
        class: "invalidCommand",
        reason: "malformedFrame",
        retryDisposition: "never",
        artifactKind: null,
        uploadId: SOURCE_UPLOAD_ID,
      },
    });
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: null,
      commandKey: null,
      error: {
        class: "resourceUncertain",
        reason: "settlement",
        retryDisposition: "exactAfterObserve",
        artifactKind: "semantic",
        uploadId: SEMANTIC_UPLOAD_ID,
      },
    });
    expectResponseInvalid({
      codecVersion: 1,
      kind: "error",
      operation: "observe",
      commandKey: SEMANTIC_COMMAND_KEY,
      error: {
        class: "resourceUncertain",
        reason: "confirmedRollback",
        retryDisposition: "exactNow",
        artifactKind: "semantic",
        uploadId: SEMANTIC_UPLOAD_ID,
      },
    });
  });

  it("admits exact response ceiling only and rejects noncanonical response JSON", () => {
    const encoded = success(
      encodeDeclarativeV2ArtifactUploadResponseV1(
        sourceSuccessResponse(),
        transportBudget,
      ),
    );
    expect(Result.isSuccess(
      decodeDeclarativeV2ArtifactUploadResponseV1(
        encoded.canonicalBytes,
        {
          ...transportBudget,
          maximumResponseBytes: encoded.canonicalBytes.byteLength,
        },
      ),
    )).toBe(true);
    expectFailure(
      decodeDeclarativeV2ArtifactUploadResponseV1(
        encoded.canonicalBytes,
        {
          ...transportBudget,
          maximumResponseBytes: encoded.canonicalBytes.byteLength - 1,
        },
      ),
      "responseBytesExceeded",
    );
    expectFailure(
      decodeDeclarativeV2ArtifactUploadResponseV1(
        concat(utf8(" "), encoded.canonicalBytes),
        transportBudget,
      ),
      "nonCanonicalBytes",
      "response",
    );
  });

  it("rejects hostile records and invalid byte receivers without invoking accessors", () => {
    let getterReads = 0;
    const accessor = {
      ...sourceCommand("observe", {
        budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
      }),
      get commandKey() {
        getterReads += 1;
        throw new Error("must not run");
      },
    };
    expect(Result.isFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        accessor,
        transportBudget,
      ),
    )).toBe(true);
    expect(getterReads).toBe(0);

    const proxy = new Proxy(sourceCommand("begin", {
      ceilings: sourceCeilings,
      admission: sourceAdmission,
    }), {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(Result.isFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(proxy, transportBudget),
    )).toBe(true);
    const revoked = Proxy.revocable(sourceCommand("begin", {
      ceilings: sourceCeilings,
      admission: sourceAdmission,
    }), {});
    revoked.revoke();
    expect(Result.isFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        revoked.proxy,
        transportBudget,
      ),
    )).toBe(true);

    let oversizedDescriptorReads = 0;
    const oversized = new Proxy(
      Object.fromEntries(
        Array.from({ length: 14 }, (_, index) => [`field${index}`, index]),
      ),
      {
        getOwnPropertyDescriptor(target, property) {
          oversizedDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    expect(Result.isFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        oversized,
        transportBudget,
      ),
    )).toBe(true);
    expect(oversizedDescriptorReads).toBe(0);

    const detached = Uint8Array.of(1);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(
      encodeDeclarativeV2ArtifactUploadCommandV1(
        sourceCommand("appendBlock", {
          admission: sourceAdmission,
          blockIndex: 0,
          expectedFence: 0,
          generation: 1,
          payloadBytes: detached,
          stream: "source",
        }),
        transportBudget,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2ArtifactUploadCommandV1(
        new Proxy(Uint8Array.of(1, 2, 3, 4), {}),
        transportBudget,
      ),
    )).toBe(true);
  });
});

function makeCommands(): readonly unknown[] {
  return [
    sourceCommand("begin", {
      ceilings: sourceCeilings,
      admission: sourceAdmission,
    }),
    sourceCommand("beginModule", {
      admission: sourceAdmission,
      environment: "isolate",
      expectedFence: 1,
      generation: 1,
      path: "_flarex/execution.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
    }),
    sourceCommand("appendBlock", {
      admission: sourceAdmission,
      blockIndex: 0,
      expectedFence: 2,
      generation: 1,
      payloadBytes: Uint8Array.of(1, 2, 3, 4),
      stream: "source",
    }),
    sourceCommand("closeModule", {
      admission: sourceAdmission,
      expectedFence: 3,
      generation: 1,
    }),
    sourceCommand("finalize", {
      admission: sourceAdmission,
      expectedFence: 4,
      generation: 1,
    }),
    sourceCommand("observe", {
      budget: { maximumCalls: 1, maximumStoredBytes: 10_000 },
    }),
    sourceCommand("abandon", {
      admission: sourceAdmission,
      expectedFence: 5,
      generation: 1,
    }),
    semanticCommand("begin", semanticBeginFields()),
    semanticCommand("append", {
      admission: semanticAdmission,
      blockOrdinal: 0,
      expectedFence: 1,
      generation: 1,
      payloadBytes: utf8('{"kind":"function"}\n'),
    }),
    semanticCommand("finalize", {
      admission: semanticAdmission,
      expectedFence: 2,
      generation: 1,
    }),
    semanticCommand("observe", {
      budget: { maximumCalls: 2, maximumStoredBytes: 20_000 },
    }),
    semanticCommand("abandon", {
      admission: semanticAdmission,
      expectedFence: 3,
      generation: 1,
    }),
  ];
}

function sourceCommand(
  operation: string,
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    artifactKind: "source",
    codecVersion: 1,
    commandKey: SOURCE_COMMAND_KEY,
    deploymentId: "deployment-primary",
    operation,
    uploadId: SOURCE_UPLOAD_ID,
    ...fields,
  };
}

function semanticCommand(
  operation: string,
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    artifactKind: "semantic",
    codecVersion: 1,
    commandKey: SEMANTIC_COMMAND_KEY,
    deploymentId: "deployment-primary",
    operation,
    uploadId: SEMANTIC_UPLOAD_ID,
    ...fields,
  };
}

function semanticBeginFields(): Readonly<Record<string, unknown>> {
  return {
    admission: semanticAdmission,
    authorizationBudget: {
      cumulative: scopeLookupCumulative,
      command: scopeLookupCommand,
    },
    ceilings: semanticCeilings,
    finalizedSourceReadBudget: {
      cumulative: sourceReadCumulative,
      command: sourceReadCommand,
    },
    sourceGeneration: 1,
    sourceMutationFence: 5,
    sourceUploadId: SOURCE_UPLOAD_ID,
  };
}

function sourceSuccessResponse() {
  return {
    codecVersion: 1,
    kind: "success",
    operation: "finalize",
    commandKey: SOURCE_COMMAND_KEY,
    checkpoint: {
      artifactKind: "source",
      uploadId: SOURCE_UPLOAD_ID,
      lifecycle: "finalized",
      generation: 1,
      mutationFence: 6,
      acceptedCommandKey: SOURCE_COMMAND_KEY,
      nextModuleOrdinal: 1,
      currentModule: null,
      usage: sourceAdmission,
      completed: {
        rootSha256: DIGEST_A,
        selectorSha256: DIGEST_B,
      },
    },
  };
}

function semanticSuccessResponse() {
  return {
    codecVersion: 1,
    kind: "success",
    operation: "finalize",
    commandKey: SEMANTIC_COMMAND_KEY,
    checkpoint: {
      artifactKind: "semantic",
      uploadId: SEMANTIC_UPLOAD_ID,
      lifecycle: "finalized",
      generation: 1,
      mutationFence: 3,
      acceptedCommandKey: SEMANTIC_COMMAND_KEY,
      nextBlockOrdinal: 1,
      usage: semanticAdmission,
      completed: {
        rootSha256: DIGEST_C,
        selectorSha256: DIGEST_D,
        sourceUploadId: SOURCE_UPLOAD_ID,
        sourceGeneration: 1,
        sourceMutationFence: 5,
        sourceRootSha256: DIGEST_A,
        sourceSelectorSha256: DIGEST_B,
      },
    },
  };
}

function exactCommandBudget(
  encoded: Readonly<{
    readonly usage: {
      readonly metadataBytes: number;
      readonly payloadBytes: number;
      readonly frameBytes: number;
    };
  }>,
): DeclarativeV2ArtifactUploadTransportBudgetV1 {
  return {
    ...transportBudget,
    maximumMetadataBytes: encoded.usage.metadataBytes,
    maximumPayloadBytes: encoded.usage.payloadBytes,
    maximumFrameBytes: encoded.usage.frameBytes,
  };
}

function metadataObject(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    4,
  ).getUint32(0, false);
  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(bytes.slice(4, 4 + length)),
  );
  if (!isNonArrayRecord(parsed)) {
    throw new Error("Expected command metadata object.");
  }
  return parsed;
}

function expectResponseInvalid(input: unknown): void {
  expectFailure(
    encodeDeclarativeV2ArtifactUploadResponseV1(input, transportBudget),
    "invalidInput",
  );
}

function expectFailure(
  result: Result.Result<
    unknown,
    Readonly<{ readonly reason: string; readonly field?: string }>
  >,
  reason: string,
  field?: string,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure.reason).toBe(reason);
    if (field !== undefined) expect(result.failure.field).toBe(field);
  }
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.getOrThrow(result);
}

function frame(metadata: Uint8Array, payload = new Uint8Array()): Uint8Array {
  return concat(u32(metadata.byteLength), metadata, payload);
}

function withU32Prefix(bytes: Uint8Array, value: number): Uint8Array {
  const output = new Uint8Array(bytes);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
