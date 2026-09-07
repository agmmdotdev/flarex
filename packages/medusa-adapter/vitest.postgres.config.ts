import { mergeConfig } from "vitest/config";
import common from "./vitest.config";

export default mergeConfig(common, {
  test: { env: { MEDUSA_COMPARISON_DRIVER: "postgres" } },
});
