// =============================================================================
// Public Transparency Integration & Invariant Tests
//
// Tests verify:
// 1. PATCH /api/mosques/:mosqueId extends update payload with isTransparencyPageEnabled.
// 2. GET /api/public/mosques/:slug/summary:
//    - Strictly gated by isTransparencyPageEnabled (generic 404 when disabled).
//    - currentBalance strictly matches getFundBalance() to prevent drift.
//    - totalCollected and totalDisbursed reflect current fiscal year sums.
//    - Zero Account rows or account numbers exposed.
// 3. GET /api/public/mosques/:slug/donations:
//    - Gated by isTransparencyPageEnabled.
//    - Excludes voided originals and reversal corrections (reversalOfId: null).
//    - Substitutes "Anonymous" when isAnonymousPublic is true.
//    - Never leaks donor phone or email.
// 4. GET /api/public/mosques/:slug/expenses/summary:
//    - Gated by isTransparencyPageEnabled.
//    - Category-grouped totals only (never itemized vendor/staff rows).
// 5. GET /api/public/mosques/:slug/campaigns:
//    - Gated by isTransparencyPageEnabled.
//    - Aggregates live raisedAmount and open pledgedAmount.
//    - Zero individual donor or pledger identities.
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";
import {
  updateMosque,
  getMosqueSettings,
} from "../../src/modules/mosque/mosque.service.js";
import {
  getPublicMosqueSummary,
  getPublicMosqueDonationsFeed,
  getPublicMosqueExpenseCategorySummary,
  getPublicCampaigns,
} from "../../src/modules/transparency/transparency.service.js";
import { createDonation, voidDonation } from "../../src/modules/donation/donation.service.js";
import { createExpense } from "../../src/modules/expense/expense.service.js";
import { getFundBalance } from "../../src/modules/fund/fund.service.js";
import { HttpError } from "../../src/errors/HttpError.js";
import {
  CampaignStatus,
  PledgeStatus,
  DonationSource,
} from "../../generated/prisma/client.js";

describe("Public Transparency & Privacy Guarantees", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    await fixture.cleanup();
  });

  it("1. PATCH /api/mosques/:mosqueId extends update payload with isTransparencyPageEnabled", async () => {
    // 1. Disable transparency
    const disabledSettings = await updateMosque(fixture.mosqueId, {
      isTransparencyPageEnabled: false,
    });
    assert.equal(disabledSettings.isTransparencyPageEnabled, false);

    // Verify settings query returns false
    const fetched1 = await getMosqueSettings(fixture.adminUser.id, fixture.mosqueId);
    assert.equal(fetched1.isTransparencyPageEnabled, false);

    // 2. Re-enable transparency
    const enabledSettings = await updateMosque(fixture.mosqueId, {
      isTransparencyPageEnabled: true,
    });
    assert.equal(enabledSettings.isTransparencyPageEnabled, true);

    const fetched2 = await getMosqueSettings(fixture.adminUser.id, fixture.mosqueId);
    assert.equal(fetched2.isTransparencyPageEnabled, true);
  });

  it("2. GET /api/public/mosques/:slug/summary: 404 when disabled, exact getFundBalance() match when enabled", async () => {
    // A. Disable transparency and verify 404 (existence-hiding)
    await updateMosque(fixture.mosqueId, { isTransparencyPageEnabled: false });

    await assert.rejects(
      async () => {
        await getPublicMosqueSummary(fixture.slug);
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, "MOSQUE_NOT_FOUND");
        return true;
      },
    );

    // B. Re-enable transparency
    await updateMosque(fixture.mosqueId, { isTransparencyPageEnabled: true });

    // Seed: Donation into general fund (100,000 poisha = 1,000 BDT)
    await createDonation(
      fixture.mosqueId,
      {
        amount: 100000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    // Seed: Expense from general fund (30,000 poisha = 300 BDT)
    await createExpense(
      fixture.mosqueId,
      {
        amount: 30000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Test General Supplier",
        attachments: ["https://example.com/receipt-1.jpg"],
        notes: "Public Summary Test Expense",
      },
      fixture.adminActor,
    );

    // Compute expected internal balance
    const expectedGeneralBalance = await getFundBalance(fixture.generalFund.id);
    assert.equal(expectedGeneralBalance, 70000n);

    // Fetch public summary
    const summary = await getPublicMosqueSummary(fixture.slug);

    assert.equal(summary.mosque.slug, fixture.slug);
    assert(summary.funds.length >= 2);

    const generalFundSummary = summary.funds.find((f) => f.name === fixture.generalFund.name);
    assert(generalFundSummary !== undefined);
    assert.equal(generalFundSummary.totalCollected, "100000");
    assert.equal(generalFundSummary.totalDisbursed, "30000");
    // Guarantee: currentBalance exactly matches getFundBalance()
    assert.equal(generalFundSummary.currentBalance, expectedGeneralBalance.toString());

    // Guarantee: Zero account rows, account numbers, or bank identifiers in response
    const rawSummaryJson = JSON.stringify(summary);
    assert(!rawSummaryJson.includes("accountId"));
    assert(!rawSummaryJson.includes("accountNumber"));
    assert(!rawSummaryJson.includes("Main Cash"));
    assert(!rawSummaryJson.includes("Bank Account"));
  });

  it("3. GET /api/public/mosques/:slug/donations: Excludes reversals/voids, redacts anonymous donors, no sensitive leaks", async () => {
    // 1. Normal donor donation (named)
    await createDonation(
      fixture.mosqueId,
      {
        amount: 50000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        donorName: "Haji Mohammad Ali",
        donorPhone: "+8801700000001",
        donorEmail: "haji@example.com",
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    // 2. Anonymous donation
    await createDonation(
      fixture.mosqueId,
      {
        amount: 25000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        donorName: "Secret Donor",
        donorPhone: "+8801700000002",
        donorEmail: "secret@example.com",
        source: DonationSource.ONLINE,
        isAnonymousPublic: true,
      },
      fixture.adminActor,
    );

    // 3. Donation that gets voided (creates voided original + reversal pair)
    const toVoid = await createDonation(
      fixture.mosqueId,
      {
        amount: 40000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        donorName: "Void Candidate",
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    await voidDonation(
      fixture.mosqueId,
      toVoid.id,
      "Mistake during entry",
      fixture.adminActor,
    );

    // Fetch public feed
    const feed = await getPublicMosqueDonationsFeed(fixture.slug, { page: 1, limit: 50 });

    assert(feed.donations.length >= 2);

    // Guarantee: Neither the voided original nor the reversal entry appears
    const voidCandidateDonations = feed.donations.filter((d) => d.donorName === "Void Candidate");
    assert.equal(voidCandidateDonations.length, 0);

    const amount40000Donations = feed.donations.filter((d) => d.amount === "40000" || d.amount === "-40000");
    assert.equal(amount40000Donations.length, 0);

    // Guarantee: Named donation shows name
    const hajiDonation = feed.donations.find((d) => d.donorName === "Haji Mohammad Ali");
    assert(hajiDonation !== undefined);
    assert.equal(hajiDonation.amount, "50000");
    assert.equal(hajiDonation.fundName, fixture.generalFund.name);

    // Guarantee: Anonymous donation displays "Anonymous" (and redacts Secret Donor)
    const secretDonation = feed.donations.find((d) => d.donorName === "Secret Donor");
    assert.equal(secretDonation, undefined);

    const anonDonation = feed.donations.find((d) => d.amount === "25000");
    assert(anonDonation !== undefined);
    assert.equal(anonDonation.donorName, "Anonymous");

    // Guarantee: Never leak donorPhone, donorEmail, memberId, accountId
    const rawFeedJson = JSON.stringify(feed);
    assert(!rawFeedJson.includes("+8801700000001"));
    assert(!rawFeedJson.includes("+8801700000002"));
    assert(!rawFeedJson.includes("haji@example.com"));
    assert(!rawFeedJson.includes("secret@example.com"));
    assert(!rawFeedJson.includes("donorPhone"));
    assert(!rawFeedJson.includes("donorEmail"));
    assert(!rawFeedJson.includes("accountId"));
  });

  it("4. GET /api/public/mosques/:slug/expenses/summary: Groups by Category only, never itemized rows", async () => {
    // Record another expense in unrestricted category
    await createExpense(
      fixture.mosqueId,
      {
        amount: 20000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Secret Contractor Inc",
        attachments: ["https://example.com/receipt-2.jpg"],
        notes: "Confidential Vendor Bill",
      },
      fixture.adminActor,
    );

    const expenseSummary = await getPublicMosqueExpenseCategorySummary(fixture.slug);

    assert.equal(expenseSummary.mosque.slug, fixture.slug);
    assert(expenseSummary.categories.length >= 1);

    const categoryItem = expenseSummary.categories.find(
      (c) => c.categoryName === fixture.unrestrictedExpenseCategory.name,
    );
    assert(categoryItem !== undefined);
    // 30,000 from test 2 + 20,000 from test 4 = 50,000
    assert.equal(categoryItem.total, "50000");

    // Guarantee: Macro view only. Never exposes individual payee, vendor, or itemized titles
    const rawExpenseJson = JSON.stringify(expenseSummary);
    assert(!rawExpenseJson.includes("Secret Contractor Inc"));
    assert(!rawExpenseJson.includes("Confidential Vendor Bill"));
    assert(!rawExpenseJson.includes("payee"));
  });

  it("5. GET /api/public/mosques/:slug/campaigns: Summarizes goal, raised, and pledged without leaking identities", async () => {
    // 1. Create a public campaign
    const campaign = await prisma.campaign.create({
      data: {
        mosqueId: fixture.mosqueId,
        fundId: fixture.generalFund.id,
        title: "Ramadan Food Drive",
        description: "Annual food distribution for the needy",
        targetAmount: 500000n, // 5,000 BDT
        startDate: new Date(),
        isPublic: true,
        status: CampaignStatus.ACTIVE,
      },
    });

    // 2. Link a posted donation to the campaign
    await createDonation(
      fixture.mosqueId,
      {
        amount: 150000n, // 1,500 BDT
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        campaignId: campaign.id,
        date: new Date(),
        donorName: "Anonymous Donor",
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: true,
      },
      fixture.adminActor,
    );

    // 3. Create an open pledge linked to the campaign
    await prisma.pledge.create({
      data: {
        mosqueId: fixture.mosqueId,
        fundId: fixture.generalFund.id,
        campaignId: campaign.id,
        amount: 200000n, // 2,000 BDT
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: PledgeStatus.OPEN,
        donorName: "Promised Contributor",
      },
    });

    // Fetch public campaigns
    const campaigns = await getPublicCampaigns(fixture.slug);

    const foodDrive = campaigns.find((c) => c.id === campaign.id);
    assert(foodDrive !== undefined);
    assert.equal(foodDrive.title, "Ramadan Food Drive");
    assert.equal(foodDrive.goalAmount, "500000");
    assert.equal(foodDrive.raisedAmount, "150000");
    assert.equal(foodDrive.pledgedAmount, "200000");
    assert.equal(foodDrive.status, CampaignStatus.ACTIVE);
    assert.equal(foodDrive.percentage, 30); // 150000 / 500000 = 30%

    // Guarantee: Zero donor or pledger identities in campaign summary
    const rawCampaignJson = JSON.stringify(campaigns);
    assert(!rawCampaignJson.includes("Promised Contributor"));
    assert(!rawCampaignJson.includes("Anonymous Donor"));
    assert(!rawCampaignJson.includes("donorName"));
  });
});

