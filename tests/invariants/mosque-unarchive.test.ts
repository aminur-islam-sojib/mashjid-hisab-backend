// =============================================================================
// Invariant Tests: Mosque Archive & Unarchive Lifecycle
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import {
  archiveMosque,
  unarchiveMosque,
  getUserMosques,
} from "../../src/modules/mosque/mosque.service.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";

describe("Mosque Archive & Unarchive Suite", () => {
  let fixture: TestTenantFixture;

  before(async () => {
    fixture = await createTestTenantFixture();
  });

  after(async () => {
    if (fixture?.cleanup) {
      await fixture.cleanup();
    }
  });

  it("1. Successfully archives and unarchives a mosque tenant with zero balances", async () => {
    // 1. Initially active
    const initialMosque = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
    });
    assert.ok(initialMosque, "Mosque must exist");
    assert.equal(initialMosque.isArchived, false);

    // 2. Archive the mosque
    const archived = await archiveMosque(fixture.mosqueId);
    assert.equal(archived.isArchived, true);
    assert.ok(archived.archivedAt !== null, "archivedAt must be recorded");

    // 3. Verify getUserMosques excludes it by default
    const activeMosques = await getUserMosques(fixture.adminUser.id);
    const foundInActive = activeMosques.find((m) => m.id === fixture.mosqueId);
    assert.equal(foundInActive, undefined, "Archived mosque must not be in default list");

    // 4. Verify getUserMosques includes it when includeArchived: true
    const allMosques = await getUserMosques(fixture.adminUser.id, {
      includeArchived: true,
    });
    const foundInAll = allMosques.find((m) => m.id === fixture.mosqueId);
    assert.ok(foundInAll, "Archived mosque must be returned with includeArchived: true");
    assert.equal(foundInAll.isArchived, true);

    // 5. Unarchive the mosque
    const unarchived = await unarchiveMosque(fixture.mosqueId);
    assert.equal(unarchived.isArchived, false);
    assert.equal(unarchived.archivedAt, null);

    // 6. Verify database state
    const restoredDb = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
    });
    assert.equal(restoredDb?.isArchived, false);
    assert.equal(restoredDb?.archivedAt, null);

    // 7. Verify getUserMosques now returns it by default
    const activeAgain = await getUserMosques(fixture.adminUser.id);
    const restoredInList = activeAgain.find((m) => m.id === fixture.mosqueId);
    assert.ok(restoredInList, "Restored mosque must appear in active list");
    assert.equal(restoredInList.isArchived, false);
  });

  it("2. Rejects unarchiving a mosque that is already active (MOSQUE_NOT_ARCHIVED)", async () => {
    await assert.rejects(
      async () => {
        await unarchiveMosque(fixture.mosqueId);
      },
      (err: any) => {
        assert.equal(err.code, "MOSQUE_NOT_ARCHIVED");
        return true;
      },
    );
  });

  it("3. Rejects unarchiving a non-existent mosque (MOSQUE_NOT_FOUND)", async () => {
    await assert.rejects(
      async () => {
        await unarchiveMosque("cmv9nonexistentmosqueid999");
      },
      (err: any) => {
        assert.equal(err.code, "MOSQUE_NOT_FOUND");
        return true;
      },
    );
  });
});

