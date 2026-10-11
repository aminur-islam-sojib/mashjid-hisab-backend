// =============================================================================
// Invariant Tests: Idempotency & Double-Submit Protection (T03)
//
// Invariants enforced:
//  1. Replaying an identical request with the same Idempotency-Key returns the
//     cached response with `Idempotent-Replayed: true` and creates only 1 DB record.
//  2. Sending the same Idempotency-Key with a different payload returns
//     409 Conflict with code IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
//  3. An in-flight concurrent request with the same key returns
//     409 Conflict with code IDEMPOTENCY_IN_FLIGHT.
//  4. Different Idempotency-Keys create distinct records.
//  5. Requests without Idempotency-Key succeed normally.
//  6. Key order in JSON payload does not cause false-positive payload mismatch
//     (canonical JSON sorting invariant).
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { Role, IdempotencyStatus } from "../../generated/prisma/client.js";
import { createTestTenantFixture, type TestTenantFixture } from "../helpers/test-factory.js";
import { signAccessToken } from "../../src/utils/token.js";
import {
  canonicalJsonStringify,
  computeRequestHash,
} from "../../src/middlewares/idempotency.middleware.js";

describe("Invariant Suite: Idempotency & Double-Submit Protection (T03)", () => {
  let fixture: TestTenantFixture;
  let server: Server;
  let baseUrl: string;
  let adminToken: string;

  before(async () => {
    fixture = await createTestTenantFixture();

    // Start ephemeral HTTP server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });

    // Create admin auth token
    adminToken = signAccessToken({
      sub: fixture.adminUser.id,
      mosqueId: fixture.mosqueId,
      role: Role.MOSQUE_ADMIN,
      sessionVersion: 1,
      mustChangePassword: false,
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Clean up any test idempotency keys
    await prisma.idempotencyKey.deleteMany({
      where: { mosqueId: fixture.mosqueId },
    });
    await fixture.cleanup();
  });

  it("Invariant 3.1: Canonical JSON stringification produces deterministic output regardless of key order", () => {
    const payloadA = { b: 2, a: 1, nested: { y: "hello", x: "world" } };
    const payloadB = { a: 1, b: 2, nested: { x: "world", y: "hello" } };

    const strA = canonicalJsonStringify(payloadA);
    const strB = canonicalJsonStringify(payloadB);
    assert.equal(strA, strB);

    const hashA = computeRequestHash(payloadA);
    const hashB = computeRequestHash(payloadB);
    assert.equal(hashA, hashB);
  });

  it("Invariant 3.2: Replaying identical donation creation returns cached response with Idempotent-Replayed: true and creates only 1 record", async () => {
    const key = `test-donation-${Date.now()}`;
    const payload = {
      amount: "50000", // ৳500.00
      accountId: fixture.cashAccount.id,
      fundId: fixture.generalFund.id,
      categoryId: fixture.unrestrictedIncomeCategory.id,
      date: new Date().toISOString(),
      source: "MEMBER",
      notes: "First test donation",
    };

    // First request
    const res1 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res1.status, 201);
    assert.equal(res1.headers.get("Idempotent-Replayed"), null);
    const data1 = (await res1.json()) as any;
    assert.ok(data1.data?.id);
    const createdId = data1.data.id;

    // Small delay to allow async response persistence to complete
    await new Promise((r) => setTimeout(r, 100));

    // Verify key status in DB is RESOLVED
    const keyRecord = await prisma.idempotencyKey.findUnique({
      where: {
        mosqueId_userId_key: {
          mosqueId: fixture.mosqueId,
          userId: fixture.adminUser.id,
          key,
        },
      },
    });
    assert.ok(keyRecord);
    assert.equal(keyRecord.status, IdempotencyStatus.RESOLVED);

    // Second request: same key, same payload (with differently ordered object keys)
    const payloadReordered = {
      notes: "First test donation",
      source: "MEMBER",
      date: payload.date,
      categoryId: fixture.unrestrictedIncomeCategory.id,
      fundId: fixture.generalFund.id,
      accountId: fixture.cashAccount.id,
      amount: "50000",
    };

    const res2 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payloadReordered),
    });

    assert.equal(res2.status, 201);
    assert.equal(res2.headers.get("Idempotent-Replayed"), "true");
    const data2 = (await res2.json()) as any;
    assert.equal(data2.data?.id, createdId);

    // Verify exactly ONE donation exists with this note
    const donations = await prisma.donation.findMany({
      where: {
        mosqueId: fixture.mosqueId,
        notes: "First test donation",
      },
    });
    assert.equal(donations.length, 1);
  });

  it("Invariant 3.3: Reusing Idempotency-Key with different payload throws 409 Conflict IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", async () => {
    const key = `test-mismatch-${Date.now()}`;
    const payloadA = {
      amount: "25000",
      accountId: fixture.cashAccount.id,
      fundId: fixture.generalFund.id,
      categoryId: fixture.unrestrictedIncomeCategory.id,
      date: new Date().toISOString(),
      source: "MEMBER",
      notes: "Original payload",
    };

    // First request
    const res1 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payloadA),
    });
    assert.equal(res1.status, 201);

    await new Promise((r) => setTimeout(r, 100));

    // Second request with altered payload
    const payloadB = {
      ...payloadA,
      amount: "99999", // Different amount
      notes: "Tampered payload",
    };

    const res2 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payloadB),
    });

    assert.equal(res2.status, 409);
    const errorData = (await res2.json()) as any;
    assert.equal(errorData.error?.code, "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  });

  it("Invariant 3.4: In-flight concurrent request with the same Idempotency-Key throws 409 Conflict IDEMPOTENCY_IN_FLIGHT", async () => {
    const key = `test-inflight-${Date.now()}`;

    // Simulate an in-flight locked key
    await prisma.idempotencyKey.create({
      data: {
        mosqueId: fixture.mosqueId,
        userId: fixture.adminUser.id,
        key,
        requestPath: `/api/mosques/${fixture.mosqueId}/donations`,
        requestMethod: "POST",
        requestHash: "some-hash",
        status: IdempotencyStatus.PROCESSING,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const res = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        amount: "10000",
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date().toISOString(),
        source: "MEMBER",
      }),
    });

    assert.equal(res.status, 409);
    const errorData = (await res.json()) as any;
    assert.equal(errorData.error?.code, "IDEMPOTENCY_IN_FLIGHT");
  });

  it("Invariant 3.5: Different Idempotency-Keys create distinct records", async () => {
    const key1 = `test-distinct-1-${Date.now()}`;
    const key2 = `test-distinct-2-${Date.now()}`;

    const makePayload = (note: string) => ({
      amount: "15000",
      accountId: fixture.cashAccount.id,
      fundId: fixture.generalFund.id,
      categoryId: fixture.unrestrictedIncomeCategory.id,
      date: new Date().toISOString(),
      source: "MEMBER",
      notes: note,
    });

    const res1 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key1,
      },
      body: JSON.stringify(makePayload("Distinct Donation 1")),
    });
    assert.equal(res1.status, 201);
    const data1 = (await res1.json()) as any;

    const res2 = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "Idempotency-Key": key2,
      },
      body: JSON.stringify(makePayload("Distinct Donation 2")),
    });
    assert.equal(res2.status, 201);
    const data2 = (await res2.json()) as any;

    assert.notEqual(data1.data?.id, data2.data?.id);
  });

  it("Invariant 3.6: Requests without Idempotency-Key header succeed normally", async () => {
    const res = await fetch(`${baseUrl}/mosques/${fixture.mosqueId}/donations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        amount: "12000",
        accountId: fixture.cashAccount.id,
        fundId: fixture.generalFund.id,
        categoryId: fixture.unrestrictedIncomeCategory.id,
        date: new Date().toISOString(),
        source: "MEMBER",
        notes: "No idempotency key",
      }),
    });

    assert.equal(res.status, 201);
    assert.equal(res.headers.get("Idempotent-Replayed"), null);
  });
});

