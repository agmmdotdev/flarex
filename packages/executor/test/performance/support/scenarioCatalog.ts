/** One inventory for the Node command and executor runner. This module has no
 * framework imports, runtime authority or database side effects. */
export const corePerformanceScenarios = [
  { name: "payload-create", family: "payload-scalar", daily: true, flow: "Payload scalar create" },
  { name: "medusa-workflow", family: "medusa-workflow", daily: true, flow: "Variant/Pricing/Link/Tag launch on a seeded Product" },
  { name: "mixed-product", family: "mixed-product", daily: true, flow: "Application insert/patch + Product update/retrieve/indexed lookup" },
  { name: "mixed-payload", family: "mixed-payload", daily: true, flow: "Application + Product + Payload create/hook/read/update" },
  { name: "mixed-workflow", family: "mixed-workflow", daily: true, flow: "Application + Product launch + Payload lifecycle" },
  { name: "product-create", family: "product", daily: false, flow: "Native scalar Product create" },
  { name: "product-create-graph", family: "product", daily: false, flow: "Native Product create with owned options/values/variants/images" },
  { name: "product-update", family: "product", daily: false, flow: "Native Product scalar update" },
  { name: "product-replace-images", family: "product", daily: false, flow: "Native image graph replacement: retain, remove and create" },
  { name: "product-delete", family: "product", daily: false, flow: "Native hard delete of an owned Product graph" },
  { name: "product-soft-delete", family: "product", daily: false, flow: "Native soft delete of an owned Product graph" },
  { name: "product-restore", family: "product", daily: false, flow: "Native restoration of a soft-deleted owned Product graph" },
  { name: "payload-update", family: "payload-scalar", daily: false, flow: "Payload scalar update" },
  { name: "payload-delete", family: "payload-scalar", daily: false, flow: "Payload scalar delete" },
  { name: "payload-find-by-id", family: "payload-scalar", daily: false, flow: "Payload scalar findByID" },
  { name: "payload-find", family: "payload-scalar", daily: false, flow: "Payload indexed equality find with bounded page" },
  { name: "payload-count", family: "payload-scalar", daily: false, flow: "Payload indexed equality count" },
  { name: "payload-replay", family: "payload-scalar", daily: false, flow: "Replay a genuinely committed Payload create request" },
  { name: "payload-populate-one", family: "payload-one", daily: false, flow: "Payload depth-one optional relationship population" },
  { name: "payload-populate-many", family: "payload-many", daily: false, flow: "Payload ordered many relationship population" },
  { name: "payload-replace-many", family: "payload-many", daily: false, flow: "Payload ordered many relationship replacement" },
  { name: "payload-reverse-join", family: "payload-joins", daily: false, flow: "Payload bounded reverse join with depth-one source population" },
  { name: "application-only", family: "application-only", daily: false, flow: "Application insert/read/patch/read with complete finite settlement" },
  { name: "mixed-application-payload", family: "mixed-application-payload", daily: false, flow: "Application insert/patch + Payload create/hook/read/update" },
  { name: "mixed-repeated-product", family: "mixed-repeated-product", daily: false, flow: "Repeated Product update/read on the same pending record + Application publication" },
] as const;

export type CorePerformanceScenarioName = typeof corePerformanceScenarios[number]["name"];
export type CorePerformanceFamily = typeof corePerformanceScenarios[number]["family"];
export type CorePerformanceSize = "small" | "typical";

export function selectedCorePerformanceScenarios(selection: string) {
  return corePerformanceScenarios.filter(scenario => selection === "all" ||
    (selection === "daily" ? scenario.daily : selection === "product" ? scenario.name.startsWith("product-")
      : selection === "payload" ? scenario.name.startsWith("payload-")
        : selection === "mixed" ? scenario.name.startsWith("mixed-") || scenario.name === "application-only"
          : scenario.name === selection));
}
