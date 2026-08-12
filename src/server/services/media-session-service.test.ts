import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  MediaSessionOperationError,
  MediaSessionService,
} from "@server/services/media-session-service"

const originalFetch = globalThis.fetch
const workspaces: string[] = []

function service() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-media-session-"))
  workspaces.push(workspace)
  return new MediaSessionService(workspace)
}

function hlsRequest() {
  return {
    candidates: [
      {
        kind: "page" as const,
        pageUrl: "https://media.example/watch/one",
        candidateFingerprint: "a".repeat(64),
      },
      {
        kind: "network-media" as const,
        pageUrl: "https://media.example/watch/one",
        frameUrl: "https://embed.example/player/one",
        mediaUrl: "https://cdn.example/vod.m3u8?token=ephemeral",
        protocol: "hls" as const,
        candidateFingerprint: "b".repeat(64),
      },
    ],
    cookies: [
      {
        name: "session",
        value: "secret-cookie",
        domain: ".cdn.example",
        path: "/",
        secure: true,
        httpOnly: true,
        hostOnly: false,
        session: true,
      },
    ],
    authenticationConsentAt: "2026-08-11T00:00:00.000Z",
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe("browser media sessions", () => {
  test("creates one scoped 0600 cookie jar and deletes it after the claim", async () => {
    globalThis.fetch = (async () =>
      new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n")) as unknown as typeof fetch
    const sessions = service()
    const created = await sessions.create(hlsRequest())
    const claimed = sessions.claim(created.sessionId)
    expect(claimed.sourceKind).toBe("page")
    expect(claimed.sourceUrls).toEqual([
      "https://media.example/watch/one",
      "https://cdn.example/vod.m3u8?token=ephemeral",
    ])
    expect(claimed.cookieFile).not.toBeNull()
    expect(statSync(claimed.cookieFile!).mode & 0o777).toBe(0o600)
    expect(readFileSync(claimed.cookieFile!, "utf8")).toContain("secret-cookie")
    claimed.dispose()
    expect(existsSync(claimed.cookieFile!)).toBe(false)
    expect(() => sessions.claim(created.sessionId)).toThrow(
      "本次來源資料已失效",
    )
  })

  test("rejects live media playlists before queueing", async () => {
    globalThis.fetch = (async () =>
      new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n")) as unknown as typeof fetch
    await expect(service().create(hlsRequest())).rejects.toMatchObject({
      code: "live-stream-not-supported",
    } satisfies Partial<MediaSessionOperationError>)
  })

  test("rejects protected HLS key formats", async () => {
    globalThis.fetch = (async () =>
      new Response(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery"\n#EXT-X-ENDLIST\n',
      )) as unknown as typeof fetch
    await expect(service().create(hlsRequest())).rejects.toMatchObject({
      code: "drm-not-supported",
    } satisfies Partial<MediaSessionOperationError>)
  })
})
