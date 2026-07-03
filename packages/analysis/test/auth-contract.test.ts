import { describe, expectTypeOf, it } from "vitest";
import type {
  UserIdentity as PublicUserIdentity,
  UserIdentityAttributes as PublicUserIdentityAttributes,
} from "flarex";
import type {
  ExecutionIdentity,
  UserIdentity as ProtocolUserIdentity,
  UserIdentityAttributes as ProtocolUserIdentityAttributes,
} from "flarex-protocol";

describe("auth contract compatibility", () => {
  it("keeps public SDK identity types compatible with protocol identities", () => {
    expectTypeOf<PublicUserIdentity>().toEqualTypeOf<ProtocolUserIdentity>();
    expectTypeOf<PublicUserIdentityAttributes>()
      .toEqualTypeOf<ProtocolUserIdentityAttributes>();
    expectTypeOf<ExecutionIdentity>().toMatchTypeOf<
      | { readonly kind: "anonymous" }
      | { readonly kind: "user"; readonly user: PublicUserIdentity }
    >();
  });
});
