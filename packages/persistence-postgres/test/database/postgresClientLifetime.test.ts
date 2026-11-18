import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { observePostgresClientLifetime } from "../../src/database/postgresClientLifetime";

describe("invocation-scoped PostgreSQL client observation", () => {
  it("latches the first event before connection and preserves it through successful shutdown", async () => {
    const client = new Client();
    const observation = observePostgresClientLifetime(client);
    const first = new Error("connection transition failed");
    const later = new Error("later connection failure");
    expect(client.emit("error", first)).toBe(true);
    expect(client.emit("error", later)).toBe(true);
    expect(() => observation.check()).toThrow(expect.objectContaining({ connectionCause: first }));
    await expect(observation.finish(async () => {})).rejects.toMatchObject({ connectionCause: first, settlementCause: undefined });
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  });

  it("retains an idle error arriving while the actual release is still pending", async () => {
    const client = new Client();
    const observation = observePostgresClientLifetime(client);
    const connectionCause = new Error("disconnected while ending");
    let completeRelease: (() => void) | undefined;
    const finishing = observation.finish(() => new Promise<void>(resolve => { completeRelease = resolve; }));
    const rejected = expect(finishing).rejects.toMatchObject({ connectionCause });
    expect(client.listenerCount("error")).toBe(1);
    expect(client.emit("error", connectionCause)).toBe(true);
    completeRelease?.();
    await rejected;
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  });

  it("preserves both connection and end failure after confirmed shutdown", async () => {
    const client = new Client();
    const observation = observePostgresClientLifetime(client);
    const connectionCause = new Error("idle disconnect");
    const settlementCause = new Error("end cleanup failed");
    client.emit("error", connectionCause);
    await expect(observation.finish(async () => {
      client.emit("end");
      throw settlementCause;
    })).rejects.toMatchObject({ connectionCause, settlementCause });
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  });

  it("keeps observing after rejected end until a late driver end confirms shutdown", async () => {
    const client = new Client();
    const observation = observePostgresClientLifetime(client);
    const settlementCause = new Error("end rejected before shutdown");
    await expect(observation.finish(async () => { throw settlementCause; })).rejects.toBe(settlementCause);
    expect(client.listenerCount("error")).toBe(1);
    expect(client.listenerCount("end")).toBe(1);
    const lateCause = new Error("late socket error while still alive");
    expect(client.emit("error", lateCause)).toBe(true);
    expect(() => observation.check()).toThrow(expect.objectContaining({ connectionCause: lateCause }));
    client.emit("end");
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  });

  it("does not detach on an early end event before the release Promise settles", async () => {
    const client = new Client();
    const observation = observePostgresClientLifetime(client);
    let completeRelease: (() => void) | undefined;
    const finishing = observation.finish(() => new Promise<void>(resolve => { completeRelease = resolve; }));
    client.emit("end");
    expect(client.listenerCount("error")).toBe(1);
    completeRelease?.();
    await expect(finishing).resolves.toBeUndefined();
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  });
});
