import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  probeSpanId,
} from "../src/identity";
import { decodeProbeSampleResultV1Effect } from "../src/protocol";
import { validateProbeTraceV1 } from "../src/trace";
import { validSample } from "./fixtures";

describe("runtime topology probe trace validation", () => {
  it.each([
    "edge_echo",
    "session_echo",
    "dynamic_direct_echo",
    "facet_echo",
    "facet_journal",
    "commit_wake",
    "full_invoke",
    "executor_worker_invoke",
    "facet_executor_invoke",
    "facet_finalizer_invoke",
    "facet_finalizer_warm_invoke",
    "facet_finalizer_postgres_warm_invoke",
    "session_postgres_warm_invoke",
    "session_executor_invoke",
    "sync_rerun",
  ] as const)("accepts the exact %s topology", scenario => {
    expect(validateProbeTraceV1(validSample(scenario))).toEqual({ ok: true });
  });

  it("separates Postgres commit and outcome-recovery latency spans", () => {
    const committed = validSample("facet_finalizer_postgres_warm_invoke");
    const recovered = {
      ...committed,
      spans: committed.spans.map(span =>
        span.name === "commit_transaction_io"
          ? { ...span, name: "outcome_resolution_io" as const }
          : span
      ),
    };

    expect(validateProbeTraceV1(committed)).toEqual({ ok: true });
    expect(validateProbeTraceV1(recovered)).toEqual({ ok: true });
    expect(committed.spans.some(span => span.name === "outcome_resolution_io"))
      .toBe(false);
    expect(recovered.spans.some(span => span.name === "commit_transaction_io"))
      .toBe(false);

    const sessionCommitted = validSample("session_postgres_warm_invoke");
    const sessionRecovered = {
      ...sessionCommitted,
      spans: sessionCommitted.spans.map(span =>
        span.name === "commit_transaction_io"
          ? { ...span, name: "outcome_resolution_io" as const }
          : span
      ),
    };
    expect(validateProbeTraceV1(sessionRecovered)).toEqual({ ok: true });
  });

  it("places the direct Postgres transaction under the SessionDO commit span", () => {
    const sample = validSample("session_postgres_warm_invoke");
    const transaction = sample.spans.find(
      span => span.name === "commit_transaction_io",
    );
    const sessionCommit = sample.spans.find(
      span => span.name === "session_postgres_commit_rtt",
    );

    expect(transaction?.parentSpanId).toBe(sessionCommit?.spanId);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
  });

  it("rejects missing spans", () => {
    const sample = validSample("facet_echo");
    expect(
      validateProbeTraceV1({ ...sample, spans: sample.spans.slice(0, -1) }),
    ).toEqual({
      ok: false,
      issue: "missing_or_extra_span",
      spanName: null,
    });
  });

  it("rejects duplicate IDs, missing parents, cycles, and wrong parents", () => {
    const sample = validSample("full_invoke");
    const spans = [...sample.spans];
    const root = spans[0];
    const session = spans[1];
    const facet = spans[2];
    if (root === undefined || session === undefined || facet === undefined) {
      throw new Error("Test fixture is missing expected spans.");
    }

    const duplicateId = [
      root,
      { ...session, spanId: root.spanId },
      ...spans.slice(2),
    ];
    expect(validateProbeTraceV1({ ...sample, spans: duplicateId }).ok).toBe(
      false,
    );

    const missingParent = spans.map(span =>
      span.name === "session_facet_rtt"
        ? {
            ...span,
            parentSpanId: probeSpanId(
              Effect.runSync(decodeProbeOrdinalEffect(999_999)),
            ),
          }
        : span
    );
    expect(validateProbeTraceV1({ ...sample, spans: missingParent }).ok).toBe(
      false,
    );

    const cycle = spans.map(span => {
      if (span.name === "gateway_session_rtt") {
        return { ...span, parentSpanId: facet.spanId };
      }
      if (span.name === "session_facet_rtt") {
        return { ...span, parentSpanId: session.spanId };
      }
      return span;
    });
    expect(validateProbeTraceV1({ ...sample, spans: cycle })).toMatchObject({
      ok: false,
      issue: "cycle",
    });

    const wrongParent = spans.map(span =>
      span.name === "facet_journal_io"
        ? { ...span, parentSpanId: root.spanId }
        : span
    );
    expect(validateProbeTraceV1({ ...sample, spans: wrongParent })).toMatchObject(
      { ok: false, issue: "wrong_parent" },
    );
  });

  it("requires sample and span outcomes to agree", () => {
    const sample = validSample("edge_echo");
    const root = sample.spans[0];
    if (root === undefined) throw new Error("Missing root span.");
    const error = {
      code: "runtime_failure",
      retryable: false,
      stage: "external_request",
    } as const;
    const decoded = Effect.runSync(
      decodeProbeSampleResultV1Effect({
        ...sample,
        outcome: { kind: "ok" },
        spans: [{ ...root, outcome: { kind: "error", error } }],
      }),
    );
    expect(validateProbeTraceV1(decoded)).toEqual({
      ok: false,
      issue: "outcome_mismatch",
      spanName: null,
    });
  });
});
