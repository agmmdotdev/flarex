import { expect, it } from "vitest";
import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { AdmittedParticipantOperationSchema } from "flarex-protocol/commit-protocol";
import * as participantFacade from "../src/logicalParticipantAuthority";
import { preparePublicationDefinitions } from "../src/commitPublication/definitionPreparation";
import { hasLogicalParticipantCommitAuthority, inspectLogicalParticipantCommitAuthority,
  inspectLogicalParticipantCommitAuthoritySource, issueLogicalParticipantCommitAuthority } from "../src/logicalDocuments/participantAdmission";
import { captureHostPreparationLifetime, chargeHostPreparation, makePreparedHostRuntime,
  retainPreparedHost } from "../src/preparedHostRuntime";
import { runEffect } from "./effectTestRuntime";

it("retires escaped participant authority issued outside ambient construction after its actual borrower drains", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 256 });
    const host = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      if (lifetime === undefined) throw new Error("Expected actual source lifetime");
      const generation = yield* lifetime.stage(Effect.gen(function* () {
        const preparationLifetime = yield* captureHostPreparationLifetime();
        if (preparationLifetime === undefined) throw new Error("Expected actual generation lifetime");
        const payload = "retained participant source payload";
        yield* chargeHostPreparation(payload);
        return { preparationLifetime, payload };
      }));
      return { generation };
    }));
    const generation = yield* host.use(value => Effect.succeed(value.generation));
    const source = yield* generation.use(Effect.succeed);
    const definitions = preparePublicationDefinitions([], []);
    const tableId = CatalogTableIdSchema.make(101);
    const sourceSha256 = "a".repeat(64);
    // Deliberately issue after the genuine preparation Effect has returned.
    const issue = () => issueLogicalParticipantCommitAuthority({
      participant: "payload.fixed", methods: new Set(["create"]), sourceKey: "payload", sourceSha256,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("selected-payload-schema"),
      tableIds: new Set([tableId]), search: [], publicationDefinitions: definitions,
      validateDocument: () => Result.succeed(source.payload), verify: () => Effect.void,
    }, source.preparationLifetime);
    const token = issue();
    const contribution = { sourceKey: "payload", sourceSha256Hex: sourceSha256,
      bindingHead: { sequence: "1", sha256: sourceSha256 }, sourceBindingSha256Hex: sourceSha256,
      methods: ["create"], effects: [], dependencyEvidence: {} };
    expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", contribution)).toBe(true);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const borrower = yield* Effect.forkChild(generation.use(() => Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)))));
    yield* Deferred.await(entered);
    yield* generation.retire;
    expect(inspectLogicalParticipantCommitAuthoritySource(token)).not.toBeNull();
    expect(Result.getOrThrow(host.readUsage()).chargedBytes).toBeGreaterThan(0);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(borrower);
    expect(inspectLogicalParticipantCommitAuthoritySource(token)).toBeNull();
    expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", contribution)).toBe(false);
    expect(Result.getOrThrow(host.readUsage()).chargedBytes).toBe(0);
    expect(inspectLogicalParticipantCommitAuthoritySource(issue())).toBeNull();
    yield* host.close;
  }))), 10_000);

it("keeps participant method and table authority private after construction and inspection", () => {
  const tableId = CatalogTableIdSchema.make(101);
  const foreignTableId = CatalogTableIdSchema.make(102);
  const methods = new Set(["create"]);
  const tableIds = new Set([tableId]);
  const sourceSha256 = "a".repeat(64);
  const token = issueLogicalParticipantCommitAuthority({
    participant: "payload.fixed", methods, sourceKey: "payload", sourceSha256,
    schemaVersionId: CatalogSchemaVersionIdSchema.make("selected-payload-schema"),
    tableIds, search: [], publicationDefinitions: preparePublicationDefinitions([], []),
    validateDocument: () => Result.succeed(undefined), verify: () => Effect.void,
  });
  methods.add("delete");
  tableIds.add(foreignTableId);
  const contribution = { sourceKey: "payload", sourceSha256Hex: sourceSha256,
    bindingHead: { sequence: "1", sha256: sourceSha256 },
    sourceBindingSha256Hex: sourceSha256, methods: ["create"], effects: [], dependencyEvidence: {} };
  expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", contribution)).toBe(true);
  expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", { ...contribution, methods: ["delete"] })).toBe(false);
  const operation = Schema.decodeUnknownSync(AdmittedParticipantOperationSchema)({
    syscallSequence: "1", participant: "payload.fixed", method: "create",
    profileRevision: sourceSha256, admissionBundleSha256Hex: sourceSha256,
    requestSha256Hex: sourceSha256, resultSha256Hex: sourceSha256,
    sourceContributions: [contribution], eventIntents: [],
  });
  const selected = operation.sourceContributions[0];
  if (selected === undefined) throw new Error("Expected selected source");
  const inspected = inspectLogicalParticipantCommitAuthority(token, operation, selected);
  expect(inspected?.tableIds.has(tableId)).toBe(true);
  expect(inspected?.tableIds.has(foreignTableId)).toBe(false);
  if (inspected === null) throw new Error("Expected selected authority");
  Reflect.apply(Reflect.get(inspected.tableIds, "add"), inspected.tableIds, [foreignTableId]);
  expect(inspectLogicalParticipantCommitAuthority(token, operation, selected)?.tableIds.has(foreignTableId)).toBe(false);
});

it("exposes participant inspection without the source issuer through the package facade", async () => {
  const packageJson = await import("../package.json", { with: { type: "json" } });
  expect(packageJson.default.exports["./internal/logical-participant-admission"])
    .toBe("./src/logicalParticipantAuthority.ts");
  expect(packageJson.default.exports["./internal/logical-document-admission"])
    .toBe("./src/logicalDocumentAdmission.ts");
  expect(participantFacade).not.toHaveProperty("issueLogicalParticipantAttemptAdmission");
  expect(participantFacade).not.toHaveProperty("issueLogicalParticipantCommitAuthority");
});
