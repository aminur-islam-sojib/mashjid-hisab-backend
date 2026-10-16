// =============================================================================
// Invariant Tests: Mosque Archive Super Admin Gating & Request Workflow
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import { Role, UserStatus } from "../../generated/prisma/client.js";
import { requireSuperAdmin } from "../../src/middlewares/auth.middleware.js";
import {
  archiveMosque,
  unarchiveMosque,
  requestMosqueArchive,
  cancelMosqueArchiveRequest,
  rejectMosqueArchiveRequest,
  getPendingArchiveRequests,
} from "../../src/modules/mosque/mosque.service.js";
import {
  createTestTenantFixture,
  type TestTenantFixture,
} from "../helpers/test-factory.js";

describe("Mosque Archive Super Admin Gating & Request Workflow", () => {
  let fixture: TestTenantFixture;
  let superAdminUser: { id: string; email: string | null };

  before(async () => {
    fixture = await createTestTenantFixture();

    const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    superAdminUser = await prisma.user.create({
      data: {
        email: `superadmin-${nonce}@example.com`,
        passwordHash: "dummyhash",
        status: UserStatus.ACTIVE,
        role: Role.SUPER_ADMIN,
        name: `Super Admin ${nonce}`,
      },
      select: { id: true, email: true },
    });
  });

  after(async () => {
    if (superAdminUser?.id) {
      await prisma.user.delete({ where: { id: superAdminUser.id } }).catch(() => {});
    }
    if (fixture?.cleanup) {
      await fixture.cleanup();
    }
  });

  it("1. requireSuperAdmin blocks non-super-admin (403 FORBIDDEN_SUPER_ADMIN_REQUIRED)", async () => {
    const fakeReq: any = {
      user: { sub: fixture.adminUser.id },
    };
    const fakeRes: any = {};
    let nextCalled = false;
    let caughtError: any = null;

    await requireSuperAdmin(fakeReq, fakeRes, (err?: any) => {
      if (err) {
        caughtError = err;
      } else {
        nextCalled = true;
      }
    });

    assert.equal(nextCalled, false, "Must not call next() for non-super-admin");
    assert.ok(caughtError, "Must return an error");
    assert.equal(caughtError.code, "FORBIDDEN_SUPER_ADMIN_REQUIRED");
    assert.equal(caughtError.statusCode, 403);
  });

  it("2. requireSuperAdmin allows platform SUPER_ADMIN", async () => {
    const fakeReq: any = {
      user: { sub: superAdminUser.id },
    };
    const fakeRes: any = {};
    let nextCalled = false;
    let caughtError: any = null;

    await requireSuperAdmin(fakeReq, fakeRes, (err?: any) => {
      if (err) {
        caughtError = err;
      } else {
        nextCalled = true;
      }
    });

    assert.equal(caughtError, null, "Must not return an error for SUPER_ADMIN");
    assert.equal(nextCalled, true, "Must call next() for SUPER_ADMIN");
  });

  it("3. Admin can submit an archive request with reason and view in pending list", async () => {
    const result = await requestMosqueArchive(
      fixture.mosqueId,
      fixture.adminUser.id,
      "Relocating community to a larger premises.",
    );

    assert.equal(result.success, true);
    assert.equal(result.mosqueId, fixture.mosqueId);
    assert.equal(result.archiveRequestReason, "Relocating community to a larger premises.");

    // Verify DB state
    const mosqueDb = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
      select: { archiveRequested: true, archiveRequestReason: true, archiveRequestedById: true },
    });
    assert.equal(mosqueDb?.archiveRequested, true);
    assert.equal(mosqueDb?.archiveRequestReason, "Relocating community to a larger premises.");
    assert.equal(mosqueDb?.archiveRequestedById, fixture.adminUser.id);

    // Verify getPendingArchiveRequests includes this mosque with requester info
    const pendingList = await getPendingArchiveRequests();
    const found = pendingList.find((p) => p.id === fixture.mosqueId);
    assert.ok(found, "Pending list must contain the requested mosque");
    assert.equal(found.archiveRequestReason, "Relocating community to a larger premises.");
    assert.equal(found.requester?.id, fixture.adminUser.id);
  });

  it("4. Blocks duplicate archive request when already pending (400 MOSQUE_ARCHIVE_REQUEST_ALREADY_PENDING)", async () => {
    await assert.rejects(
      async () => {
        await requestMosqueArchive(fixture.mosqueId, fixture.adminUser.id, "Second request");
      },
      (err: any) => {
        assert.equal(err.code, "MOSQUE_ARCHIVE_REQUEST_ALREADY_PENDING");
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });

  it("5. Admin can cancel a pending archive request", async () => {
    const cancelResult = await cancelMosqueArchiveRequest(fixture.mosqueId, fixture.adminUser.id);
    assert.equal(cancelResult.success, true);

    const mosqueDb = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
      select: { archiveRequested: true, archiveRequestReason: true, archiveRequestedById: true },
    });
    assert.equal(mosqueDb?.archiveRequested, false);
    assert.equal(mosqueDb?.archiveRequestReason, null);
    assert.equal(mosqueDb?.archiveRequestedById, null);

    // Further cancel should fail
    await assert.rejects(
      async () => {
        await cancelMosqueArchiveRequest(fixture.mosqueId, fixture.adminUser.id);
      },
      (err: any) => {
        assert.equal(err.code, "NO_PENDING_ARCHIVE_REQUEST");
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });

  it("6. Super admin can reject an archive request", async () => {
    // Request again
    await requestMosqueArchive(fixture.mosqueId, fixture.adminUser.id, "To be rejected");

    const rejectResult = await rejectMosqueArchiveRequest(fixture.mosqueId);
    assert.equal(rejectResult.success, true);

    const mosqueDb = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
      select: { archiveRequested: true },
    });
    assert.equal(mosqueDb?.archiveRequested, false);
  });

  it("7. Super admin archiving resets pending archive request flags", async () => {
    // Request again
    await requestMosqueArchive(fixture.mosqueId, fixture.adminUser.id, "Ready to archive");

    // Execute archive
    const archived = await archiveMosque(fixture.mosqueId);
    assert.equal(archived.isArchived, true);

    // Verify flags are cleared in DB
    const mosqueDb = await prisma.mosque.findUnique({
      where: { id: fixture.mosqueId },
      select: { isArchived: true, archiveRequested: true, archiveRequestReason: true },
    });
    assert.equal(mosqueDb?.isArchived, true);
    assert.equal(mosqueDb?.archiveRequested, false);
    assert.equal(mosqueDb?.archiveRequestReason, null);

    // Unarchive to restore
    const unarchived = await unarchiveMosque(fixture.mosqueId);
    assert.equal(unarchived.isArchived, false);
  });
});

