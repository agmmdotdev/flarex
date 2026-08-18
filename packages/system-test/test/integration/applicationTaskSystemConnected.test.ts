import { describe, expect, it } from "vitest";

import { proveApplicationTaskSystemConnected } from
  "../../support/applicationTaskSystemConnectedHarness";

describe("DTE06-E5 Application Task supervision", () => {
  it("connects one accepted Application Worker to durable result and lifecycle settlement", async () => {
    await expect(proveApplicationTaskSystemConnected()).resolves.toBeUndefined();
  }, 120_000);

  it("maps a real Application Worker handler failure into the durable retry policy", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "task_failure_retry",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("delivers and acknowledges one exact durable cancellation generation", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "cancellation",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("maps the real Worker maximum duration into terminal timeout policy", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "maximum_duration",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("stops the real Worker when lifecycle heartbeat reports a stale fence", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "stale_fence",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("leaves recovery authoritative when the real database lease is lost", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "lease_loss",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("reconciles a lost R2 create response before durable success", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "result_publication_reconciled",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("leaves lifecycle unchanged when R2 publication cannot be reconciled", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "result_publication_uncertain",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("replays the exact completion after its committed response is lost", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "completion_response_lost",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("suppresses a duplicate connected delivery while the accepted Worker is live", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "duplicate_delivery",
    )).resolves.toBeUndefined();
  }, 120_000);

  it("lets durable success supersede cancellation when completion wins the race", async () => {
    await expect(proveApplicationTaskSystemConnected(
      undefined,
      "cancel_complete_race",
    )).resolves.toBeUndefined();
  }, 120_000);
});
