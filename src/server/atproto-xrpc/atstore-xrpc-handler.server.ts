import type { Client } from "@atcute/client";
import type { DirectoryListingCard } from "#/integrations/tanstack-query/api-directory-listings.functions";
import type { ListingLink } from "#/lib/atproto/listing-record";

import { db } from "#/db/index.server";
import * as schema from "#/db/schema";
import { directoryListingXrpcHelpers } from "#/integrations/tanstack-query/api-directory-listings.functions";
import { parseAtUriParts } from "#/lib/atproto/at-uri";
import { ATSTORE_XRPC_METHOD, NSID } from "#/lib/atproto/nsids";
import {
  createListingReviewRecord,
  ensureProfileSelfRecord,
} from "#/lib/atproto/repo-records";
import { upsertListingReviewFromTap } from "#/lib/atproto/tap-review-sync";
import { fetchBlueskyPublicProfileFields } from "#/lib/bluesky-public-profile";
import { getAtprotoSessionForRequest } from "#/middleware/auth";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

const LEGACY_DETAIL_SQL = {
  rawCategoryHint: sql<string | null>`null::text`.as("rawCategoryHint"),
  scope: sql<string | null>`null::text`.as("scope"),
  productType: sql<string | null>`null::text`.as("productType"),
  domain: sql<string | null>`null::text`.as("domain"),
  vertical: sql<string | null>`null::text`.as("vertical"),
  classificationReason: sql<string | null>`null::text`.as(
    "classificationReason",
  ),
};

const corsJsonHeaders: HeadersInit = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

function xrpcJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsJsonHeaders,
  });
}

function xrpcErr(status: number, error: string, message?: string) {
  return xrpcJson({ error, message: message ?? error }, status);
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString(
    "base64url",
  );
}

function decodeOffsetCursor(cursor: string | null): number | undefined {
  if (!cursor?.trim()) {
    return undefined;
  }
  try {
    const raw = Buffer.from(cursor.trim(), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { o?: unknown };
    if (
      typeof parsed.o !== "number" ||
      !Number.isFinite(parsed.o) ||
      parsed.o < 0
    ) {
      return undefined;
    }
    return Math.floor(parsed.o);
  } catch {
    return undefined;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function listingCardJson(card: DirectoryListingCard) {
  return {
    ...card,
    slug: card.slug ?? "",
    rating:
      card.rating == null || Number.isNaN(Number(card.rating))
        ? null
        : String(card.rating),
  };
}

function normalizeExternalUrlCandidates(raw: string): Array<string> {
  const t = raw.trim();
  if (!t) {
    return [];
  }
  const noTrail = t.replace(/\/+$/, "");
  if (noTrail === t) {
    return [t];
  }
  return [t, noTrail];
}

async function handleDescribe() {
  const methods = (
    Object.values(ATSTORE_XRPC_METHOD) as Array<string>
  ).toSorted((a, b) => a.localeCompare(b));
  return xrpcJson({
    service: "at-store-directory",
    publicReads: true,
    oauthSubmitReview: true,
    defaultListingLimit: 24,
    maxListingLimit: 100,
    maxReviewLimit: 100,
    methods,
  });
}

async function handleSearchListings(url: URL) {
  const q = url.searchParams.get("q")?.trim();
  const sortRaw = url.searchParams.get("sort")?.trim() ?? "popular";
  const sort =
    sortRaw === "newest"
      ? "newest"
      : sortRaw === "alphabetical"
        ? "alphabetical"
        : "popular";
  const limitParam = Number(url.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.floor(limitParam)))
    : 24;
  const cursorParam = url.searchParams.get("cursor");
  const offset = decodeOffsetCursor(cursorParam);
  if (cursorParam?.trim() && offset === undefined) {
    return xrpcErr(400, "InvalidCursor");
  }
  const start = offset ?? 0;

  const table = schema.storeListings;
  const {
    listingPublicWhere,
    getListingSelect,
    orderByPopularListingSort,
    toListingCard,
  } = directoryListingXrpcHelpers;

  const searchClause = q
    ? or(
        ilike(table.name, `%${q}%`),
        ilike(table.tagline, `%${q}%`),
        ilike(table.fullDescription, `%${q}%`),
        ilike(
          sql<string>`array_to_string(${table.categorySlugs}, ' ')`,
          `%${q}%`,
        ),
        ilike(sql<string>`array_to_string(${table.appTags}, ' ')`, `%${q}%`),
      )
    : undefined;

  const listingSelect = getListingSelect(table);
  const orderBy =
    sort === "newest"
      ? [desc(table.createdAt)]
      : sort === "alphabetical"
        ? [asc(table.name)]
        : orderByPopularListingSort(table);

  const rows = await db
    .select(listingSelect)
    .from(table)
    .where(listingPublicWhere(table, searchClause))
    .orderBy(...orderBy)
    .offset(start)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const listings = slice.map((row) => listingCardJson(toListingCard(row)));

  return xrpcJson({
    listings,
    ...(hasMore ? { cursor: encodeOffsetCursor(start + limit) } : {}),
  });
}

async function fetchVerifiedListingDetailRow(options: {
  listingId?: string;
  slug?: string;
}) {
  const listingId = options.listingId?.trim();
  const slugOnly = options.slug?.trim();

  if ((listingId && slugOnly) || (!listingId && !slugOnly)) {
    return { error: "InvalidParams" as const };
  }

  const table = schema.storeListings;
  const { listingPublicWhere } = directoryListingXrpcHelpers;

  let filter;
  if (listingId) {
    if (!isUuid(listingId)) {
      return { error: "InvalidParams" as const };
    }
    filter = eq(table.id, listingId);
  } else {
    filter = eq(table.slug, slugOnly ?? "");
  }

  const [row] = await db
    .select({
      id: table.id,
      sourceUrl: table.sourceUrl,
      name: table.name,
      slug: table.slug,
      externalUrl: table.externalUrl,
      iconUrl: table.iconUrl,
      heroImageUrl: table.heroImageUrl,
      screenshotUrls: table.screenshotUrls,
      tagline: table.tagline,
      fullDescription: table.fullDescription,
      categorySlugs: table.categorySlugs,
      atUri: table.atUri,
      repoDid: table.repoDid,
      migratedFromAtUri: table.migratedFromAtUri,
      productAccountDid: table.productAccountDid,
      productAccountHandle: table.productAccountHandle,
      reviewCount: table.reviewCount,
      averageRating: table.averageRating,
      ...LEGACY_DETAIL_SQL,
      appTags: table.appTags,
      links: table.links,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .where(listingPublicWhere(table, filter))
    .limit(1);

  if (!row) {
    return { error: "ListingNotFound" as const };
  }
  return { row };
}

async function handleGetListing(url: URL) {
  const listingId = url.searchParams.get("listingId") ?? undefined;
  const slug = url.searchParams.get("slug") ?? undefined;

  const fetched = await fetchVerifiedListingDetailRow({ listingId, slug });
  if ("error" in fetched) {
    switch (fetched.error) {
      case "InvalidParams": {
        return xrpcErr(400, fetched.error);
      }
      case "ListingNotFound": {
        return xrpcErr(404, fetched.error);
      }
      default: {
        return xrpcErr(500, "InternalError");
      }
    }
  }

  const { toListingCard, computeIsStoreManaged, normalizeListingLinks } =
    directoryListingXrpcHelpers;

  const row = fetched.row;
  const listing = listingCardJson(toListingCard(row));
  const isStoreManaged = await computeIsStoreManaged(row);

  const linksRaw = normalizeListingLinks(
    row.links as Array<ListingLink> | null,
  );

  return xrpcJson({
    listing,
    isStoreManaged,
    atUri: row.atUri ?? null,
    repoDid: row.repoDid ?? null,
    productAccountDid: row.productAccountDid ?? null,
    sourceTagline: row.tagline ?? null,
    sourceFullDescription: row.fullDescription ?? null,
    screenshots: row.screenshotUrls ?? [],
    externalUrl: row.externalUrl ?? null,
    sourceUrl: row.sourceUrl ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    links: linksRaw.map((link) => ({
      ...(link.label ? { label: link.label } : {}),
      uri: link.url,
    })),
  });
}

async function handleResolveListing(url: URL) {
  const externalUrl = url.searchParams.get("externalUrl")?.trim();
  if (!externalUrl) {
    return xrpcErr(400, "InvalidParams", "externalUrl is required.");
  }

  const variants = normalizeExternalUrlCandidates(externalUrl);
  if (variants.length === 0) {
    return xrpcErr(400, "InvalidParams");
  }

  const table = schema.storeListings;
  const { listingPublicWhere } = directoryListingXrpcHelpers;

  const clause =
    variants.length === 1
      ? (() => {
          const only = variants[0];
          return only ? eq(table.externalUrl, only) : undefined;
        })()
      : or(...variants.map((v) => eq(table.externalUrl, v)));

  if (!clause) {
    return xrpcErr(400, "InvalidParams");
  }

  const rows = await db
    .select({
      id: table.id,
      slug: table.slug,
      atUri: table.atUri,
    })
    .from(table)
    .where(listingPublicWhere(table, clause))
    .limit(4);

  if (rows.length === 0) {
    return xrpcErr(404, "ListingNotFound");
  }
  if (rows.length > 1) {
    return xrpcErr(409, "AmbiguousResolution");
  }

  const hit = rows.at(0);
  if (!hit) {
    return xrpcErr(404, "ListingNotFound");
  }
  const slug = hit.slug?.trim();
  if (!slug) {
    return xrpcErr(404, "ListingNotFound");
  }

  return xrpcJson({
    listingId: hit.id,
    slug,
    atUri: hit.atUri ?? null,
  });
}

async function handleListReviews(url: URL, request: Request) {
  const listingId = url.searchParams.get("listingId")?.trim();
  if (!listingId || !isUuid(listingId)) {
    return xrpcErr(400, "InvalidParams");
  }

  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.floor(limitParam)))
    : 50;
  const cursorParam = url.searchParams.get("cursor");
  const offset = decodeOffsetCursor(cursorParam);
  if (cursorParam?.trim() && offset === undefined) {
    return xrpcErr(400, "InvalidCursor");
  }
  const start = offset ?? 0;

  const table = schema.storeListings;
  const { listingPublicWhere, viewerMayReplyOnListingReview } =
    directoryListingXrpcHelpers;

  const [listing] = await db
    .select({
      id: table.id,
      repoDid: table.repoDid,
      productAccountDid: table.productAccountDid,
    })
    .from(table)
    .where(listingPublicWhere(table, eq(table.id, listingId)))
    .limit(1);

  if (!listing) {
    return xrpcErr(404, "ListingNotFound");
  }

  const session = await getAtprotoSessionForRequest(request);
  const viewerDid = session?.did ?? undefined;

  const rev = schema.storeListingReviews;
  const rows = await db
    .select({
      id: rev.id,
      authorDid: rev.authorDid,
      rating: rev.rating,
      text: rev.text,
      reviewCreatedAt: rev.reviewCreatedAt,
      authorDisplayName: rev.authorDisplayName,
      authorAvatarUrl: rev.authorAvatarUrl,
      replyCount: rev.replyCount,
    })
    .from(rev)
    .where(eq(rev.storeListingId, listing.id))
    .orderBy(desc(rev.reviewCreatedAt))
    .offset(start)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const reviews = await Promise.all(
    slice.map(async (row) => {
      const profile = await fetchBlueskyPublicProfileFields(row.authorDid);
      const handle =
        profile?.handle?.trim() && profile.handle.trim().length > 0
          ? profile.handle.trim()
          : null;
      const displayName =
        row.authorDisplayName?.trim() ||
        profile?.displayName?.trim() ||
        profile?.handle ||
        null;
      const avatarUrl =
        row.authorAvatarUrl?.trim() || profile?.avatarUrl || null;

      return {
        id: row.id,
        authorDid: row.authorDid,
        rating: row.rating,
        text: row.text,
        reviewCreatedAt: row.reviewCreatedAt.toISOString(),
        authorDisplayName: displayName,
        authorHandle: handle,
        authorAvatarUrl: avatarUrl,
        replyCount: Number(row.replyCount ?? 0),
        canReply: viewerMayReplyOnListingReview({
          viewerDid,
          reviewAuthorDid: row.authorDid,
          listingRepoDid: listing.repoDid,
          listingProductAccountDid: listing.productAccountDid,
        }),
      };
    }),
  );

  return xrpcJson({
    reviews,
    ...(hasMore ? { cursor: encodeOffsetCursor(start + limit) } : {}),
  });
}

/**
 * Mirror OAuth callback: create `fyi.atstore.profile` / `self` when missing so
 * reviewers who never hit `/api/auth/atproto/callback` still get first-login
 * repo state (requires delegated `repo:create` on `fyi.atstore.profile`).
 */
async function ensureReviewerProfileLikeFirstLogin(session: {
  did: string;
  client: Client;
  session: { user: { name: string } };
}): Promise<void> {
  try {
    const publicProfile = await fetchBlueskyPublicProfileFields(session.did);
    const handle =
      publicProfile?.handle?.trim() && publicProfile.handle.trim().length > 0
        ? publicProfile.handle.trim()
        : "";
    const displayName =
      publicProfile?.displayName?.trim() ||
      handle ||
      session.session.user.name.trim() ||
      session.did;
    await ensureProfileSelfRecord(session.client, session.did, {
      displayName,
    });
  } catch (error) {
    console.warn(
      "Failed to ensure fyi.atstore.profile record during submitReview:",
      error,
    );
  }
}

async function handleSubmitReview(request: Request) {
  const session = await getAtprotoSessionForRequest(request);
  if (!session) {
    return xrpcErr(401, "Unauthorized");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return xrpcErr(400, "InvalidParams", "JSON body required.");
  }

  if (!body || typeof body !== "object") {
    return xrpcErr(400, "InvalidParams");
  }

  const rec = body as Record<string, unknown>;
  const subject = typeof rec.subject === "string" ? rec.subject.trim() : "";
  const rating = rec.rating;
  const text =
    typeof rec.text === "string" ? rec.text : rec.text == null ? "" : null;

  if (!subject || typeof rating !== "number" || !Number.isInteger(rating)) {
    return xrpcErr(400, "InvalidParams");
  }
  if (rating < 1 || rating > 5) {
    return xrpcErr(400, "InvalidParams");
  }

  if (typeof rec.createdAt !== "string" || !rec.createdAt.trim()) {
    return xrpcErr(400, "InvalidParams");
  }

  const createdAtIso = new Date().toISOString();

  let parsedUri: ReturnType<typeof parseAtUriParts>;
  try {
    parsedUri = parseAtUriParts(subject);
  } catch {
    return xrpcErr(400, "InvalidSubject");
  }

  if (parsedUri.collection !== NSID.listingDetail) {
    return xrpcErr(400, "InvalidSubject");
  }

  const table = schema.storeListings;
  const { listingPublicWhere } = directoryListingXrpcHelpers;

  const [listing] = await db
    .select({ id: table.id, atUri: table.atUri })
    .from(table)
    .where(listingPublicWhere(table, eq(table.atUri, subject)))
    .limit(1);

  if (!listing) {
    return xrpcErr(404, "ListingNotFound");
  }

  const atUri = listing.atUri?.trim();
  if (!atUri) {
    return xrpcErr(400, "ListingNotOnNetwork");
  }

  const rev = schema.storeListingReviews;
  const [existing] = await db
    .select({ id: rev.id })
    .from(rev)
    .where(
      and(eq(rev.storeListingId, listing.id), eq(rev.authorDid, session.did)),
    )
    .limit(1);

  if (existing) {
    return xrpcErr(409, "AlreadyReviewed");
  }

  await ensureReviewerProfileLikeFirstLogin(session);

  const { uri, cid } = await createListingReviewRecord(
    session.client,
    session.did,
    {
      subject: atUri,
      rating,
      createdAt: createdAtIso,
      text: typeof text === "string" ? text : undefined,
    },
  );

  const { repo, rkey } = parseAtUriParts(uri);
  if (repo !== session.did) {
    return xrpcErr(500, "InvalidSubject", "Unexpected review record repo DID.");
  }

  const record: {
    $type: typeof NSID.listingReview;
    subject: string;
    rating: number;
    createdAt: string;
    text?: string;
  } = {
    $type: NSID.listingReview,
    subject: atUri,
    rating,
    createdAt: createdAtIso,
  };
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed) {
    record.text = trimmed;
  }

  await upsertListingReviewFromTap({
    db,
    did: repo,
    rkey,
    record,
  });

  const [reviewRow] = await db
    .select({ id: rev.id })
    .from(rev)
    .where(eq(rev.atUri, uri))
    .limit(1);

  if (!reviewRow) {
    return xrpcErr(
      500,
      "InvalidSubject",
      "Review was created but could not be mirrored locally.",
    );
  }

  return xrpcJson({ uri, cid, reviewId: reviewRow.id });
}

export async function handleAtstoreXrpc(
  request: Request,
  nsid: string,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const url = new URL(request.url);

  try {
    switch (nsid) {
      case ATSTORE_XRPC_METHOD.serverDescribe: {
        if (request.method !== "GET") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleDescribe();
      }

      case ATSTORE_XRPC_METHOD.directorySearchListings: {
        if (request.method !== "GET") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleSearchListings(url);
      }

      case ATSTORE_XRPC_METHOD.directoryGetListing: {
        if (request.method !== "GET") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleGetListing(url);
      }

      case ATSTORE_XRPC_METHOD.directoryResolveListing: {
        if (request.method !== "GET") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleResolveListing(url);
      }

      case ATSTORE_XRPC_METHOD.reviewsListForListing: {
        if (request.method !== "GET") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleListReviews(url, request);
      }

      case ATSTORE_XRPC_METHOD.reviewsSubmitReview: {
        if (request.method !== "POST") {
          return xrpcErr(405, "MethodNotAllowed");
        }
        return handleSubmitReview(request);
      }

      default: {
        return xrpcErr(404, "MethodNotFound");
      }
    }
  } catch (error) {
    console.error("atstore xrpc handler error", error);
    return xrpcErr(500, "InternalError");
  }
}
