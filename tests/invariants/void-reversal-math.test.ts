// =============================================================================
// Invariant Tests: Void / Reversal Math & Ledger Balance Neutralization
//
// Invariants enforced:
//  1. Atomic Void & Reversal: Voided transactions create an offsetting negative entry.
//  2. Exact Balance Restoration: Account and fund balances return precisely to pre-transaction baseline.
//  3. Ledger Double-Entry Neutralization: The sum of voided original + reversal pair equals 0.
//  4. Double-Void Prevention: Neither voided records nor reversal entries can be re-voided.
//  5. Overdraft Protection: Expenses exceeding available balance are strictly rejected.
//  6. Transaction Immutability: Posted financial fields cannot be modified in-place.
//  7. Archival Protection: Non-zero balances prevent account and fund archival.
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import {
  createDonation,
  voidDonation,
  updateDonation,
} from "../../src/modules/donation/donation.service.js";
import {
  createExpense,
  voidExpense,
  updateExpense,
} from "../../src/modules/expense/expense.service.js";
import {
  createTransfer,
  voidTransfer,
} from "../../src/modules/transfer/transfer.service.js";
import {
  getAccountBalance,
  archiveAccount,
} from "../../src/modules/account/account.service.js";
import {
  getFundBalance,
  archiveFund,
} from "../../src/modules/fund/fund.service.js";
import {
  DonationSource,
  DonationStatus,
  ExpenseStatus,
  TransferStatus,
} from "../../generated/prisma/client.js";
import { HttpError } from "../../src/errors/HttpError.js";

describe("Invariant Suite: Void/Reversal Math & Balance Integrity", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    await fixture.cleanup();
  });

  it("Invariant 2.1: Donation voiding creates an exact negative reversal and zeroes out balance effect", async () => {
    const initialAccountBal = await getAccountBalance(fixture.cashAccount.id);
    const initialFundBal = await getFundBalance(fixture.generalFund.id);

    // 1. Post a donation of 80,000 poisha (800 BDT)
    const donationAmount = 80000n;
    const donation = await createDonation(
      fixture.mosqueId,
      {
        amount: donationAmount,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    assert.equal(donation.status, DonationStatus.POSTED);

    const postDonationAccountBal = await getAccountBalance(fixture.cashAccount.id);
    const postDonationFundBal = await getFundBalance(fixture.generalFund.id);

    assert.equal(
      postDonationAccountBal,
      initialAccountBal + donationAmount,
      "Account balance must increase by exact donation amount",
    );
    assert.equal(
      postDonationFundBal,
      initialFundBal + donationAmount,
      "Fund balance must increase by exact donation amount",
    );

    // 2. Void the donation
    const voidResult = await voidDonation(
      fixture.mosqueId,
      donation.id,
      "Donor entered wrong amount",
      fixture.adminActor,
    );

    // Assert original record state
    assert.equal(
      voidResult.voidedDonation.status,
      DonationStatus.VOIDED,
      "Original donation must be VOIDED",
    );
    assert.ok(voidResult.voidedDonation.voidInfo?.voidedAt);
    assert.equal(
      voidResult.voidedDonation.voidInfo?.voidReason,
      "Donor entered wrong amount",
    );

    // Assert reversal record state
    assert.equal(
      voidResult.reversalEntry.status,
      DonationStatus.POSTED,
      "Reversal entry must be POSTED",
    );
    assert.equal(
      voidResult.reversalEntry.amount,
      (-donationAmount).toString(),
      "Reversal entry must have exact negative amount (-80000)",
    );
    assert.equal(
      voidResult.reversalEntry.reversalOfId,
      donation.id,
      "Reversal entry must link back to original donation",
    );

    // 3. Assert exact balance restoration in ledger
    const postVoidAccountBal = await getAccountBalance(fixture.cashAccount.id);
    const postVoidFundBal = await getFundBalance(fixture.generalFund.id);

    assert.equal(
      postVoidAccountBal,
      initialAccountBal,
      "Account balance must return exactly to pre-donation baseline",
    );
    assert.equal(
      postVoidFundBal,
      initialFundBal,
      "Fund balance must return exactly to pre-donation baseline",
    );

    // 4. Double-void guard: Attempting to void the already-voided donation must fail
    await assert.rejects(
      async () => {
        await voidDonation(
          fixture.mosqueId,
          donation.id,
          "Second void attempt",
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "ALREADY_VOIDED");
        return true;
      },
    );

    // 5. Attempting to void the reversal entry must fail
    await assert.rejects(
      async () => {
        await voidDonation(
          fixture.mosqueId,
          voidResult.reversalEntry.id,
          "Attempt to void reversal",
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "CANNOT_VOID_REVERSAL");
        return true;
      },
    );
  });

  it("Invariant 2.2: Expense voiding creates an exact negative reversal and restores available balance", async () => {
    // 1. Seed account and fund with 100,000 poisha (1,000 BDT)
    const seedDonation = await createDonation(
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
    assert.equal(seedDonation.status, DonationStatus.POSTED);

    const balBeforeExpense = await getAccountBalance(fixture.cashAccount.id);

    // 2. Post an expense of 35,000 poisha (350 BDT)
    const expenseAmount = 35000n;
    const expense = await createExpense(
      fixture.mosqueId,
      {
        amount: expenseAmount,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Hardware Store",
        attachments: ["https://example.com/receipt.jpg"],
      },
      fixture.adminActor,
    );

    assert.equal(expense.status, ExpenseStatus.POSTED);

    const balAfterExpense = await getAccountBalance(fixture.cashAccount.id);
    assert.equal(
      balAfterExpense,
      balBeforeExpense - expenseAmount,
      "Account balance must decrease by exact expense amount",
    );

    // 3. Void the expense
    const voidResult = await voidExpense(
      fixture.mosqueId,
      expense.id,
      "Duplicate receipt recorded in error",
      fixture.adminActor,
    );

    assert.equal(voidResult.voidedExpense.status, ExpenseStatus.VOIDED);
    assert.equal(voidResult.reversalEntry.status, ExpenseStatus.POSTED);
    assert.equal(
      voidResult.reversalEntry.amount,
      (-expenseAmount).toString(),
      "Reversal expense amount must be negative (-35000)",
    );

    // 4. Assert restored balance in ledger
    const balAfterVoid = await getAccountBalance(fixture.cashAccount.id);
    assert.equal(
      balAfterVoid,
      balBeforeExpense,
      "Account balance must be restored exactly to pre-expense amount",
    );

    // 5. Double-void guard
    await assert.rejects(
      async () => {
        await voidExpense(
          fixture.mosqueId,
          expense.id,
          "Second void attempt",
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "ALREADY_VOIDED");
        return true;
      },
    );

    // 6. Cannot void reversal entry
    await assert.rejects(
      async () => {
        await voidExpense(
          fixture.mosqueId,
          voidResult.reversalEntry.id,
          "Attempt to void reversal",
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "CANNOT_VOID_REVERSAL");
        return true;
      },
    );
  });

  it("Invariant 2.3: Transfer voiding restores balances across both source and destination accounts", async () => {
    // Current state: cashAccount has 100,000 poisha; bankAccount has 0 poisha
    const cashBefore = await getAccountBalance(fixture.cashAccount.id);
    const bankBefore = await getAccountBalance(fixture.bankAccount.id);
    const transferAmount = 40000n;

    // 1. Execute transfer of 40,000 poisha from cash to bank
    const transfer = await createTransfer(
      fixture.mosqueId,
      {
        amount: transferAmount,
        fromAccountId: fixture.cashAccount.id,
        toAccountId: fixture.bankAccount.id,
        fromFundId: fixture.generalFund.id,
        toFundId: fixture.generalFund.id,
        date: new Date(),
        notes: "Move cash to bank",
      },
      fixture.adminActor,
    );

    const cashAfterTransfer = await getAccountBalance(fixture.cashAccount.id);
    const bankAfterTransfer = await getAccountBalance(fixture.bankAccount.id);

    assert.equal(cashAfterTransfer, cashBefore - transferAmount);
    assert.equal(bankAfterTransfer, bankBefore + transferAmount);

    // 2. Void the transfer
    const voidResult = await voidTransfer(
      fixture.mosqueId,
      transfer.fromLeg.id,
      "Transfer entered against wrong bank account",
      fixture.adminActor,
    );

    assert.equal(voidResult.voidedTransfer.fromLeg.status, TransferStatus.VOIDED);
    assert.equal(voidResult.voidedTransfer.toLeg.status, TransferStatus.VOIDED);
    assert.equal(voidResult.reversalTransfer.fromLeg.status, TransferStatus.POSTED);
    assert.equal(voidResult.reversalTransfer.toLeg.status, TransferStatus.POSTED);

    // 3. Verify exact balance restoration across both accounts
    const cashRestored = await getAccountBalance(fixture.cashAccount.id);
    const bankRestored = await getAccountBalance(fixture.bankAccount.id);

    assert.equal(cashRestored, cashBefore, "Source account balance must be fully restored");
    assert.equal(bankRestored, bankBefore, "Destination account balance must be fully restored");

    // 4. Double void guard
    await assert.rejects(
      async () => {
        await voidTransfer(
          fixture.mosqueId,
          transfer.fromLeg.id,
          "Second void attempt",
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "ALREADY_VOIDED");
        return true;
      },
    );
  });

  it("Invariant 2.4: Overdraft protection rejects expenses exceeding available balance and restores capability after void", async () => {
    const available = await getAccountBalance(fixture.cashAccount.id);
    assert.ok(available > 0n, "Account must have positive available balance");

    // 1. Attempting an expense greater than available balance must fail
    const excessiveAmount = available + 50000n;
    await assert.rejects(
      async () => {
        await createExpense(
          fixture.mosqueId,
          {
            amount: excessiveAmount,
            accountId: fixture.cashAccount.id,
            fundId: fixture.generalFund.id,
            categoryId: fixture.unrestrictedExpenseCategory.id,
            date: new Date(),
            payee: "Major Contractor",
            attachments: ["https://example.com/invoice.jpg"],
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "INSUFFICIENT_ACCOUNT_BALANCE");
        return true;
      },
    );

    // 2. Spending the EXACT available balance must succeed
    const drainExpense = await createExpense(
      fixture.mosqueId,
      {
        amount: available,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Full Balance Contractor",
        attachments: ["https://example.com/invoice.jpg"],
      },
      fixture.adminActor,
    );

    assert.equal(drainExpense.status, ExpenseStatus.POSTED);
    const balanceNow = await getAccountBalance(fixture.cashAccount.id);
    assert.equal(balanceNow, 0n, "Balance should now be zero");

    // 3. Any further expense attempt must fail
    await assert.rejects(
      async () => {
        await createExpense(
          fixture.mosqueId,
          {
            amount: 100n,
            accountId: fixture.cashAccount.id,
            fundId: fixture.generalFund.id,
            categoryId: fixture.unrestrictedExpenseCategory.id,
            date: new Date(),
            payee: "Small Expense",
            attachments: ["https://example.com/receipt.jpg"],
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "INSUFFICIENT_ACCOUNT_BALANCE");
        return true;
      },
    );

    // 4. Voiding the draining expense restores the funds
    await voidExpense(
      fixture.mosqueId,
      drainExpense.id,
      "Cancelled contractor contract",
      fixture.adminActor,
    );

    const restoredBal = await getAccountBalance(fixture.cashAccount.id);
    assert.equal(restoredBal, available, "Balance must be fully restored after void");

    // 5. Subsequent valid expense succeeds now
    const validExpense = await createExpense(
      fixture.mosqueId,
      {
        amount: 1000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedExpenseCategory.id,
        date: new Date(),
        payee: "Authorized Expense",
        attachments: ["https://example.com/receipt.jpg"],
      },
      fixture.adminActor,
    );
    assert.equal(validExpense.status, ExpenseStatus.POSTED);
  });

  it("Invariant 2.5: Immutability of posted and voided financial records", async () => {
    const donation = await createDonation(
      fixture.mosqueId,
      {
        amount: 10000n,
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date(),
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    // Updating non-financial fields (notes, donorName) is permitted
    const updated = await updateDonation(
      fixture.mosqueId,
      donation.id,
      { notes: "Updated note" },
      fixture.adminActor,
    );
    assert.equal(updated.notes, "Updated note");

    // Void the donation
    await voidDonation(fixture.mosqueId, donation.id, "Audit freeze test", fixture.adminActor);

    // Updating any field on a voided donation must be strictly rejected
    await assert.rejects(
      async () => {
        await updateDonation(
          fixture.mosqueId,
          donation.id,
          { notes: "Trying to edit voided record" },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "DONATION_VOIDED");
        return true;
      },
    );
  });

  it("Invariant 2.6: Archival protection guards accounts and funds from deletion while holding non-zero balance", async () => {
    const accountBal = await getAccountBalance(fixture.cashAccount.id);
    assert.ok(accountBal > 0n, "Account must hold non-zero balance for this test");

    // 1. Attempting to archive an account with non-zero balance must be blocked
    await assert.rejects(
      async () => {
        await archiveAccount(fixture.mosqueId, fixture.cashAccount.id);
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "ACCOUNT_ARCHIVE_BLOCKED_NON_ZERO_BALANCE");
        return true;
      },
    );

    // 2. Attempting to archive a fund with non-zero balance must be blocked
    const fundBal = await getFundBalance(fixture.generalFund.id);
    assert.ok(fundBal > 0n, "Fund must hold non-zero balance for this test");

    await assert.rejects(
      async () => {
        await archiveFund(fixture.mosqueId, fixture.generalFund.id);
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "FUND_ARCHIVE_BLOCKED_NON_ZERO_BALANCE");
        return true;
      },
    );
  });
});

