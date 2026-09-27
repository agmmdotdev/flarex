import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { bindPrivateProductAttempt, preparePrivateProductAttempt } from "../src/product-attempt";
import { makeLocalProductCommands } from "../src/product-service";

describe("private Product attempt admission", () => {
  it("selects only the real native Product service commands and their receipt policy", async () => {
    const runtime = await Effect.runPromise(makeLocalProductCommands());
    const admitted = bindPrivateProductAttempt(runtime);
    const update = admitted.update({ id: "prod_attempt", data: {
      title: "Published title", handle: "published-handle", status: "published",
    } });
    const retrieve = admitted.retrieve({ id: "prod_attempt" });
    const list = admitted.listByHandle({ filters: { handle: "published-handle" } });
    expect(Result.isSuccess(update)).toBe(true);
    expect(Result.isSuccess(retrieve)).toBe(true);
    expect(Result.isSuccess(list)).toBe(true);
    if (Result.isFailure(update) || Result.isFailure(retrieve) || Result.isFailure(list)) return;
    expect(update.success.command).toBe(runtime.commands.update);
    expect(retrieve.success.command).toBe(runtime.commands.retrieve);
    expect(list.success.command).toBe(runtime.commands.list);
    expect(update.success.args).toEqual({ id: "prod_attempt", data: {
      title: "Published title", handle: "published-handle", status: "published",
    } });
    expect(commerceCommandIdentity(update.success.command)).toMatchObject({ name: "productUpdate", mode: "write" });
    expect(commerceCommandIdentity(retrieve.success.command)).toMatchObject({ name: "productretrieve", mode: "read" });
    expect(commerceCommandIdentity(list.success.command)).toMatchObject({ name: "productlist", mode: "read" });
    expect(admitted.logicalPolicy).toBe(runtime.logicalPolicy);
  });

  it("refuses expanded mutation and read surfaces before service execution", async () => {
    const admitted = await Effect.runPromise(preparePrivateProductAttempt());
    const refused = [
      admitted.update({ id: "prod_attempt", data: { title: "Title", handle: "handle", status: "draft" } }),
      admitted.update({ id: "prod_attempt", data: { title: "Title", handle: "handle", status: "published", tags: [] } }),
      admitted.retrieve({ id: "prod_attempt", config: { relations: ["tags"] } }),
      admitted.listByHandle({ filters: { handle: "handle", status: "published" } }),
      admitted.listByHandle({ filters: { handle: "handle", q: "Title" } }),
    ];
    for (const result of refused) {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toBe("unsupportedProfile");
    }
  });
});
