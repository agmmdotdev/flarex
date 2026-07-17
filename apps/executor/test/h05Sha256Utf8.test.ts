import { describe, expect, it } from "vitest";

import { h05Sha256Utf8 } from "../h05/sha256Utf8";

describe("H05 UTF-8 SHA-256", () => {
  it.each([
    [
      "",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    [
      "abc",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      "é",
      "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
    ],
    [
      "\ud800",
      "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097",
    ],
    [
      "a\0b",
      "59b271ae1bbcb1d31d41929817f4b16fb439eb4f31520b5ad1d5ce98920a7138",
    ],
  ])("hashes %j using the established UTF-8 contract", (value, expected) => {
    expect(h05Sha256Utf8(value)).toBe(expected);
  });
});
