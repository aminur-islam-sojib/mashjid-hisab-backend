// =============================================================================
// Invariant Tests: Mosque Category Seeding & Auto-Initialization
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  FundType,
  CategoryType,
  Role,
  MembershipStatus,
  UserStatus,
} from "../../generated/prisma/client.js";
import {
  seedDefaultCategoriesForMosque,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
} from "../../src/modules/category/category.catalog.js";
import { createMosque } from "../../src/modules/mosque/mosque.service.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";

describe("Mosque Category Seeding & Catalog Suite", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    if (fixture?.cleanup) {
      await fixture.cleanup();
    }
  });

  it("1. Seeds all default income & expense categories for a mosque", async () => {
    const result = await seedDefaultCategoriesForMosque(fixture.mosqueId);

    const totalCatalogExpected =
      DEFAULT_INCOME_CATEGORIES.length + DEFAULT_EXPENSE_CATEGORIES.length;

    assert.equal(result.totalCatalogCount, totalCatalogExpected);
    assert.ok(result.createdCount > 0, "Must create new categories");

    // Fetch all categories for this mosque
    const categoriesInDb = await prisma.category.findMany({
      where: { mosqueId: fixture.mosqueId, isArchived: false },
    });

    const incomeCategories = categoriesInDb.filter((c) => c.type === CategoryType.INCOME);
    const expenseCategories = categoriesInDb.filter((c) => c.type === CategoryType.EXPENSE);

    assert.ok(
      incomeCategories.length >= DEFAULT_INCOME_CATEGORIES.length,
      `Expected at least ${DEFAULT_INCOME_CATEGORIES.length} income categories`,
    );
    assert.ok(
      expenseCategories.length >= DEFAULT_EXPENSE_CATEGORIES.length,
      `Expected at least ${DEFAULT_EXPENSE_CATEGORIES.length} expense categories`,
    );

    // Verify key categories exist
    const hasJummah = incomeCategories.some((c) => c.name === "Friday Jummah Collection");
    const hasImam = expenseCategories.some((c) => c.name === "Imam & Khatib Honorarium");
    const hasUtility = expenseCategories.some((c) => c.name === "Electricity & Utility Bills");

    assert.equal(hasJummah, true, "Must have Friday Jummah Collection");
    assert.equal(hasImam, true, "Must have Imam & Khatib Honorarium");
    assert.equal(hasUtility, true, "Must have Electricity & Utility Bills");
  });

  it("2. Idempotency: Running seed again skips existing categories without error", async () => {
    const secondRun = await seedDefaultCategoriesForMosque(fixture.mosqueId);

    assert.equal(
      secondRun.createdCount,
      0,
      "Second run must create 0 duplicate categories",
    );
    assert.equal(
      secondRun.skippedCount,
      DEFAULT_INCOME_CATEGORIES.length + DEFAULT_EXPENSE_CATEGORIES.length,
      "All standard categories must be skipped as already present",
    );
  });

  it("3. Automatically binds Zakat categories to Zakat fund if present", async () => {
    const categoriesInDb = await prisma.category.findMany({
      where: { mosqueId: fixture.mosqueId },
      include: { fund: true },
    });

    const zakatIncome = categoriesInDb.find((c) => c.name === "Zakat Collection");
    const zakatExpense = categoriesInDb.find(
      (c) => c.name === "Zakat & Poor Relief Disbursement",
    );

    assert.ok(zakatIncome, "Zakat Collection category must exist");
    assert.ok(zakatExpense, "Zakat & Poor Relief Disbursement must exist");

    // Since fixture has a restricted ZAKAT fund (fixture.restrictedFund), verify binding
    assert.ok(zakatIncome.fundId !== null, "Zakat Collection must be bound to fund");
    assert.equal(zakatIncome.fundId, fixture.restrictedFund.id);
    assert.equal(zakatExpense.fundId, fixture.restrictedFund.id);
  });

  it("4. createMosque automatically seeds General Fund and default categories", async () => {
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const user = await prisma.user.create({
      data: {
        email: `new-mosque-creator-${nonce}@example.com`,
        passwordHash: "dummyhash",
        status: UserStatus.ACTIVE,
        name: `Creator ${nonce}`,
      },
    });

    const result = await createMosque(user.id, {
      name: `Auto-Seeded Mosque ${nonce}`,
      slug: `auto-seed-${nonce}`,
    });

    const newMosqueId = result.mosque.id;

    // Verify General Fund was automatically initialized
    const generalFund = await prisma.fund.findFirst({
      where: { mosqueId: newMosqueId, type: FundType.GENERAL },
    });
    assert.ok(generalFund, "Default General Operating Fund must be created on mosque registration");

    // Verify standard categories were automatically seeded
    const categories = await prisma.category.findMany({
      where: { mosqueId: newMosqueId },
    });

    const expectedTotal =
      DEFAULT_INCOME_CATEGORIES.length + DEFAULT_EXPENSE_CATEGORIES.length;
    assert.equal(
      categories.length,
      expectedTotal,
      `Newly created mosque must automatically have all ${expectedTotal} default categories`,
    );

    // Clean up
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.mosque.delete({ where: { id: newMosqueId } }).catch(() => {});
  });
});

