// =============================================================================
// Invariant Tests: Pending Count Consistency (T01)
//
// Invariants enforced:
//  1. /reports/dashboard pendingApprovals.totalPending strictly equals the count of
//     pending donations and pending expenses (the actual rows in the approval queue).
//  2. Open box counting sessions are returned separately as countingSessionsToVerify.
//  3. The number reported in totalPending exactly equals the number of items
//     returned by getPendingTransactions() (badge count == rows in queue).
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  Role,
  UserStatus,
  MembershipStatus,
  DonationSource,
  CollectionStatus,
} from "../../generated/prisma/client.js";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import { createDonation } from "../../src/modules/donation/donation.service.js";
import { createExpense } from "../../src/modules/expense/expense.service.js";
import { getDashboardReport } from "../../src/modules/report/report.service.js";
import { getPendingTransactions } from "../../src/modules/transaction/transaction.service.js";

describe("Invariant Suite: Pending Count Consistency (T01)", () => {
  let fixture: TestTenantFixture;
  let staffUser: { id: string };
  let staffActor: { userId: string; role: Role };

  before(async () => {
    fixture = await createTestTenantFixture();

    // 1. Initial posted donation by admin to fund the account & fund for future expenses
    await createDonation(
      fixture.mosqueId,
      {
        amount: 500000n, // ৳5,000.00 posted immediately by admin
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.MEMBER,
        isAnonymousPublic: false,
        donorName: "Initial Endowment",
      },
      fixture.adminActor,
    );

    // 2. Create a staff user to record pending entries
    staffUser = await prisma.user.create({
      data: {
        email: `staff-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`,
        passwordHash: "dummyhash",
        status: UserStatus.ACTIVE,
        name: "Test Staff",
      },
    });

    await prisma.membership.create({
      data: {
        userId: staffUser.id,
        mosqueId: fixture.mosqueId,
        role: Role.STAFF,
        status: MembershipStatus.ACTIVE,
      },
    });

    staffActor = {
      userId: staffUser.id,
      role: Role.STAFF,
    };
  });

  after(async () => {
    await prisma.collectionSession.deleteMany({ where: { mosqueId: fixture.mosqueId } });
    await prisma.donation.deleteMany({ where: { mosqueId: fixture.mosqueId } });
    await prisma.expense.deleteMany({ where: { mosqueId: fixture.mosqueId } });
    await prisma.auditLog.deleteMany({ where: { mosqueId: fixture.mosqueId } });
    await prisma.membership.deleteMany({ where: { userId: staffUser.id } });
    await prisma.user.deleteMany({ where: { id: staffUser.id } });
    await fixture.cleanup();
  });

  it("T01 Invariant: Dashboard pending count matches approvals queue, and box counts are separate", async () => {
    // 1. Initial state: zero pending (the initial admin donation was POSTED immediately)
    const initialReport = await getDashboardReport(fixture.mosqueId);
    assert.equal(initialReport.pendingApprovals.totalPending, 0);
    assert.equal(initialReport.pendingApprovals.countingSessionsToVerify, 0);

    const initialQueue = await getPendingTransactions(fixture.mosqueId, { limit: 50 }, fixture.adminActor);
    assert.equal(initialQueue.items.length, 0);
    assert.equal(initialQueue.totalPending, 0);

    // 2. Staff records 1 donation -> saved as PENDING
    await createDonation(
      fixture.mosqueId,
      {
        amount: 25000n, // ৳250.00
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.MEMBER,
        isAnonymousPublic: false,
        donorName: "Brother Zayd",
      },
      staffActor,
    );

    // 3. Staff records 1 expense -> saved as PENDING
    await createExpense(
      fixture.mosqueId,
      {
        amount: 15000n, // ৳150.00
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Hardware Store",
        attachments: [],
      },
      staffActor,
    );

    // 4. Staff starts 1 box counting session -> status OPEN
    await prisma.collectionSession.create({
      data: {
        mosqueId: fixture.mosqueId,
        occasion: "JUMMAH",
        date: new Date(),
        totalAmount: 450000n, // ৳4500.00
        status: CollectionStatus.OPEN,
        createdById: staffUser.id,
      },
    });

    // 5. Fetch dashboard report
    const dashboardReport = await getDashboardReport(fixture.mosqueId);

    // Verify individual breakdown
    assert.equal(dashboardReport.pendingApprovals.pendingDonations, 1);
    assert.equal(dashboardReport.pendingApprovals.pendingExpenses, 1);
    assert.equal(dashboardReport.pendingApprovals.openCollections, 1);
    assert.equal(dashboardReport.pendingApprovals.countingSessionsToVerify, 1);

    // KEY INVARIANT: totalPending must be 2 (donations + expenses), NOT 3!
    assert.equal(
      dashboardReport.pendingApprovals.totalPending,
      2,
      "totalPending must strictly equal pendingDonations + pendingExpenses (excluding openCollections)",
    );

    // 6. Fetch pending transactions queue
    const pendingQueue = await getPendingTransactions(fixture.mosqueId, { limit: 50 }, fixture.adminActor);

    // KEY INVARIANT: queue length must be exactly 2
    assert.equal(pendingQueue.items.length, 2, "Pending queue must return exactly 2 items");
    assert.equal(pendingQueue.totalPending, 2);

    // KEY INVARIANT: dashboard badge count strictly matches queue row count
    assert.equal(
      dashboardReport.pendingApprovals.totalPending,
      pendingQueue.items.length,
      "Dashboard totalPending badge MUST exactly equal the number of rows in the pending queue",
    );
  });
});

