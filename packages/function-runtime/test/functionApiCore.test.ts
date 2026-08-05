import { describe, expect, it, vi } from "vitest";

import type { UserIdentity } from "flarex-protocol/auth";

import {
  createFunctionRuntimeAuthV1,
  createMutationFunctionRuntimeBaseContextV1,
  createQueryFunctionRuntimeBaseContextV1,
} from "../src/functionApiCore";

const IDENTITY = Object.freeze({
  tokenIdentifier: "issuer|subject",
  subject: "subject",
  issuer: "issuer",
  name: "Flarex User",
}) satisfies UserIdentity;

describe("@flarex/function-runtime/function-api-core", () => {
  it("returns null for anonymous auth without invoking the clone port", async () => {
    const cloneIdentity = vi.fn<(identity: UserIdentity) => UserIdentity>();
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "anonymous" }),
      cloneIdentity,
    );

    await expect(auth.getUserIdentity()).resolves.toBeNull();
    expect(cloneIdentity).not.toHaveBeenCalled();
    expect(Object.isFrozen(auth)).toBe(true);
    expect(Object.keys(auth)).toEqual(["getUserIdentity"]);
  });

  it("returns a fresh owned identity from the trusted clone port on every call", async () => {
    const cloneIdentity = vi.fn((identity: UserIdentity): UserIdentity => ({
      ...identity,
    }));
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "user", user: IDENTITY }),
      cloneIdentity,
    );

    const first = await auth.getUserIdentity();
    const second = await auth.getUserIdentity();

    expect(first).toEqual(IDENTITY);
    expect(second).toEqual(IDENTITY);
    expect(first).not.toBe(IDENTITY);
    expect(second).not.toBe(IDENTITY);
    expect(second).not.toBe(first);
    expect(cloneIdentity).toHaveBeenNthCalledWith(1, IDENTITY);
    expect(cloneIdentity).toHaveBeenNthCalledWith(2, IDENTITY);
  });

  it("constructs exact frozen query and mutation base contexts", async () => {
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "anonymous" }),
      identity => identity,
    );
    const queryDb = Object.freeze({ get: vi.fn() });
    const mutationDb = Object.freeze({
      get: vi.fn(),
      insert: vi.fn(),
    });

    const query = createQueryFunctionRuntimeBaseContextV1(auth, queryDb);
    const mutation = createMutationFunctionRuntimeBaseContextV1(auth, mutationDb);

    expect(query).toEqual({ auth, db: queryDb });
    expect(mutation).toEqual({ auth, db: mutationDb });
    expect(query.db).toBe(queryDb);
    expect(mutation.db).toBe(mutationDb);
    expect(Object.keys(query)).toEqual(["auth", "db"]);
    expect(Object.keys(mutation)).toEqual(["auth", "db"]);
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(mutation)).toBe(true);
    expect("runQuery" in query).toBe(false);
    expect("runMutation" in mutation).toBe(false);
    expect("scheduler" in mutation).toBe(false);
    expect("storage" in mutation).toBe(false);
  });
});
