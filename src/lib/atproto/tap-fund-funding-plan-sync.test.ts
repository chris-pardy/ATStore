import { tryParseFundFundingPlanRecord } from "#/lib/atproto/tap-fund-funding-plan-sync";
import { describe, expect, it } from "vitest";

describe("tryParseFundFundingPlanRecord", () => {
  it("accepts a fully-populated active plan", () => {
    const result = tryParseFundFundingPlanRecord({
      $type: "fund.at.funding.plan",
      status: "active",
      name: "Sustainer",
      description: "Keeps the lights on",
      amount: 500,
      currency: "usd",
      frequency: "monthly",
      channels: [
        "at://did:plc:abc/fund.at.funding.channel/github",
        "at://did:plc:abc/fund.at.funding.channel/stripe",
      ],
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.name).toBe("Sustainer");
      expect(result.record.amount).toBe(500n);
      // Currency normalized to uppercase to match ISO 4217.
      expect(result.record.currency).toBe("USD");
      expect(result.record.frequency).toBe("monthly");
      expect(result.record.channelAtUris).toEqual([
        "at://did:plc:abc/fund.at.funding.channel/github",
        "at://did:plc:abc/fund.at.funding.channel/stripe",
      ]);
    }
  });

  it("supports a minimal record (only `name`)", () => {
    const result = tryParseFundFundingPlanRecord({ name: "Tip jar" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.name).toBe("Tip jar");
      expect(result.record.amount).toBeUndefined();
      expect(result.record.channelAtUris).toBeUndefined();
    }
  });

  it("treats amount=0 as 'any amount' (per spec)", () => {
    const result = tryParseFundFundingPlanRecord({
      name: "Pay what you want",
      amount: 0,
      currency: "EUR",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.amount).toBe(0n);
    }
  });

  it("drops non-at-uri channel entries", () => {
    const result = tryParseFundFundingPlanRecord({
      name: "Mixed",
      channels: [
        "at://did:plc:abc/fund.at.funding.channel/ok",
        "https://example.com/not-at-uri",
        "",
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.channelAtUris).toEqual([
        "at://did:plc:abc/fund.at.funding.channel/ok",
      ]);
    }
  });

  it("rejects when name is missing", () => {
    const result = tryParseFundFundingPlanRecord({ status: "active" });
    expect(result.ok).toBe(false);
  });

  it("rejects when name is empty after trim", () => {
    const result = tryParseFundFundingPlanRecord({ name: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects amount that is not an integer", () => {
    const result = tryParseFundFundingPlanRecord({
      name: "Bad amount",
      amount: 12.5,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unexpected $type", () => {
    const result = tryParseFundFundingPlanRecord({
      $type: "fund.at.funding.contribute",
      name: "Sustainer",
    });
    expect(result.ok).toBe(false);
  });
});
