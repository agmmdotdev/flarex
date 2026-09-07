import { mergeConfig } from "vitest/config";
import live from "./vitest.live.config";

export default mergeConfig(live, {
  test: { env: { MEDUSA_COMPARISON_DRIVER: "postgres" } },
});
