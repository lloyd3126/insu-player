import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

export function isRegularFile(candidate: string) {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

export function safeContainedFile(root: string, candidate: string) {
  if (!isRegularFile(candidate)) return null
  try {
    const resolvedRoot = realpathSync(root)
    const resolvedCandidate = realpathSync(candidate)
    if (
      resolvedCandidate !== resolvedRoot &&
      !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      return null
    }
    return resolvedCandidate
  } catch {
    return null
  }
}

export function atomicWriteJson(
  destination: string,
  payload: unknown,
  mode = 0o600,
) {
  mkdirSync(path.dirname(destination), { recursive: true })
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
    throw new Error("descriptor path must not be a symlink")
  }
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode })
    renameSync(temporary, destination)
    chmodSync(destination, mode)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function readJsonFile<T>(candidate: string): T {
  return JSON.parse(readFileSync(candidate, "utf8")) as T
}

export function contentTypeFor(candidate: string) {
  const extension = path.extname(candidate).toLowerCase()
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".vtt": "text/vtt; charset=utf-8",
      ".mp4": "video/mp4",
      ".map": "application/json; charset=utf-8",
      ".woff2": "font/woff2",
    }[extension] ?? "application/octet-stream"
  )
}
