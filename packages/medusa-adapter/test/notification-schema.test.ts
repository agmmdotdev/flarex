import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { Notification, NotificationProvider } from "@medusajs/notification/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { captureNotificationMetadata, compileNotificationDefinition } from "../src/modules/notification/schema";
import { compileNotificationPhaseContracts, decodeLocalFeedNotificationsInput } from "../src/modules/notification/contracts";

describe("native Notification DML and local-feed phase admission", () => {
  it("retains the real channels array and empty default through shared lowering", async () => {
    // This is the Notification consumer witness for the shared array/default
    // correction. The previous compiled grammar rejected this genuine model.
    const native = compileDmlSchema([Notification, NotificationProvider]);
    const channels = native.tables.find(table => table.name === "notification_provider")?.columns.find(column => column.name === "channels");
    expect(channels).toMatchObject({ type: "array", nullable: false, defaultValue: [] });
    const captured = await Effect.runPromise(captureNotificationMetadata());
    expect(captured.frame.tables.find(table => table.name === "notification_provider")?.columns.find(column => column.name === "channels"))
      .toMatchObject({ type: "array", nullable: false, defaultValue: [] });
    const definition = await Effect.runPromise(compileNotificationDefinition());
    expect(definition.schema.tables.find(table => table.identity.tableId === "notification_provider")?.columns.find(column => column.identity.columnId === "channels"))
      .toMatchObject({ type: "jsonb", nullable: false, default: { kind: "emptyJsonArray" } });
    expect(captured.frame.tables.find(table => table.name === "notification")?.columns.find(column => column.name === "status"))
      .toMatchObject({ type: "enum", defaultValue: "pending", options: { choices: ["pending", "success", "failure"] } });
  });

  it("derives stored array fields from DML and refuses scalar/object/non-string channels", async () => {
    const metadata = await Effect.runPromise(captureNotificationMetadata());
    const notification = metadata.frame.tables.find(table => table.name === "notification"), provider = metadata.frame.tables.find(table => table.name === "notification_provider");
    if (notification === undefined || provider === undefined) throw new Error("Missing native Notification model");
    const profile = Result.getOrThrow(compileNotificationPhaseContracts(notification, provider));
    for (const channels of ["feed", {}, [1], null, undefined])
      expect(Result.isFailure(profile.decodeProviderRow({ id: "local", channels }))).toBe(true);
    expect(Result.getOrThrow(profile.decodeProviderRow({ id: "local", channels: ["feed"] }))).toEqual({ id: "local", channels: ["feed"] });
    expect(Result.isFailure(profile.decodeProviderRow({ id: "local", channels: ["feed"], extra: true }))).toBe(true);
  });

  it("admits the native import message and preserves scalar/array/empty shape while refusing keys", () => {
    const message = { to: "", channel: "feed", template: "admin-ui", data: { title: "Products imported", description: "import.csv" } };
    for (const input of [message, [message], []]) expect(Result.getOrThrow(decodeLocalFeedNotificationsInput(input))).toEqual(input);
    for (const input of [{ ...message, idempotency_key: "invented" }, { ...message, idempotency_key: null }, { ...message, channel: "email" },
      { ...message, id: "chosen" }, { ...message, provider_id: "chosen" }, [message, message]])
      expect(Result.isFailure(decodeLocalFeedNotificationsInput(input))).toBe(true);
  });
});
