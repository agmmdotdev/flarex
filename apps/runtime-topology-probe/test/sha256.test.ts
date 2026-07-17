import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../src/sha256";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probe host SHA-256", () => {
  it("encodes one real digest as canonical lowercase hexadecimal text", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes UTF-8 text once with SHA-256", async () => {
    const digestBytes = Uint8Array.from(
      { length: 32 },
      (_, index) => index,
    );
    const digest = vi.spyOn(crypto.subtle, "digest")
      .mockResolvedValue(digestBytes.buffer);

    await expect(sha256Hex("é")).resolves.toBe(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(digest).toHaveBeenCalledOnce();
    expect(digest).toHaveBeenCalledWith(
      "SHA-256",
      new TextEncoder().encode("é"),
    );
  });

  it("preserves Web Crypto rejections", async () => {
    const cause = new Error("Web Crypto failed");
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(cause);

    await expect(sha256Hex("evidence")).rejects.toBe(cause);
  });
});
