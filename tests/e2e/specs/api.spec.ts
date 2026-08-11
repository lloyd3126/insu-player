import { expect, test } from "@playwright/test"

test.describe("Hono API contracts @api", () => {
  test("reports runtime and normalized job/caption data", async ({ request }) => {
    const health = await request.get("/api/health")
    await expect(health).toBeOK()
    expect(await health.json()).toMatchObject({
      ok: true,
      runtime: "bun",
      framework: "hono",
      database: "sqlite",
    })

    const jobs = await request.get("/api/jobs")
    await expect(jobs).toBeOK()
    expect(await jobs.json()).toMatchObject({
      jobs: [
        {
          videoId: "demo-video",
          captionCodes: ["en", "zh-TW"],
          watchable: true,
        },
      ],
    })

    const library = await request.get("/api/library")
    await expect(library).toBeOK()
    expect(await library.json()).toMatchObject({
      items: [
        {
          kind: "media",
          id: "media:demo-video",
          job: { videoId: "demo-video", watchable: true },
        },
      ],
      queue: {
        paused: false,
        queuedCount: 0,
        activeCount: 0,
        attentionCount: 0,
      },
    })

    const captions = await request.get("/api/jobs/demo-video/captions")
    await expect(captions).toBeOK()
    expect(await captions.json()).toMatchObject({
      tracks: [{ code: "en" }, { code: "zh-TW" }],
    })

    const removedLegacyAsset = await request.get("/assets/library.js")
    expect(removedLegacyAsset.status()).toBe(404)
  })

  test("supports media ranges and validates environment mutation origin", async ({ request }) => {
    const range = await request.get("/media/demo-video/video", {
      headers: { Range: "bytes=0-3" },
    })
    expect(range.status()).toBe(206)
    expect(range.headers()["content-range"]).toBe("bytes 0-3/18")
    expect(await range.text()).toBe("fake")

    const forbidden = await request.put("/api/providers/openai/credential", {
      headers: { Origin: "https://untrusted.example" },
      data: { value: "not-a-real-key" },
    })
    expect(forbidden.status()).toBe(403)
  })
})
