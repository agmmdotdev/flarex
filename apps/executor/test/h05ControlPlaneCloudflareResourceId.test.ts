import { describe, expect, it } from "vitest";

import { isH05ControlPlaneCloudflareResourceId } from "../h05/controlPlaneCloudflareResourceId";

describe("H05 control-plane Cloudflare resource ID policy", () => {
  it.each([
    "a".repeat(8),
    "a".repeat(128),
    "deploy/id?opaque",
    "resource-\u00a0id",
  ])("accepts %j", (value) => {
    expect(isH05ControlPlaneCloudflareResourceId(value)).toBe(true);
  });

  it.each([
    "",
    "a".repeat(7),
    "a".repeat(129),
    "resource\0id",
    "resource\tid",
    "resource\nid",
    "resource id",
    "resource\u007fid",
  ])("rejects %j", (value) => {
    expect(isH05ControlPlaneCloudflareResourceId(value)).toBe(false);
  });
});
