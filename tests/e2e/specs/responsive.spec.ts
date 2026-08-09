import { expect, test } from "@playwright/test"

import { HomePage } from "../pages/home.page"

test("mobile homepage and library remain usable @responsive", async ({ page }) => {
  const home = new HomePage(page)
  await home.goto()
  await expect(home.navigation.getByRole("button", { name: /影音中心/ })).toBeVisible()

  const library = await home.openLibrary()
  await expect(library.getByRole("heading", { name: "影音中心" })).toBeVisible()
  await expect(library.getByRole("tab", { name: "我的影音" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await library.getByRole("tab", { name: "詳細資訊" }).click()
  await expect(library.getByRole("row").filter({ hasText: "雙語測試影音" })).toBeVisible()
})
