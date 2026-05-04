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
 * `fund.at.funding.plan` — keyed by `any` (rkey IS the slug).
 * `name` is required; everything else is optional. `amount` is the smallest currency unit
 * (per spec); `0` means "any amount". `channels` is an array of AT URIs (max 10).
 */
const planBodySchema = z.object({
  status: z.string().max(16).optional(),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  amount: z.number().int().optional(),
  currency: z.string().max(3).optional(),
  frequency: z.string().max(16).optional(),
  channels: z.array(z.string()).max(10).optional(),
  createdAt: z.string().optional(),
});

export type FundFundingPlanParsed = {
  status?: string;
  name: string;
  description?: string;
  /** Smallest currency unit (cents for USD); stored as bigint to allow > 2^53. */
  amount?: bigint;
  /** ISO 4217 code, uppercased. */
  currency?: string;
  frequency?: string;
  /** AT URIs of `fund.at.funding.channel` records. */
  channelAtUris?: Array<string>;
  createdAt?: string;
};

export type FundFundingPlanParseResult =
  | { ok: true; record: FundFundingPlanParsed }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "zod";
      zodError?: z.ZodError;
    };

function isAtUri(s: string | undefined): s is string {
  if (!s?.trim()) return false;
  return s.trim().startsWith("at://");
}

export function tryParseFundFundingPlanRecord(
  body: Record<string, unknown> | undefined,
): FundFundingPlanParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (t !== undefined && typeof t === "string" && t !== FUND_NSID.fundingPlan) {
    return { ok: false, reason: `unexpected $type ${t}`, stage: "zod" };
  }
  const parsed = planBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.message,
      stage: "zod",
      zodError: parsed.error,
    };
  }
  const name = parsed.data.name.trim();
  if (!name) return { ok: false, reason: "name is empty", stage: "zod" };

  const rec: FundFundingPlanParsed = { name };
  const s = parsed.data.status?.trim();
  if (s) rec.status = s;
  const d = parsed.data.description?.trim();
  if (d) rec.description = d;
  if (parsed.data.amount !== undefined && Number.isFinite(parsed.data.amount)) {
    rec.amount = BigInt(parsed.data.amount);
  }
  const cur = parsed.data.currency?.trim().toUpperCase();
  if (cur) rec.currency = cur;
  const f = parsed.data.frequency?.trim();
  if (f) rec.frequency = f;
  if (parsed.data.channels !== undefined) {
    const filtered = parsed.data.channels
      .map((u) => u?.trim())
      .filter((u): u is string => isAtUri(u))
      .slice(0, 10);
    if (filtered.length > 0) rec.channelAtUris = filtered;
  }
  const c = parsed.data.createdAt?.trim();
  if (c) rec.createdAt = c;
  return { ok: true, record: rec };
}

export async function upsertFundFundingPlanIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  record: FundFundingPlanParsed;
  recordSource?: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, record } = input;
  const atUri = atUriFor(repoDid, COLLECTION.fundFundingPlan, rkey);
  const status = record.status ?? null;
  const description = record.description ?? null;
  const amount = record.amount ?? null;
  const currency = record.currency ?? null;
  const frequency = record.frequency ?? null;
  const channelAtUris = record.channelAtUris ?? null;
  const recordCreatedAt = parseRecordCreatedAt(record.createdAt);
  const recordJson = input.recordSource
    ? cloneRecordJson(input.recordSource)
    : null;

  await db
    .insert(schema.fundFundingPlans)
    .values({
      repoDid,
      rkey,
      atUri,
      status,
      name: record.name,
      description,
      amount,
      currency,
      frequency,
      channelAtUris,
      recordCreatedAt,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.fundFundingPlans.atUri,
      set: {
        repoDid,
        rkey,
        status,
        name: record.name,
        description,
        amount,
        currency,
        frequency,
        channelAtUris,
        recordCreatedAt,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

export async function upsertFundFundingPlanFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  record: FundFundingPlanParsed;
  recordSource?: Record<string, unknown>;
}) {
  if (!(await hasStoreListingForProductDid(input.db, input.did))) {
    console.warn(
      `[tap-fund-funding-plan] skip — no store_listings.product_account_did=${input.did} rkey=${input.rkey}`,
    );
    return;
  }
  await upsertFundFundingPlanIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    record: input.record,
    recordSource: input.recordSource,
  });
}

export async function deleteFundFundingPlanFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.fundFundingPlans)
    .where(
      and(
        eq(schema.fundFundingPlans.repoDid, input.did),
        eq(schema.fundFundingPlans.rkey, input.rkey),
      ),
    );
}
