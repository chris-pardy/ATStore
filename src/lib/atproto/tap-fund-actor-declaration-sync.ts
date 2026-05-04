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
 * `fund.at.actor.declaration` — singleton record (lexicon `key: "literal:self"`).
 * The mere existence of the record signals participation; both fields are optional enrichment.
 */
const declarationBodySchema = z.object({
  entityType: z.string().max(32).optional(),
  role: z.string().max(32).optional(),
  createdAt: z.string().optional(),
});

export type FundActorDeclarationParsed = {
  entityType?: string;
  role?: string;
  createdAt?: string;
};

export type FundActorDeclarationParseResult =
  | { ok: true; record: FundActorDeclarationParsed }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "zod";
      zodError?: z.ZodError;
    };

export function tryParseFundActorDeclarationRecord(
  body: Record<string, unknown> | undefined,
): FundActorDeclarationParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (
    t !== undefined &&
    typeof t === "string" &&
    t !== FUND_NSID.actorDeclaration
  ) {
    return { ok: false, reason: `unexpected $type ${t}`, stage: "zod" };
  }
  const parsed = declarationBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.message,
      stage: "zod",
      zodError: parsed.error,
    };
  }
  const rec: FundActorDeclarationParsed = {};
  const e = parsed.data.entityType?.trim();
  if (e) rec.entityType = e;
  const r = parsed.data.role?.trim();
  if (r) rec.role = r;
  const c = parsed.data.createdAt?.trim();
  if (c) rec.createdAt = c;
  return { ok: true, record: rec };
}

export async function upsertFundActorDeclarationIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  record: FundActorDeclarationParsed;
  recordSource?: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, record } = input;
  const atUri = atUriFor(repoDid, COLLECTION.fundActorDeclaration, rkey);
  const entityType = record.entityType ?? null;
  const role = record.role ?? null;
  const recordCreatedAt = parseRecordCreatedAt(record.createdAt);
  const recordJson = input.recordSource
    ? cloneRecordJson(input.recordSource)
    : null;

  await db
    .insert(schema.fundActorDeclarations)
    .values({
      repoDid,
      rkey,
      atUri,
      entityType,
      role,
      recordCreatedAt,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.fundActorDeclarations.atUri,
      set: {
        repoDid,
        rkey,
        entityType,
        role,
        recordCreatedAt,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

export async function upsertFundActorDeclarationFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  record: FundActorDeclarationParsed;
  recordSource?: Record<string, unknown>;
}) {
  if (!(await hasStoreListingForProductDid(input.db, input.did))) {
    console.warn(
      `[tap-fund-actor-declaration] skip — no store_listings.product_account_did=${input.did} rkey=${input.rkey}`,
    );
    return;
  }
  await upsertFundActorDeclarationIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    record: input.record,
    recordSource: input.recordSource,
  });
}

export async function deleteFundActorDeclarationFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.fundActorDeclarations)
    .where(
      and(
        eq(schema.fundActorDeclarations.repoDid, input.did),
        eq(schema.fundActorDeclarations.rkey, input.rkey),
      ),
    );
}
