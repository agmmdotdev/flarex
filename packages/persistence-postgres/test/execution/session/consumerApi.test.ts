import { describe, expectTypeOf, it } from "vitest";

type RootActivationExport = Extract<
  keyof typeof import("../../../src"),
  "createPointMutationSessionActivationPersistenceV1"
>;

describe("O03-B1 point-mutation session activation", () => {

  it("keeps activation off the broad persistence facade", () => {
    expectTypeOf<RootActivationExport>().toEqualTypeOf<never>();
  });
});
