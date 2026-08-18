import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  makeTaskExecutionPrincipalStore,
  type TaskExecutionPrincipalStoreBucket,
} from "../src/taskExecutionPrincipal/TaskExecutionPrincipalStore.js";

const SCOPE_A = "scope_97000000-0000-4000-8000-000000000001";
const SCOPE_B = "scope_97000000-0000-4000-8000-000000000002";

describe("TaskExecutionPrincipalStore", () => {
  it("classifies an invalid scope as store construction input", () => {
    expect(makeTaskExecutionPrincipalStore(
      "not-a-scope",
      new MemoryBucket(),
    )).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "TaskExecutionPrincipalStoreInputError",
        operation: "create",
        reason: "invalidScope",
      },
    });
  });

  it("issues a scope-bound authenticated principal and reconstructs owned identity", async () => {
    const bucket = new MemoryBucket();
    const store = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_A,
      bucket,
    ));
    const identity = {
      kind: "user" as const,
      user: {
        tokenIdentifier: "token-1",
        subject: "user-1",
        issuer: "https://auth.flarex.invalid",
        custom: { roles: ["reader"] },
      },
    };

    const first = await Effect.runPromise(store.issueAuthenticatedUser(identity));
    const replay = await Effect.runPromise(store.issueAuthenticatedUser(identity));
    identity.user.subject = "caller-mutated";
    const stored = await Effect.runPromise(store.read(first));

    expect(replay).toEqual(first);
    expect(stored.object).toEqual({
      version: 1,
      scopeId: SCOPE_A,
      executionIdentity: {
        kind: "user",
        user: {
          tokenIdentifier: "token-1",
          subject: "user-1",
          issuer: "https://auth.flarex.invalid",
          custom: { roles: ["reader"] },
        },
      },
    });
    expect(Object.isFrozen(stored.object)).toBe(true);
    expect(Object.isFrozen(stored.object.executionIdentity.user)).toBe(true);
    expect(Object.isFrozen(stored.object.executionIdentity.user.custom)).toBe(true);
    expect(bucket.putCalls).toBe(2);

    stored.canonicalBytes[0] = 0;
    stored.reference.sha256[0] = 0;
    const reread = await Effect.runPromise(store.read(first));
    expect(reread.canonicalBytes[0]).not.toBe(0);
    expect(reread.reference.sha256).toEqual(first.sha256);
  });

  it("rejects anonymous and malformed identities before touching storage", async () => {
    const bucket = new MemoryBucket();
    const store = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_A,
      bucket,
    ));
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    await expectFailure(
      store.issueAuthenticatedUser({ kind: "anonymous" }),
      "TaskExecutionPrincipalStoreInputError",
      "anonymousIdentity",
    );
    await expectFailure(
      store.issueAuthenticatedUser(revoked.proxy),
      "TaskExecutionPrincipalStoreInputError",
      "invalidIdentity",
    );
    expect(bucket.putCalls).toBe(0);
  });

  it("rejects a genuine principal object when read through another scope", async () => {
    const bucket = new MemoryBucket();
    const scopeA = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_A,
      bucket,
    ));
    const scopeB = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_B,
      bucket,
    ));
    const reference = await Effect.runPromise(scopeA.issueAuthenticatedUser({
      kind: "user",
      user: {
        tokenIdentifier: "token-1",
        subject: "user-1",
        issuer: "https://auth.flarex.invalid",
      },
    }));

    await expectFailure(
      scopeB.read(reference),
      "TaskExecutionPrincipalStoreCorruptionError",
      "scopeMismatch",
    );
  });

  it("fails closed for missing, size-corrupt, and noncanonical principal objects", async () => {
    const bucket = new MemoryBucket();
    const store = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_A,
      bucket,
    ));
    const reference = await Effect.runPromise(store.issueAuthenticatedUser({
      kind: "user",
      user: {
        tokenIdentifier: "token-1",
        subject: "user-1",
        issuer: "https://auth.flarex.invalid",
      },
    }));

    bucket.values.delete(reference.objectKey);
    await expectFailure(
      store.read(reference),
      "TaskExecutionPrincipalStoreNotFoundError",
    );

    bucket.values.set(reference.objectKey, new Uint8Array([1]));
    await expectFailure(
      store.read(reference),
      "TaskExecutionPrincipalStoreCorruptionError",
      "sizeMismatch",
    );
  });

  it("accepts genuine cross-realm Uint8Array stream chunks", async () => {
    const bucket = new MemoryBucket();
    const store = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE_A,
      bucket,
    ));
    const reference = await Effect.runPromise(store.issueAuthenticatedUser({
      kind: "user",
      user: {
        tokenIdentifier: "token-1",
        subject: "user-1",
        issuer: "https://auth.flarex.invalid",
      },
    }));
    bucket.crossRealmChunks = true;

    await expect(Effect.runPromise(store.read(reference))).resolves.toMatchObject({
      object: { scopeId: SCOPE_A },
    });
  });
});

async function expectFailure(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
  reason?: string,
): Promise<void> {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: tag,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

class MemoryBucket implements TaskExecutionPrincipalStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;
  crossRealmChunks = false;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: "*" } },
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    const bytes = copyBytes(value);
    const chunk = this.crossRealmChunks
      ? runInNewContext("Uint8Array.from(bytes)", { bytes: [...bytes] })
      : copyBytes(bytes);
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    };
  }
}
