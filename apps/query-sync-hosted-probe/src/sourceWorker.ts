import {
  decodeQuerySyncSourceReadRequestV1,
  encodeQuerySyncSourceReadResponseV1,
  MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
  querySyncSourceReadMediaTypeV1,
  querySyncSourceReadPathV1,
  type QuerySyncSourceReadRequestV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";

import { hasExactBearerCapability, isConfiguredSecret } from "./authentication";
import {
  FX02B_PROBE_EPOCH_UUID,
  FX02B_PROBE_SCOPE_UUID,
} from "./fixture";

interface Fx02bSourceEnv {
  readonly FLAREX_EXECUTOR_TOKEN?: string;
}

const SOURCE_SEQUENCES = Object.freeze([1n, 2n]);
const CURRENT_EPOCH = decodeScopeEpochUuidV1(FX02B_PROBE_EPOCH_UUID);
const LATEST_SEQUENCE = CommitSeqSchema.make(2n);
const ZERO_SEQUENCE = CommitSeqSchema.make(0n);
const FIRST_SEQUENCE = CommitSeqSchema.make(1n);

export const fx02bSourceWorker = {
  async fetch(request: Request, env: Fx02bSourceEnv): Promise<Response> {
    const token = env.FLAREX_EXECUTOR_TOKEN;
    if (!isConfiguredSecret(token)) return privateText("Misconfigured", 500);
    if (!(await hasExactBearerCapability(request, token))) {
      return privateText("Unauthorized", 401);
    }
    const url = new URL(request.url);
    if (url.pathname !== querySyncSourceReadPathV1) {
      return privateText("Not Found", 404);
    }
    if (request.method !== "POST") return privateText("Method Not Allowed", 405);
    if (request.headers.get("content-type") !== querySyncSourceReadMediaTypeV1) {
      return privateText("Unsupported Media Type", 415);
    }
    let requestBytes: Uint8Array | null;
    try {
      requestBytes = await readBoundedBody(
        request.body,
        MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
      );
    } catch {
      return privateText("Invalid Request", 400);
    }
    if (requestBytes === null) return privateText("Request Too Large", 413);
    return Result.match(decodeQuerySyncSourceReadRequestV1(requestBytes), {
      onFailure: () => privateText("Invalid Request", 400),
      onSuccess: decoded => sourceResponse(decoded.value),
    });
  },
} satisfies ExportedHandler<Fx02bSourceEnv>;

export default fx02bSourceWorker;

function sourceResponse(request: QuerySyncSourceReadRequestV1): Response {
  if (request.scopeUuid !== FX02B_PROBE_SCOPE_UUID) {
    return privateText("Not Found", 404);
  }
  const common = {
    codecVersion: 1 as const,
    scopeUuid: request.scopeUuid,
    syncModelId: request.syncModelId,
    requestedSourceEpoch: request.requestedSourceEpoch,
    requestedAfterCommitSeqExclusive:
      request.requestedAfterCommitSeqExclusive,
    currentSourceEpoch: CURRENT_EPOCH,
    observedLatestCommitSeq: LATEST_SEQUENCE,
    replayableAfterCommitSeqExclusive: ZERO_SEQUENCE,
    retainedFromCommitSeqInclusive: FIRST_SEQUENCE,
  };
  if (request.requestedSourceEpoch !== CURRENT_EPOCH) {
    return encodedResponse({ ...common, kind: "epochReplaced" as const });
  }
  if (request.requestedAfterCommitSeqExclusive > LATEST_SEQUENCE) {
    return encodedResponse({ ...common, kind: "cursorAhead" as const });
  }
  const selected = SOURCE_SEQUENCES.filter(sequence =>
    sequence > request.requestedAfterCommitSeqExclusive
  ).slice(0, request.budget.maximumCommittedBatches);
  const readThroughValue = selected.at(-1)
    ?? request.requestedAfterCommitSeqExclusive;
  const readThrough = CommitSeqSchema.make(readThroughValue);
  const hasMore = readThrough < LATEST_SEQUENCE;
  return encodedResponse({
    ...common,
    kind: "page" as const,
    commits: Object.freeze(selected.map(sequence => Object.freeze({
      scopeUuid: request.scopeUuid,
      epochUuid: CURRENT_EPOCH,
      commitSeq: CommitSeqSchema.make(sequence),
      committedAtMilliseconds: 1_788_134_400_000 + Number(sequence),
      appRowChanges: Object.freeze([]),
      relationAdjacencyChanges: Object.freeze([]),
    }))),
    readThroughCommitSeq: readThrough,
    hasMore,
    authorityObservation: hasMore ? null : Object.freeze({
      format: "flarex.scope-sync-active-head-observation",
      version: 1,
      scopeUuid: request.scopeUuid,
      epochUuid: CURRENT_EPOCH,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      observedAtCommitSeq: LATEST_SEQUENCE,
      activationSequence: 1n,
      activeHeadSha256Hex: "00".repeat(32),
    }),
  });
}

function encodedResponse(value: unknown): Response {
  return Result.match(encodeQuerySyncSourceReadResponseV1(
    value,
    16 * 1_024 * 1_024,
  ), {
    onFailure: () => privateText("Invalid Fixture", 500),
    onSuccess: encoded => new Response(
      copyBytesToArrayBuffer(encoded.bytes),
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-length": String(encoded.bytes.byteLength),
          "content-type": querySyncSourceReadMediaTypeV1,
        },
      },
    ),
  });
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = new Uint8Array(next.value);
      const candidateBytes = totalBytes + chunk.byteLength;
      if (!Number.isSafeInteger(candidateBytes) || candidateBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      if (chunk.byteLength > 0) chunks.push(chunk);
      totalBytes = candidateBytes;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function privateText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
