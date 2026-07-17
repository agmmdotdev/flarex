import {
  sameProbeNormalizedErrorV1,
  type ProbeSampleResultV1,
  type ProbeScenario,
  type ProbeSpanName,
  type ProbeTraceSpanV1,
} from "./protocol";

type ExpectedSpan = readonly [
  name: ProbeSpanName,
  parentName: ProbeSpanName | null,
];

export const PROBE_SCENARIO_TOPOLOGY = {
  edge_echo: [["external_request", null]],
  session_echo: [
    ["external_request", null],
    ["gateway_session_rtt", "external_request"],
  ],
  dynamic_direct_echo: [
    ["external_request", null],
    ["gateway_dynamic_rtt", "external_request"],
  ],
  facet_echo: [
    ["external_request", null],
    ["gateway_session_rtt", "external_request"],
    ["session_facet_rtt", "gateway_session_rtt"],
  ],
  facet_journal: [
    ["external_request", null],
    ["gateway_session_rtt", "external_request"],
    ["session_facet_rtt", "gateway_session_rtt"],
    ["facet_journal_io", "session_facet_rtt"],
  ],
  commit_wake: [
    ["external_request", null],
    ["mock_sync_wake_rtt", "external_request"],
    ["sync_cursor_io", "mock_sync_wake_rtt"],
  ],
  full_invoke: [
    ["external_request", null],
    ["gateway_session_rtt", "external_request"],
    ["session_facet_rtt", "gateway_session_rtt"],
    ["facet_mock_read_rtt", "session_facet_rtt"],
    ["facet_journal_io", "session_facet_rtt"],
    ["session_mock_finish_rtt", "gateway_session_rtt"],
    ["mock_sync_wake_rtt", "session_mock_finish_rtt"],
    ["sync_cursor_io", "mock_sync_wake_rtt"],
  ],
  sync_rerun: [
    ["external_request", null],
    ["sync_runtime_rerun_rtt", "external_request"],
    ["gateway_session_rtt", "sync_runtime_rerun_rtt"],
    ["session_facet_rtt", "gateway_session_rtt"],
  ],
} as const satisfies Readonly<
  Record<ProbeScenario, readonly ExpectedSpan[]>
>;

export type ProbeTraceIssue =
  | "duplicate_span_id"
  | "duplicate_span_name"
  | "missing_or_extra_span"
  | "missing_parent"
  | "wrong_root"
  | "cycle"
  | "wrong_parent"
  | "outcome_mismatch";

export type ProbeTraceValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly issue: ProbeTraceIssue;
      readonly spanName: ProbeSpanName | null;
    };

export function validateProbeTraceV1(
  sample: ProbeSampleResultV1,
): ProbeTraceValidation {
  const expected = PROBE_SCENARIO_TOPOLOGY[sample.scenario];
  const spansById = new Map<string, ProbeTraceSpanV1>();
  const spansByName = new Map<ProbeSpanName, ProbeTraceSpanV1>();

  for (const span of sample.spans) {
    if (spansById.has(span.spanId)) {
      return invalid("duplicate_span_id", span.name);
    }
    if (spansByName.has(span.name)) {
      return invalid("duplicate_span_name", span.name);
    }
    spansById.set(span.spanId, span);
    spansByName.set(span.name, span);
  }

  if (sample.spans.length !== expected.length) {
    return invalid("missing_or_extra_span", null);
  }
  for (const [expectedName] of expected) {
    if (!spansByName.has(expectedName)) {
      return invalid("missing_or_extra_span", expectedName);
    }
  }

  const roots = sample.spans.filter(span => span.parentSpanId === null);
  if (roots.length !== 1 || roots[0]?.name !== "external_request") {
    return invalid("wrong_root", roots[0]?.name ?? null);
  }

  for (const span of sample.spans) {
    if (
      span.parentSpanId !== null &&
      !spansById.has(span.parentSpanId)
    ) {
      return invalid("missing_parent", span.name);
    }
    if (hasParentCycle(span, spansById)) {
      return invalid("cycle", span.name);
    }
  }

  for (const [name, expectedParentName] of expected) {
    const span = spansByName.get(name);
    if (span === undefined) {
      return invalid("missing_or_extra_span", name);
    }
    const actualParentName =
      span.parentSpanId === null
        ? null
        : spansById.get(span.parentSpanId)?.name;
    if (actualParentName !== expectedParentName) {
      return invalid("wrong_parent", name);
    }
  }

  const spanErrors = sample.spans.flatMap(span =>
    span.outcome.kind === "error" ? [span.outcome.error] : []
  );
  if (sample.outcome.kind === "ok") {
    return spanErrors.length === 0
      ? { ok: true }
      : invalid("outcome_mismatch", null);
  }
  const sampleError = sample.outcome.error;
  return spanErrors.some(error =>
    sameProbeNormalizedErrorV1(error, sampleError)
  )
    ? { ok: true }
    : invalid("outcome_mismatch", null);
}

function hasParentCycle(
  start: ProbeTraceSpanV1,
  spansById: ReadonlyMap<string, ProbeTraceSpanV1>,
): boolean {
  const visited = new Set<string>();
  let current: ProbeTraceSpanV1 | undefined = start;
  while (current !== undefined) {
    if (visited.has(current.spanId)) return true;
    visited.add(current.spanId);
    current =
      current.parentSpanId === null
        ? undefined
        : spansById.get(current.parentSpanId);
  }
  return false;
}

function invalid(
  issue: ProbeTraceIssue,
  spanName: ProbeSpanName | null,
): ProbeTraceValidation {
  return { ok: false, issue, spanName };
}
