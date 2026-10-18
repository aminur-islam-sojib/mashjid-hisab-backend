// =============================================================================
// Invariant Tests: Family & Family Member Management (Admin Assignment & Gender Constraints)
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  Role,
  MembershipStatus,
  FamilyRelation,
} from "../../generated/prisma/client.js";
import {
  validateCreateFamilyInput,
  validateCreateFamilyMemberInput,
  validateUpdateFamilyMemberInput,
} from "../../src/modules/family/family.validation.js";
import {
  createFamily,
  getFamilyByMembership,
  addFamilyMemberByMembership,
  addFamilyMember,
} from "../../src/modules/family/family.service.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";

describe("Family & Family Member Invariant Suite", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    if (fixture?.cleanup) {
      await fixture.cleanup();
    }
  });

  describe("Validation Invariants: Gender & Head Assignment", () => {
    it("1. validateCreateFamilyMemberInput strictly enforces Male and Female only", () => {
      // Valid Male inputs
      const male1 = validateCreateFamilyMemberInput({
        name: "Rahim",
        relation: "SON",
        gender: "Male",
      });
      assert.equal(male1.gender, "Male");

      const male2 = validateCreateFamilyMemberInput({
        name: "Rahim",
        relation: "SON",
        gender: "male",
      });
      assert.equal(male2.gender, "Male");

      // Valid Female inputs
      const female1 = validateCreateFamilyMemberInput({
        name: "Fatima",
        relation: "DAUGHTER",
        gender: "Female",
      });
      assert.equal(female1.gender, "Female");

      const female2 = validateCreateFamilyMemberInput({
        name: "Fatima",
        relation: "DAUGHTER",
        gender: "female",
      });
      assert.equal(female2.gender, "Female");

      // Optional - undefined/null/empty
      const noGender = validateCreateFamilyMemberInput({
        name: "Baby",
        relation: "OTHER",
      });
      assert.equal(noGender.gender, undefined);

      // Rejects "Other", "Non-binary", or arbitrary strings with 422 validation issue
      assert.throws(
        () =>
          validateCreateFamilyMemberInput({
            name: "Child",
            relation: "SON",
            gender: "Other",
          }),
        (err: any) => {
          assert.equal(err.statusCode, 422);
          assert.ok(
            err.details?.some(
              (d: any) =>
                d.field === "gender" &&
                d.issue === "Gender must be either 'Male' or 'Female'.",
            ),
          );
          return true;
        },
      );
    });

    it("2. validateUpdateFamilyMemberInput enforces Male and Female or null to clear", () => {
      const updatedMale = validateUpdateFamilyMemberInput({ gender: "male" });
      assert.equal(updatedMale.gender, "Male");

      const updatedFemale = validateUpdateFamilyMemberInput({ gender: "Female" });
      assert.equal(updatedFemale.gender, "Female");

      const clearedGender = validateUpdateFamilyMemberInput({ gender: null });
      assert.equal(clearedGender.gender, null);

      assert.throws(
        () => validateUpdateFamilyMemberInput({ gender: "Other" }),
        (err: any) => {
          assert.equal(err.statusCode, 422);
          assert.ok(
            err.details?.some(
              (d: any) =>
                d.field === "gender" &&
                d.issue === "Gender must be either 'Male' or 'Female'.",
            ),
          );
          return true;
        },
      );
    });

    it("3. validateCreateFamilyInput supports optional headMembershipId", () => {
      const withHead = validateCreateFamilyInput({
        name: "Khan Family",
        headMembershipId: "mem_12345",
      });
      assert.equal(withHead.headMembershipId, "mem_12345");

      const withoutHead = validateCreateFamilyInput({
        name: "Khan Family",
      });
      assert.equal(withoutHead.headMembershipId, undefined);

      assert.throws(
        () =>
          validateCreateFamilyInput({
            name: "Khan Family",
            headMembershipId: "   ",
          }),
        (err: any) => {
          assert.equal(err.statusCode, 422);
          assert.ok(
            err.details?.some((d: any) => d.field === "headMembershipId"),
          );
          return true;
        },
      );
    });
  });

  describe("Service & Database Invariants: Admin Management & Auto-Provisioning", () => {
    it("4. Non-admin member cannot create family with a different headMembershipId", async () => {
      const memberMembership = await prisma.membership.findFirstOrThrow({
        where: { id: fixture.memberActor.membershipId },
      });

      await assert.rejects(
        async () => {
          await createFamily(fixture.mosqueId, memberMembership, {
            name: "Unauthorized Family",
            headMembershipId: fixture.adminActor.membershipId,
          });
        },
        (err: any) => {
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, "FORBIDDEN_HEAD_ASSIGNMENT");
          return true;
        },
      );
    });

    it("5. Admin can create family assigning another mosque member as head", async () => {
      const adminMembership = await prisma.membership.findFirstOrThrow({
        where: { id: fixture.adminActor.membershipId },
      });

      const family = await createFamily(fixture.mosqueId, adminMembership, {
        name: "Member Household",
        address: "House 10, Road 4",
        headMembershipId: fixture.memberActor.membershipId,
      });

      assert.ok(family.id);
      assert.equal(family.name, "Member Household");
      assert.equal(family.headMembershipId, fixture.memberActor.membershipId);

      // Verify one family per membership invariant
      await assert.rejects(
        async () => {
          await createFamily(fixture.mosqueId, adminMembership, {
            name: "Duplicate Household",
            headMembershipId: fixture.memberActor.membershipId,
          });
        },
        (err: any) => {
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, "FAMILY_ALREADY_EXISTS");
          return true;
        },
      );
    });

    it("6. Admin can add family member with strictly Male or Female gender", async () => {
      const adminMembership = await prisma.membership.findFirstOrThrow({
        where: { id: fixture.adminActor.membershipId },
      });

      const memberFamily = await prisma.family.findFirstOrThrow({
        where: { headMembershipId: fixture.memberActor.membershipId },
      });

      const child = await addFamilyMember(
        fixture.mosqueId,
        memberFamily.id,
        adminMembership,
        {
          name: "Ayesha",
          relation: FamilyRelation.DAUGHTER,
          gender: "Female",
        },
      );

      assert.equal(child.name, "Ayesha");
      assert.equal(child.gender, "Female");
      assert.equal(child.relation, FamilyRelation.DAUGHTER);
    });

    it("7. addFamilyMemberByMembership auto-provisions Family household if none exists", async () => {
      // Create a new member without a family
      const newUser = await prisma.user.create({
        data: {
          name: "Tariq Ahmed",
          email: `tariq-${Date.now()}@example.com`,
          passwordHash: "hash",
          status: "ACTIVE",
        },
      });

      const newMembership = await prisma.membership.create({
        data: {
          userId: newUser.id,
          mosqueId: fixture.mosqueId,
          role: Role.MEMBER,
          status: MembershipStatus.ACTIVE,
        },
      });

      const adminMembership = await prisma.membership.findFirstOrThrow({
        where: { id: fixture.adminActor.membershipId },
      });

      // Admin directly adds family member for this user
      const son = await addFamilyMemberByMembership(
        fixture.mosqueId,
        newMembership.id,
        adminMembership,
        {
          name: "Bilal",
          relation: FamilyRelation.SON,
          gender: "Male",
        },
      );

      assert.ok(son.id);
      assert.equal(son.name, "Bilal");
      assert.equal(son.gender, "Male");

      // Household should have been automatically created
      const family = await getFamilyByMembership(
        fixture.mosqueId,
        newMembership.id,
        adminMembership,
      );

      assert.ok(family);
      assert.equal(family.name, "Tariq Ahmed's Family");
      assert.equal(family.headMembershipId, newMembership.id);
      assert.equal(family.members.length, 1);
      assert.equal(family.members[0].name, "Bilal");
    });
  });
});

