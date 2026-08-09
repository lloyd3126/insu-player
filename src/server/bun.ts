import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { homedir } from "node:os"
import { createServer } from "node:net"
import path from "node:path"
import { parseArgs } from "node:util"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { atomicWriteJson } from "@server/lib/files"
import { JobRepository } from "@server/repositories/job-repository"
import { RemovalService } from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"

function processIsAlive(pid: unknown) {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function readActiveEndpoint(candidate: string) {
  try {
    if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) return null
    const payload = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>
    if (
      !["127.0.0.1", "localhost", "::1"].includes(String(payload.host)) ||
      !Number.isInteger(payload.port) ||
      Number(payload.port) < 1 ||
      Number(payload.port) > 65535 ||
      !processIsAlive(payload.pid)
    ) {
      return null
    }
    return payload as { host: string; port: number; pid: number }
  } catch {
    return null
  }
}

function localUrl(host: string, port: number) {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}/`
}

function portIsAvailable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once("error", () => resolve(false))
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolve(true))
    })
  })
}

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8000" },
    "auto-port": { type: "boolean", default: false },
    "pid-file": { type: "string" },
    "library-template": { type: "string" },
    "player-template": { type: "string" },
    migrations: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
})

if (!values.workspace) throw new Error("--workspace is required")
if (!values["library-template"]) throw new Error("--library-template is required")
if (!values["player-template"]) throw new Error("--player-template is required")
if (!values.migrations) throw new Error("--migrations is required")

const workspace = path.resolve(values.workspace)
if (workspace === path.parse(workspace).root || workspace === path.resolve(homedir())) {
  throw new Error("choose a dedicated workspace, not the filesystem root or home directory")
}
mkdirSync(path.join(workspace, "jobs"), { recursive: true })

const preferredPort = Number(values.port)
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  throw new Error("port must be between 1 and 65535")
}

const serverDescriptor = path.join(workspace, ".insu-player-server.json")
const sessionDescriptor = path.join(workspace, ".insu-environment-session.json")
const active = readActiveEndpoint(serverDescriptor)
if (active) {
  console.log(`Local video library: ${localUrl(active.host, active.port)}`)
  console.log(`Workspace: ${workspace}`)
  console.log(`Already running with pid ${active.pid}.`)
  process.exit(0)
}

const pidFile = values["pid-file"] ? path.resolve(values["pid-file"]) : null
if (pidFile && pidFile !== workspace && !pidFile.startsWith(`${workspace}${path.sep}`)) {
  throw new Error("pid file must stay inside the workspace")
}

const { db, sqlite } = openAppDatabase(path.join(workspace, "app.db"), path.resolve(values.migrations))
const jobs = new JobRepository(workspace, db)
const resources = new ResourceService(workspace)
const removalScript = path.resolve(
  values["library-template"],
  "../../../..",
  "video-library",
  "scripts",
  "remove_library_item.py",
)
const app = createApplication({
  jobs,
  removals: new RemovalService(workspace, removalScript),
  resources,
  libraryAppRoot: path.resolve(values["library-template"]),
  playerRoot: path.resolve(values["player-template"]),
})

const startServer = (port: number) =>
  Bun.serve({
    hostname: values.host,
    port,
    fetch: app.fetch,
    maxRequestBodySize: 4096,
    development: false,
  })

let server: ReturnType<typeof Bun.serve>
const selectedPort =
  values["auto-port"] && !(await portIsAvailable(values.host, preferredPort))
    ? 0
    : preferredPort
try {
  server = startServer(selectedPort)
} catch (error) {
  if (!values["auto-port"]) throw error
  server = startServer(0)
}

const actualPort = server.port
if (!Number.isInteger(actualPort) || actualPort === undefined) {
  cleanupFailedStartup()
  throw new Error("Bun did not report the selected port")
}
atomicWriteJson(serverDescriptor, {
  host: values.host,
  port: actualPort,
  pid: process.pid,
  runtime: "hono-bun",
})
atomicWriteJson(sessionDescriptor, {
  host: values.host,
  port: actualPort,
  pid: process.pid,
  token: resources.sessionToken,
})
if (pidFile) atomicWriteJson(pidFile, process.pid)

let stopping = false
const cleanup = () => {
  if (stopping) return
  stopping = true
  try {
    server.stop(true)
    sqlite.close()
  } finally {
    for (const candidate of [serverDescriptor, sessionDescriptor, pidFile]) {
      if (!candidate || !existsSync(candidate)) continue
      try {
        const payload = JSON.parse(readFileSync(candidate, "utf8"))
        if (payload === process.pid || payload?.pid === process.pid) {
          rmSync(candidate, { force: true })
        }
      } catch {
        // Never remove descriptors not owned by this process.
      }
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup()
    process.exit(0)
  })
}
process.on("exit", cleanup)

if (actualPort !== preferredPort) {
  console.log(`Preferred port ${preferredPort} is occupied; selected free port ${actualPort}.`)
}
console.log(`Local video library: ${localUrl(values.host, actualPort)}`)
console.log(`Server descriptor: ${serverDescriptor}`)
console.log(`Workspace: ${workspace}`)
console.log("Press Ctrl+C to stop.")

function cleanupFailedStartup() {
  server.stop(true)
  sqlite.close()
}
