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
 * `fund.at.funding.channel` — keyed by `any` so the rkey IS the channel slug.
 * `channelType` is the only required field per the lexicon. `uri` is optional (e.g. bank/cheque
 * channels need no public URL).
 */
const channelBodySchema = z.object({
  channelType: z.string().min(1).max(32),
  uri: z.string().optional(),
  description: z.string().max(500).optional(),
  createdAt: z.string().optional(),
});

export type FundFundingChannelParsed = {
  channelType: string;
  uri?: string;
  description?: string;
  createdAt?: string;
};

export type FundFundingChannelParseResult =
  | { ok: true; record: FundFundingChannelParsed }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "zod" | "uri";
      zodError?: z.ZodError;
    };

function normalizeChannelUri(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    // Channels may use https:, http:, or `at://` URIs (e.g. cross-account references).
    if (
      u.protocol !== "https:" &&
      u.protocol !== "http:" &&
      u.protocol !== "at:"
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function tryParseFundFundingChannelRecord(
  body: Record<string, unknown> | undefined,
): FundFundingChannelParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (
    t !== undefined &&
    typeof t === "string" &&
    t !== FUND_NSID.fundingChannel
  ) {
    return { ok: false, reason: `unexpected $type ${t}`, stage: "zod" };
  }
  const parsed = channelBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.message,
      stage: "zod",
      zodError: parsed.error,
    };
  }
  const channelType = parsed.data.channelType.trim();
  if (!channelType) {
    return { ok: false, reason: "channelType is empty", stage: "zod" };
  }
  const rec: FundFundingChannelParsed = { channelType };
  // Optional URI — invalid URIs drop the field rather than failing the record.
  const uri = normalizeChannelUri(parsed.data.uri);
  if (uri) rec.uri = uri;
  const d = parsed.data.description?.trim();
  if (d) rec.description = d;
  const c = parsed.data.createdAt?.trim();
  if (c) rec.createdAt = c;
  return { ok: true, record: rec };
}

export async function upsertFundFundingChannelIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  record: FundFundingChannelParsed;
  recordSource?: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, record } = input;
  const atUri = atUriFor(repoDid, COLLECTION.fundFundingChannel, rkey);
  const channelUri = record.uri ?? null;
  const description = record.description ?? null;
  const recordCreatedAt = parseRecordCreatedAt(record.createdAt);
  const recordJson = input.recordSource
    ? cloneRecordJson(input.recordSource)
    : null;

  await db
    .insert(schema.fundFundingChannels)
    .values({
      repoDid,
      rkey,
      atUri,
      channelType: record.channelType,
      channelUri,
      description,
      recordCreatedAt,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.fundFundingChannels.atUri,
      set: {
        repoDid,
        rkey,
        channelType: record.channelType,
        channelUri,
        description,
        recordCreatedAt,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

export async function upsertFundFundingChannelFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  record: FundFundingChannelParsed;
  recordSource?: Record<string, unknown>;
}) {
  if (!(await hasStoreListingForProductDid(input.db, input.did))) {
    console.warn(
      `[tap-fund-funding-channel] skip — no store_listings.product_account_did=${input.did} rkey=${input.rkey}`,
    );
    return;
  }
  await upsertFundFundingChannelIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    record: input.record,
    recordSource: input.recordSource,
  });
}

export async function deleteFundFundingChannelFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.fundFundingChannels)
    .where(
      and(
        eq(schema.fundFundingChannels.repoDid, input.did),
        eq(schema.fundFundingChannels.rkey, input.rkey),
      ),
    );
}
