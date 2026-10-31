import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";
import { makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { payloadDisjointVisibilityScenario, payloadPendingVisibilityScenario, payloadUniqueAbaVisibilityScenario,
  payloadVisibilityScenario } from "./payloadVisibilityScenario";
import { fullProofPayloadVisibilityTarget } from "./payloadVisibilityFixture";

describe.skipIf(postgresUrl === null)("direct native Payload visibility (ordinary PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("preserves pending reads, root rollback and committed replay", () => withPersistence(persistence =>
    runEffect(Effect.scoped(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
        { name: "title", type: "text", required: true, unique: true },
      ] }]);
      const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence), compiled);
      yield* payloadPendingVisibilityScenario(fullProofPayloadVisibilityTarget(tested));
    })))), 180_000);
  it("characterizes touched rows, absence and new demands across competing publication", () => withPersistence(persistence =>
    runEffect(Effect.scoped(Effect.gen(function* () {
      const role = yield* Effect.tryPromise({ try: () => persistence.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname=current_user"),
      catch: cause => cmsError("resourceFailure", cause) });
      expect(role.rows[0]?.superuser).toBe(false);
      const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
        { name: "title", type: "text", required: true, unique: true },
      ] }]);
      const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence), compiled);
      yield* payloadVisibilityScenario(fullProofPayloadVisibilityTarget(tested));
    })))), 180_000);
  it("characterizes disjoint untouched-demand visibility and final acceptance", () => withPersistence(persistence =>
    runEffect(Effect.scoped(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
        { name: "title", type: "text", required: true, unique: true },
      ] }]);
      const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence), compiled);
      yield* payloadDisjointVisibilityScenario(fullProofPayloadVisibilityTarget(tested));
    })))), 180_000);
  it("characterizes native unique-key ABA acceptance after two competing publications", () => withPersistence(persistence =>
    runEffect(Effect.scoped(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
        { name: "title", type: "text", required: true, unique: true },
      ] }]);
      const tested = yield* makeIndexedPayloadFixture(persistence, makePostgresRelationalSession(persistence), compiled);
      yield* payloadUniqueAbaVisibilityScenario(fullProofPayloadVisibilityTarget(tested));
    })))), 180_000);
});
