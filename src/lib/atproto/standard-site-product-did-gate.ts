import type { Database } from "#/db/index.server";

import * as schema from "#/db/schema";
import { eq, or } from "drizzle-orm";

/** True when some public listing uses `did` as official product account. */
export async function hasStoreListingForProductDid(
  db: Database,
  did: string,
): Promise<boolean> {
  const trimmed = did.trim();
  if (!trimmed.startsWith("did:")) return false;
  const [row] = await db
    .select({ id: schema.storeListings.id })
    .from(schema.storeListings)
    .where(eq(schema.storeListings.productAccountDid, trimmed))
    .limit(1);
  return row != null;
}

/**
 * Gate for `fund.at.graph.dependency` records. The relationship has TWO sides — the
 * publishing repo (`repoDid`) and the targeted entity (`subjectDid`). We keep the row
 * when EITHER side matches a known listing's `productAccountDid`, so that dependency
 * declarations FROM a listed app survive even when the upstream isn't listed (gives us
 * the "depends on …" disclosure on the product page).
 *
 * Both DIDs are validated to be `did:`-prefixed before hitting the DB.
 */
export async function hasStoreListingForFundParticipant(
  db: Database,
  repoDid: string,
  subjectDid: string,
): Promise<boolean> {
  const repo = repoDid.trim();
  const subject = subjectDid.trim();
  const candidates: Array<string> = [];
  if (repo.startsWith("did:")) candidates.push(repo);
  if (subject.startsWith("did:") && subject !== repo) candidates.push(subject);
  if (candidates.length === 0) return false;
  const [row] = await db
    .select({ id: schema.storeListings.id })
    .from(schema.storeListings)
    .where(
      or(
        ...candidates.map((d) => eq(schema.storeListings.productAccountDid, d)),
      ),
    )
    .limit(1);
  return row != null;
}
