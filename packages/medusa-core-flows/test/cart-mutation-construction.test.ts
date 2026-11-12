import { Result } from "effect";
import { expect, it } from "vitest";
import { createWorkflow, nativeCartMutationProfile, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartWorkflow } from "../src/cart/workflows/update-cart";
import { addToCartWorkflow } from "../src/cart/workflows/add-to-cart";
import { updateLineItemInCartWorkflow } from "../src/cart/workflows/update-line-item-in-cart";
import { deleteLineItemsWorkflow } from "../src/line-item/workflows/delete-line-items";
import { refreshCartItemsWorkflow } from "../src/cart/workflows/refresh-cart-items";
import { updateCartPromotionsWorkflow } from "../src/cart/workflows/update-cart-promotions";

const wrappers = {
  updateCart: createWorkflow({ name: "native-cart-update-operation-count", constructionProfile: nativeCartMutationProfile },
    (input: WorkflowData<NonNullable<typeof updateCartWorkflow[" input"]>>) => {
      updateCartWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
    }),
  addLineItem: createWorkflow({ name: "native-cart-add-operation-count", constructionProfile: nativeCartMutationProfile },
    (input: WorkflowData<NonNullable<typeof addToCartWorkflow[" input"]>>) => {
      addToCartWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
    }),
  updateLineItem: createWorkflow({ name: "native-cart-item-update-operation-count", constructionProfile: nativeCartMutationProfile },
    (input: WorkflowData<NonNullable<typeof updateLineItemInCartWorkflow[" input"]>>) => {
      updateLineItemInCartWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
    }),
  deleteLineItems: createWorkflow({ name: "native-cart-delete-operation-count", constructionProfile: nativeCartMutationProfile },
    (input: WorkflowData<NonNullable<typeof deleteLineItemsWorkflow[" input"]>>) => {
      deleteLineItemsWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
    }),
};

/** Read the genuine prepared resolution DAG. Each frame owns its transform
 * cache, so repeated children count again; inactive branches remain included.
 * This observes declarations without invoking callbacks or modeling commerce. */
function countControlOperations(prepared: PreparedWorkflow) {
  const count = { nodes: 0, conditions: 0, branchResults: 0, transforms: 0, callbackChildren: 0, operations: 2 };
  const visit = (frame: PreparedWorkflow) => {
    type Resolution = PreparedWorkflow["resolution"]["result"];
    const seen = new Set<Resolution>(), transforms = new Set<object>();
    const walk = (resolution: Resolution | undefined): void => {
      if (resolution === undefined || seen.has(resolution)) return;
      seen.add(resolution);
      if (resolution.kind === "reference") {
        if (resolution.reference.kind === "transform") transforms.add(resolution.reference);
        walk(resolution.input);
      } else if (resolution.kind === "array" || resolution.kind === "record") for (const member of resolution.members) walk(member);
    };
    for (const input of frame.resolution.inputs) walk(input);
    walk(frame.resolution.result);
    count.transforms += transforms.size; count.operations += 2 * transforms.size;
    for (const node of frame.nodes) {
      count.nodes++;
      if (node.kind === "condition") { count.conditions++; count.operations++; }
      else if (node.kind === "branchResult") count.branchResults++;
      else count.operations += 2;
      if (node.kind === "workflow") visit(node.workflow);
      else for (const child of node.invokedWorkflows ?? []) { count.callbackChildren++; count.operations += 2; visit(child.workflow); }
    }
  };
  // Runtime input/output capture costs at most two operations per ordinary
  // node, one per condition, none per branch result, and two per transform.
  // The two root operations are its final checkpoint and completion capture.
  visit(prepared); return count;
}

it("counts the genuine complete native mutation closures including inactive children and the trusted wrapper", () => {
  for (const [workflow, count] of [[updateCartWorkflow, 130], [addToCartWorkflow, 132],
    [updateLineItemInCartWorkflow, 242], [deleteLineItemsWorkflow, 113], [refreshCartItemsWorkflow, 108]] as const) {
    const prepared = Result.getOrThrow(workflow.prepare());
    expect(prepared.nodeCount, workflow.name).toBe(count);
    expect(prepared.identity.idempotent).toBe(false);
    expect(prepared.identity.constructionProfile).toEqual({ profile: "nativeCartMutation", maximumNodes: 243 });
  }
  const wrapper = createWorkflow({ name: "native-item-mutation-construction-wrapper", constructionProfile: nativeCartMutationProfile },
    (input: WorkflowData<NonNullable<typeof updateLineItemInCartWorkflow[" input"]>>) => {
      updateLineItemInCartWorkflow.runAsStep({ input });
      return new WorkflowResponse(null);
    });
  expect(Result.getOrThrow(wrapper.prepare()).nodeCount).toBe(243);
});

it("bounds the shared mutation operation allowance from every native node and frame-local transform", () => {
  const expected = {
    updateCart: { nodes: 131, conditions: 17, branchResults: 17, transforms: 42, callbackChildren: 0, operations: 297 },
    addLineItem: { nodes: 133, conditions: 16, branchResults: 16, transforms: 48, callbackChildren: 0, operations: 316 },
    updateLineItem: { nodes: 243, conditions: 31, branchResults: 31, transforms: 79, callbackChildren: 0, operations: 553 },
    deleteLineItems: { nodes: 114, conditions: 14, branchResults: 14, transforms: 36, callbackChildren: 0, operations: 260 },
  };
  const counts = [];
  for (const name of ["updateCart", "addLineItem", "updateLineItem", "deleteLineItems"] as const) {
    const prepared = Result.getOrThrow(wrappers[name].prepare()), count = countControlOperations(prepared);
    expect(count, name).toEqual(expected[name]);
    expect(count.nodes).toBe(prepared.nodeCount);
    counts.push(count.operations);
  }
  expect(512 + Math.max(...counts)).toBe(1065);
});

it("fits the dedicated native promotion wrapper within ordinary authoring and the existing root allowance", () => {
  const root = createWorkflow("native-cart-promotions-ordinary-wrapper", (input: WorkflowData<NonNullable<typeof updateCartPromotionsWorkflow[" input"]>>) => {
    updateCartPromotionsWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
  });
  const prepared = Result.getOrThrow(root.prepare()), count = countControlOperations(prepared);
  expect(count).toEqual({ nodes: 32, conditions: 4, branchResults: 4, transforms: 8, callbackChildren: 0, operations: 70 });
  expect(prepared.nodeCount).toBe(32);
  expect(prepared.nodeCount).toBeLessThanOrEqual(64);
  expect(prepared.identity.constructionProfile).toBeUndefined();
  expect(new TextEncoder().encode(JSON.stringify(prepared.identity)).byteLength).toBeLessThan(64 * 1024);
});
