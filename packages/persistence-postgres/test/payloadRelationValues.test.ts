import { ApplicationWriteOwnershipHistoryBudget } from "../src/applicationWriteOwnership/Policy";
import { it, expect } from "vitest";
import { Effect } from "effect";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { policyManifestFixture, hashPolicyFixture } from "./applicationWritePolicyFixture";
import { payloadScalarFields } from "../src/payloadScalar/contract";
import { payloadRelationManifest } from "./payloadRelationFixture";
import { isOptionalPostRelationSuccessor, admitsApplicationOwnershipSuccessor } from "../src/applicationWriteOwnership/Successor";

it("admits only the additive optional-one configuration without reinterpreting scalar bytes", async () => {
  const prior = (await policyManifestFixture(undefined, true, payloadScalarFields)).manifest;
  const next = (await payloadRelationManifest(prior)).manifest;
  expect(isOptionalPostRelationSuccessor(prior, next)).toBe(true);
  expect(isOptionalPostRelationSuccessor(next, prior)).toBe(false);
  expect(isOptionalPostRelationSuccessor(next, next)).toBe(false);
  for (const changed of [
    { ...next, schema: { ...next.schema, indexes: [] } },
    { ...next, schema: { ...next.schema, tables: next.schema.tables.map(table => ({ ...table, name: "changed" })) } },
  ]) expect(isOptionalPostRelationSuccessor(prior, changed)).toBe(false);
  const changedProvenance = { ...next, schema: { ...next.schema, writePolicies: { ...next.schema.writePolicies, configuration: { ...next.schema.writePolicies.configuration, provenanceSha256: "0".repeat(64) } } } };
  expect(isOptionalPostRelationSuccessor(prior, changedProvenance)).toBe(false);
  const changedScalar = { ...next, schema: { ...next.schema, tables: next.schema.tables.map(table => table.name === "posts" && table.validator.type === "object" ? {
    ...table, validator: { ...table.validator, value: { ...table.validator.value, title: { optional: true, fieldType: { type: "string" as const } } } },
  } : table) } };
  expect(isOptionalPostRelationSuccessor(prior, changedScalar)).toBe(false);
  const relation = next.schema.relations[0];
  if (relation === undefined) throw new Error("Missing relation fixture");
  for (const declaration of [
    { ...relation.declaration, value: { cardinality: "one", required: true } },
    { ...relation.declaration, value: { cardinality: "many", required: false } },
    { ...relation.declaration, localized: true },
    { ...relation.declaration, target: { table: "audit" } },
    { ...relation.declaration, inverse: { cardinality: "one", name: null } },
    { ...relation.declaration, onTargetDelete: "cascade" },
  ]) expect(await Effect.runPromise(verifyApplicationManifestV3({ ...next, schema: { ...next.schema, relations: [{ ...relation, declaration }] } }).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
  const records = new ApplicationWriteOwnershipHistoryBudget();
  expect(records.consume(64, 0)._tag).toBe("Success");
  expect(records.consume(1, 0)._tag).toBe("Failure");
  const bytes = new ApplicationWriteOwnershipHistoryBudget();
  expect(bytes.consume(0, 1_048_576)._tag).toBe("Success");
  expect(bytes.consume(0, 1)._tag).toBe("Failure");
  for (const field of [{ type: "string" }, { type: "id", tableName: "audit" }]) {
    const changed = { ...next, schema: { ...next.schema, tables: next.schema.tables.map(table => table.name === "posts" && table.validator.type === "object" ? { ...table,
      validator: { type: "object", value: { ...table.validator.value, relatedPost: { optional: true, fieldType: field } } } } : table) } };
    expect(await Effect.runPromise(verifyApplicationManifestV3(changed).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
  }
  const configuration = { ...next.schema.writePolicies.configuration, profile: "payload.scalar" };
  const policies = { ...next.schema.writePolicies, configuration, tables: next.schema.writePolicies.tables.map(table => table.owner === "payload" ? { ...table, configSha256: hashPolicyFixture(configuration) } : table) };
  expect(await Effect.runPromise(verifyApplicationManifestV3({ ...next, schema: { ...next.schema, writePolicies: policies, writePolicySetSha256: hashPolicyFixture(policies) } }).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
  // @ts-expect-error Forged values cannot grant an ownership successor.
  expect(admitsApplicationOwnershipSuccessor({}, { tableId: 1 }, { tableId: 1 })).toBe(false);
});
