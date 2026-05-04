import type { Database } from "#/db/index.server";

import {
  paginateListRecords,
  rkeyFromCollectionAtUri,
} from "#/lib/atproto/list-records";
import { COLLECTION } from "#/lib/atproto/nsids";
import { resolveAtprotoPdsBaseUrl } from "#/lib/atproto/resolve-atproto-pds";
import {
  tryParseStandardDocumentRecord,
  upsertStandardDocumentIntoDb,
} from "#/lib/atproto/tap-standard-document-sync";
import {
  tryParseStandardPublicationRecord,
  upsertStandardPublicationIntoDb,
} from "#/lib/atproto/tap-standard-publication-sync";

export async function backfillStandardSiteForProductDid(
  db: Database,
  productDid: string,
): Promise<void> {
  const did = productDid.trim();
  if (!did.startsWith("did:")) return;

  const pds = await resolveAtprotoPdsBaseUrl(did);
  if (!pds) {
    console.warn(
      `[standard-site-backfill] no PDS for ${did}; skip listRecords backfill`,
    );
    return;
  }

  for await (const row of paginateListRecords(
    pds,
    did,
    COLLECTION.standardPublication,
  )) {
    const body = row.value as Record<string, unknown> | null | undefined;
    if (!body || typeof body !== "object") continue;
    const rkey = rkeyFromCollectionAtUri(
      row.uri,
      COLLECTION.standardPublication,
    );
    if (!rkey) continue;
    const parsed = tryParseStandardPublicationRecord(body);
    if (!parsed.ok) continue;
    await upsertStandardPublicationIntoDb({
      db,
      repoDid: did,
      rkey,
      record: parsed.record,
      recordSource: body,
    });
  }

  for await (const row of paginateListRecords(
    pds,
    did,
    COLLECTION.standardDocument,
  )) {
    const body = row.value as Record<string, unknown> | null | undefined;
    if (!body || typeof body !== "object") continue;
    const rkey = rkeyFromCollectionAtUri(row.uri, COLLECTION.standardDocument);
    if (!rkey) continue;
    const parsed = tryParseStandardDocumentRecord(body);
    if (!parsed.ok) continue;
    await upsertStandardDocumentIntoDb({
      db,
      repoDid: did,
      rkey,
      record: parsed.record,
      recordSource: body,
    });
  }
}

/**
 * Fire-and-forget PDS crawl after a listing becomes verified — fills rows Tap skipped
 * before any `product_account_did` gate matched.
 */
export function scheduleStandardSiteBackfillForProductDid(
  db: Database,
  productDid: string,
): void {
  const did = productDid.trim();
  if (!did.startsWith("did:")) return;
  void backfillStandardSiteForProductDid(db, did).catch((error) => {
    console.error(`[standard-site-backfill] failed productDid=${did}`, error);
  });
}
