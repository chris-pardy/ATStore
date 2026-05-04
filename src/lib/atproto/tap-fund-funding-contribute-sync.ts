import type { Database } from "#/db/index.server";

import * as schema from "#/db/schema";
import {
  atUriFor,
  cloneRecordJson,
  parseRecordCreatedAt,
} from "#/lib/atproto/fund-record-helpers";
import { COLLECTION, FUND_NSID } from "#/lib/atproto/nsids";
import { hasStoreListingForProductDid } from "#/lib/atproto/standard-site-product-did-gate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

/**
 * `fund.at.funding.contribute` — singleton (lexicon `key: "literal:self"`).
 * The canonical "Fund this steward" URL — equivalent to rel="payment".
 */
const contributeBodySchema = z.object({
  url: z.string().min(1),
  label: z.string().max(128).optional(),
  createdAt: z.string().optional(),
});

export type FundFundingContributeParsed = {
  url: string;
  label?: string;
  createdAt?: string;
};

export type FundFundingContributeParseResult =
  | { ok: true; record: FundFundingContributeParsed }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "zod" | "url";
      zodError?: z.ZodError;
    };

function normalizeContributeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function tryParseFundFundingContributeRecord(
  body: Record<string, unknown> | undefined,
): FundFundingContributeParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (
    t !== undefined &&
    typeof t === "string" &&
    t !== FUND_NSID.fundingContribute
  ) {
    return { ok: false, reason: `unexpected $type ${t}`, stage: "zod" };
  }
  const parsed = contributeBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.message,
      stage: "zod",
      zodError: parsed.error,
    };
  }
  const url = normalizeContributeUrl(parsed.data.url);
  if (!url) {
    return {
      ok: false,
      reason: "url is not a valid http(s) URL",
      stage: "url",
    };
  }
  const rec: FundFundingContributeParsed = { url };
  const l = parsed.data.label?.trim();
  if (l) rec.label = l;
  const c = parsed.data.createdAt?.trim();
  if (c) rec.createdAt = c;
  return { ok: true, record: rec };
}

export async function upsertFundFundingContributeIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  record: FundFundingContributeParsed;
  recordSource?: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, record } = input;
  const atUri = atUriFor(repoDid, COLLECTION.fundFundingContribute, rkey);
  const label = record.label?.trim() || null;
  const recordCreatedAt = parseRecordCreatedAt(record.createdAt);
  const recordJson = input.recordSource
    ? cloneRecordJson(input.recordSource)
    : null;

  await db
    .insert(schema.fundFundingContributes)
    .values({
      repoDid,
      rkey,
      atUri,
      url: record.url,
      label,
      recordCreatedAt,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.fundFundingContributes.atUri,
      set: {
        repoDid,
        rkey,
        url: record.url,
        label,
        recordCreatedAt,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

export async function upsertFundFundingContributeFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  record: FundFundingContributeParsed;
  recordSource?: Record<string, unknown>;
}) {
  if (!(await hasStoreListingForProductDid(input.db, input.did))) {
    console.warn(
      `[tap-fund-funding-contribute] skip — no store_listings.product_account_did=${input.did} rkey=${input.rkey}`,
    );
    return;
  }
  await upsertFundFundingContributeIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    record: input.record,
    recordSource: input.recordSource,
  });
}

export async function deleteFundFundingContributeFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.fundFundingContributes)
    .where(
      and(
        eq(schema.fundFundingContributes.repoDid, input.did),
        eq(schema.fundFundingContributes.rkey, input.rkey),
      ),
    );
}
