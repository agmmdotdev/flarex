import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_ID,
  SEMANTIC_ADMISSION,
  SEMANTIC_CEILINGS,
  SOURCE_ADMISSION,
  SOURCE_UPLOAD_A,
  SOURCE_UPLOAD_B,
  SOURCE_UPLOAD_C,
  driveCorrelation,
  driveSourcePlan,
  finalizedSourceProofInput,
  makeCorrelationFixture,
  materializedPlan,
  pushRequest,
  type CorrelationRunReceipt,
} from "./declarativeV2UploadCorrelationFixture";

describe("Declarative V2 in-memory upload-core correlation", () => {
  it("keeps content roots stable across cold lifecycle identities", async () => {
    const plan = materializedPlan();
    const first = await Effect.runPromise(driveCorrelation(
      makeCorrelationFixture({ semanticUploadId: "semantic-a" }),
      {
        plan,
        sourceUploadId: SOURCE_UPLOAD_A,
        semanticUploadId: "semantic-a",
      },
    ));
    const second = await Effect.runPromise(driveCorrelation(
      makeCorrelationFixture({ semanticUploadId: "semantic-b" }),
      {
        plan,
        sourceUploadId: SOURCE_UPLOAD_B,
        semanticUploadId: "semantic-b",
      },
    ));

    expect(second.sourceRootDigest).toBe(first.sourceRootDigest);
    expect(second.semanticRootDigest).toBe(first.semanticRootDigest);
    expect(second.sourceSelectorDigest).not.toBe(first.sourceSelectorDigest);
    expect(second.semanticSelectorDigest).not.toBe(first.semanticSelectorDigest);
    expect(second.semanticAttemptIdentityDigest)
      .not.toBe(first.semanticAttemptIdentityDigest);
    assertEvidenceCorrelation(first);
    assertEvidenceCorrelation(second);
  });

  it("binds the semantic root to backend-derived source content", async () => {
    const baselinePlan = materializedPlan("export const place = 1;\n");
    const changedPlan = materializedPlan("export const place = 2;\n");
    expect(changedPlan.semantic.bytes).toEqual(baselinePlan.semantic.bytes);

    const baseline = await Effect.runPromise(driveCorrelation(
      makeCorrelationFixture({ semanticUploadId: "semantic-source-a" }),
      {
        plan: baselinePlan,
        sourceUploadId: SOURCE_UPLOAD_A,
        semanticUploadId: "semantic-source-a",
      },
    ));
    const changed = await Effect.runPromise(driveCorrelation(
      makeCorrelationFixture({ semanticUploadId: "semantic-source-b" }),
      {
        plan: changedPlan,
        sourceUploadId: SOURCE_UPLOAD_C,
        semanticUploadId: "semantic-source-b",
      },
    ));

    expect(changed.sourceRootDigest).not.toBe(baseline.sourceRootDigest);
    expect(changed.semanticRootDigest).not.toBe(baseline.semanticRootDigest);
    assertEvidenceCorrelation(changed);
  });

  it("preserves source and semantic command budget failures", async () => {
    const plan = materializedPlan();
    const largestSourceBlock = Math.max(
      ...plan.source.modules.flatMap((module) => [
        module.sourceBytes.byteLength,
        module.sourceMapBytes?.byteLength ?? 0,
      ]),
    );
    const sourceFailure = await Effect.runPromise(Effect.flip(driveCorrelation(
      makeCorrelationFixture({ semanticUploadId: "semantic-source-budget" }),
      {
        plan,
        sourceUploadId: SOURCE_UPLOAD_A,
        semanticUploadId: "semantic-source-budget",
        sourceAdmission: {
          ...SOURCE_ADMISSION,
          blockBytes: largestSourceBlock - 1,
        },
      },
    )));
    expect(sourceFailure).toMatchObject({
      _tag: "SourceArtifactV2UploadBudgetError",
      operation: "appendBlock",
      resource: "blockBytes",
    });

    const semanticFailure = await Effect.runPromise(Effect.flip(
      driveCorrelation(
        makeCorrelationFixture({ semanticUploadId: "semantic-stream-budget" }),
        {
          plan,
          sourceUploadId: SOURCE_UPLOAD_B,
          semanticUploadId: "semantic-stream-budget",
          semanticAdmission: {
            ...SEMANTIC_ADMISSION,
            blockBytes: plan.semantic.bytes.byteLength - 1,
          },
        },
      ),
    ));
    expect(semanticFailure).toMatchObject({
      _tag: "SemanticArtifactV1BudgetError",
      operation: "append",
      dimension: "blockBytes",
      observed: plan.semantic.bytes.byteLength,
      maximum: plan.semantic.bytes.byteLength - 1,
    });
  });

  it("fails semantic admission when the source correlation reread drifts", async () => {
    const failure = await Effect.runPromise(Effect.flip(driveCorrelation(
      makeCorrelationFixture({
        semanticUploadId: "semantic-drift",
        sourceCorrelationGenerationDelta: 1,
      }),
      {
        plan: materializedPlan(),
        sourceUploadId: SOURCE_UPLOAD_A,
        semanticUploadId: "semantic-drift",
      },
    )));
    expect(failure).toMatchObject({
      _tag: "SemanticArtifactV1StateError",
      reason: "sourceDrift",
    });
  });

  it("keeps finalized-source proofs request-bound and single-use", async () => {
    const fixture = makeCorrelationFixture({
      semanticUploadId: "semantic-proof",
    });
    const source = await Effect.runPromise(driveSourcePlan(
      fixture.sourceCore,
      materializedPlan(),
      SOURCE_UPLOAD_A,
      SOURCE_ADMISSION,
    ));
    const request = pushRequest("proof");
    const proof = await Effect.runPromise(fixture.proofs.issue(
      request,
      finalizedSourceProofInput(source),
    ));
    const wrongRequestFailure = await Effect.runPromise(Effect.flip(
      fixture.semanticCore.begin({
        request: pushRequest("proof-wrong-request"),
        proof,
        deploymentId: DEPLOYMENT_ID,
        commandId: "semantic-proof-wrong-request",
        ceilings: SEMANTIC_CEILINGS,
        admission: SEMANTIC_ADMISSION,
      }),
    ));
    expect(wrongRequestFailure).toMatchObject({ reason: "wrongRequest" });

    await Effect.runPromise(fixture.semanticCore.begin({
      request,
      proof,
      deploymentId: DEPLOYMENT_ID,
      commandId: "semantic-proof-begin",
      ceilings: SEMANTIC_CEILINGS,
      admission: SEMANTIC_ADMISSION,
    }));
    const reusedFailure = await Effect.runPromise(Effect.flip(
      fixture.semanticCore.begin({
        request,
        proof,
        deploymentId: DEPLOYMENT_ID,
        commandId: "semantic-proof-reused",
        ceilings: SEMANTIC_CEILINGS,
        admission: SEMANTIC_ADMISSION,
      }),
    ));
    expect(reusedFailure).toMatchObject({ reason: "alreadyClaimed" });
  });
});

function assertEvidenceCorrelation(receipt: CorrelationRunReceipt): void {
  expect(receipt.evidence.sourceUploadId).toBe(receipt.sourceUploadId);
  expect(receipt.evidence.sourceGeneration).toBe(receipt.sourceGeneration);
  expect(receipt.evidence.sourceMutationFence)
    .toBe(receipt.sourceMutationFence);
  expect(encodeBytesToLowercaseHex(receipt.evidence.sourceRootSha256))
    .toBe(receipt.sourceRootDigest);
  expect(encodeBytesToLowercaseHex(receipt.evidence.sourceSelectorSha256))
    .toBe(receipt.sourceSelectorDigest);
  expect(receipt.evidence.semanticUploadId).toBe(receipt.semanticUploadId);
  expect(receipt.evidence.semanticGeneration).toBe(receipt.semanticGeneration);
  expect(receipt.evidence.semanticMutationFence)
    .toBe(receipt.semanticMutationFence);
  expect(encodeBytesToLowercaseHex(receipt.evidence.semanticRootSha256))
    .toBe(receipt.semanticRootDigest);
  expect(encodeBytesToLowercaseHex(receipt.evidence.semanticSelectorSha256))
    .toBe(receipt.semanticSelectorDigest);
}
