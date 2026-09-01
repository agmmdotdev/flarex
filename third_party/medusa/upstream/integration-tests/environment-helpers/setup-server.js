const path = require("path")
const { spawn } = require("child_process")
const {
  resolveTestWorkerIdentity,
} = require("@medusajs/test-utils/dist/test-worker-identity")
const { setPort, useExpressServer } = require("./use-api")
const { setContainer } = require("./use-container")

module.exports = async ({ cwd, redisUrl, uploadDir, verbose, env }) => {
  const serverPath = path.join(__dirname, "test-server.js")

  // Preserve the existing zero-based Redis database allocation for each
  // one-based test-runner worker identity.
  const redisUrlWithDatabase = redisUrl
    ? `${redisUrl}/${resolveTestWorkerIdentity().redisDatabase}`
    : undefined

  verbose = verbose ?? false

  return await new Promise((resolve, reject) => {
    const medusaProcess = spawn("node", [path.resolve(serverPath)], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "development",
        JWT_SECRET: "test",
        COOKIE_SECRET: "test",
        REDIS_URL: redisUrlWithDatabase, // If provided, will use a real instance, otherwise a fake instance
        UPLOAD_DIR: uploadDir, // If provided, will be used for the fake local file service
        ...env,
      },
      stdio: verbose
        ? ["inherit", "inherit", "inherit", "ipc"]
        : ["ignore", "ignore", "ignore", "ipc"],
    })

    medusaProcess.on("error", (err) => {
      console.log(err)
      reject(err)
      process.exit()
    })

    medusaProcess.on("uncaughtException", (err) => {
      console.log(err)
      reject(err)
      medusaProcess.kill()
    })

    medusaProcess.on("message", (port) => {
      setPort(port)
      resolve(medusaProcess)
    })

    medusaProcess.on("exit", () => {
      const expressServer = useExpressServer()

      setContainer(null)

      if (expressServer) {
        expressServer.close()
      }
    })
  })
}
