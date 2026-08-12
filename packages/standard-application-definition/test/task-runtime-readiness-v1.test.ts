import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Brand, Effect, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import { describe, expect, expectTypeOf, it } from "vitest";

import { produceStandardApplicationSource } from "../src/applicationSource";
import { produceApplicationTaskBindingsV1 } from
  "../src/applicationTaskBinding/v1";
import {
  completeTaskRuntimeReadinessVerification,
  decodeTaskRuntimeReadinessBasisPreimageV1,
  decodeTaskRuntimePublicationReceiptPreimageV1,
  encodeTaskRuntimeReadinessBasisPreimageV1,
  encodeTaskRuntimePublicationReceiptPreimageV1,
  hashCanonicalTaskCatalogV1,
  hashTaskRuntimeReadinessBasisV1,
  makeStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthorityV1,
  prepareTaskRuntimeReadinessVerification,
  prepareTaskRuntimePublicationV1,
  taskRuntimeObjectKeyV1,
  verifyTaskRuntimeReadiness,
  type CompleteTaskRuntimeReadinessVerificationError,
  type PreparedTaskRuntimeReadinessVerification,
  type PreparedTaskRuntimeReadinessBasisV1,
  type PrepareTaskRuntimeReadinessVerificationError,
  type TaskDefinitionSha256V1,
  type TaskRuntimeReadinessVerificationInput,
  type TaskRuntimePublicationPreparationInputV1,
  type VerifyTaskRuntimeReadinessError,
} from "../src/taskDefinition/v1";
import { prepareStandardApplicationDefinitionV1 } from "../src/v1";

const UTF8 = new TextEncoder();
const TEXT = new TextDecoder();
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");
const digest = (byte: number) =>
  new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;

describe("task runtime readiness V1", () => {
  it("prepares owned receipt membership before bodies and completes the exact handle", async () => {
    const fixture = await readinessFixture();
    const preparationInput = {
      receiptCanonicalBytes: fixture.verificationInput.receiptCanonicalBytes,
      receiptSha256: fixture.verificationInput.receiptSha256,
      expected: fixture.verificationInput.expected,
    };

    expectTypeOf(prepareTaskRuntimeReadinessVerification(
      preparationInput,
      sha256,
    )).toEqualTypeOf<Effect.Effect<
      PreparedTaskRuntimeReadinessVerification,
      PrepareTaskRuntimeReadinessVerificationError
    >>();
    const prepared = await Effect.runPromise(
      prepareTaskRuntimeReadinessVerification(preparationInput, sha256),
    );
    const references = prepared.readRuntimeObjectReferences();
    expect(references).toEqual(fixture.verificationInput.runtimeObjects.map(
      object => object.reference,
    ));
    expect(Object.isFrozen(references)).toBe(true);
    references[0]!.sha256.fill(0);
    expect(prepared.readRuntimeObjectReferences()[0]!.sha256).toEqual(
      fixture.verificationInput.runtimeObjects[0]!.reference.sha256,
    );

    const completionInput = {
      prepared,
      runtimeObjects: fixture.verificationInput.runtimeObjects,
    };
    expectTypeOf(completeTaskRuntimeReadinessVerification(
      completionInput,
    )).toEqualTypeOf<Effect.Effect<
      PreparedTaskRuntimeReadinessBasisV1,
      CompleteTaskRuntimeReadinessVerificationError
    >>();
    const completed = await Effect.runPromise(
      completeTaskRuntimeReadinessVerification(completionInput),
    );
    expect(completed.readBasis()).toMatchObject({
      kind: "populated",
      objectCount: 7n,
    });

    await expect(Effect.runPromise(completeTaskRuntimeReadinessVerification({
      prepared: {
        readRuntimeObjectReferences: prepared.readRuntimeObjectReferences,
      },
      runtimeObjects: fixture.verificationInput.runtimeObjects,
    }))).rejects.toMatchObject({
      _tag: "InvalidTaskRuntimeReadinessV1Error",
      reason: "invalid_input",
      path: "prepared",
    });
  });

  it("rejects malformed, mismatched, and unsupported expected evidence during preparation", async () => {
    const fixture = await readinessFixture();
    const cases = [
      {
        expected: {
          ...fixture.verificationInput.expected,
          scopeId: " scope-orders",
        },
        reason: "invalid_input",
      },
      {
        expected: {
          ...fixture.verificationInput.expected,
          candidateSha256: digest(0xee),
        },
        reason: "authoritative_evidence_mismatch",
      },
      {
        expected: {
          ...fixture.verificationInput.expected,
          materializationPolicy: {
            ...fixture.verificationInput.expected.materializationPolicy,
            runtimeImplementationVersion: "worker-loader-other",
          },
        },
        reason: "runtime_policy_unsupported",
      },
    ] as const;

    for (const testCase of cases) {
      await expect(Effect.runPromise(prepareTaskRuntimeReadinessVerification({
        receiptCanonicalBytes: fixture.verificationInput.receiptCanonicalBytes,
        receiptSha256: fixture.verificationInput.receiptSha256,
        expected: testCase.expected,
      }, sha256))).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimeReadinessV1Error",
        reason: testCase.reason,
      });
    }

    const receipt = Result.getOrThrow(
      decodeTaskRuntimePublicationReceiptPreimageV1(
        fixture.verificationInput.receiptCanonicalBytes,
      ),
    );
    const taskEntryIndex = receipt.runtimeObjects.findIndex(
      membership => membership.reference.role === "task_runtime_entry",
    );
    const taskEntry = receipt.runtimeObjects[taskEntryIndex]!;
    const additionalTaskEntrySha256 = digest(0xac);
    const cardinalityDriftBytes = Result.getOrThrow(
      encodeTaskRuntimePublicationReceiptPreimageV1({
        ...receipt,
        runtimeObjects: [
          ...receipt.runtimeObjects.slice(0, taskEntryIndex + 1),
          {
            ...taskEntry,
            ordinal: 1n,
            reference: {
              ...taskEntry.reference,
              objectKey: taskRuntimeObjectKeyV1(
                "task_runtime_entry",
                encodeBytesToLowercaseHex(additionalTaskEntrySha256),
              ),
              sha256: additionalTaskEntrySha256,
            },
          },
          ...receipt.runtimeObjects.slice(taskEntryIndex + 1),
        ],
      }),
    );
    const cardinalityDriftSha256 = await Effect.runPromise(sha256(
      cardinalityDriftBytes,
      { maximumInputBytes: cardinalityDriftBytes.byteLength },
    )) as TaskDefinitionSha256V1;
    await expect(Effect.runPromise(prepareTaskRuntimeReadinessVerification({
      receiptCanonicalBytes: cardinalityDriftBytes,
      receiptSha256: cardinalityDriftSha256,
      expected: fixture.verificationInput.expected,
    }, sha256))).rejects.toMatchObject({
      _tag: "InvalidTaskRuntimeReadinessV1Error",
      reason: "authoritative_evidence_mismatch",
      path: "expected.taskCatalog.entries",
    });
  });

  it("copies shared-backed expected digests before asynchronous preparation", async () => {
    const fixture = await readinessFixture();
    const sharedCandidateSha256 = new Uint8Array(new SharedArrayBuffer(32));
    sharedCandidateSha256.set(fixture.verificationInput.expected.candidateSha256);
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    const gatedSha256 = makeStandardApplicationTaskSha256V1((input) => {
      calls += 1;
      if (calls !== 1) return nativeDigest("SHA-256", input);
      started();
      return releasePromise.then(() => nativeDigest("SHA-256", input));
    });

    const pending = Effect.runPromise(prepareTaskRuntimeReadinessVerification({
      receiptCanonicalBytes: fixture.verificationInput.receiptCanonicalBytes,
      receiptSha256: fixture.verificationInput.receiptSha256,
      expected: {
        ...fixture.verificationInput.expected,
        candidateSha256: sharedCandidateSha256 as TaskDefinitionSha256V1,
      },
    }, gatedSha256));
    await startedPromise;
    sharedCandidateSha256.fill(0);
    release();

    const prepared = await pending;
    expect(prepared.readRuntimeObjectReferences()).toHaveLength(7);
  });

  it("cold-verifies a populated publication and owns its canonical basis", async () => {
    const fixture = await readinessFixture();

    expectTypeOf(verifyTaskRuntimeReadiness(fixture.verificationInput, sha256))
      .toEqualTypeOf<Effect.Effect<
        PreparedTaskRuntimeReadinessBasisV1,
        VerifyTaskRuntimeReadinessError
      >>();
    const verified = await Effect.runPromise(
      verifyTaskRuntimeReadiness(fixture.verificationInput, sha256),
    );
    const basis = verified.readBasis();
    const canonicalBytes = verified.readCanonicalBytes();

    expect(basis).toMatchObject({
      version: 1,
      kind: "populated",
      scopeId: "scope-orders",
      candidateId: "candidate-orders",
      applicationRevisionId: "revision-orders-v2",
      taskCount: 1n,
      objectCount: 7n,
      runtimeImplementationVersion: "worker-loader-2026.08.12",
      supportedComputeProfiles: ["standard-1x"],
    });
    expect(basis.canonicalObjectByteLength).toBeGreaterThan(0n);
    expect(decodeTaskRuntimeReadinessBasisPreimageV1(canonicalBytes))
      .toEqual(Result.succeed(basis));
    expect(encodeTaskRuntimeReadinessBasisPreimageV1(basis))
      .toEqual(Result.succeed(canonicalBytes));
    expect(await Effect.runPromise(
      hashTaskRuntimeReadinessBasisV1(basis, sha256),
    )).toEqual(verified.readSha256());
    expect(Object.isFrozen(basis)).toBe(true);
    expect(Object.isFrozen(basis.compatibilityFlags)).toBe(true);

    basis.candidateSha256.fill(0);
    canonicalBytes.fill(0);
    const replayed = verified.readBasis();
    expect(replayed.candidateSha256).toEqual(
      fixture.verificationInput.expected.candidateSha256,
    );
    expect(verified.readCanonicalBytes()[0]).not.toBe(0);
  });

  it("verifies an explicit empty catalog with zero runtime bodies", async () => {
    const fixture = await readinessFixture(true);
    const verified = await Effect.runPromise(
      verifyTaskRuntimeReadiness(fixture.verificationInput, sha256),
    );

    expect(verified.readBasis()).toMatchObject({
      kind: "empty",
      taskCount: 0n,
      objectCount: 0n,
      canonicalObjectByteLength: 0n,
      taskRuntimeProjectionSha256: null,
      taskRuntimeGroupManifestSha256: null,
      taskRuntimeMaterializationSpecSha256: null,
    });
  });

  it("rejects missing, reordered, mismatched-reference, and digest-corrupt bodies", async () => {
    const fixture = await readinessFixture();
    const objects = fixture.verificationInput.runtimeObjects;
    const first = objects[0]!;
    const cases: ReadonlyArray<readonly [
      TaskRuntimeReadinessVerificationInput,
      string,
    ]> = [
      [{
        ...fixture.verificationInput,
        runtimeObjects: objects.slice(1),
      }, "runtime_object_mismatch"],
      [{
        ...fixture.verificationInput,
        runtimeObjects: [objects[1]!, objects[0]!, ...objects.slice(2)],
      }, "runtime_object_mismatch"],
      [{
        ...fixture.verificationInput,
        runtimeObjects: [{
          ...first,
          reference: { ...first.reference, objectKey: `${first.reference.objectKey}-wrong` },
        }, ...objects.slice(1)],
      }, "runtime_object_mismatch"],
      [{
        ...fixture.verificationInput,
        runtimeObjects: [{
          ...first,
          canonicalBytes: new Uint8Array(first.canonicalBytes).fill(0),
        }, ...objects.slice(1)],
      }, "runtime_object_mismatch"],
    ];

    for (const [input, reason] of cases) {
      await expect(Effect.runPromise(
        verifyTaskRuntimeReadiness(input, sha256),
      )).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimeReadinessV1Error",
        operation: "verify_readiness",
        reason,
      });
    }
  });

  it("rejects noncanonical, wrong-codec, and wrong-ordinal runtime bodies", async () => {
    const fixture = await readinessFixture();
    const first = fixture.verificationInput.runtimeObjects[0]!;
    const originalText = TEXT.decode(first.canonicalBytes);
    const cases: ReadonlyArray<readonly [Uint8Array, string]> = [
      [UTF8.encode(` ${originalText}`), "runtime_object_invalid"],
      [UTF8.encode(originalText.replace(
        "flarex.standard-application/task-runtime-projection-module/v1",
        "flarex.standard-application/task-runtime-projection/v1",
      )), "runtime_object_invalid"],
      [UTF8.encode(originalText.replace(
        '"moduleOrdinal":"0"',
        '"moduleOrdinal":"1"',
      )), "runtime_object_mismatch"],
    ];

    for (const [canonicalBytes, reason] of cases) {
      const changed = await replaceRuntimeObjectBody(fixture, 0, canonicalBytes);
      await expect(Effect.runPromise(
        verifyTaskRuntimeReadiness(changed, sha256),
      )).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimeReadinessV1Error",
        reason,
      });
    }
  });

  it("recomputes graph roots and rejects a self-consistent receipt with a drifted group body", async () => {
    const fixture = await readinessFixture();
    const groupIndex = fixture.verificationInput.runtimeObjects.findIndex(
      object => object.reference.role === "task_runtime_group_manifest",
    );
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    const original = fixture.verificationInput.runtimeObjects[groupIndex]!;
    const changedBytes = UTF8.encode(TEXT.decode(original.canonicalBytes).replace(
      '"taskCount":"1"',
      '"taskCount":"2"',
    ));
    const changed = await replaceRuntimeObjectBody(
      fixture,
      groupIndex,
      changedBytes,
      true,
    );

    await expect(Effect.runPromise(
      verifyTaskRuntimeReadiness(changed, sha256),
    )).rejects.toMatchObject({
      _tag: "InvalidTaskRuntimeReadinessV1Error",
      reason: "runtime_root_mismatch",
    });
  });

  it("rejects authoritative catalog, receipt, and admitted-policy drift", async () => {
    const fixture = await readinessFixture();
    const cases: ReadonlyArray<readonly [
      TaskRuntimeReadinessVerificationInput,
      string,
    ]> = [
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          scopeId: " scope-orders",
        },
      }, "invalid_input"],
      [{ ...fixture.verificationInput, receiptSha256: digest(0xee) },
        "receipt_digest_mismatch"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          candidateSha256: digest(0xdd),
        },
      }, "authoritative_evidence_mismatch"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          taskCatalog: {
            ...fixture.verificationInput.expected.taskCatalog,
            taskCatalogSha256: digest(0xcc),
          },
        },
      }, "authoritative_evidence_mismatch"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          materializationPolicy: {
            ...fixture.verificationInput.expected.materializationPolicy,
            runtimeImplementationVersion: "worker-loader-other",
          },
        },
      }, "runtime_policy_unsupported"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          materializationPolicy: {
            ...fixture.verificationInput.expected.materializationPolicy,
            compatibilityDate: "2026-08-13",
          },
        },
      }, "runtime_policy_unsupported"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          materializationPolicy: {
            ...fixture.verificationInput.expected.materializationPolicy,
            compatibilityFlags: [],
          },
        },
      }, "runtime_policy_unsupported"],
      [{
        ...fixture.verificationInput,
        expected: {
          ...fixture.verificationInput.expected,
          materializationPolicy: {
            ...fixture.verificationInput.expected.materializationPolicy,
            supportedComputeProfiles: [
              Brand.nominal<TaskComputeProfileRefV1>()("large-2x"),
            ],
          },
        },
      }, "runtime_policy_unsupported"],
    ];

    for (const [input, reason] of cases) {
      await expect(Effect.runPromise(
        verifyTaskRuntimeReadiness(input, sha256),
      )).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimeReadinessV1Error",
        reason,
      });
    }
  });

  it("captures all evidence before asynchronous hashing and rejects hostile input", async () => {
    const fixture = await readinessFixture();
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const gatedSha256 = makeStandardApplicationTaskSha256V1((input) => {
      calls += 1;
      if (calls !== 1) return nativeDigest("SHA-256", input);
      started();
      return releasePromise.then(() => nativeDigest("SHA-256", input));
    });
    const pending = Effect.runPromise(
      verifyTaskRuntimeReadiness(fixture.verificationInput, gatedSha256),
    );
    await startedPromise;
    fixture.verificationInput.receiptSha256.fill(0);
    fixture.verificationInput.runtimeObjects[0]!.canonicalBytes.fill(0);
    fixture.verificationInput.expected.taskCatalog.taskCatalogSha256.fill(0);
    release();
    expect((await pending).readBasis().kind).toBe("populated");

    let invoked = false;
    const hostile = Object.defineProperty({}, "expected", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("must not run");
      },
    });
    const hostileResult = await Effect.runPromise(Effect.result(
      verifyTaskRuntimeReadiness(
        hostile as TaskRuntimeReadinessVerificationInput,
        sha256,
      ),
    ));
    expect(Result.isFailure(hostileResult)).toBe(true);
    expect(invoked).toBe(false);

    const buffer = new ArrayBuffer(1);
    const detached = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    await expect(Effect.runPromise(verifyTaskRuntimeReadiness({
      ...fixture.verificationInput,
      receiptCanonicalBytes: detached,
    }, sha256))).rejects.toMatchObject({ reason: "invalid_input" });
  });

  it("rejects noncanonical and internally contradictory basis preimages", async () => {
    const fixture = await readinessFixture();
    const verified = await Effect.runPromise(
      verifyTaskRuntimeReadiness(fixture.verificationInput, sha256),
    );
    const basis = verified.readBasis();
    const canonical = verified.readCanonicalBytes();

    expect(Result.isFailure(decodeTaskRuntimeReadinessBasisPreimageV1(
      UTF8.encode(` ${TEXT.decode(canonical)}`),
    ))).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimeReadinessBasisPreimageV1({
      ...basis,
      kind: "empty",
    }))).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimeReadinessBasisPreimageV1({
      ...basis,
      compatibilityFlags: ["nodejs_compat", "nodejs_compat"],
    }))).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimeReadinessBasisPreimageV1({
      ...basis,
      objectCount: 1n,
    }))).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimeReadinessBasisPreimageV1({
      ...basis,
      taskRuntimeProjectionSha256: null,
    }))).toBe(true);

    const projectionHex = encodeBytesToLowercaseHex(
      basis.taskRuntimeProjectionSha256!,
    );
    const mixedNullCanonical = TEXT.decode(canonical).replace(
      `"taskRuntimeProjectionSha256":"${projectionHex}"`,
      `"taskRuntimeProjectionSha256":null`,
    );
    expect(mixedNullCanonical).not.toBe(TEXT.decode(canonical));
    expect(Result.isFailure(decodeTaskRuntimeReadinessBasisPreimageV1(
      UTF8.encode(mixedNullCanonical),
    ))).toBe(true);
  });
});

interface ReadinessFixture {
  readonly publicationInput: TaskRuntimePublicationPreparationInputV1;
  readonly verificationInput: TaskRuntimeReadinessVerificationInput;
}

async function readinessFixture(empty = false): Promise<ReadinessFixture> {
  const publicationInput = await makeInput(empty);
  const publication = await Effect.runPromise(
    prepareTaskRuntimePublicationV1(publicationInput, sha256),
  );
  const receiptAuthority = makeTaskRuntimePublicationReceiptAuthorityV1(sha256);
  const receipt = await Effect.runPromise(receiptAuthority.prepareReceipt(
    publication,
    publication.objects.map(object => Result.getOrThrow(
      receiptAuthority.confirmPublishedObject(object, object.readReference()),
    )),
  ));
  return {
    publicationInput,
    verificationInput: {
      receiptCanonicalBytes: receipt.readCanonicalBytes(),
      receiptSha256: receipt.readSha256(),
      expected: {
        scopeId: publicationInput.authority.candidate.scopeId,
        candidateId: publicationInput.authority.candidateId,
        applicationRevisionId: publicationInput.authority.applicationRevisionId,
        candidateSha256: publicationInput.authority.candidateSha256,
        taskCatalogBindingSha256: publicationInput.taskBindings.catalog.sha256,
        taskCatalog: publicationInput.catalog,
        packageSha256: publicationInput.authority.candidate.packageSha256,
        artifactSha256: publicationInput.authority.candidate.artifactSha256,
        sourceRootSha256: publicationInput.authority.candidate.sourceRootSha256,
        semanticRootSha256: publicationInput.authority.candidate.semanticRootSha256,
        materializationPolicy: publicationInput.policy.materialization,
      },
      runtimeObjects: publication.objects.map(object => ({
        reference: object.readReference(),
        canonicalBytes: object.readCanonicalBytes(),
      })),
    },
  };
}

async function replaceRuntimeObjectBody(
  fixture: ReadinessFixture,
  index: number,
  canonicalBytes: Uint8Array,
  updateSingletonDigest = false,
): Promise<TaskRuntimeReadinessVerificationInput> {
  const original = fixture.verificationInput.runtimeObjects[index];
  if (original === undefined) throw new Error("Expected runtime object.");
  const bodySha256 = await Effect.runPromise(sha256(canonicalBytes, {
    maximumInputBytes: canonicalBytes.byteLength,
  })) as TaskDefinitionSha256V1;
  const reference = {
    ...original.reference,
    objectKey: taskRuntimeObjectKeyV1(
      original.reference.role,
      encodeBytesToLowercaseHex(bodySha256),
    ),
    byteLength: BigInt(canonicalBytes.byteLength),
    sha256: bodySha256,
  };
  const receiptResult = decodeTaskRuntimePublicationReceiptPreimageV1(
    fixture.verificationInput.receiptCanonicalBytes,
  );
  const receipt = Result.getOrThrow(receiptResult);
  const runtimeObjects = receipt.runtimeObjects.map((item, itemIndex) =>
    itemIndex === index ? { ...item, reference } : item
  );
  const updatedReceipt = {
    ...receipt,
    runtimeObjects,
    ...(updateSingletonDigest && reference.role === "task_runtime_group_manifest"
      ? { taskRuntimeGroupManifestSha256: bodySha256 }
      : {}),
  };
  const receiptCanonicalBytes = Result.getOrThrow(
    encodeTaskRuntimePublicationReceiptPreimageV1(updatedReceipt),
  );
  const receiptSha256 = await Effect.runPromise(sha256(receiptCanonicalBytes, {
    maximumInputBytes: receiptCanonicalBytes.byteLength,
  })) as TaskDefinitionSha256V1;
  return {
    ...fixture.verificationInput,
    receiptCanonicalBytes,
    receiptSha256,
    runtimeObjects: fixture.verificationInput.runtimeObjects.map(
      (item, itemIndex) => itemIndex === index
        ? { reference, canonicalBytes }
        : item,
    ),
  };
}

async function makeInput(
  empty = false,
): Promise<TaskRuntimePublicationPreparationInputV1> {
  const definition = makeDefinition();
  const source = Result.getOrThrow(produceStandardApplicationSource(definition));
  const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: empty ? [] : [taskManifest()],
  }, sha256));
  const taskBindings = await Effect.runPromise(produceApplicationTaskBindingsV1({
    definition,
    catalog,
    authority: {
      scopeId: "scope-orders",
      revisionId: "revision-orders-v2",
      candidateId: "candidate-orders",
      analysisId: "analysis-orders",
      publicationSha256: "11".repeat(32),
      sourceArtifactRootSha256: "22".repeat(32),
    },
    runtimePolicy: {
      runtimeHostIdentity: "application-runtime-host",
      compatibilityDate: "2026-08-12",
    },
  }, sha256));
  const authenticatedModules = await Promise.all(
    source.modules.map(async (module, ordinal) => ({
      ordinal,
      artifactModulePath: module.path,
      roles: module.roles,
      sourceByteLength: module.sourceBytes.byteLength,
      sourceSha256: await Effect.runPromise(sha256(module.sourceBytes, {
        maximumInputBytes: module.sourceBytes.byteLength,
      })) as TaskDefinitionSha256V1,
    })),
  );
  const materialization = Object.freeze({
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: "flarex.task-runtime/durable-task/v1" as const,
    bridgeAbiIdentity: "flarex.task-runtime-rpc/v1" as const,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: "flarex.worker-loader/task-runtime/v1" as const,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles: Object.freeze([computeProfile]),
    moduleEntryPolicyIdentity:
      "flarex.task-runtime/module-entry/exact-artifact-path/v1" as const,
  });
  const candidate = makeCandidate();
  const encodedCandidate = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(
    candidate,
    { maximumFrameBytes: 1_024 * 1_024, maximumCanonicalBytes: 1_024 * 1_024 },
  ));
  const candidateSha256 = await Effect.runPromise(sha256(
    encodedCandidate.canonicalBytes,
    { maximumInputBytes: encodedCandidate.canonicalBytes.byteLength },
  )) as TaskDefinitionSha256V1;
  return {
    source,
    catalog,
    taskBindings,
    authority: {
      candidateId: "candidate-orders",
      candidate,
      candidateSha256,
      applicationRevisionId: "revision-orders-v2",
      authenticatedModules,
    },
    policy: {
      materialization,
      admittedCompatibilityDate: materialization.compatibilityDate,
      admittedCompatibilityFlags: materialization.compatibilityFlags,
      admittedRuntimeImplementationVersion:
        materialization.runtimeImplementationVersion,
      admittedComputeProfiles: materialization.supportedComputeProfiles,
    },
  };
}

function makeCandidate(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project-orders",
    deploymentId: "candidate-orders",
    deploymentCreatedAt: "2026-08-12T00:00:00.000Z",
    scopeId: "scope-orders",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: "scope-epoch-orders",
    sourceRootSha256: digest(0x22),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    runtimeProjectionSetSha256: digest(13),
    functionGroupManifestSha256: digest(14),
    readinessPolicyIdentity:
      "flarex.readiness/runtime-projection-cold-materialization/v1",
  };
}

function taskManifest() {
  return {
    version: 1 as const,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: { type: "any" as const },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1 as const,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" as const },
    },
    maximumDurationInSeconds: 300,
    computeProfile,
    queue: { kind: "default" as const },
  };
}

function makeDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "tasks/orders",
        functions: [{
          exportName: "lookup",
          kind: "query",
          visibility: "internal",
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
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "tasks/orders.js",
        roles: ["function", "execution"],
        sourceBytes: UTF8.encode(
          "export const lookup = () => null; export const run = () => null;\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "tasks/orders",
        artifactModulePath: "tasks/orders.js",
      }],
      executionPath: "tasks/orders.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}
