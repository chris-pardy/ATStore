#!/usr/bin/env node
/**
 * Standard.site bulk backfill: for every distinct `store_listings.product_account_did`
 * that looks like `did:plc:…` (ATProto PDS — `did:web:` and other DID methods are excluded),
 * runs `listRecords` on `site.standard.publication` and `site.standard.document`
 * (same as `standard-site-backfill-product.ts`, once per product repo).
 *
 * Usage:
 *   pnpm exec tsx -r dotenv/config scripts/standard-site-backfill-all-product-dids.ts
 *
 * Requires DATABASE_URL.
 */
import "dotenv/config";
import * as schema from "#/db/schema";
import { backfillStandardSiteForProductDid } from "#/lib/atproto/standard-site-verify-backfill";
import { and, asc, isNotNull, sql } from "drizzle-orm";

import { db } from "../src/db/index.server";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[standard-site-backfill-all] DATABASE_URL is required");
    process.exit(1);
  }

  const rows = await db
    .selectDistinct({
      productAccountDid: schema.storeListings.productAccountDid,
    })
    .from(schema.storeListings)
    .where(
      and(
        isNotNull(schema.storeListings.productAccountDid),
        sql`trim(${schema.storeListings.productAccountDid}) like 'did:plc:%'`,
      ),
    )
    .orderBy(asc(schema.storeListings.productAccountDid));

  const dids = rows
    .map((r) => r.productAccountDid?.trim())
    .filter(
      (d): d is string => typeof d === "string" && d.startsWith("did:plc:"),
    );

  if (dids.length === 0) {
    console.log(
      "[standard-site-backfill-all] no rows with product_account_did; nothing to do.",
    );
    return;
  }

  console.log(
    `[standard-site-backfill-all] ${dids.length} distinct product repo(s)…`,
  );

  let ok = 0;
  let failed = 0;
  let index = 0;
  for (const did of dids) {
    index++;
    const label = `[${String(index)}/${String(dids.length)}] ${did}`;
    process.stdout.write(`${label} … `);
    try {
      await backfillStandardSiteForProductDid(db, did);
      console.log("ok");
      ok++;
    } catch (error) {
      failed++;
      console.log("FAILED");
      console.error(error);
    }
  }

  console.log(
    `[standard-site-backfill-all] done. ok=${String(ok)} failed=${String(failed)}`,
  );
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
