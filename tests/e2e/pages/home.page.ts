import { expect, type Locator, type Page } from "@playwright/test"

export class HomePage {
  readonly page: Page
  readonly navigation: Locator
  readonly heroHeading: Locator

  constructor(page: Page) {
    this.page = page
    this.navigation = page.getByRole("navigation", { name: "主要導覽" })
    this.heroHeading = page.getByRole("heading", {
      level: 1,
      name: /用 Agent.*讓影音跨越語言/,
    })
  }

  async goto() {
    await this.page.goto("/")
    const policy = this.page.getByRole("dialog", { name: "使用規範" })
    await expect(policy).toBeVisible()
    await policy.getByRole("button", { name: "我了解並同意" }).click()
    await expect(this.heroHeading).toBeVisible()
  }

  async openNavigationDialog(buttonName: string | RegExp, dialogName: string) {
    await this.navigation.getByRole("button", { name: buttonName }).click()
    const dialog = this.page.getByRole("dialog", { name: dialogName })
    await expect(dialog).toBeVisible()
    return dialog
  }

  async openLibrary() {
    return this.openNavigationDialog(/影片中心/, "影片中心")
  }
}
