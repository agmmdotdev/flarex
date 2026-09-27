import { expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { AdmittedParticipantOperationSchema } from "flarex-protocol/commit-protocol";
import * as participantFacade from "../src/logicalParticipantAuthority";
import { hasLogicalParticipantCommitAuthority, inspectLogicalParticipantCommitAuthority,
  issueLogicalParticipantCommitAuthority } from "../src/logicalDocuments/participantAdmission";

it("keeps participant method and table authority private after construction and inspection", () => {
  const tableId = CatalogTableIdSchema.make(101);
  const foreignTableId = CatalogTableIdSchema.make(102);
  const methods = new Set(["create"]);
  const tableIds = new Set([tableId]);
  const sourceSha256 = "a".repeat(64);
  const token = issueLogicalParticipantCommitAuthority({
    participant: "payload.fixed", methods, sourceKey: "payload", sourceSha256,
    schemaVersionId: CatalogSchemaVersionIdSchema.make("selected-payload-schema"),
    tableIds, indexes: [], unique: [], search: [],
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
