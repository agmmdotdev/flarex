import { createHash } from "node:crypto";

/** Bounded physical lookup key. Exact text remains the equality proof. */
export const textFingerprint = (key: string) => createHash("sha256").update(key).digest("hex");
