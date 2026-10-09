import { Result } from "effect";
import { getTableColumns } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isJson, type Json } from "flarex-protocol/json";
import { fxSystemTransactionSessions } from "../../database/schema";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import { readOriginalFinitePublicationSession, type OriginalFiniteExecutionEntry } from "./finiteEntry";

/** Publication expectations come from this exact confirmed-entry issuer.
 * Caller-authored rows with matching digest/scalar pins cannot substitute any
 * original JSON, canonical bytes, null or immutable session column. */
export function projectOriginalFinitePublicationSession(original: OriginalFiniteExecutionEntry,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  return Result.gen(function* () {
    const session = yield* readOriginalFinitePublicationSession(original, issuer);
    const encoded: Record<string, Json> = {};
    for (const [key, column] of Object.entries(getTableColumns(fxSystemTransactionSessions))) {
      const value: unknown = Reflect.get(session, key);
      if (value instanceof Uint8Array) encoded[column.name] = `\\x${encodeBytesToLowercaseHex(value)}`;
      else if (value instanceof Date) {
        if (!Number.isSafeInteger(value.getTime()))
          return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        encoded[column.name] = value.toISOString();
      } else if (typeof value === "bigint") encoded[column.name] = value.toString();
      else if (isJson(value)) encoded[column.name] = value;
      else return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    return JSON.stringify(encoded);
  });
}
