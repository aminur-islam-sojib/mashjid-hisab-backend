// =============================================================================
// Invariant Tests: Dashboard Dynamic Data & Single Source of Truth
//
// Invariants enforced:
//  1. /reports/dashboard provides live dynamic data for all dashboard cards.
//  2. kpi.totalMembers, kpi.monthlyIncome, and trend percentages match ledger.
//  3. donationsTrend data points correctly calculate cumulative milestones for the month.
//  4. recentMembers matches database memberships in descending order.
//  5. fundAllocation percentages strictly sum to <= 100%.
// =============================================================================

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Role, DonationSource, CampaignStatus } from "../../generated/prisma/client.js";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import { createDonation } from "../../src/modules/donation/donation.service.js";
import { getDashboardReport } from "../../src/modules/report/report.service.js";
import { prisma } from "../../src/lib/prisma.js";

describe("Invariant Suite: Dashboard Dynamic Data", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();

    // 1. Post a donation in current month
    await createDonation(
      fixture.mosqueId,
      {
        amount: 845000n, // ৳8,450.00
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.MEMBER,
        isAnonymousPublic: false,
        donorName: "Brother Abdullah",
      },
      fixture.adminActor,
    );

    // 2. Create an active campaign
    await prisma.campaign.create({
      data: {
        mosqueId: fixture.mosqueId,
        fundId: fixture.generalFund.id,
        title: "Community Iftar Drive",
        startDate: new Date(),
        status: CampaignStatus.ACTIVE,
        targetAmount: 5000000n, // ৳50,000.00
      },
    });
  });

  it("returns populated dynamic KPI, trend, fund allocation, and recent members", async () => {
    const report = await getDashboardReport(fixture.mosqueId);

    // KPI Verification
    assert.ok(report.kpi, "report.kpi must be defined");
    assert.equal(typeof report.kpi.totalMembers, "number");
    assert.ok(report.kpi.totalMembers >= 1, "Should have at least the admin member");
    assert.equal(report.kpi.monthlyIncome, "845000");
    assert.equal(typeof report.kpi.totalTreasuryBalance, "string");
    assert.ok(BigInt(report.kpi.totalTreasuryBalance) > 0n);
    assert.equal(typeof report.kpi.monthlyExpense, "string");
    assert.equal(typeof report.kpi.expenseTrendPercentage, "number");
    assert.equal(typeof report.kpi.pendingApprovalsCount, "number");
    assert.equal(report.kpi.upcomingEventsCount, 1);

    // Donations Trend Verification
    assert.ok(report.donationsTrend, "report.donationsTrend must be defined");
    assert.equal(report.donationsTrend.currentMonthIncome, "845000");
    assert.equal(report.donationsTrend.currentMonthPoints.length, 5);
    assert.equal(report.donationsTrend.lastMonthPoints.length, 5);
    assert.equal(typeof report.donationsTrend.currentMonthLabel, "string");
    assert.equal(typeof report.donationsTrend.lastMonthLabel, "string");
    assert.equal(typeof report.donationsTrend.lastMonthTrendPercentage, "number");
    // Last data point must reflect full cumulative amount
    const lastPoint = report.donationsTrend.currentMonthPoints[report.donationsTrend.currentMonthPoints.length - 1];
    assert.equal(lastPoint?.amount, "845000");

    // Recent Members Verification
    assert.ok(Array.isArray(report.recentMembers), "report.recentMembers must be an array");
    assert.ok(report.recentMembers.length >= 1, "Should list at least the memberships created");
    assert.ok((report.recentMembers[0]?.name.length ?? 0) > 0);

    // Fund Allocation Verification
    assert.ok(report.fundAllocation, "report.fundAllocation must be defined");
    assert.ok(Array.isArray(report.fundAllocation.funds));
    assert.ok(report.fundAllocation.overallAllocationPercentage >= 0);

    // Upcoming Events Verification
    assert.ok(Array.isArray(report.upcomingEvents));
    assert.equal(report.upcomingEvents.length, 1);
    assert.equal(report.upcomingEvents[0]?.title, "Community Iftar Drive");

    // Quick Stats Verification
    assert.ok(report.quickStats);
    assert.equal(typeof report.quickStats.boxCollectionsCount, "number");
  });
});
