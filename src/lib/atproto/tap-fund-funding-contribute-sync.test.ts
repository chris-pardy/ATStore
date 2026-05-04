import { tryParseFundFundingContributeRecord } from "#/lib/atproto/tap-fund-funding-contribute-sync";
import { describe, expect, it } from "vitest";

describe("tryParseFundFundingContributeRecord", () => {
  it("accepts a minimal valid record", () => {
    const result = tryParseFundFundingContributeRecord({
      $type: "fund.at.funding.contribute",
      url: "https://github.com/sponsors/example",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.url).toBe("https://github.com/sponsors/example");
      expect(result.record.createdAt).toBe("2026-01-01T00:00:00Z");
    }
  });

  it("preserves an optional label", () => {
    const result = tryParseFundFundingContributeRecord({
      url: "https://opencollective.com/example",
      label: "Support via Open Collective",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.label).toBe("Support via Open Collective");
    }
  });

  it("rejects when url is missing", () => {
    const result = tryParseFundFundingContributeRecord({
      label: "no url",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when url is not http(s)", () => {
    const result = tryParseFundFundingContributeRecord({
      url: "ftp://example.com/donate",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("url");
    }
  });

  it("rejects an unexpected $type", () => {
    const result = tryParseFundFundingContributeRecord({
      $type: "fund.at.funding.channel",
      url: "https://example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("zod");
    }
  });

  it("rejects when body is undefined", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- the parser explicitly accepts undefined and surfaces a "no_body" stage
    const result = tryParseFundFundingContributeRecord(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("no_body");
    }
  });
});
