import { existsSync, lstatSync, realpathSync, statSync } from "node:fs"
import path from "node:path"

import type {
  RemovalExecutionResponse,
  RemovalIssue,
  RemovalPreviewResponse,
  RemovalTarget,
} from "@shared/contracts/removal"

interface ScriptPayload {
  digest?: unknown
  blocked?: unknown
  warnings?: unknown
  error?: unknown
  removed?: unknown
}

export interface RemovalOperations {
  preview(target: RemovalTarget): Promise<RemovalPreviewResponse>
  execute(
    target: RemovalTarget,
    planDigest: string,
  ): Promise<RemovalExecutionResponse>
}

export class RemovalOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 404 | 409 | 500,
  ) {
    super(message)
  }
}

function isRegularFile(candidate: string) {
  try {
    if (!existsSync(candidate)) return false
    const metadata = lstatSync(candidate)
    return !metadata.isSymbolicLink() && metadata.isFile()
  } catch {
    return false
  }
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
}

function isWorkspaceExecutable(runtimeRoot: string, candidate: string) {
  try {
    if (!existsSync(candidate)) return false
    const resolvedRoot = realpathSync(runtimeRoot)
    const resolved = realpathSync(candidate)
    const metadata = statSync(resolved)
    return (
      isContained(resolvedRoot, resolved) &&
      metadata.isFile() &&
      (metadata.mode & 0o111) !== 0
    )
  } catch {
    return false
  }
}

function issues(value: unknown): RemovalIssue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
      return []
    }
    return [{ code: candidate.code, message: candidate.message }]
  })
}

function targetArguments(target: RemovalTarget) {
  switch (target.kind) {
    case "video":
      return ["--kind", "video", "--video-id", target.videoId]
    case "subtitle-artifact":
      return [
        "--kind",
        "subtitle-artifact",
        "--video-id",
        target.videoId,
        "--artifact-id",
        target.artifactId,
      ]
    case "media-rendition":
      return [
        "--kind",
        "media-rendition",
        "--video-id",
        target.videoId,
        "--rendition-id",
        target.renditionId,
      ]
  }
}

function errorDetails(message: string) {
  if (message.includes("not found")) {
    return { code: "resource-not-found", status: 404 as const }
  }
  if (message.includes("stale")) {
    return { code: "stale-plan", status: 409 as const }
  }
  if (
    message.includes("blocked") ||
    message.includes("symbolic") ||
    message.includes("unsafe")
  ) {
    return { code: "removal-blocked", status: 409 as const }
  }
  return { code: "removal-failed", status: 500 as const }
}

async function outputText(
  output: number | ReadableStream<Uint8Array> | undefined,
) {
  if (typeof output === "number" || output === undefined) return ""
  return new Response(output).text()
}

export class RemovalService implements RemovalOperations {
  private readonly workspace: string

  constructor(
    workspace: string,
    private readonly scriptPath: string,
  ) {
    this.workspace = path.resolve(workspace)
  }

  private pythonExecutable() {
    const runtimeRoot = path.join(
      this.workspace,
      ".agent-tools",
      "insu-player",
    )
    const virtualEnvironment = path.join(runtimeRoot, ".venv")
    const executable = [
      path.join(virtualEnvironment, "bin", "python"),
      path.join(virtualEnvironment, "Scripts", "python.exe"),
    ].find((candidate) => isWorkspaceExecutable(runtimeRoot, candidate))
    if (!executable) {
      throw new RemovalOperationError(
        "workspace-local Python removal runtime is unavailable",
        "runtime-unavailable",
        500,
      )
    }
    return executable
  }

  private async run(command: "preview" | "execute" | "verify", args: string[]) {
    if (!isRegularFile(this.scriptPath)) {
      throw new RemovalOperationError(
        "removal script is unavailable",
        "runtime-unavailable",
        500,
      )
    }
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(
        [
          this.pythonExecutable(),
          this.scriptPath,
          command,
          this.workspace,
          ...args,
        ],
        {
          cwd: this.workspace,
          stdout: "pipe",
          stderr: "pipe",
        },
      )
    } catch (error) {
      throw new RemovalOperationError(
        error instanceof Error ? error.message : String(error),
        "runtime-unavailable",
        500,
      )
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      outputText(child.stdout),
      outputText(child.stderr),
      child.exited,
    ])
    let payload: ScriptPayload
    try {
      payload = JSON.parse(stdout) as ScriptPayload
    } catch {
      throw new RemovalOperationError(
        stderr.trim() || "removal command returned invalid output",
        "invalid-removal-output",
        500,
      )
    }
    if (exitCode !== 0 || typeof payload.error === "string") {
      const message =
        typeof payload.error === "string"
          ? payload.error
          : stderr.trim() || `removal command exited with ${exitCode}`
      const details = errorDetails(message)
      throw new RemovalOperationError(message, details.code, details.status)
    }
    return payload
  }

  async preview(target: RemovalTarget): Promise<RemovalPreviewResponse> {
    const payload = await this.run("preview", targetArguments(target))
    if (typeof payload.digest !== "string") {
      throw new RemovalOperationError(
        "removal preview did not return a plan digest",
        "invalid-removal-output",
        500,
      )
    }
    return {
      schemaVersion: 1,
      target,
      planDigest: payload.digest,
      blocked: issues(payload.blocked),
      warnings: issues(payload.warnings),
    }
  }

  async execute(
    target: RemovalTarget,
    planDigest: string,
  ): Promise<RemovalExecutionResponse> {
    await this.run("execute", [
      ...targetArguments(target),
      "--plan-digest",
      planDigest,
      "--yes",
    ])
    const verification = await this.run("verify", targetArguments(target))
    if (verification.removed !== true) {
      throw new RemovalOperationError(
        "removal verification found retained resource data",
        "verification-failed",
        500,
      )
    }
    return {
      schemaVersion: 1,
      target,
      planDigest,
      removed: true,
    }
  }
}
