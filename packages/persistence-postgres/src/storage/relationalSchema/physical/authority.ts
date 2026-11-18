import type { RelationalPhysicalLayout } from "./model";

const capturedRelationalPhysicalLayouts = new WeakSet<
  RelationalPhysicalLayout
>();

export function registerCapturedRelationalPhysicalLayout(
  layout: RelationalPhysicalLayout,
): void {
  capturedRelationalPhysicalLayouts.add(layout);
}

export function hasCapturedRelationalPhysicalLayout(
  layout: RelationalPhysicalLayout,
): boolean {
  return capturedRelationalPhysicalLayouts.has(layout);
}
