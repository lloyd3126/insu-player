import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

import { zipSync } from "fflate"

import type { ExtensionBootstrap } from "@shared/contracts/browser-extension"

const PACKAGE_FILES = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "service-worker.js",
  "connection-protocol.js",
  "media-discovery.js",
  "content-bridge.js",
] as const

export class ExtensionPackageService {
  constructor(private readonly extensionDirectory: string) {}

  createPackage(bootstrap: ExtensionBootstrap) {
    const manifest = JSON.parse(
      readFileSync(path.join(this.extensionDirectory, "manifest.json"), "utf8"),
    ) as { version?: unknown }
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      throw new Error("Chrome 擴充功能版本格式無效")
    }
    const files = {
      ...Object.fromEntries(
        PACKAGE_FILES.map((name) => [
          name,
          new Uint8Array(readFileSync(path.join(this.extensionDirectory, name))),
        ]),
      ),
      "pairing-bootstrap.json": new TextEncoder().encode(
        `${JSON.stringify(bootstrap, null, 2)}\n`,
      ),
    }
    const contents = zipSync(files, { level: 9 })
    return {
      contents,
      filename: `insu-player-extension-v${manifest.version}.zip`,
      checksum: createHash("sha256").update(contents).digest("hex"),
      files: [...PACKAGE_FILES, "pairing-bootstrap.json"],
    }
  }
}
