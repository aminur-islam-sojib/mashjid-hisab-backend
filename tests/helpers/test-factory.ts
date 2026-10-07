// =============================================================================
// Test Factory — Fixtures & Clean Teardown for Invariant Regression Tests
// =============================================================================

import { prisma } from "../../src/lib/prisma.js";
import {
  Role,
  MembershipStatus,
  UserStatus,
  AccountType,
  FundType,
  CategoryType,
} from "../../generated/prisma/client.js";
import type { DonationActor } from "../../src/modules/donation/donation.service.js";
import type { ExpenseActor } from "../../src/modules/expense/expense.service.js";
import type { TransferActor } from "../../src/modules/transfer/transfer.service.js";

export interface TestTenantFixture {
  mosqueId: string;
  slug: string;
  adminUser: { id: string; email: string | null };
  adminActor: DonationActor & ExpenseActor & TransferActor;
  treasurerUser: { id: string; email: string | null };
  treasurerActor: DonationActor & ExpenseActor & TransferActor;
  memberUser: { id: string; email: string | null };
  memberActor: DonationActor & ExpenseActor & TransferActor;
  cashAccount: { id: string; name: string };
  bankAccount: { id: string; name: string };
  generalFund: { id: string; name: string };
  restrictedFund: { id: string; name: string };
  unrestrictedIncomeCategory: { id: string; name: string };
  unrestrictedExpenseCategory: { id: string; name: string };
  restrictedIncomeCategory: { id: string; name: string };
  restrictedExpenseCategory: { id: string; name: string };
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated, fully configured tenant for invariant testing.
 */
export async function createTestTenantFixture(): Promise<TestTenantFixture> {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const slug = `inv-test-${nonce}`;

  // 1. Create Mosque
  const mosque = await prisma.mosque.create({
    data: {
      name: `Invariant Test Mosque ${nonce}`,
      slug,
      address: "Test Mosque Location",
      timezone: "Asia/Dhaka",
      fiscalYearStart: 7,
      publicTransparency: true,
    },
  });

  // 2. Create Users & Memberships
  const adminUser = await prisma.user.create({
    data: {
      email: `admin-${nonce}@example.com`,
      passwordHash: "dummyhash",
      status: UserStatus.ACTIVE,
      name: `Admin ${nonce}`,
    },
  });

  const adminMembership = await prisma.membership.create({
    data: {
      userId: adminUser.id,
      mosqueId: mosque.id,
      role: Role.MOSQUE_ADMIN,
      status: MembershipStatus.ACTIVE,
    },
  });

  const treasurerUser = await prisma.user.create({
    data: {
      email: `treasurer-${nonce}@example.com`,
      passwordHash: "dummyhash",
      status: UserStatus.ACTIVE,
      name: `Treasurer ${nonce}`,
    },
  });

  const treasurerMembership = await prisma.membership.create({
    data: {
      userId: treasurerUser.id,
      mosqueId: mosque.id,
      role: Role.TREASURER,
      status: MembershipStatus.ACTIVE,
    },
  });

  const memberUser = await prisma.user.create({
    data: {
      email: `member-${nonce}@example.com`,
      passwordHash: "dummyhash",
      status: UserStatus.ACTIVE,
      name: `Member ${nonce}`,
    },
  });

  const memberMembership = await prisma.membership.create({
    data: {
      userId: memberUser.id,
      mosqueId: mosque.id,
      role: Role.MEMBER,
      status: MembershipStatus.ACTIVE,
    },
  });

  // 3. Create Accounts
  const cashAccount = await prisma.account.create({
    data: {
      mosqueId: mosque.id,
      name: `Main Cash ${nonce}`,
      type: AccountType.CASH,
      openingBalance: 0n,
    },
  });

  const bankAccount = await prisma.account.create({
    data: {
      mosqueId: mosque.id,
      name: `Bank Account ${nonce}`,
      type: AccountType.BANK,
      openingBalance: 0n,
    },
  });

  // 4. Create Funds (One unrestricted, One restricted)
  const generalFund = await prisma.fund.create({
    data: {
      mosqueId: mosque.id,
      name: `General Fund ${nonce}`,
      type: FundType.GENERAL,
      isRestricted: false,
    },
  });

  const restrictedFund = await prisma.fund.create({
    data: {
      mosqueId: mosque.id,
      name: `Zakat Fund ${nonce}`,
      type: FundType.ZAKAT,
      isRestricted: true,
    },
  });

  // 5. Create Categories
  // Unrestricted categories (fundId = null)
  const unrestrictedIncomeCategory = await prisma.category.create({
    data: {
      mosqueId: mosque.id,
      name: `General Donation ${nonce}`,
      type: CategoryType.INCOME,
      fundId: null,
    },
  });

  const unrestrictedExpenseCategory = await prisma.category.create({
    data: {
      mosqueId: mosque.id,
      name: `General Maintenance ${nonce}`,
      type: CategoryType.EXPENSE,
      fundId: null,
    },
  });

  // Restricted categories (fundId = restrictedFund.id)
  const restrictedIncomeCategory = await prisma.category.create({
    data: {
      mosqueId: mosque.id,
      name: `Zakat Income ${nonce}`,
      type: CategoryType.INCOME,
      fundId: restrictedFund.id,
    },
  });

  const restrictedExpenseCategory = await prisma.category.create({
    data: {
      mosqueId: mosque.id,
      name: `Zakat Distribution ${nonce}`,
      type: CategoryType.EXPENSE,
      fundId: restrictedFund.id,
    },
  });

  const adminActor: DonationActor & ExpenseActor & TransferActor = {
    userId: adminUser.id,
    role: Role.MOSQUE_ADMIN,
    membershipId: adminMembership.id,
  };

  const treasurerActor: DonationActor & ExpenseActor & TransferActor = {
    userId: treasurerUser.id,
    role: Role.TREASURER,
    membershipId: treasurerMembership.id,
  };

  const memberActor: DonationActor & ExpenseActor & TransferActor = {
    userId: memberUser.id,
    role: Role.MEMBER,
    membershipId: memberMembership.id,
  };

  const cleanup = async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.transfer.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.donation.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.expense.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.campaign.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.pledge.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.due.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.chandaPlan.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.collectionSession.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.category.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.fund.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.account.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.membership.deleteMany({ where: { mosqueId: mosque.id } });
      await prisma.mosque.delete({ where: { id: mosque.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUser.id, treasurerUser.id, memberUser.id] } },
      });
    } catch (e) {
      console.warn("Cleanup warning for tenant:", mosque.id, e);
    }
  };

  return {
    mosqueId: mosque.id,
    slug,
    adminUser: { id: adminUser.id, email: adminUser.email },
    adminActor,
    treasurerUser: { id: treasurerUser.id, email: treasurerUser.email },
    treasurerActor,
    memberUser: { id: memberUser.id, email: memberUser.email },
    memberActor,
    cashAccount: { id: cashAccount.id, name: cashAccount.name },
    bankAccount: { id: bankAccount.id, name: bankAccount.name },
    generalFund: { id: generalFund.id, name: generalFund.name },
    restrictedFund: { id: restrictedFund.id, name: restrictedFund.name },
    unrestrictedIncomeCategory: {
      id: unrestrictedIncomeCategory.id,
      name: unrestrictedIncomeCategory.name,
    },
    unrestrictedExpenseCategory: {
      id: unrestrictedExpenseCategory.id,
      name: unrestrictedExpenseCategory.name,
    },
    restrictedIncomeCategory: {
      id: restrictedIncomeCategory.id,
      name: restrictedIncomeCategory.name,
    },
    restrictedExpenseCategory: {
      id: restrictedExpenseCategory.id,
      name: restrictedExpenseCategory.name,
    },
    cleanup,
  };
}
