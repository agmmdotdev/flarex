import { vi } from "vitest"

import { installLegacyJestBridge } from "./vitest-jest-compatibility"

installLegacyJestBridge(vi)
