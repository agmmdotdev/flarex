import { expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { AdmittedParticipantOperationV1Schema } from "flarex-protocol/commit-protocol";
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
  expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", "create")).toBe(true);
  expect(hasLogicalParticipantCommitAuthority(token, "payload.fixed", "delete")).toBe(false);
  const operation = Schema.decodeUnknownSync(AdmittedParticipantOperationV1Schema)({
    syscallSequence: "1", participant: "payload.fixed", method: "create", sourceKey: "payload",
    sourceSha256Hex: sourceSha256, bindingHead: { sequence: "1", sha256: sourceSha256 },
    participantBindingSha256Hex: sourceSha256, requestSha256Hex: sourceSha256,
    resultSha256Hex: sourceSha256, effects: [], dependencyEvidence: {}, eventIntents: [],
  });
  const inspected = inspectLogicalParticipantCommitAuthority(token, operation);
  expect(inspected?.tableIds.has(tableId)).toBe(true);
  expect(inspected?.tableIds.has(foreignTableId)).toBe(false);
  if (inspected === null) throw new Error("Expected selected authority");
  Reflect.apply(Reflect.get(inspected.tableIds, "add"), inspected.tableIds, [foreignTableId]);
  expect(inspectLogicalParticipantCommitAuthority(token, operation)?.tableIds.has(foreignTableId)).toBe(false);
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
