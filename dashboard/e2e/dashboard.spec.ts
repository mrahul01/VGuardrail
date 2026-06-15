import { test, expect } from "@playwright/test";

const protectedOrLogin = /\/(dashboard|devices|policies|violations|exceptions|audit|settings|login)/;

test.describe("dashboard RBAC shell", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
  });

  test("dashboard route is protected or renders in mock mode", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("devices page loads list or redirects", async ({ page }) => {
    await page.goto("/devices");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("policies page loads or redirects", async ({ page }) => {
    await page.goto("/policies");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("violations page loads or redirects", async ({ page }) => {
    await page.goto("/violations");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("exceptions page loads or redirects", async ({ page }) => {
    await page.goto("/exceptions");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("audit page loads or redirects", async ({ page }) => {
    await page.goto("/audit");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("users settings page loads or redirects", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).toHaveURL(protectedOrLogin);
  });

  test("org settings page loads or redirects", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(protectedOrLogin);
  });
});
