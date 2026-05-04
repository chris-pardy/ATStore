import type { Database } from "#/db/index.server";

import * as schema from "#/db/schema";
import {
  atUriFor,
  cloneRecordJson,
  parseRecordCreatedAt,
} from "#/lib/atproto/fund-record-helpers";
import { COLLECTION, FUND_NSID } from "#/lib/atproto/nsids";
import { hasStoreListingForFundParticipant } from "#/lib/atproto/standard-site-product-did-gate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

/**
 * `fund.at.graph.dependency` — the author (`repoDid`) declares they depend on `subjectDid`.
 * `subject` is required and must be a DID.
 */
const dependencyBodySchema = z.object({
  subject: z.string().min(1).max(512),
  label: z.string().max(128).optional(),
  createdAt: z.string().optional(),
});

export type FundGraphDependencyParsed = {
  subjectDid: string;
  label?: string;
  createdAt?: string;
};

export type FundGraphDependencyParseResult =
  | { ok: true; record: FundGraphDependencyParsed }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "zod" | "subject";
      zodError?: z.ZodError;
    };

export function tryParseFundGraphDependencyRecord(
  body: Record<string, unknown> | undefined,
): FundGraphDependencyParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (
    t !== undefined &&
    typeof t === "string" &&
    t !== FUND_NSID.graphDependency
  ) {
    return { ok: false, reason: `unexpected $type ${t}`, stage: "zod" };
  }
  const parsed = dependencyBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.message,
      stage: "zod",
      zodError: parsed.error,
    };
  }
  const subjectDid = parsed.data.subject.trim();
  if (!subjectDid.startsWith("did:")) {
    return {
      ok: false,
      reason: "subject is not a DID",
      stage: "subject",
    };
  }
  const rec: FundGraphDependencyParsed = { subjectDid };
  const l = parsed.data.label?.trim();
  if (l) rec.label = l;
  const c = parsed.data.createdAt?.trim();
  if (c) rec.createdAt = c;
  return { ok: true, record: rec };
}

export async function upsertFundGraphDependencyIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  record: FundGraphDependencyParsed;
  recordSource?: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, record } = input;
  const atUri = atUriFor(repoDid, COLLECTION.fundGraphDependency, rkey);
  const label = record.label ?? null;
  const recordCreatedAt = parseRecordCreatedAt(record.createdAt);
  const recordJson = input.recordSource
    ? cloneRecordJson(input.recordSource)
    : null;

  await db
    .insert(schema.fundGraphDependencies)
    .values({
      repoDid,
      rkey,
      atUri,
      subjectDid: record.subjectDid,
      label,
      recordCreatedAt,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.fundGraphDependencies.atUri,
      set: {
        repoDid,
        rkey,
        subjectDid: record.subjectDid,
        label,
        recordCreatedAt,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

/**
 * Tap wrapper — keeps the row when EITHER `repoDid` or `subjectDid` is a known listing's
 * `productAccountDid`. See `hasStoreListingForFundParticipant` for the rationale.
 */
export async function upsertFundGraphDependencyFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  record: FundGraphDependencyParsed;
  recordSource?: Record<string, unknown>;
}) {
  const matched = await hasStoreListingForFundParticipant(
    input.db,
    input.did,
    input.record.subjectDid,
  );
  if (!matched) {
    console.warn(
      `[tap-fund-graph-dependency] skip — no listing matches repo=${input.did} subject=${input.record.subjectDid} rkey=${input.rkey}`,
    );
    return;
  }
  await upsertFundGraphDependencyIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    record: input.record,
    recordSource: input.recordSource,
  });
}

export async function deleteFundGraphDependencyFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.fundGraphDependencies)
    .where(
      and(
        eq(schema.fundGraphDependencies.repoDid, input.did),
        eq(schema.fundGraphDependencies.rkey, input.rkey),
      ),
    );
}
