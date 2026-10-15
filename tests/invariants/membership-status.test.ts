// =============================================================================
// Invariant Tests: Membership Status & Suspension Lifecycle
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  Role,
  MembershipStatus,
} from "../../generated/prisma/client.js";
import {
  validateUpdateMembershipInput,
  validateGetMosqueMembersQuery,
} from "../../src/modules/membership/membership.validation.js";
import {
  updateMembership,
} from "../../src/modules/mosque/mosque.service.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";

describe("Membership Status & Suspension Suite", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    if (fixture?.cleanup) {
      await fixture.cleanup();
    }
  });

  it("1. validateUpdateMembershipInput accepts SUSPENDED and normalizes INACTIVE", () => {
    const validSuspended = validateUpdateMembershipInput({ status: "SUSPENDED" });
    assert.equal(validSuspended.status, MembershipStatus.SUSPENDED);

    const normalizedInactive = validateUpdateMembershipInput({ status: "INACTIVE" });
    assert.equal(normalizedInactive.status, MembershipStatus.SUSPENDED);

    const validActive = validateUpdateMembershipInput({ status: "ACTIVE" });
    assert.equal(validActive.status, MembershipStatus.ACTIVE);

    assert.throws(
      () => validateUpdateMembershipInput({ status: "INVALID_STATUS_XYZ" }),
      (err: any) => {
        assert.equal(err.message, "One or more fields are invalid.");
        assert.ok(err.details?.some((d: any) => /Invalid status/.test(d.issue)));
        return true;
      },
    );
  });

  it("2. validateGetMosqueMembersQuery normalizes INACTIVE to SUSPENDED", () => {
    const query = validateGetMosqueMembersQuery({ status: "INACTIVE" });
    assert.equal(query.status, MembershipStatus.SUSPENDED);

    const querySuspended = validateGetMosqueMembersQuery({ status: "SUSPENDED" });
    assert.equal(querySuspended.status, MembershipStatus.SUSPENDED);
  });

  it("3. Admin can suspend and reactivate a mosque member", async () => {
    // Find the member membership
    const memberRecord = await prisma.membership.findFirst({
      where: {
        mosqueId: fixture.mosqueId,
        userId: fixture.memberUser.id,
      },
    });
    assert.ok(memberRecord, "Member record must exist");
    assert.equal(memberRecord.status, MembershipStatus.ACTIVE);

    // 1. Suspend the member
    const suspended = await updateMembership(fixture.mosqueId, memberRecord.id, {
      status: MembershipStatus.SUSPENDED,
    });
    assert.equal(suspended.status, MembershipStatus.SUSPENDED);

    const dbAfterSuspended = await prisma.membership.findUnique({
      where: { id: memberRecord.id },
    });
    assert.equal(dbAfterSuspended?.status, MembershipStatus.SUSPENDED);

    // 2. Reactivate the member
    const reactivated = await updateMembership(fixture.mosqueId, memberRecord.id, {
      status: MembershipStatus.ACTIVE,
    });
    assert.equal(reactivated.status, MembershipStatus.ACTIVE);

    const dbAfterReactivated = await prisma.membership.findUnique({
      where: { id: memberRecord.id },
    });
    assert.equal(dbAfterReactivated?.status, MembershipStatus.ACTIVE);
  });
});

