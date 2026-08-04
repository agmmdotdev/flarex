import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type {
  DirectActionExecutionSubjectCapabilityV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import { Data } from "effect";
import type { EdgeActionHostPolicyFrameV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";

import {
  confirmActiveApplicationOutboundHttpEffectV1,
  declareActiveApplicationExternalEffectDispatchV1,
  failActiveApplicationExternalEffectBeforeDispatchV1,
  markActiveApplicationExternalEffectUncertainV1,
  prepareActiveApplicationOutboundHttpEffectV1,
  type ActiveApplicationActionEffectRunnerV1,
  type ActiveApplicationActionEvidenceLiveV1,
} from "./actionAdmissionSystemV1";
import type { EdgeActionHostSyscallSequencerV1 } from
  "./edgeActionHostSyscallSequencerV1";

const UTF8 = new TextEncoder();
const NO_OUTBOUND_POISON = Symbol("FlarexEdgeActionNoOutboundPoison");

export interface EdgeActionOutboundHostFetchV1 {
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface EdgeActionOutboundGatewayV1Input {
  readonly stableKeyPrefix: string;
  readonly policy: EdgeActionHostPolicyFrameV1;
  readonly sequencer: EdgeActionHostSyscallSequencerV1;
  readonly evidence: EdgeActionOutboundEvidencePortV1;
  readonly host: EdgeActionOutboundHostFetchV1;
}

export interface EdgeActionOutboundEvidencePortV1 {
  readonly hash: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly prepare: (input: Readonly<{
    readonly stableEffectKey: string;
    readonly canonicalRequestBytes: Uint8Array;
  }>) => Promise<Readonly<{ readonly effectOrdinal: bigint }>>;
  readonly declareDispatch: (effectOrdinal: bigint) => Promise<void>;
  readonly failBeforeDispatch: (
    effectOrdinal: bigint,
    terminalCode: string,
  ) => Promise<void>;
  readonly confirm: (
    effectOrdinal: bigint,
    canonicalResponseBytes: Uint8Array,
  ) => Promise<void>;
  readonly markUncertain: (
    effectOrdinal: bigint,
    terminalCode: string,
  ) => Promise<void>;
}

export class EdgeActionOutboundGatewayV1Error extends Data.TaggedError(
  "EdgeActionOutboundGatewayV1Error",
)<{
  readonly reason:
    | "closed"
    | "invalidRequest"
    | "originDenied"
    | "resourceExceeded"
    | "redirectDenied"
    | "dispatchUncertain";
  readonly phase: "beforeDispatch" | "afterDispatch";
  readonly cause?: unknown;
}> {}

export interface EdgeActionOutboundGatewayV1 {
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export function makeEdgeActionOutboundGatewayV1(
  input: EdgeActionOutboundGatewayV1Input,
): EdgeActionOutboundGatewayV1 {
  let open = true;
  let ordinal = 0;
  let active = 0;
  let cumulativeBodyBytes = 0;
  let firstPoison: unknown | typeof NO_OUTBOUND_POISON = NO_OUTBOUND_POISON;
  const pending = new Set<Promise<unknown>>();

  const fetch = (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const operation = run(requestInput, init);
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  };

  const run = async (
    requestInput: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!open) throw gatewayError("closed", "beforeDispatch");
    let activeAcquired = false;
    let preparedOrdinal: bigint | undefined;
    let dispatchDeclared = false;
    try {
      ordinal += 1;
      if (ordinal > input.policy.maximumOutboundRequests) {
        throw gatewayError("resourceExceeded", "beforeDispatch");
      }
      if (active >= input.policy.maximumConcurrentOutboundRequests) {
        throw gatewayError("resourceExceeded", "beforeDispatch");
      }
      active += 1;
      activeAcquired = true;
      let hostOrdinal: bigint;
      try {
        hostOrdinal = input.sequencer.next("outbound");
      } catch (cause) {
        throw gatewayError("resourceExceeded", "beforeDispatch", cause);
      }
      const captured = await captureRequest(requestInput, init, input.policy);
      const requestIdentitySha256 = await input.evidence.hash(
        captured.evidenceBytes,
      );
      const prepared = await input.evidence.prepare({
            stableEffectKey: [
              input.stableKeyPrefix,
              "http",
              hostOrdinal,
              encodeBytesToLowercaseHex(requestIdentitySha256),
            ].join(":"),
            canonicalRequestBytes: captured.evidenceBytes,
          });
      preparedOrdinal = prepared.effectOrdinal;
      await input.evidence.declareDispatch(preparedOrdinal);
      dispatchDeclared = true;
      let response: Response;
      try {
        response = await input.host.fetch(captured.request);
      } catch (cause) {
        await markUncertain(input.evidence, preparedOrdinal);
        const failure = gatewayError("dispatchUncertain", "afterDispatch", cause);
        if (firstPoison === NO_OUTBOUND_POISON) firstPoison = failure;
        throw failure;
      }
      let capturedResponse: Readonly<{
        readonly response: Response;
        readonly evidenceBytes: Uint8Array;
        readonly bodyBytes: number;
      }>;
      try {
        capturedResponse = await captureResponse(response, input.policy);
      } catch (cause) {
        await markUncertain(input.evidence, preparedOrdinal);
        const failure = gatewayError("dispatchUncertain", "afterDispatch", cause);
        if (firstPoison === NO_OUTBOUND_POISON) firstPoison = failure;
        throw failure;
      }
      const nextCumulative = cumulativeBodyBytes + captured.requestBodyBytes +
        capturedResponse.bodyBytes;
      if (
        !Number.isSafeInteger(nextCumulative) ||
        nextCumulative > input.policy.maximumCumulativeOutboundBodyBytes
      ) {
        await markUncertain(input.evidence, preparedOrdinal);
        const failure = gatewayError("resourceExceeded", "afterDispatch");
        if (firstPoison === NO_OUTBOUND_POISON) firstPoison = failure;
        throw failure;
      }
      try {
        await input.evidence.confirm(
          preparedOrdinal,
          capturedResponse.evidenceBytes,
        );
      } catch (cause) {
        await markUncertain(input.evidence, preparedOrdinal);
        const failure = gatewayError("dispatchUncertain", "afterDispatch", cause);
        if (firstPoison === NO_OUTBOUND_POISON) firstPoison = failure;
        throw failure;
      }
      cumulativeBodyBytes = nextCumulative;
      if (capturedResponse.response.status >= 300 &&
        capturedResponse.response.status < 400) {
        throw gatewayError("redirectDenied", "afterDispatch");
      }
      return capturedResponse.response;
    } catch (cause) {
      if (
        cause instanceof EdgeActionOutboundGatewayV1Error &&
        cause.reason === "resourceExceeded" &&
        firstPoison === NO_OUTBOUND_POISON
      ) firstPoison = cause;
      if (preparedOrdinal !== undefined && !dispatchDeclared) {
        await input.evidence.failBeforeDispatch(
            preparedOrdinal,
            cause instanceof EdgeActionOutboundGatewayV1Error
              ? `edge_action_${cause.reason}`
              : "edge_action_integration_failure",
          ).catch(() => {});
      }
      throw cause;
    } finally {
      if (activeAcquired) active -= 1;
    }
  };

  return Object.freeze({
    fetch,
    close: () => { open = false; },
    drain: async () => {
      const timeout = new Promise<never>((_resolve, reject) => {
        const id = setTimeout(
          () => reject(gatewayError("dispatchUncertain", "afterDispatch")),
          input.policy.cleanupDrainMilliseconds,
        );
        void Promise.allSettled(Array.from(pending)).finally(() => clearTimeout(id));
      });
      await Promise.race([Promise.allSettled(Array.from(pending)), timeout]);
      if (firstPoison !== NO_OUTBOUND_POISON) throw firstPoison;
    },
  });
}

async function captureRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  policy: EdgeActionHostPolicyFrameV1,
) {
  let request: Request;
  try {
    request = new Request(input, { ...init, redirect: "manual" });
  } catch (cause) {
    throw gatewayError("invalidRequest", "beforeDispatch", cause);
  }
  if (!policy.allowedOrigins.includes(new URL(request.url).origin)) {
    throw gatewayError("originDenied", "beforeDispatch");
  }
  if (
    UTF8.encode(request.url).byteLength > policy.maximumUrlBytes ||
    UTF8.encode(request.method).byteLength > policy.maximumMethodBytes
  ) throw gatewayError("resourceExceeded", "beforeDispatch");
  if (request.redirect !== "manual" || hasAmbientCredentialHeader(request.headers)) {
    throw gatewayError("invalidRequest", "beforeDispatch");
  }
  const body = await readBoundedBody(
    request.body,
    request.headers,
    policy.maximumOutboundRequestBodyBytes,
    "beforeDispatch",
  );
  const headers = canonicalHeaders(request.headers, policy, "beforeDispatch");
  const evidenceBytes = encodeHttpEvidence([
    "request",
    request.method.toUpperCase(),
    request.url,
    Object.entries(headers),
    encodeBytesToLowercaseHex(body),
  ]);
  return Object.freeze({
    request: new Request(request.url, {
      method: request.method,
      headers,
      ...(body.byteLength === 0 ? {} : { body: Uint8Array.from(body) }),
      redirect: "manual",
    }),
    evidenceBytes,
    requestBodyBytes: body.byteLength,
  });
}

async function captureResponse(
  response: Response,
  policy: EdgeActionHostPolicyFrameV1,
) {
  if (UTF8.encode(response.statusText).byteLength > policy.maximumStatusTextBytes) {
    throw gatewayError("resourceExceeded", "afterDispatch");
  }
  const body = await readBoundedBody(
    response.body,
    response.headers,
    policy.maximumOutboundResponseBodyBytes,
    "afterDispatch",
  );
  const headers = canonicalHeaders(response.headers, policy, "afterDispatch");
  const evidenceBytes = encodeHttpEvidence([
    "response",
    response.status,
    response.statusText,
    Object.entries(headers),
    encodeBytesToLowercaseHex(body),
  ]);
  return Object.freeze({
    response: new Response(Uint8Array.from(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    evidenceBytes,
    bodyBytes: body.byteLength,
  });
}

function canonicalHeaders(
  headers: Headers,
  policy: EdgeActionHostPolicyFrameV1,
  phase: EdgeActionOutboundGatewayV1Error["phase"],
): Readonly<Record<string, string>> {
  const entries = Array.from(headers.entries())
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
  );
  if (entries.length > policy.maximumHeaderCount) {
    throw gatewayError("resourceExceeded", phase);
  }
  let bytes = 0;
  const captured: Record<string, string> = {};
  for (const [name, value] of entries) {
    bytes += UTF8.encode(name).byteLength + UTF8.encode(value).byteLength;
    if (!Number.isSafeInteger(bytes) || bytes > policy.maximumHeaderBytes) {
      throw gatewayError("resourceExceeded", phase);
    }
    captured[name] = value;
  }
  return Object.freeze(captured);
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  maximumBytes: number,
  phase: EdgeActionOutboundGatewayV1Error["phase"],
): Promise<Uint8Array> {
  const declaredLength = headers.get("content-length");
  if (
    declaredLength !== null && /^\d+$/.test(declaredLength) &&
    BigInt(declaredLength) > BigInt(maximumBytes)
  ) throw gatewayError("resourceExceeded", phase);
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (!Number.isSafeInteger(total) || total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw gatewayError("resourceExceeded", phase);
      }
      chunks.push(next.value.slice());
    }
  } finally {
    reader.releaseLock();
  }
  const captured = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    captured.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return captured;
}

function hasAmbientCredentialHeader(headers: Headers): boolean {
  return headers.has("authorization") || headers.has("cookie") ||
    headers.has("proxy-authorization");
}

function encodeHttpEvidence(value: unknown): Uint8Array {
  const body = UTF8.encode(JSON.stringify(value));
  const domain = UTF8.encode("flarex.system/edge-action-http-evidence/v1\0");
  const bytes = new Uint8Array(domain.byteLength + body.byteLength);
  bytes.set(domain);
  bytes.set(body, domain.byteLength);
  return bytes;
}

async function markUncertain(
  evidence: EdgeActionOutboundEvidencePortV1,
  effectOrdinal: bigint,
): Promise<void> {
  await evidence.markUncertain(
    effectOrdinal,
    "edge_action_dispatch_uncertain",
  ).catch(() => {});
}

function gatewayError(
  reason: EdgeActionOutboundGatewayV1Error["reason"],
  phase: EdgeActionOutboundGatewayV1Error["phase"],
  cause?: unknown,
): EdgeActionOutboundGatewayV1Error {
  return new EdgeActionOutboundGatewayV1Error({
    reason,
    phase,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function makeActiveApplicationEdgeActionOutboundEvidencePortV1<
  HashError,
  CanonicalError,
>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  evidence: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
  runner: ActiveApplicationActionEffectRunnerV1,
): EdgeActionOutboundEvidencePortV1 {
  const port: EdgeActionOutboundEvidencePortV1 = {
    hash: bytes => runner.runPromise(evidence.authority.sha256.hash(bytes)),
    prepare: input => runner.runPromise(
      prepareActiveApplicationOutboundHttpEffectV1(
        subject,
        input,
        evidence,
      ),
    ),
    declareDispatch: effectOrdinal => runner.runPromise(
      declareActiveApplicationExternalEffectDispatchV1(
        subject,
        effectOrdinal,
        evidence.authority,
      ),
    ).then(() => {}),
    failBeforeDispatch: (effectOrdinal, terminalCode) => runner.runPromise(
      failActiveApplicationExternalEffectBeforeDispatchV1(
        subject,
        effectOrdinal,
        terminalCode,
        evidence.authority,
      ),
    ).then(() => {}),
    confirm: (effectOrdinal, responseBytes) => runner.runPromise(
      confirmActiveApplicationOutboundHttpEffectV1(
        subject,
        effectOrdinal,
        responseBytes,
        evidence,
      ),
    ).then(() => {}),
    markUncertain: (effectOrdinal, terminalCode) => runner.runPromise(
      markActiveApplicationExternalEffectUncertainV1(
        subject,
        effectOrdinal,
        terminalCode,
        evidence.authority,
      ),
    ).then(() => {}),
  };
  return Object.freeze(port);
}
