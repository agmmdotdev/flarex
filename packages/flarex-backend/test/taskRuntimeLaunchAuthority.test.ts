import {
  APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
} from "@flarex/analysis/application-analysis";
import {
  decodeApplicationTaskComputeDispatchRequestV1,
  decodeTaskComputeDispatchRequestV1,
  validateApplicationTaskComputeDispatchRequestV1,
  validateTaskComputeDispatchRequestV1,
  type TaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
  decodeApplicationTaskComputePreparedExecutionV1,
  decodeTaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-evidence-v1";
import {
  decodeApplicationTaskRunCreationAuthorityV1,
  decodeApplicationTaskRuntimeTargetV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeTaskDefinitionRuntimeBindingCommitmentV1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeCanonicalTaskManifestV1,
  decodeTaskRuntimeEntryFrameV1,
  encodeTaskRuntimeEntryPreimageV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  hashCanonicalTaskManifestV1,
  hashTaskRuntimeEntryFrameV1,
  makeStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { asNonArrayRecord } from "@flarex/utils/records";
import { Effect, Exit, Layer, Result } from "effect";
import {
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  TaskRuntimeLaunchAuthority,
  makeTaskRuntimeLaunchAuthorityLayer,
} from "../src/taskRuntimeLaunch/Authority";
import {
  TaskRuntimeLaunchHashError,
  TaskRuntimeLaunchObjectCodecError,
  TaskRuntimeLaunchPortError,
  type CurrentTaskRuntimeLaunchEvidence,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchEvidence,
  type ApplicationTaskRuntimeLaunchEvidence,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchObjectValidator,
  type TaskRuntimeLaunchSha256,
} from "../src/taskRuntimeLaunch/Model";
import type { ApplicationAnalysisSourceBundle } from
  "../src/sourceArtifactV2/ApplicationAnalysisReader";

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();
const sha256 = makeStandardApplicationTaskSha256V1((owned) =>
  crypto.subtle.digest("SHA-256", owned)
);
const launchSha256: TaskRuntimeLaunchSha256 = (input, budget) =>
  input instanceof Uint8Array
    && typeof budget === "object"
    && budget !== null
    && "maximumInputBytes" in budget
    ? Effect.tryPromise({
      try: () => hashBytes(input),
      catch: () => new TaskRuntimeLaunchHashError({
        reason: "native_rejected",
      }),
    })
    : Effect.fail(new TaskRuntimeLaunchHashError({
      reason: "invalid_bytes",
    }));
const launchObjectValidator: TaskRuntimeLaunchObjectValidator =
  (reference, ownedBytes) => Effect.try({
    try: () => {
      if (reference.role === "task_runtime_entry") {
        const envelope = asNonArrayRecord(
          JSON.parse(UTF8_DECODER.decode(ownedBytes)),
        );
        if (
          envelope === null
          || envelope.codec !== TASK_RUNTIME_ENTRY_CODEC_V1
          || asNonArrayRecord(envelope.entry) === null
          || !bytesEqualFullScan(
            UTF8.encode(JSON.stringify(envelope)),
            ownedBytes,
          )
        ) {
          throw new Error("invalid task runtime entry envelope");
        }
        return;
      }
      const expected = runtimeBody(runtimeBodyLabel(reference.role));
      if (!bytesEqualFullScan(expected, ownedBytes)) {
        throw new Error("invalid deterministic runtime object fixture");
      }
    },
    catch: (cause) => new TaskRuntimeLaunchObjectCodecError({
      reason: "invalid_body",
      cause,
    }),
  });

describe("DTE06-D1 task runtime launch authority", () => {
  it("resolves an owned Application launch subject without Legacy object reads", async () => {
    const fixture = await makeApplicationFixture();
    let runtimeObjectReads = 0;
    let sourceReads = 0;
    let inputReads = 0;
    let principalReads = 0;
    const directory = applicationDirectoryFor(fixture, {
      runtimeObjectRead: () => { runtimeObjectReads += 1; },
      sourceRead: () => { sourceReads += 1; },
      inputRead: () => { inputReads += 1; },
      principalRead: () => { principalReads += 1; },
    });

    const subject = await runCurrentResolve(directory, fixture.request);

    expect(subject.generation).toBe("application_v1");
    if (subject.generation !== "application_v1") {
      throw new Error("Expected Application launch subject.");
    }
    expect(runtimeObjectReads).toBe(0);
    expect(sourceReads).toBe(1);
    expect(inputReads).toBe(0);
    expect(principalReads).toBe(1);
    expect(subject.runtimeTarget).toEqual(fixture.runtimeTarget);
    expect(subject.manifest).toEqual(fixture.manifest);
    expect(subject.creationAuthority).toEqual(fixture.creationAuthority);
    expect(subject.executionIdentity).toEqual(
      fixture.principalObject.executionIdentity,
    );
    expect(Object.isFrozen(subject.executionIdentity.user)).toBe(true);
    expect(subject.source).toEqual(fixture.source);
    expect(Object.isFrozen(subject)).toBe(true);
    expect(Object.isFrozen(subject.source.modules)).toBe(true);

    const firstInput = await Effect.runPromise(subject.input.read());
    firstInput[0] = 0;
    const secondInput = await Effect.runPromise(subject.input.read());
    expect(inputReads).toBe(2);
    expect(secondInput).toEqual(fixture.inputBytes);

    (fixture.source.modules[0] as { source: string }).source =
      "export const run = 'changed';";
    expect(subject.source.modules[0]!.source).not.toContain("changed");
  });

  it("accepts a narrowed Application duration and rejects a duration above the manifest ceiling", async () => {
    const fixture = await makeApplicationFixture();
    const narrowedRequest = success(
      validateApplicationTaskComputeDispatchRequestV1({
        ...fixture.request,
        maximumDurationMs: fixture.request.maximumDurationMs - 1_000,
      }),
    );
    const narrowedPrepared = success(
      decodeApplicationTaskComputePreparedExecutionV1({
        ...fixture.preparedExecution,
        dispatchRequest: narrowedRequest,
      }),
    );
    const narrowed = await runCurrentResolve(
      applicationDirectoryFor(fixture, {
        evidence: Object.freeze({
          generation: "application_v1",
          preparedExecution: narrowedPrepared,
        }),
      }),
      narrowedRequest,
    );
    expect(narrowed.request.maximumDurationMs).toBe(
      narrowedRequest.maximumDurationMs,
    );

    const overLimitRequest = success(
      validateApplicationTaskComputeDispatchRequestV1({
        ...fixture.request,
        maximumDurationMs: fixture.request.maximumDurationMs + 1_000,
      }),
    );
    const overLimitPrepared = success(
      decodeApplicationTaskComputePreparedExecutionV1({
        ...fixture.preparedExecution,
        dispatchRequest: overLimitRequest,
      }),
    );
    let sourceReads = 0;
    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        evidence: Object.freeze({
          generation: "application_v1",
          preparedExecution: overLimitPrepared,
        }),
        sourceRead: () => { sourceReads += 1; },
      }),
      overLimitRequest,
    );
    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_authority_mismatch",
      path: "preparedExecution",
    });
    expect(sourceReads).toBe(0);
  });

  it("rejects Application authority mismatch before source and input reads", async () => {
    const fixture = await makeApplicationFixture();
    let sourceReads = 0;
    let inputReads = 0;
    const mismatched = success(validateApplicationTaskComputeDispatchRequestV1({
      ...fixture.request,
      applicationTaskRuntimeTargetSha256: digest(0xee),
    }));
    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        sourceRead: () => { sourceReads += 1; },
        inputRead: () => { inputReads += 1; },
      }),
      mismatched,
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "request_mismatch",
      path: "preparedExecution.dispatchRequest",
    });
    expect(sourceReads).toBe(0);
    expect(inputReads).toBe(0);
  });

  it("requires the Application-only source reader without using Legacy fallback", async () => {
    const fixture = await makeApplicationFixture();
    const directory = applicationDirectoryFor(fixture, {}, false);
    const failure = await runFailure(directory, fixture.request);

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_source_invalid",
      path: "source.readApplicationSource",
    });
  });

  it("requires the Application principal reader before source or Worker preparation", async () => {
    const fixture = await makeApplicationFixture();
    let sourceReads = 0;
    const failure = await runFailure(
      applicationDirectoryFor(
        fixture,
        { sourceRead: () => { sourceReads += 1; } },
        true,
        false,
      ),
      fixture.request,
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "principal_invalid",
      path: "source.readPrincipal",
    });
    expect(sourceReads).toBe(0);
  });

  it("rejects digest-mismatched and cross-scope principal objects before source access", async () => {
    const fixture = await makeApplicationFixture();
    let sourceReads = 0;
    const digestMismatch = copyBytes(fixture.principalBytes);
    digestMismatch[digestMismatch.byteLength - 1] ^= 1;
    const digestFailure = await runFailure(
      applicationDirectoryFor(fixture, {
        principal: digestMismatch,
        sourceRead: () => { sourceReads += 1; },
      }),
      fixture.request,
    );
    expect(digestFailure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "principal_invalid",
      path: "principal.canonicalBytes",
    });

    const crossScope = await canonicalizeFlarexValueV1({
      ...fixture.principalObject,
      scopeId: "scope_97000000-0000-4000-8000-000000000099",
    });
    const crossReference = success(makeTaskExecutionPrincipalReferenceV1(
      crossScope.sha256,
      crossScope.canonicalBytes.byteLength,
    ));
    const crossPrepared = success(
      decodeApplicationTaskComputePreparedExecutionV1({
        ...fixture.preparedExecution,
        principalReference: crossReference,
      }),
    );
    const crossFailure = await runFailure(
      applicationDirectoryFor(fixture, {
        principal: crossScope.canonicalBytes,
        sourceRead: () => { sourceReads += 1; },
        evidence: Object.freeze({
          generation: "application_v1" as const,
          preparedExecution: crossPrepared,
        }),
      }),
      fixture.request,
    );
    expect(crossFailure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "principal_invalid",
      path: "principal.scopeId",
    });
    expect(sourceReads).toBe(0);
  });

  it("does not let the principal reader retarget the authoritative digest", async () => {
    const fixture = await makeApplicationFixture();
    const attacker = await canonicalizeFlarexValueV1({
      ...fixture.principalObject,
      executionIdentity: {
        ...fixture.principalObject.executionIdentity,
        user: {
          ...fixture.principalObject.executionIdentity.user,
          subject: "application-launch-useq",
        },
      },
    });
    expect(attacker.canonicalBytes.byteLength).toBe(
      fixture.principalReference.byteLength,
    );

    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        principalReader: reference => Effect.sync(() => {
          reference.sha256.set(attacker.sha256);
          return attacker.canonicalBytes;
        }),
      }),
      fixture.request,
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "principal_invalid",
      path: "principal.canonicalBytes",
    });
  });

  it("preserves transient principal-store failure and rejects anonymous principal objects", async () => {
    const fixture = await makeApplicationFixture();
    const expected = new TaskRuntimeLaunchPortError<"read_principal">({
      operation: "read_principal",
      reason: "resource_failure",
      cause: new Error("principal store unavailable"),
    });
    expect(await runFailure(
      applicationDirectoryFor(fixture, { principalFailure: expected }),
      fixture.request,
    )).toBe(expected);

    const anonymous = await canonicalizeFlarexValueV1({
      version: 1,
      scopeId: fixture.request.identity.scopeId,
      executionIdentity: { kind: "anonymous" },
    });
    const anonymousReference = success(makeTaskExecutionPrincipalReferenceV1(
      anonymous.sha256,
      anonymous.canonicalBytes.byteLength,
    ));
    const anonymousPrepared = success(
      decodeApplicationTaskComputePreparedExecutionV1({
        ...fixture.preparedExecution,
        principalReference: anonymousReference,
      }),
    );
    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        principal: anonymous.canonicalBytes,
        evidence: Object.freeze({
          generation: "application_v1" as const,
          preparedExecution: anonymousPrepared,
        }),
      }),
      fixture.request,
    );
    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "principal_invalid",
      path: "principal.object",
    });
  });

  it("preserves terminal and transient Application source failures", async () => {
    const fixture = await makeApplicationFixture();
    const failures = [
      new TaskRuntimeLaunchPortError<"read_application_source">({
        operation: "read_application_source",
        reason: "corrupt",
      }),
      new TaskRuntimeLaunchPortError<"read_application_source">({
        operation: "read_application_source",
        reason: "resource_failure",
        cause: new Error("source store unavailable"),
      }),
    ] as const;

    for (const expected of failures) {
      const actual = await runFailure(
        applicationDirectoryFor(fixture, { sourceFailure: expected }),
        fixture.request,
      );
      expect(actual).toBe(expected);
    }
  });

  it("rejects a divergent prepared Application authority before source access", async () => {
    const fixture = await makeApplicationFixture();
    let sourceReads = 0;
    const divergentTarget = success(decodeApplicationTaskRuntimeTargetV1({
      ...fixture.runtimeTarget,
      publicationSha256: "d".repeat(64),
    }));
    const divergentPrepared = success(
      decodeApplicationTaskComputePreparedExecutionV1({
        ...fixture.preparedExecution,
        runtimeTarget: divergentTarget,
      }),
    );
    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        sourceRead: () => { sourceReads += 1; },
        evidence: Object.freeze({
          generation: "application_v1" as const,
          preparedExecution: divergentPrepared,
        }),
      }),
      fixture.request,
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_authority_mismatch",
      path: "preparedExecution",
    });
    expect(sourceReads).toBe(0);
  });

  it("rejects unknown and cross-generation evidence wrappers before source access", async () => {
    const application = await makeApplicationFixture();
    const legacy = await makeFixture();
    let sourceReads = 0;
    const invalidEvidence: ReadonlyArray<CurrentTaskRuntimeLaunchEvidence> = [
      Object.freeze({
        generation: "unknown",
        preparedExecution: application.preparedExecution,
      }) as unknown as CurrentTaskRuntimeLaunchEvidence,
      Object.freeze({
        preparedExecution: application.preparedExecution,
        runtimeBinding: legacy.binding,
        runtimeBindingCanonicalBytes: legacy.evidence.runtimeBindingCanonicalBytes,
      }),
      Object.freeze({
        generation: "application_v1",
        preparedExecution: legacy.evidence.preparedExecution,
      }),
    ];

    for (const evidence of invalidEvidence) {
      const failure = await runFailure(
        applicationDirectoryFor(application, {
          evidence,
          sourceRead: () => { sourceReads += 1; },
        }),
        application.request,
      );
      expect(failure).toMatchObject({
        _tag: "TaskRuntimeLaunchValidationError",
        reason: "invalid_evidence",
      });
    }
    expect(sourceReads).toBe(0);
  });

  it("rejects hostile or wrong-root Application source values as typed validation", async () => {
    const fixture = await makeApplicationFixture();
    let getterReads = 0;
    const hostile = {};
    Object.defineProperty(hostile, "sourceArtifact", {
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("hostile source getter");
      },
    });
    Object.defineProperty(hostile, "modules", {
      enumerable: true,
      value: [],
    });
    const hostileFailure = await runFailure(
      applicationDirectoryFor(fixture, { source: hostile }),
      fixture.request,
    );
    expect(hostileFailure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_source_invalid",
      path: "source.applicationSource",
    });
    expect(getterReads).toBe(0);

    const wrongRoot = {
      ...fixture.source,
      sourceArtifact: {
        ...fixture.source.sourceArtifact,
        rootSha256: "f".repeat(64),
      },
    };
    const rootFailure = await runFailure(
      applicationDirectoryFor(fixture, { source: wrongRoot }),
      fixture.request,
    );
    expect(rootFailure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_source_invalid",
      path: "source.applicationSource",
    });
  });

  it("rejects mismatched and oversized Application source bodies", async () => {
    const fixture = await makeApplicationFixture();
    const baseModule = fixture.source.modules[0]!;
    const invalidSources: ReadonlyArray<ApplicationAnalysisSourceBundle> = [
      {
        sourceArtifact: fixture.source.sourceArtifact,
        modules: [{ ...baseModule, source: `${baseModule.source}x` }],
      },
      (() => {
        const source = "x".repeat(
          APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1 + 1,
        );
        const module = {
          ...baseModule,
          sourceByteLength: source.length,
          source,
        };
        return {
          sourceArtifact: {
            ...fixture.source.sourceArtifact,
            modules: [{
              path: module.path,
              roles: module.roles,
              sourceSha256: module.sourceSha256,
              sourceByteLength: module.sourceByteLength,
            }],
          },
          modules: [module],
        };
      })(),
    ];

    for (const source of invalidSources) {
      const failure = await runFailure(
        applicationDirectoryFor(fixture, { source }),
        fixture.request,
      );
      expect(failure).toMatchObject({
        _tag: "TaskRuntimeLaunchValidationError",
        reason: "application_source_invalid",
        path: "source.applicationSource",
      });
    }
  });

  it("stops before reading later Application source bodies after the first identity mismatch", async () => {
    const fixture = await makeApplicationFixture();
    let laterSourceReads = 0;
    const firstIdentity = fixture.source.sourceArtifact.modules[0]!;
    const firstBody = fixture.source.modules[0]!;
    const wrongDigest = "0".repeat(64);
    const secondIdentity = { ...firstIdentity, path: "tasks/later.js" };
    const secondBody = { ...firstBody, path: "tasks/later.js" };
    Object.defineProperty(secondBody, "source", {
      enumerable: true,
      get() {
        laterSourceReads += 1;
        return "x".repeat(APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1);
      },
    });
    const failure = await runFailure(
      applicationDirectoryFor(fixture, {
        source: {
          sourceArtifact: {
            ...fixture.source.sourceArtifact,
            modules: [
              { ...firstIdentity, sourceSha256: wrongDigest },
              secondIdentity,
            ],
          },
          modules: [
            { ...firstBody, sourceSha256: wrongDigest },
            secondBody,
          ],
        },
      }),
      fixture.request,
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "application_source_invalid",
      path: "source.applicationSource.modules.sourceSha256",
    });
    expect(laterSourceReads).toBe(0);
  });

  it("resolves one exact owned launch subject and lazy canonical input", async () => {
    const fixture = await makeFixture();
    const observedRuntimeRoles: string[] = [];
    let directoryReceiver = false;
    let sourceReceiver = false;
    let inputReads = 0;
    let source: TaskRuntimeLaunchLocatedSource;
    source = {
      scopeId: fixture.request.identity.scopeId,
      readEvidence(request) {
        sourceReceiver = sourceReceiver || this === source;
        expect(request).toEqual(fixture.request);
        return Effect.succeed(fixture.evidence);
      },
      readRuntimeObject(reference) {
        sourceReceiver = sourceReceiver || this === source;
        observedRuntimeRoles.push(reference.role);
        return Effect.succeed(fixture.objectBytes.get(reference.objectKey));
      },
      readInput(reference) {
        sourceReceiver = sourceReceiver || this === source;
        inputReads += 1;
        expect(reference).toEqual(fixture.inputReference);
        return Effect.succeed(fixture.inputBytes);
      },
    };
    let directory: TaskRuntimeLaunchDirectory;
    directory = {
      resolve(scopeId) {
        directoryReceiver = this === directory;
        expect(scopeId).toBe(fixture.request.identity.scopeId);
        return Effect.succeed(source);
      },
    };

    const subject = await runResolve(directory, fixture.request);

    expect(directoryReceiver).toBe(true);
    expect(sourceReceiver).toBe(true);
    expect(observedRuntimeRoles).toEqual(
      fixture.binding.runtimeObjects.map((reference) => reference.role),
    );
    expect(inputReads).toBe(0);
    expect(subject.request).toEqual(fixture.request);
    expect(subject.runtimeBinding).toEqual(fixture.binding);
    expect(subject.runtimeObjects.map((item) => item.reference.role)).toEqual(
      fixture.binding.runtimeObjects.map((reference) => reference.role),
    );
    expect(Object.isFrozen(subject)).toBe(true);
    expect(Object.isFrozen(subject.runtimeObjects)).toBe(true);
    expect(Object.isFrozen(subject.input)).toBe(true);

    const firstInput = await Effect.runPromise(subject.input.read());
    firstInput[0] = 0;
    const secondInput = await Effect.runPromise(subject.input.read());
    expect(inputReads).toBe(2);
    expect(secondInput).toEqual(fixture.inputBytes);
    expect(secondInput[0]).not.toBe(0);

    const firstRuntimeBytes = subject.runtimeObjects[0]!.bytes;
    const storedRuntimeBytes = fixture.objectBytes.get(
      subject.runtimeObjects[0]!.reference.objectKey,
    )!;
    const storedFirstByte = storedRuntimeBytes[0];
    firstRuntimeBytes[0] = (firstRuntimeBytes[0] ?? 0) ^ 0xff;
    expect(storedRuntimeBytes[0]).toBe(storedFirstByte);
  });

  it("rejects a full binding that does not match prepared commitment", async () => {
    const fixture = await makeFixture();
    const otherBinding = await makeBinding({ candidateSeed: 0x66 });
    const failure = await runFailure(directoryFor(fixture, {
      ...fixture.evidence,
      runtimeBinding: otherBinding,
      runtimeBindingCanonicalBytes: success(
        encodeTaskDefinitionRuntimeBindingPreimageV1(otherBinding),
      ),
    }), fixture.request);

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      operation: "resolve",
      reason: "runtime_binding_mismatch",
      path: "runtimeBinding",
    });
  });

  it("fails before object reads when request policy differs from the binding", async () => {
    const fixture = await makeFixture();
    let objectReads = 0;
    const directory = directoryFor(fixture, fixture.evidence, () => {
      objectReads += 1;
      return undefined;
    });
    const mismatched = success(validateTaskComputeDispatchRequestV1({
      ...fixture.request,
      maximumDurationMs: 31_000,
    }));

    const failure = await runFailure(directory, mismatched);

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "request_mismatch",
      path: "preparedExecution.dispatchRequest",
    });
    expect(objectReads).toBe(0);
  });

  it("rejects corrupt runtime object bytes with exact role diagnostics", async () => {
    const fixture = await makeFixture();
    const corruptRole = fixture.binding.runtimeObjects[0]!.role;
    const directory = directoryFor(fixture, fixture.evidence, (reference) =>
      reference.role === corruptRole
        ? UTF8.encode("corrupt runtime body")
        : fixture.objectBytes.get(reference.objectKey)
    );

    const failure = await runFailure(directory, fixture.request);

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "runtime_object_invalid",
      path: `runtimeObjects.${corruptRole}.byteLength`,
    });
  });

  it("fails the lazy input capability on noncanonical or mismatched evidence", async () => {
    const fixture = await makeFixture();
    const directory = directoryFor(fixture, fixture.evidence, undefined,
      () => new Uint8Array(fixture.inputBytes.byteLength));
    const subject = await runResolve(directory, fixture.request);

    const failure = await Effect.runPromise(subject.input.read().pipe(
      Effect.flip,
    ));

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      operation: "read_input",
      reason: "input_invalid",
      path: "input.canonicalBytes",
    });
  });

  it("preserves located source resource failures and rejects hostile evidence", async () => {
    const fixture = await makeFixture();
    const resourceFailure = new TaskRuntimeLaunchPortError<"read_evidence">({
      operation: "read_evidence",
      reason: "resource_failure",
      cause: new Error("database unavailable"),
    });
    const resourceDirectory = directoryFor(fixture, fixture.evidence);
    const source = await Effect.runPromise(
      resourceDirectory.resolve(fixture.request.identity.scopeId),
    );
    const failingSource = {
      ...source,
      readEvidence: () => Effect.fail(resourceFailure),
    } satisfies TaskRuntimeLaunchLocatedSource;
    const resourceOutcome = await runFailure({
      resolve: () => Effect.succeed(failingSource),
    }, fixture.request);
    expect(resourceOutcome).toBe(resourceFailure);

    let reads = 0;
    const hostile = {} as TaskRuntimeLaunchEvidence;
    Object.defineProperty(hostile, "preparedExecution", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("hostile evidence getter");
      },
    });
    const hostileFailure = await runFailure(
      directoryFor(fixture, hostile),
      fixture.request,
    );
    expect(hostileFailure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      reason: "invalid_evidence",
      path: "evidence",
    });
    expect(reads).toBe(0);
  });

  it("rejects a located source for a different trusted scope before reading evidence", async () => {
    const fixture = await makeFixture();
    let evidenceReads = 0;
    const source = await Effect.runPromise(
      directoryFor(fixture, fixture.evidence).resolve(
        fixture.request.identity.scopeId,
      ),
    );
    const otherScopeId = success(validateTaskComputeDispatchRequestV1({
      ...fixture.request,
      identity: {
        ...fixture.request.identity,
        scopeId: "scope_97000000-0000-4000-8000-000000000099",
      },
    })).identity.scopeId;
    const mismatchedSource = {
      ...source,
      scopeId: otherScopeId,
      readEvidence: () => {
        evidenceReads += 1;
        return Effect.succeed(fixture.evidence);
      },
    } satisfies TaskRuntimeLaunchLocatedSource;

    const failure = await runFailure({
      resolve: () => Effect.succeed(mismatchedSource),
    }, fixture.request);

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      operation: "resolve",
      reason: "scope_mismatch",
      path: "source.scopeId",
    });
    expect(evidenceReads).toBe(0);
  });

  it("enforces the configured runtime-object byte budget before reading a body", async () => {
    const fixture = await makeFixture();
    let objectReads = 0;
    const directory = directoryFor(fixture, fixture.evidence, () => {
      objectReads += 1;
      return undefined;
    });

    const failure = await runFailureWithOptions(directory, fixture.request, {
      maximumRuntimeObjectBytes: 10,
      maximumTotalRuntimeObjectBytes: 100,
      validateRuntimeObject: launchObjectValidator,
      sha256: launchSha256,
    });

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      operation: "resolve",
      reason: "runtime_object_budget_exceeded",
    });
    expect(objectReads).toBe(0);
  });

  it("rejects a correctly addressed body when its role codec rejects it", async () => {
    const fixture = await makeFixture();
    const rejectedRole = fixture.binding.runtimeObjects[0]!.role;
    const failure = await runFailureWithOptions(
      directoryFor(fixture, fixture.evidence),
      fixture.request,
      {
        maximumRuntimeObjectBytes: 1_024,
        maximumTotalRuntimeObjectBytes: 8_192,
        validateRuntimeObject: (reference) =>
          reference.role === rejectedRole
            ? Effect.fail(new TaskRuntimeLaunchObjectCodecError({
              reason: "invalid_body",
            }))
            : Effect.succeed(undefined),
        sha256: launchSha256,
      },
    );

    expect(failure).toMatchObject({
      _tag: "TaskRuntimeLaunchValidationError",
      operation: "resolve",
      reason: "runtime_object_invalid",
      path: `runtimeObjects.${rejectedRole}.codec`,
    });
  });

  it("maps typed input codec failures but preserves unexpected input defects", async () => {
    const fixture = await makeFixture();
    const defect = new Error("foreign reader defect");
    const subject = await runResolve(
      directoryFor(fixture, fixture.evidence, undefined, () => {
        throw defect;
      }),
      fixture.request,
    );

    const exit = await Effect.runPromise(Effect.exit(subject.input.read()));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("foreign reader defect");
    }
  });
});

async function runResolve(
  directory: TaskRuntimeLaunchDirectory,
  input: unknown,
) {
  const subject = await Effect.runPromise(Effect.gen(function* () {
    const authority = yield* TaskRuntimeLaunchAuthority;
    return yield* authority.resolve(input);
  }).pipe(Effect.provide(authorityLayer(directory))));
  if (subject.generation === "application_v1") {
    throw new Error("Legacy fixture resolved to Application launch subject.");
  }
  return subject;
}

async function runCurrentResolve(
  directory: TaskRuntimeLaunchDirectory,
  input: unknown,
) {
  return Effect.runPromise(Effect.gen(function* () {
    const authority = yield* TaskRuntimeLaunchAuthority;
    return yield* authority.resolve(input);
  }).pipe(Effect.provide(authorityLayer(directory))));
}

async function runFailure(
  directory: TaskRuntimeLaunchDirectory,
  input: unknown,
) {
  return runFailureWithOptions(directory, input, {
    maximumRuntimeObjectBytes: 1_024,
    maximumTotalRuntimeObjectBytes: 8_192,
    validateRuntimeObject: launchObjectValidator,
    sha256: launchSha256,
  });
}

async function runFailureWithOptions(
  directory: TaskRuntimeLaunchDirectory,
  input: unknown,
  options: Parameters<typeof makeTaskRuntimeLaunchAuthorityLayer>[1],
) {
  return Effect.runPromise(Effect.gen(function* () {
    const authority = yield* TaskRuntimeLaunchAuthority;
    return yield* authority.resolve(input).pipe(Effect.flip);
  }).pipe(Effect.provide(
    makeTaskRuntimeLaunchAuthorityLayer(directory, options),
  )));
}

function authorityLayer(directory: TaskRuntimeLaunchDirectory) {
  return makeTaskRuntimeLaunchAuthorityLayer(directory, {
    maximumRuntimeObjectBytes: 1_024,
    maximumTotalRuntimeObjectBytes: 8_192,
    validateRuntimeObject: launchObjectValidator,
    sha256: launchSha256,
  });
}

function directoryFor(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  evidence: TaskRuntimeLaunchEvidence,
  runtimeObject?: (reference: TaskRuntimeObjectReferenceV1) => unknown,
  input?: () => unknown,
): TaskRuntimeLaunchDirectory {
  return {
    resolve: () => Effect.succeed({
      scopeId: fixture.request.identity.scopeId,
      readEvidence: () => Effect.succeed(evidence),
      readRuntimeObject: (reference) => Effect.succeed(
        runtimeObject?.(reference)
          ?? fixture.objectBytes.get(reference.objectKey),
      ),
      readInput: () => input === undefined
        ? Effect.succeed(fixture.inputBytes)
        : Effect.sync(input),
    }),
  };
}

async function makeFixture() {
  const binding = await makeBinding();
  const request = success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_97000000-0000-4000-8000-000000000001",
      runId: "run_97000000-0000-4000-8000-000000000002",
      requestedEffectSequence: "7",
      attemptId: "attempt_97000000-0000-4000-8000-000000000003",
      executionFence: "11",
    },
    taskDefinitionRevisionId:
      "taskdef_97000000-0000-4000-8000-000000000004",
    attemptNumber: 1,
    leaseVersion: "13",
    computeProfile: "standard-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 30_000,
  }));
  const inputCanonical = await canonicalizeFlarexValueV1({ orderId: "A-1" });
  const inputBytes = copyBytes(inputCanonical.canonicalBytes);
  const inputReference = success(makeTaskInputReferenceV1(
    inputCanonical.sha256,
    inputBytes.byteLength,
  ));
  const { manifest: _manifest, ...commitmentInput } = binding;
  const runtimeBindingCommitment = success(
    decodeTaskDefinitionRuntimeBindingCommitmentV1(commitmentInput),
  );
  const preparedExecution = success(decodeTaskComputePreparedExecutionV1({
    version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
    dispatchRequest: request,
    runtimeBindingCommitment,
    inputReference,
  }));
  const runtimeBindingCanonicalBytes = success(
    encodeTaskDefinitionRuntimeBindingPreimageV1(binding),
  );
  const objectBytes = new Map<string, Uint8Array>();
  for (const reference of binding.runtimeObjects) {
    objectBytes.set(
      reference.objectKey,
      reference.role === "task_runtime_entry"
        ? success(encodeTaskRuntimeEntryPreimageV1(binding.taskRuntimeEntry))
        : runtimeObjectBody(reference),
    );
  }
  return {
    request,
    binding,
    inputReference,
    inputBytes,
    objectBytes,
    evidence: Object.freeze({
      preparedExecution,
      runtimeBinding: binding,
      runtimeBindingCanonicalBytes,
    }),
  };
}

async function makeApplicationFixture() {
  const manifest = success(decodeCanonicalTaskManifestV1({
    version: 1,
    taskId: "orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: { type: "any" },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-small",
    queue: { kind: "default" },
  }));
  const manifestSha256 = await hashBytes(success(
    encodeCanonicalTaskManifestPreimageV1(manifest),
  ));
  const sourceText = "export const run = async x => x;";
  const sourceSha256 = encodeBytesToLowercaseHex(
    await hashBytes(UTF8.encode(sourceText)),
  );
  const sourceModules = [{
    path: "tasks/orders.js",
    roles: 9,
    sourceSha256,
    sourceByteLength: UTF8.encode(sourceText).byteLength,
    source: sourceText,
  }];
  const source: ApplicationAnalysisSourceBundle = {
    sourceArtifact: {
      rootSha256: "a".repeat(64),
      executionModulePath: "tasks/orders.js",
      schemaModulePath: null,
      modules: sourceModules.map(({ source: _source, ...module }) => module),
    },
    modules: sourceModules,
  };
  const runtimeTarget = success(decodeApplicationTaskRuntimeTargetV1({
    version: 1,
    scopeId: "scope_97000000-0000-4000-8000-000000000001",
    revisionId: "revision-application-launch",
    candidateId: "candidate-application-launch",
    analysisId: "analysis-application-launch",
    sourceArtifactRootSha256: source.sourceArtifact.rootSha256,
    publicationSha256: "c".repeat(64),
    applicationTaskCatalogBindingSha256: digest(0x21),
    applicationTaskDefinitionBindingSha256: digest(0x22),
    taskCatalogSha256: digest(0x23),
    taskId: manifest.taskId,
    canonicalTaskManifestSha256: manifestSha256,
    handler: {
      logicalModulePath: manifest.handler.logicalModulePath,
      sourceModulePath: manifest.handler.artifactModulePath,
      exportName: manifest.handler.exportName,
    },
    runtimeHostIdentity: "flarex-application-worker-v1",
    compatibilityDate: "2026-06-14",
  }));
  const runtimeTargetSha256 = await hashBytes(success(
    encodeApplicationTaskRuntimeTargetPreimageV1(runtimeTarget),
  ));
  const creationAuthority = success(
    decodeApplicationTaskRunCreationAuthorityV1({
      version: 1,
      scopeId: runtimeTarget.scopeId,
      activationSequence: 7n,
      activeHeadSha256: digest(0x24),
      readinessSha256: digest(0x25),
      runtimeTarget,
      applicationTaskRuntimeTargetSha256: runtimeTargetSha256,
    }),
  );
  const request = success(validateApplicationTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: runtimeTarget.scopeId,
      runId: "run_97000000-0000-4000-8000-000000000012",
      requestedEffectSequence: 7n,
      attemptId: "attempt_97000000-0000-4000-8000-000000000013",
      executionFence: 11n,
    },
    applicationTaskRuntimeTargetSha256: runtimeTargetSha256,
    attemptNumber: 1,
    leaseVersion: 13n,
    computeProfile: manifest.computeProfile,
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: manifest.maximumDurationInSeconds * 1_000,
  }));
  const inputCanonical = await canonicalizeFlarexValueV1({ orderId: "A-2" });
  const inputBytes = copyBytes(inputCanonical.canonicalBytes);
  const inputReference = success(makeTaskInputReferenceV1(
    inputCanonical.sha256,
    inputBytes.byteLength,
  ));
  const principalObject = {
    version: 1 as const,
    scopeId: request.identity.scopeId,
    executionIdentity: {
      kind: "user" as const,
      user: {
        tokenIdentifier: "application-launch-token",
        subject: "application-launch-user",
        issuer: "https://application-launch.flarex.invalid",
        roles: ["reader"],
      },
    },
  };
  const principalCanonical = await canonicalizeFlarexValueV1(principalObject);
  const principalReference = success(makeTaskExecutionPrincipalReferenceV1(
    principalCanonical.sha256,
    principalCanonical.canonicalBytes.byteLength,
  ));
  const preparedExecution = success(
    decodeApplicationTaskComputePreparedExecutionV1({
      version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
      generation: "application_v1",
      dispatchRequest: request,
      runtimeTarget,
      manifest,
      creationAuthority,
      inputReference,
      principalReference,
    }),
  );
  const evidence: ApplicationTaskRuntimeLaunchEvidence = Object.freeze({
    generation: "application_v1",
    preparedExecution,
  });
  return {
    request,
    runtimeTarget,
    manifest,
    creationAuthority,
    inputBytes,
    inputReference,
    principalObject,
    principalBytes: copyBytes(principalCanonical.canonicalBytes),
    principalReference,
    source,
    evidence,
    preparedExecution,
  };
}

function applicationDirectoryFor(
  fixture: Awaited<ReturnType<typeof makeApplicationFixture>>,
  observations: Readonly<{
    readonly runtimeObjectRead?: () => void;
    readonly sourceRead?: () => void;
    readonly inputRead?: () => void;
    readonly principalRead?: () => void;
    readonly evidence?: CurrentTaskRuntimeLaunchEvidence;
    readonly source?: unknown;
    readonly sourceFailure?: TaskRuntimeLaunchPortError<"read_application_source">;
    readonly principal?: unknown;
    readonly principalReader?: NonNullable<
      TaskRuntimeLaunchLocatedSource["readPrincipal"]
    >;
    readonly principalFailure?: TaskRuntimeLaunchPortError<"read_principal">;
  }> = {},
  includeSourceReader = true,
  includePrincipalReader = true,
): TaskRuntimeLaunchDirectory {
  return {
    resolve: () => Effect.succeed({
      scopeId: fixture.request.identity.scopeId,
      readEvidence: () => Effect.succeed(
        observations.evidence ?? fixture.evidence,
      ),
      readRuntimeObject: () => {
        observations.runtimeObjectRead?.();
        return Effect.fail(new TaskRuntimeLaunchPortError({
          operation: "read_runtime_object",
          reason: "not_found",
        }));
      },
      readInput: () => {
        observations.inputRead?.();
        return Effect.succeed(fixture.inputBytes);
      },
      ...(includePrincipalReader
        ? {
          readPrincipal: observations.principalReader ?? (() => {
            observations.principalRead?.();
            if (observations.principalFailure !== undefined) {
              return Effect.fail(observations.principalFailure);
            }
            return Effect.succeed(
              observations.principal ?? fixture.principalBytes,
            );
          }),
        }
        : {}),
      ...(includeSourceReader
        ? {
          readApplicationSource: (rootSha256: string) => {
            observations.sourceRead?.();
            expect(rootSha256).toBe(
              fixture.runtimeTarget.sourceArtifactRootSha256,
            );
            if (observations.sourceFailure !== undefined) {
              return Effect.fail(observations.sourceFailure);
            }
            return Effect.succeed(observations.source ?? fixture.source);
          },
        }
        : {}),
    }),
  };
}

async function makeBinding(
  changes: { readonly candidateSeed?: number } = {},
): Promise<TaskDefinitionRuntimeBindingV1> {
  const manifestInput = {
    version: 1,
    taskId: "orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: { type: "any" as const },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" as const },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-small",
    queue: { kind: "default" as const },
  };
  const catalog = await Effect.runPromise(hashCanonicalTaskManifestV1(
    manifestInput,
    sha256,
  ));
  const projectionBytes = runtimeBody("projection");
  const projectionSha256 = await hashBytes(projectionBytes);
  const entry = success(decodeTaskRuntimeEntryFrameV1({
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: manifestInput.taskId,
    canonicalTaskManifestSha256: catalog,
    logicalExecutionModule: manifestInput.handler.logicalModulePath,
    artifactExecutionModule: manifestInput.handler.artifactModulePath,
    exportName: manifestInput.handler.exportName,
    group: "durable_task",
    projectionSha256,
  }));
  const entrySha256 = await Effect.runPromise(
    hashTaskRuntimeEntryFrameV1(entry, sha256),
  );
  const groupSha256 = await hashBytes(runtimeBody("group-manifest"));
  const materializationSha256 = await hashBytes(
    runtimeBody("materialization-spec"),
  );
  const moduleSha256 = await hashBytes(runtimeBody("projection-module"));
  return success(decodeTaskDefinitionRuntimeBindingV1({
    version: 1,
    applicationRevisionId: "apprev_task_runtime_launch",
    candidateSha256: digest(changes.candidateSeed ?? 0x11),
    applicationRevisionTaskBindingSha256: digest(0x12),
    taskId: entry.taskId,
    manifest: manifestInput,
    canonicalTaskManifestSha256: catalog,
    taskRuntimeEntrySha256: entrySha256,
    taskRuntimeEntry: entry,
    taskCatalogSha256: digest(0x13),
    taskEntryRootSha256: digest(0x14),
    taskRuntimeProjectionSha256: projectionSha256,
    taskRuntimeGroupManifestSha256: groupSha256,
    taskRuntimeMaterializationSpecSha256: materializationSha256,
    packageSha256: digest(0x15),
    artifactSha256: digest(0x16),
    sourceRootSha256: digest(0x17),
    semanticRootSha256: digest(0x18),
    runtimeObjects: [
      runtimeReference(
        "runtime_projection_module",
        moduleSha256,
        runtimeBody("projection-module"),
      ),
      runtimeReference(
        "task_runtime_projection",
        projectionSha256,
        projectionBytes,
      ),
      runtimeReference("task_runtime_entry", entrySha256,
        success(encodeTaskRuntimeEntryPreimageV1(entry))),
      runtimeReference("task_runtime_group_manifest", groupSha256,
        runtimeBody("group-manifest")),
      runtimeReference("task_runtime_materialization_spec",
        materializationSha256, runtimeBody("materialization-spec")),
    ],
  }));
}

function runtimeObjectBody(reference: TaskRuntimeObjectReferenceV1) {
  return runtimeBody(runtimeBodyLabel(reference.role));
}

function runtimeBodyLabel(role: TaskRuntimeObjectRoleV1) {
  switch (role) {
    case "runtime_projection_module": return "projection-module";
    case "task_runtime_projection": return "projection";
    case "task_runtime_group_manifest": return "group-manifest";
    case "task_runtime_materialization_spec": return "materialization-spec";
    case "task_runtime_entry": return "entry";
  }
}

function runtimeBody(label: string) {
  return UTF8.encode(`task-runtime-object:${label}`);
}

function runtimeReference(
  role: TaskRuntimeObjectRoleV1,
  sha256Value: TaskDefinitionSha256V1,
  bytes: Uint8Array,
): TaskRuntimeObjectReferenceV1 {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(
      role,
      encodeBytesToLowercaseHex(sha256Value),
    ),
    byteLength: BigInt(bytes.byteLength),
    sha256: sha256Value,
  };
}

async function hashBytes(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes);
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", owned.buffer),
  ) as TaskDefinitionSha256V1;
}

function digest(seed: number) {
  return new Uint8Array(32).fill(seed) as TaskDefinitionSha256V1;
}

function success<Success, Failure>(result: Result.Result<Success, Failure>) {
  return Result.getOrThrow(result);
}
