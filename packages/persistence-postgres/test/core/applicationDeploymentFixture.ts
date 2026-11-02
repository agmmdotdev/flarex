import { Effect, Option } from "effect";
import type { CoreApplicationRegistration, CoreDatabase } from "../../src/core/api";

/** Composition over Core's real candidate and schema lifecycle. */
export const prepareApplication = Effect.fn("CoreApplicationFixture.prepare")(function* (database: CoreDatabase,
  input: Readonly<{ schema: unknown; registration: CoreApplicationRegistration }>) {
  const candidateId = yield* database.prepareApplicationCandidate(input);
  const candidate = yield* database.readApplicationCandidate(candidateId);
  if (Option.isNone(candidate)) return yield* Effect.die(new Error("Prepared candidate disappeared"));
  return { ...candidate.value.schemaProposal, candidateId };
});
export const activateApplication = Effect.fn("CoreApplicationFixture.activate")(function* (database: CoreDatabase, schema: unknown,
  publication: Readonly<{ programs: CoreApplicationRegistration["programs"]; applicationRegistration: CoreApplicationRegistration }>) {
  const proposal = yield* prepareApplication(database, { schema, registration: publication.applicationRegistration });
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "overwritten" || (status.state === "validated" || status.state === "active") && status.indexesReady)
      return yield* database.activateApplicationCandidate(proposal.candidateId, { programs: publication.programs });
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  return yield* Effect.die(new Error("Application schema did not become ready"));
});
