// =============================================================================
// Invariant Tests: Fund-Account Balance Invariant & Unallocated Money (T02)
//
// Invariants enforced:
//  1. Sum(Accounts) == Sum(Funds) at all times.
//  2. When an account is created with openingBalance > 0 and openingFundId,
//     the specified fund's openingBalance is incremented atomically.
//  3. When an account is created with openingBalance > 0 without openingFundId,
//     the active GENERAL fund's openingBalance is incremented atomically.
//  4. Creating an account with openingBalance > 0 fails if no active fund exists.
//  5. Reports (/reports/dashboard & /reports/balances) return unallocated = "0"
//     when account totals match fund totals.
//  6. allocateUnallocated endpoint correctly sockets unallocated money to a target
//     fund and rejects amounts exceeding unallocated balance.
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import { AccountType, FundType } from "../../generated/prisma/client.js";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import { createAccount } from "../../src/modules/account/account.service.js";
import { createFund, allocateUnallocated } from "../../src/modules/fund/fund.service.js";
import { getDashboardReport, getBalancesReport } from "../../src/modules/report/report.service.js";

describe("Invariant Suite: Fund-Account Balance Invariant & Unallocated Money (T02)", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    await fixture.cleanup();
  });

  it("Invariant 2.1: Initial fixture maintains Sum(Accounts) == Sum(Funds) and unallocated == '0'", async () => {
    const report = await getDashboardReport(fixture.mosqueId);
    assert.equal(report.balances.unallocated, "0");
    assert.equal(report.balances.totalAccounts, report.balances.totalFunds);

    const balancesReport = await getBalancesReport(fixture.mosqueId, {});
    assert.equal(balancesReport.unallocated, "0");
    assert.equal(balancesReport.totalAccountsBalance, balancesReport.totalFundsBalance);
  });

  it("Invariant 2.2: Creating an account with openingBalance > 0 and explicit openingFundId updates the fund", async () => {
    // Create dedicated fund
    const newFund = await createFund(fixture.mosqueId, {
      name: `Building Fund ${Date.now()}`,
      type: FundType.CONSTRUCTION,
      isRestricted: false,
    });

    const fundBefore = await prisma.fund.findUnique({
      where: { id: newFund.id },
      select: { openingBalance: true },
    });
    assert.equal(fundBefore?.openingBalance, 0n);

    // Create account with openingBalance allocating to newFund
    const openingAmt = 150000n; // ৳1,500.00
    const newAccount = await createAccount(fixture.mosqueId, {
      name: `Building Cash Safe ${Date.now()}`,
      type: AccountType.CASH,
      openingBalance: openingAmt,
      openingFundId: newFund.id,
    });

    // Check account was created
    assert.equal(newAccount.openingBalance, openingAmt.toString());

    // Check fund's openingBalance was incremented
    const fundAfter = await prisma.fund.findUnique({
      where: { id: newFund.id },
      select: { openingBalance: true },
    });
    assert.equal(fundAfter?.openingBalance, openingAmt);

    // Verify invariant holds: Sum(Accounts) == Sum(Funds) and unallocated == '0'
    const report = await getDashboardReport(fixture.mosqueId);
    assert.equal(report.balances.unallocated, "0");
    assert.equal(report.balances.totalAccounts, report.balances.totalFunds);
  });

  it("Invariant 2.3: Creating an account with openingBalance > 0 without openingFundId defaults to GENERAL fund", async () => {
    const generalFundBefore = await prisma.fund.findUnique({
      where: { id: fixture.generalFund.id },
      select: { openingBalance: true },
    });
    const beforeBal = generalFundBefore?.openingBalance ?? 0n;

    const openingAmt = 75000n; // ৳750.00
    await createAccount(fixture.mosqueId, {
      name: `Donation Box Account ${Date.now()}`,
      type: AccountType.CASH,
      openingBalance: openingAmt,
    });

    const generalFundAfter = await prisma.fund.findUnique({
      where: { id: fixture.generalFund.id },
      select: { openingBalance: true },
    });
    assert.equal(generalFundAfter?.openingBalance, beforeBal + openingAmt);

    // Verify invariant holds: Sum(Accounts) == Sum(Funds) and unallocated == '0'
    const report = await getDashboardReport(fixture.mosqueId);
    assert.equal(report.balances.unallocated, "0");
  });

  it("Invariant 2.4: Direct unallocated balance discrepancy is detected in report and can be resolved via allocateUnallocated", async () => {
    // Simulate legacy unallocated balance by manually incrementing an account's openingBalance
    const discrepancy = 50000n; // ৳500.00
    await prisma.account.update({
      where: { id: fixture.cashAccount.id },
      data: { openingBalance: { increment: discrepancy } },
    });

    // Report must now detect unallocated balance of 50000 poisha
    const reportBefore = await getDashboardReport(fixture.mosqueId);
    assert.equal(reportBefore.balances.unallocated, discrepancy.toString());
    assert.equal(reportBefore.balances.formattedUnallocated, "500.00");

    // Attempting to allocate more than unallocated must fail
    await assert.rejects(
      async () => {
        await allocateUnallocated(fixture.mosqueId, {
          fundId: fixture.generalFund.id,
          amount: discrepancy + 1000n,
        });
      },
      { name: "HttpError", message: /exceeds available unallocated balance/ },
    );

    // Allocate exact discrepancy to the general fund
    const allocationResult = await allocateUnallocated(fixture.mosqueId, {
      fundId: fixture.generalFund.id,
      amount: discrepancy,
    });

    assert.equal(allocationResult.unallocatedRemaining, "0");
    assert.equal(allocationResult.formattedUnallocatedRemaining, "0.00");

    // Report must now be back to 0 unallocated
    const reportAfter = await getDashboardReport(fixture.mosqueId);
    assert.equal(reportAfter.balances.unallocated, "0");
    assert.equal(reportAfter.balances.formattedUnallocated, "0.00");
    assert.equal(reportAfter.balances.totalAccounts, reportAfter.balances.totalFunds);
  });
});

