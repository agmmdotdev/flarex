import { fileURLToPath } from "node:url"

import {
  defineNodeVitestConfig,
  NODE_TEST_DISCOVERY_GLOBS,
} from "../../../scripts/test-runner/define-node-vitest-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const sourceTestDiscoveryGlobs = NODE_TEST_DISCOVERY_GLOBS.map(
  (glob) => `src/${glob}`
)

export default defineNodeVitestConfig({
  aliases: [],
  include: sourceTestDiscoveryGlobs,
  root: packageRoot,
})
