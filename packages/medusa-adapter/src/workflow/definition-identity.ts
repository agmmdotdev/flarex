import { Effect } from "effect";
import { isPreparedWorkflow, type PreparedWorkflow } from "@medusajs/workflows-sdk";
import { capturePrivateCanonicalValue, commerceError, commerceLimits, isJsonObject, type Json, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowPolicy } from "./configuration";

/** An opt-in encoding of the complete issued graph. Each frame retains the
 * existing policy capture ceiling; child hashes preserve the ordered tree.
 * Trusted bundle revision remains separate and still identifies callback code. */
export const captureWorkflowDefinitionDigest = Effect.fn("Workflow.captureDefinitionDigest")(function* (definition: unknown) {
  if (!isPreparedWorkflow(definition)) return yield* commerceError("invalidAuthority");
  const maximum = definition.identity.constructionProfile?.maximumNodes ?? 64;
  const pending = [{ definition, depth: 0 }];
  let nodes = 0, frames = 0;
  while (pending.length !== 0) {
    const current = pending.pop();
    if (current === undefined || !isPreparedWorkflow(current.definition)) return yield* commerceError("invalidAuthority");
    if (current.depth > 64 || ++frames > maximum + 1) return yield* commerceError("limitExceeded");
    nodes += current.definition.nodes.length;
    if (nodes > maximum || current.definition.identity.nodes.length !== current.definition.nodes.length)
      return yield* commerceError("limitExceeded");
    for (const node of current.definition.nodes) {
      if (node.kind === "workflow") pending.push({ definition: node.workflow, depth: current.depth + 1 });
      else for (const child of node.invokedWorkflows ?? []) pending.push({ definition: child.workflow, depth: current.depth + 1 });
    }
  }
  if (nodes !== definition.nodeCount) return yield* commerceError("invalidAuthority");
  const memo = new Map<PreparedWorkflow, string>();
  const digest = Effect.fn("Workflow.captureDefinitionFrame")(function* (current: PreparedWorkflow): Effect.fn.Return<string, CommerceTransactionError> {
    const retained = memo.get(current);
    if (retained !== undefined) return retained;
    const encoded: Json[] = [];
    for (const [index, node] of current.nodes.entries()) {
      const identity = current.identity.nodes[index];
      if (identity === undefined || !isJsonObject(identity) || identity.kind !== node.kind || identity.name !== node.name)
        return yield* commerceError("invalidAuthority");
      if (node.kind === "workflow") {
        if (identity.workflow !== node.workflow.identity) return yield* commerceError("invalidAuthority");
        encoded.push({ ...identity, workflow: { format: "flarex.medusa-workflow-frame-reference", version: 1,
          sha256: yield* digest(node.workflow) } });
      } else if (node.invokedWorkflows !== undefined) {
        if (!Array.isArray(identity.invokedWorkflows) || identity.invokedWorkflows.length !== node.invokedWorkflows.length)
          return yield* commerceError("invalidAuthority");
        const children: Json[] = [];
        for (const [position, child] of node.invokedWorkflows.entries()) {
          if (identity.invokedWorkflows[position] !== child.workflow.identity) return yield* commerceError("invalidAuthority");
          children.push({ format: "flarex.medusa-workflow-frame-reference", version: 1, sha256: yield* digest(child.workflow) });
        }
        encoded.push({ ...identity, invokedWorkflows: children });
      } else encoded.push(identity);
    }
    const envelope = yield* Effect.fromResult(captureWorkflowPolicy({ format: "flarex.medusa-workflow-definition-frame", version: 1,
      frame: { ...current.identity, nodes: encoded } }));
    if (!isJsonObject(envelope)) return yield* commerceError("invalidAuthority");
    const captured = yield* capturePrivateCanonicalValue(envelope,
      commerceLimits.rowBytes, { invalidInput: () => commerceError("limitExceeded"), hashFailure: cause => commerceError("resourceFailure", cause) });
    memo.set(current, captured.sha256Hex);
    return captured.sha256Hex;
  });
  return yield* digest(definition);
});
