// =============================================================================
// Invariant Tests: Restricted Fund Shariah & Accounting Rules
//
// Invariants enforced:
//  1. Restricted funds (e.g. Zakat, Waqf) REQUIRE explicitly allocated categories.
//  2. Categories allocated to Fund A cannot be used with Fund B.
//  3. Transfers OUT of restricted funds are strictly forbidden by Shariah policy.
//  4. Unrestricted funds operate seamlessly with unallocated general categories.
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import { createDonation } from "../../src/modules/donation/donation.service.js";
import { createExpense } from "../../src/modules/expense/expense.service.js";
import { createTransfer } from "../../src/modules/transfer/transfer.service.js";
import { DonationSource } from "../../generated/prisma/client.js";
import { HttpError } from "../../src/errors/HttpError.js";

describe("Invariant Suite: Restricted Funds & Category Locking", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    await fixture.cleanup();
  });

  it("Invariant 1.1: Recording a donation to a restricted fund using an unrestricted category must fail with RESTRICTED_FUND_CATEGORY_MISMATCH", async () => {
    await assert.rejects(
      async () => {
        await createDonation(
          fixture.mosqueId,
          {
            amount: 50000n, // 500 BDT
            accountId: fixture.cashAccount.id,
            fundId: fixture.restrictedFund.id, // RESTRICTED FUND (Zakat)
            categoryId: fixture.unrestrictedIncomeCategory.id, // UNRESTRICTED CATEGORY (fundId = null)
            date: new Date(),
            source: DonationSource.CASH_BOX,
            isAnonymousPublic: false,
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError, "Error must be an instance of HttpError");
        assert.equal(err.statusCode, 400, "Must return HTTP 400 Bad Request");
        assert.equal(
          err.code,
          "RESTRICTED_FUND_CATEGORY_MISMATCH",
          "Must throw RESTRICTED_FUND_CATEGORY_MISMATCH error code",
        );
        return true;
      },
    );
  });

  it("Invariant 1.2: Recording a donation to a restricted fund using its dedicated category must succeed", async () => {
    const donation = await createDonation(
      fixture.mosqueId,
      {
        amount: 50000n, // 500 BDT
        accountId: fixture.cashAccount.id,
        fundId: fixture.restrictedFund.id, // RESTRICTED FUND
        categoryId: fixture.restrictedIncomeCategory.id, // LOCKED TO THIS RESTRICTED FUND
        date: new Date(),
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    assert.ok(donation.id, "Donation record must be generated");
    assert.equal(donation.fundId, fixture.restrictedFund.id);
    assert.equal(donation.categoryId, fixture.restrictedIncomeCategory.id);
    assert.equal(donation.status, "POSTED");
  });

  it("Invariant 1.3: Recording a donation using a category locked to Fund A against Fund B must fail with CATEGORY_FUND_MISMATCH", async () => {
    await assert.rejects(
      async () => {
        await createDonation(
          fixture.mosqueId,
          {
            amount: 30000n,
            accountId: fixture.cashAccount.id,
            fundId: fixture.generalFund.id, // FUND B (General)
            categoryId: fixture.restrictedIncomeCategory.id, // LOCKED TO FUND A (Zakat)
            date: new Date(),
            source: DonationSource.CASH_BOX,
            isAnonymousPublic: false,
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError, "Error must be an instance of HttpError");
        assert.equal(err.statusCode, 400);
        assert.equal(
          err.code,
          "CATEGORY_FUND_MISMATCH",
          "Must reject mismatched category-to-fund allocation",
        );
        return true;
      },
    );
  });

  it("Invariant 1.4: Recording a donation to an unrestricted fund with an unrestricted category must succeed", async () => {
    const donation = await createDonation(
      fixture.mosqueId,
      {
        amount: 100000n, // 1,000 BDT
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id, // UNRESTRICTED FUND
        categoryId: fixture.unrestrictedIncomeCategory.id, // UNRESTRICTED CATEGORY
        date: new Date(),
        source: DonationSource.CASH_BOX,
        isAnonymousPublic: false,
      },
      fixture.adminActor,
    );

    assert.ok(donation.id);
    assert.equal(donation.fundId, fixture.generalFund.id);
    assert.equal(donation.status, "POSTED");
  });

  it("Invariant 1.5: Recording an expense from a restricted fund with an unrestricted category must fail with RESTRICTED_FUND_CATEGORY_MISMATCH", async () => {
    await assert.rejects(
      async () => {
        await createExpense(
          fixture.mosqueId,
          {
            amount: 10000n,
            accountId: fixture.cashAccount.id,
            fundId: fixture.restrictedFund.id, // RESTRICTED FUND
            categoryId: fixture.unrestrictedExpenseCategory.id, // UNRESTRICTED CATEGORY
            date: new Date(),
            payee: "Vendor Name",
            attachments: ["https://example.com/receipt.jpg"],
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "RESTRICTED_FUND_CATEGORY_MISMATCH");
        return true;
      },
    );
  });

  it("Invariant 1.6: Recording an expense from a restricted fund with its dedicated category must succeed when funds are available", async () => {
    // We already deposited 50,000 poisha into restrictedFund in test 1.2
    const expense = await createExpense(
      fixture.mosqueId,
      {
        amount: 20000n, // 200 BDT <= 500 BDT available
        accountId: fixture.cashAccount.id,
        fundId: fixture.restrictedFund.id,
        categoryId: fixture.restrictedExpenseCategory.id, // DEDICATED RESTRICTED CATEGORY
        date: new Date(),
        payee: "Eligible Zakat Recipient",
        attachments: ["https://example.com/voucher.jpg"],
      },
      fixture.adminActor,
    );

    assert.ok(expense.id);
    assert.equal(expense.fundId, fixture.restrictedFund.id);
    assert.equal(expense.status, "POSTED");
  });

  it("Invariant 1.7: Fund-to-fund transfer OUT of a restricted fund must be strictly blocked with RESTRICTED_FUND_TRANSFER_BLOCKED", async () => {
    await assert.rejects(
      async () => {
        await createTransfer(
          fixture.mosqueId,
          {
            amount: 10000n,
            fromAccountId: fixture.cashAccount.id,
            toAccountId: fixture.bankAccount.id,
            fromFundId: fixture.restrictedFund.id, // RESTRICTED SOURCE FUND
            toFundId: fixture.generalFund.id, // DESTINATION FUND
            date: new Date(),
            reason: "Attempting to divert zakat to general fund",
          },
          fixture.adminActor,
        );
      },
      (err: unknown) => {
        assert(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        assert.equal(
          err.code,
          "RESTRICTED_FUND_TRANSFER_BLOCKED",
          "Must block transfers out of restricted funds",
        );
        return true;
      },
    );
  });

  it("Invariant 1.8: Account-to-account transfer within an unrestricted fund must succeed", async () => {
    // Current general fund has 100,000 poisha in cashAccount from test 1.4
    const transfer = await createTransfer(
      fixture.mosqueId,
      {
        amount: 25000n, // 250 BDT
        fromAccountId: fixture.cashAccount.id,
        toAccountId: fixture.bankAccount.id,
        fromFundId: fixture.generalFund.id,
        toFundId: fixture.generalFund.id,
        date: new Date(),
        notes: "Deposit cash to bank",
      },
      fixture.adminActor,
    );

    assert.ok(transfer.fromLeg.id);
    assert.ok(transfer.toLeg.id);
    assert.equal(transfer.fromLeg.status, "POSTED");
    assert.equal(transfer.toLeg.status, "POSTED");
    assert.equal(transfer.isFundTransfer, false);
  });
});

