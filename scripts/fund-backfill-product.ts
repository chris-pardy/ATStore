#!/usr/bin/env node
/**
 * One-off at.fund ingest: `listRecords` for the five fund.at.* collections
 * (actor.declaration, funding.contribute, funding.channel, funding.plan,
 *  graph.dependency) on a product DID (or Bluesky handle).
 *
 * Usage:
 *   pnpm exec tsx -r dotenv/config scripts/fund-backfill-product.ts did:plc:...
 *   pnpm exec tsx -r dotenv/config scripts/fund-backfill-product.ts handle.example.com
 *
 * Requires DATABASE_URL (same as the tap consumer).
 */
import "dotenv/config";
import { backfillFundForProductDid } from "#/lib/atproto/fund-backfill";
import { resolveBlueskyHandleToDid } from "#/lib/bluesky-public-profile";

import { db } from "../src/db/index.server";

async function main() {
  const raw = process.argv.slice(2).join(" ").trim();
  if (!raw) {
    console.error(
      "Usage: fund-backfill-product.ts <did:plc:...|handle.example.com>",
    );
    process.exit(1);
  }

  let did = raw.replace(/^@/, "");
  if (!did.startsWith("did:")) {
    const resolved = await resolveBlueskyHandleToDid(did);
    if (!resolved) {
      console.error(`Could not resolve handle to DID: ${did}`);
      process.exit(1);
    }
    did = resolved;
    console.log(`Resolved handle → ${did}`);
  }

  console.log(`Backfilling at.fund for ${did}…`);
  await backfillFundForProductDid(db, did);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
