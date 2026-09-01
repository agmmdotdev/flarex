const path = require("path")
const {
  resolveTestWorkerIdentity,
} = require("@medusajs/test-utils/dist/test-worker-identity")

require("dotenv").config({ path: path.join(__dirname, ".env.test") })

if (typeof process.env.DB_TEMP_NAME === "undefined") {
  const { databaseSuffix } = resolveTestWorkerIdentity()
  const chunkNumber = parseInt(process.env.CHUNK || "1")
  process.env.DB_TEMP_NAME = `medusa-integration-${databaseSuffix}-${chunkNumber}`
}

global.performance = require("perf_hooks").performance
