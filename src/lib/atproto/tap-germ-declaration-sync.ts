import type { Database } from "#/db/index.server";

import * as schema from "#/db/schema";
import { COLLECTION, GERMNETWORK_NSID } from "#/lib/atproto/nsids";
import { resolveAtprotoPdsBaseUrl } from "#/lib/atproto/resolve-atproto-pds";
import { hasStoreListingForProductDid } from "#/lib/atproto/standard-site-product-did-gate";
import { and, eq } from "drizzle-orm";

export type GermDeclarationParseResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      stage: "no_body" | "type";
    };

/**
 * Minimal validation — record holds opaque bytes (`currentKey`, etc.) we persist as JSON only.
 */
export function tryParseGermDeclarationRecord(
  body: Record<string, unknown> | undefined,
): GermDeclarationParseResult {
  if (!body) {
    return { ok: false, reason: "record body is missing", stage: "no_body" };
  }
  const t = body.$type;
  if (
    t !== undefined &&
    typeof t === "string" &&
    t !== GERMNETWORK_NSID.declaration
  ) {
    return {
      ok: false,
      reason: `unexpected $type ${t}`,
      stage: "type",
    };
  }
  return { ok: true };
}

function recordJsonValue(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    return structuredClone(body) as Record<string, unknown>;
  }
  // eslint-disable-next-line unicorn/prefer-structured-clone -- environments without structuredClone
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function atUriForGermDeclaration(did: string, rkey: string) {
  return `at://${did}/${COLLECTION.germnetworkDeclaration}/${rkey}`;
}

export async function upsertGermDeclarationIntoDb(input: {
  db: Database;
  repoDid: string;
  rkey: string;
  recordSource: Record<string, unknown>;
}) {
  const { db, repoDid, rkey, recordSource } = input;
  const atUri = atUriForGermDeclaration(repoDid, rkey);
  const recordJson = recordJsonValue(recordSource);

  await db
    .insert(schema.productGermDeclarations)
    .values({
      repoDid,
      rkey,
      atUri,
      recordJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.productGermDeclarations.atUri,
      set: {
        repoDid,
        rkey,
        recordJson,
        updatedAt: new Date(),
      },
    });
}

export async function upsertGermDeclarationFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
  recordSource: Record<string, unknown>;
}) {
  if (!(await hasStoreListingForProductDid(input.db, input.did))) {
    console.log(
      `[tap-germ-declaration] skip repo=${input.did} rkey=${input.rkey} — no listing has product_account_did=this repo`,
    );
    return;
  }
  await upsertGermDeclarationIntoDb({
    db: input.db,
    repoDid: input.did,
    rkey: input.rkey,
    recordSource: input.recordSource,
  });
}

export async function deleteGermDeclarationFromTap(input: {
  db: Database;
  did: string;
  rkey: string;
}) {
  await input.db
    .delete(schema.productGermDeclarations)
    .where(
      and(
        eq(schema.productGermDeclarations.repoDid, input.did),
        eq(schema.productGermDeclarations.rkey, input.rkey),
      ),
    );
}

type ListRecordRow = { uri: string; value: unknown };

async function* paginateListRecords(
  pdsBase: string,
  repo: string,
  collection: string,
): AsyncGenerator<ListRecordRow, void, undefined> {
  let cursor: string | undefined;
  do {
    const u = new URL("/xrpc/com.atproto.repo.listRecords", `${pdsBase}/`);
    u.searchParams.set("repo", repo);
    u.searchParams.set("collection", collection);
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `listRecords ${collection} failed ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const data = (await res.json()) as {
      records?: Array<{ uri: string; value: unknown }>;
      cursor?: string;
    };
    const records = data.records ?? [];
    for (const rec of records) {
      yield { uri: rec.uri, value: rec.value };
    }
    cursor = data.cursor;
  } while (cursor);
}

function rkeyFromCollectionAtUri(
  uri: string,
  collection: string,
): string | null {
  const withoutAt = uri.replace(/^at:\/\//, "");
  const needle = `/${collection}/`;
  const idx = withoutAt.indexOf(needle);
  if (idx === -1) return null;
  const rkey = withoutAt.slice(idx + needle.length);
  if (rkey.length === 0 || rkey.includes("/")) return null;
  return rkey;
}

/** PDS crawl for one product repo — mirrors Tap ingest when historical events were missed. */
export async function backfillGermDeclarationsForProductDid(
  db: Database,
  productDid: string,
): Promise<void> {
  const did = productDid.trim();
  if (!did.startsWith("did:")) return;

  const pds = await resolveAtprotoPdsBaseUrl(did);
  if (!pds) {
    console.warn(
      `[germ-declaration-backfill] no PDS for ${did}; skip listRecords`,
    );
    return;
  }

  for await (const row of paginateListRecords(
    pds,
    did,
    COLLECTION.germnetworkDeclaration,
  )) {
    const body = row.value as Record<string, unknown> | null | undefined;
    if (!body || typeof body !== "object") continue;
    const rkey = rkeyFromCollectionAtUri(
      row.uri,
      COLLECTION.germnetworkDeclaration,
    );
    if (!rkey) continue;
    const parsed = tryParseGermDeclarationRecord(body);
    if (!parsed.ok) continue;
    await upsertGermDeclarationIntoDb({
      db,
      repoDid: did,
      rkey,
      recordSource: body,
    });
  }
}

/**
 * Fire-and-forget PDS crawl after listing/product linkage — fills `product_germ_declarations`
 * when Tap historical relay missed `com.germnetwork.declaration`.
 */
export function scheduleGermDeclarationBackfillForProductDid(
  db: Database,
  productDid: string,
): void {
  const did = productDid.trim();
  if (!did.startsWith("did:")) return;
  void backfillGermDeclarationsForProductDid(db, did).catch((error) => {
    console.error(
      `[germ-declaration-backfill] scheduled run failed productDid=${did}`,
      error,
    );
  });
}
