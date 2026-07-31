import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  makePrivateApplicationRevisionRegistrationEvidenceBridgeV1,
  type PrivateApplicationRevisionRegistrationEvidencePortV1,
} from "../src/PrivateApplicationRevisionRegistrationEvidence";

describe("private application revision registration evidence bridge", () => {
  it("retains opaque backend authority and maps claim failures without structural fallback", async () => {
    const definition = preparedDefinition();
    const evidence = Object.freeze({ _tag: "test-evidence" as const });
    const candidate = candidateProjection(definition);
    const candidates = new WeakMap<object, {
      readonly definition: PreparedStandardApplicationDefinitionV1;
    }>([[evidence, { definition }]]);
    const port: PrivateApplicationRevisionRegistrationEvidencePortV1<
      typeof evidence,
      TestEvidenceFailure
    > = Object.freeze({
      issueRegistrationEvidence: () => Effect.succeed(evidence),
      bindRegistrationEvidence: (
        received: typeof evidence,
        _request: Request,
        _result: unknown,
        _receivedPreparation: object,
      ) => {
        if (received !== evidence) {
          return Result.fail(new TestEvidenceFailure({
            reason: "invalidAuthority",
          }));
        }
        return Result.succeed(received);
      },
      claimRegistrationCandidate: (
        receivedDefinition: PreparedStandardApplicationDefinitionV1,
        received: unknown,
      ) =>
        typeof received === "object" &&
          received !== null &&
          candidates.get(received)?.definition === receivedDefinition
          ? Result.succeed(candidate)
          : Result.fail(new TestEvidenceFailure({
            reason: "invalidAuthority",
            path: "candidate",
          })),
      claimRegistrationCommand: () =>
        Result.fail(new TestEvidenceFailure({
          reason: "contentMismatch",
          path: "registrationPreparation",
        })),
    });
    const bridge =
      makePrivateApplicationRevisionRegistrationEvidenceBridgeV1(port);
    const issued = await Effect.runPromise(bridge.issue(
      new Request("https://analyzer.test/registration-evidence"),
      Object.freeze({}),
      definition,
    ));
    const claimedCandidate = Result.getOrThrow(
      bridge.authority.claimCandidate(definition, issued),
    );
    const cloned = bridge.authority.claimCandidate(
      definition,
      Object.freeze({ ...issued }),
    );
    if (Result.isSuccess(cloned)) {
      throw new Error("Expected private evidence claims to fail.");
    }

    expect(claimedCandidate).toEqual(candidate);
    expect(cloned.failure).toMatchObject({
      _tag: "ApplicationRevisionRegistrationEvidenceV1Error",
      reason: "authorityChanged",
      path: "candidate",
    });
  });
});

class TestEvidenceFailure extends Error {
  readonly reason: string;
  readonly path?: string;

  constructor(input: Readonly<{ readonly reason: string; readonly path?: string }>) {
    super(input.reason);
    this.reason = input.reason;
    if (input.path !== undefined) this.path = input.path;
  }
}

function preparedDefinition(): PreparedStandardApplicationDefinitionV1 {
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
        sourceBytes: new TextEncoder().encode("export const ready = 1;\n"),
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

function candidateProjection(
  definition: PreparedStandardApplicationDefinitionV1,
) {
  return Object.freeze({
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-31T00:00:00.000Z",
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticAttemptIdentitySha256: digest(5),
    sourceModules: Object.freeze(
      definition.artifactIngressPlan.source.modules.map((module, ordinal) =>
        Object.freeze({
          ordinal,
          artifactModulePath: module.path,
          roles: module.roles,
          sourceByteLength: module.sourceBytes.byteLength,
          sourceSha256: digest(6 + ordinal),
        })
      ),
    ),
    semanticByteLength:
      definition.artifactIngressPlan.semantic.bytes.byteLength,
    semanticStreamSha256: digest(7),
    semanticModelIdentity: "semantic-model",
    semanticCodecIdentity: "semantic-codec",
    semanticPolicyIdentity: "semantic-policy",
    coreLanguageIdentity: "javascript",
    abiIdentity: "abi",
    grammarIdentity: "grammar",
    unicodeIdentity: "unicode",
    parserTableIdentity: "parser",
    analyzerIdentitySha256: digest(8),
    verifierIdentitySha256: digest(9),
    deploymentAnalysisCodecIdentity: "analysis-codec",
    deploymentAnalysisByteLength: 10n,
    deploymentAnalysisSha256: digest(10),
    deploymentCodegenAnalysisCodecIdentity: "codegen-codec",
    deploymentCodegenAnalysisByteLength: 11n,
    deploymentCodegenAnalysisSha256: digest(11),
  });
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
