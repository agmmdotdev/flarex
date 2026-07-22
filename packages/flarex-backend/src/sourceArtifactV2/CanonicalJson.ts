import { compareUtf16Strings } from "@flarex/utils/strings";
import {
  isJsonArray,
  isJsonObject,
  type Json,
} from "flarex-protocol/json";

export interface SourceArtifactV2CanonicalJsonLengthDefects {
  readonly invalidMembership: () => never;
  readonly overflow: () => never;
}

export function sourceArtifactV2CanonicalJsonUtf8ByteLength(
  value: Json,
  defects: SourceArtifactV2CanonicalJsonLengthDefects,
): number {
  if (typeof value === "string") return canonicalJsonStringUtf8ByteLength(value, defects);
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return defects.invalidMembership();
    return encoded.length;
  }
  if (isJsonArray(value)) {
    let total = 2;
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item === undefined) return defects.invalidMembership();
      total = checkedCanonicalLength(
        total,
        sourceArtifactV2CanonicalJsonUtf8ByteLength(item, defects),
        defects,
      );
      if (index > 0) total = checkedCanonicalLength(total, 1, defects);
    }
    return total;
  }
  if (!isJsonObject(value)) return defects.invalidMembership();
  const keys = Object.keys(value).sort(compareUtf16Strings);
  let total = 2;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) return defects.invalidMembership();
    const item = value[key];
    if (item === undefined) return defects.invalidMembership();
    total = checkedCanonicalLength(total, canonicalJsonStringUtf8ByteLength(key, defects), defects);
    total = checkedCanonicalLength(total, 1, defects);
    total = checkedCanonicalLength(
      total,
      sourceArtifactV2CanonicalJsonUtf8ByteLength(item, defects),
      defects,
    );
    if (index > 0) total = checkedCanonicalLength(total, 1, defects);
  }
  return total;
}

function canonicalJsonStringUtf8ByteLength(
  value: string,
  defects: SourceArtifactV2CanonicalJsonLengthDefects,
): number {
  let total = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 ||
      code === 0x0a || code === 0x0c || code === 0x0d
    ) {
      total = checkedCanonicalLength(total, 2, defects);
    } else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
      if (
        code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff
      ) {
        total = checkedCanonicalLength(total, 4, defects);
        index += 1;
      } else {
        total = checkedCanonicalLength(total, 6, defects);
      }
    } else {
      total = checkedCanonicalLength(
        total,
        code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3,
        defects,
      );
    }
  }
  return total;
}

function checkedCanonicalLength(
  left: number,
  right: number,
  defects: SourceArtifactV2CanonicalJsonLengthDefects,
): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) return defects.overflow();
  return sum;
}
