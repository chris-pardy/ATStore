import type { SatoriOptions } from "satori";

import { createFileRoute } from "@tanstack/react-router";
import { db } from "#/db/index.server";
import * as schema from "#/db/schema";
import { fetchBlueskyPublicProfileFields } from "#/lib/bluesky-public-profile";
import { loadAppleEmojiAsset } from "#/lib/og-emoji.server";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  renderOg,
} from "#/lib/render-og.server";
import { and, eq } from "drizzle-orm";
import satori from "satori";

const OG_WIDTH = OG_IMAGE_WIDTH;
const OG_HEIGHT = OG_IMAGE_HEIGHT;
const INTER_REGULAR_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff";
const INTER_BOLD_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.woff";

/** Neutral surface — avoids brand blue so previews read clearly as “review” cards. */
const BG = "#fafafa";
const BORDER = "#e4e4e7";
const TEXT = "#18181b";
const TEXT_MUTED = "#71717a";
const SURFACE_SUBTLE = "#f4f4f5";

/**
 * Matches `Avatar` size `xl` in `design-system/avatar/index.tsx`: `size["5xl"]` (3.5rem),
 * `radius.xl` (~1.35rem), `uiColor.component1` / `border1`, `text1` for fallback initials.
 */
const AVATAR_OG_SIZE_PX = 80;
const AVATAR_OG_RADIUS = "22px";
const AVATAR_OG_BG = "#f2eff3";
const AVATAR_OG_BORDER = "#dbd8e0";
const AVATAR_OG_FALLBACK_TEXT = "#65636d";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OG excerpt body — must match `lineHeight` / `fontSize` on the Satori node below. */
const EXCERPT_FONT_SIZE_PX = 34;
const EXCERPT_LINE_HEIGHT = 1.42;
const EXCERPT_MAX_LINES = 5;
const EXCERPT_MAX_HEIGHT_PX = Math.round(
  EXCERPT_FONT_SIZE_PX * EXCERPT_LINE_HEIGHT * EXCERPT_MAX_LINES,
);

/** Total excerpt length cap (includes `\n` and trailing `…` when truncated). */
const EXCERPT_MAX_CHARS = 280;
/** Body width inside `padding: 40px 64px` on the OG frame. */
const EXCERPT_BODY_INNER_WIDTH_PX = OG_WIDTH - 128;
/**
 * Approximate Inter `400` average glyph width (~0.52em) × font size vs content width so manual
 * wraps line up with Satori at full width (avoids a short rag on the right). Slightly tight for
 * emoji / wide glyphs; `maxHeight` + {@link clampOgReviewExcerpt} still guard overflow.
 */
const EXCERPT_APPROX_CHARS_PER_LINE = Math.max(
  16,
  Math.floor(EXCERPT_BODY_INNER_WIDTH_PX / (EXCERPT_FONT_SIZE_PX * 0.52)),
);

type FontPair = { regular: ArrayBuffer; bold: ArrayBuffer };
let fontPromise: Promise<FontPair> | null = null;

async function fetchArrayBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load asset (${response.status}) from ${url}`);
  }

  return response.arrayBuffer();
}

async function getFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      fetchArrayBuffer(INTER_REGULAR_URL),
      fetchArrayBuffer(INTER_BOLD_URL),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }

  return fontPromise;
}

/** Collapse whitespace only — emoji and other characters pass through for Apple-emoji rendering. */
function normalizeOgText(value: string) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.replaceAll(/\s+/g, " ").trim();
}

/** Trim and CRLF normalization; keeps newlines for `whiteSpace: pre-wrap` OG excerpts. */
function normalizeOgMultilineBody(value: string) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Truncate for headings / author lines: counts grapheme clusters so we never bisect emoji or
 * ZWJ sequences (`String#slice` is UTF-16 and breaks those). Fallback matches {@link truncate}.
 */
function truncateGraphemeClusters(value: string, maxVisible: number): string {
  if (maxVisible <= 0 || !value) {
    return "";
  }

  try {
    const IntlWithSegmenter = Intl as typeof Intl & {
      Segmenter?: typeof Intl.Segmenter;
    };
    if (typeof IntlWithSegmenter.Segmenter === "function") {
      const segmenter = new IntlWithSegmenter.Segmenter(undefined, {
        granularity: "grapheme",
      });
      const segments = [...segmenter.segment(value)];
      if (segments.length <= maxVisible) {
        return value;
      }
      const head = segments
        .slice(0, maxVisible - 1)
        .map((s) => s.segment)
        .join("")
        .trimEnd();
      return `${head}…`;
    }
  } catch {
    // Fall through — older runtimes without Segmenter / invalid locale.
  }

  return truncate(value, maxVisible);
}

function wordWrapParagraph(para: string, maxCols: number): Array<string> {
  const out: Array<string> = [];
  const words = para.split(/\s+/).filter(Boolean);
  let current = "";

  const pushCurrent = () => {
    if (current) {
      out.push(current);
      current = "";
    }
  };

  const chunkWord = (word: string): Array<string> => {
    if (word.length <= maxCols) {
      return [word];
    }
    const chunks: Array<string> = [];
    for (let i = 0; i < word.length; i += maxCols) {
      chunks.push(word.slice(i, i + maxCols));
    }
    return chunks;
  };

  for (const word of words) {
    for (const piece of chunkWord(word)) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (candidate.length <= maxCols) {
        current = candidate;
      } else {
        pushCurrent();
        current = piece;
      }
    }
  }
  pushCurrent();
  return out.length > 0 ? out : [""];
}

/** Word-wrap each segment; explicit `\n` and blank lines become separate visual rows. */
function wordWrapMultilineBody(text: string, maxCols: number): Array<string> {
  const paragraphs = text.split("\n");
  const lines: Array<string> = [];
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    lines.push(...wordWrapParagraph(para, maxCols));
  }
  return lines;
}

/**
 * Enforces line + character limits for the OG card. When more wrapped lines exist than allowed,
 * or text exceeds the char cap, ends with `…` (same convention as {@link truncate}).
 */
function clampOgReviewExcerpt(
  text: string,
  maxLines: number,
  maxCharLength: number,
  maxCols: number,
): string {
  const ellipsis = "…";
  const wrapped = wordWrapMultilineBody(text, maxCols);
  const clippedByLines = wrapped.length > maxLines;
  const head = clippedByLines ? wrapped.slice(0, maxLines) : wrapped;
  let body = head.join("\n");

  if (!clippedByLines) {
    if (body.length <= maxCharLength) {
      return body;
    }
    return truncate(body, maxCharLength);
  }

  while (body.length + ellipsis.length > maxCharLength && body.length > 0) {
    body = body.slice(0, -1);
  }
  return `${body.trimEnd()}${ellipsis}`;
}

function formatDidShort(did: string) {
  const d = did.trim();
  if (d.length <= 28) return d;
  return `${d.slice(0, 16)}…${d.slice(-6)}`;
}

function ratingFractionLabel(rating: number) {
  const r = Math.max(1, Math.min(5, Math.round(Number(rating))));
  return `${String(r)} / 5`;
}

function initialsFrom(label: string) {
  const t =
    typeof label === "string" ? label.trim() : String(label ?? "").trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Remote image URLs for Satori `<img>`. Used when raster preload fails. */
function ogRemoteImgSrc(url: string | null | undefined): string | null {
  const t = typeof url === "string" ? url.trim() : "";
  if (!t || !/^https?:\/\//i.test(t)) {
    return null;
  }
  return t;
}

/**
 * Fetch + resize remote images before `satori()` so pixels are fully decoded (avatars/icons
 * reliably paint). Output is a small JPEG data URL — large raw `data:` blobs break Yoga.
 */
async function preloadOgRasterImageForSatori(
  url: string | null | undefined,
  displayEdgePx: number,
): Promise<string | undefined> {
  const src = ogRemoteImgSrc(url);
  if (!src) {
    return undefined;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(src, {
      signal: controller.signal,
      headers: { Accept: "image/*,*/*" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return undefined;
    }

    const input = Buffer.from(await res.arrayBuffer());
    if (input.byteLength === 0 || input.byteLength > 12_000_000) {
      return undefined;
    }

    const { default: sharp } = await import("sharp");

    const encode = async (edge: number, quality: number) =>
      sharp(input, { failOn: "none" })
        .rotate()
        .resize(edge, edge, { fit: "cover" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

    const edge = Math.min(384, Math.max(displayEdgePx * 2, displayEdgePx));
    let buf = await encode(edge, 84);
    if (buf.byteLength > 300_000) {
      buf = await encode(Math.min(192, edge), 78);
    }
    if (buf.byteLength > 350_000) {
      buf = await encode(128, 72);
    }

    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export const Route = createFileRoute("/og/review")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const listingId = url.searchParams.get("listingId")?.trim() ?? "";
          const reviewId = url.searchParams.get("reviewId")?.trim() ?? "";

          if (!UUID_RE.test(listingId) || !UUID_RE.test(reviewId)) {
            return new Response("Invalid listing or review id.", {
              status: 400,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }

          const listings = schema.storeListings;
          const rev = schema.storeListingReviews;

          const [row] = await db
            .select({
              listingName: listings.name,
              iconUrl: listings.iconUrl,
              reviewText: rev.text,
              rating: rev.rating,
              authorDid: rev.authorDid,
              authorDisplayName: rev.authorDisplayName,
              authorAvatarUrl: rev.authorAvatarUrl,
            })
            .from(rev)
            .innerJoin(listings, eq(rev.storeListingId, listings.id))
            .where(
              and(
                eq(listings.verificationStatus, "verified"),
                eq(listings.id, listingId),
                eq(rev.id, reviewId),
              ),
            )
            .limit(1);

          if (!row) {
            return new Response("Review not found.", {
              status: 404,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }

          const profile = await fetchBlueskyPublicProfileFields(row.authorDid);
          const dbDisplay =
            row.authorDisplayName == null
              ? null
              : String(row.authorDisplayName).trim() || null;
          const dbAvatar =
            row.authorAvatarUrl == null
              ? null
              : String(row.authorAvatarUrl).trim() || null;

          const displayName =
            dbDisplay ||
            (profile?.displayName == null
              ? null
              : String(profile.displayName).trim() || null);
          const handleFromProfile =
            profile?.handle == null ? "" : String(profile.handle).trim();
          const handleRaw = handleFromProfile.replace(/^@/, "") || null;
          const handleLabel = handleRaw ? `@${handleRaw}` : null;

          const primaryLine =
            displayName || handleLabel || formatDidShort(row.authorDid);
          const secondaryLine = displayName && handleLabel ? handleLabel : null;

          const profileAvatarTrimmed =
            profile?.avatarUrl == null
              ? null
              : String(profile.avatarUrl).trim() || null;
          const avatarUrlMerged = dbAvatar || profileAvatarTrimmed;

          const [iconImgPreloaded, avatarImgPreloaded] = await Promise.all([
            preloadOgRasterImageForSatori(
              row.iconUrl == null ? null : String(row.iconUrl),
              120,
            ),
            preloadOgRasterImageForSatori(avatarUrlMerged, AVATAR_OG_SIZE_PX),
          ]);

          const iconImgSrc =
            iconImgPreloaded ??
            ogRemoteImgSrc(row.iconUrl == null ? null : String(row.iconUrl));
          const avatarImgSrc =
            avatarImgPreloaded ?? ogRemoteImgSrc(avatarUrlMerged);

          const listingNameRaw =
            row.listingName == null ? "" : String(row.listingName).trim();
          const listingTitle = truncateGraphemeClusters(
            normalizeOgText(listingNameRaw) || "Product",
            64,
          );

          const reviewRaw =
            row.reviewText == null ? "" : String(row.reviewText).trim();
          const reviewNorm = normalizeOgMultilineBody(reviewRaw);
          const hasWrittenReview = Boolean(reviewNorm);
          const reviewPlain = hasWrittenReview ? reviewNorm : "";
          const excerpt = hasWrittenReview
            ? clampOgReviewExcerpt(
                reviewPlain,
                EXCERPT_MAX_LINES,
                EXCERPT_MAX_CHARS,
                EXCERPT_APPROX_CHARS_PER_LINE,
              )
            : "";

          const ratingText = ratingFractionLabel(row.rating);

          const { regular, bold } = await getFonts();

          const svg = await satori(
            <div
              style={{
                backgroundColor: BG,
                borderColor: BORDER,
                borderStyle: "solid",
                borderWidth: "2px",
                color: TEXT,
                display: "flex",
                flexDirection: "column",
                fontFamily: "Inter",
                height: "100%",
                padding: "40px 64px",
                width: "100%",
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  flexDirection: "row",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    backgroundColor: SURFACE_SUBTLE,
                    borderColor: BORDER,
                    borderRadius: "24px",
                    borderStyle: "solid",
                    borderWidth: "1px",
                    display: "flex",
                    flexShrink: 0,
                    height: "120px",
                    justifyContent: "center",
                    marginRight: "32px",
                    overflow: "hidden",
                    width: "120px",
                  }}
                >
                  {iconImgSrc ? (
                    <img
                      alt=""
                      src={iconImgSrc}
                      height={120}
                      width={120}
                      style={{
                        height: "120px",
                        objectFit: "cover",
                        width: "120px",
                        overflow: "hidden",
                        borderRadius: "24px",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        color: TEXT_MUTED,
                        fontSize: "44px",
                        fontWeight: 700,
                      }}
                    >
                      @
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: TEXT_MUTED,
                      fontSize: "22px",
                      fontWeight: 700,
                      letterSpacing: "0.14em",
                      marginBottom: "10px",
                      textTransform: "uppercase",
                    }}
                  >
                    Review
                  </div>
                  <div
                    style={{
                      color: TEXT,
                      display: "flex",
                      flexWrap: "wrap",
                      fontSize: "46px",
                      fontWeight: 700,
                      lineHeight: 1.12,
                    }}
                  >
                    {listingTitle}
                  </div>
                </div>
                <div
                  style={{
                    alignItems: "flex-end",
                    display: "flex",
                    flexDirection: "column",
                    flexShrink: 0,
                    marginLeft: "28px",
                  }}
                >
                  <div
                    style={{
                      color: TEXT_MUTED,
                      fontSize: "22px",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      marginBottom: "8px",
                      textTransform: "uppercase",
                    }}
                  >
                    Rating
                  </div>
                  <div
                    style={{
                      color: TEXT,
                      fontSize: "40px",
                      fontWeight: 700,
                      lineHeight: 1.1,
                    }}
                  >
                    {ratingText}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  marginTop: "36px",
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    alignItems: hasWrittenReview ? "stretch" : "center",
                    display: "flex",
                    flexDirection: "column",
                    flexGrow: 1,
                    justifyContent: hasWrittenReview ? "flex-start" : "center",
                    minHeight: 0,
                    width: "100%",
                  }}
                >
                  {hasWrittenReview ? (
                    <div
                      style={{
                        alignSelf: "stretch",
                        color: TEXT,
                        fontSize: `${EXCERPT_FONT_SIZE_PX}px`,
                        fontWeight: 400,
                        lineHeight: EXCERPT_LINE_HEIGHT,
                        marginBottom: "28px",
                        maxHeight: `${EXCERPT_MAX_HEIGHT_PX}px`,
                        overflow: "hidden",
                        whiteSpace: "pre-wrap",
                        width: "100%",
                        wordWrap: "break-word",
                      }}
                    >
                      {excerpt}
                    </div>
                  ) : (
                    <div
                      style={{
                        color: TEXT_MUTED,
                        fontSize: "28px",
                        fontWeight: 400,
                        lineHeight: 1.45,
                        marginBottom: "28px",
                        textAlign: "center",
                      }}
                    >
                      No written review.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderTopColor: BORDER,
                    borderTopStyle: "solid",
                    borderTopWidth: "1px",
                    display: "flex",
                    flexDirection: "column",
                    flexShrink: 0,
                    paddingTop: "28px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      flexDirection: "row",
                    }}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        backgroundColor: AVATAR_OG_BG,
                        borderColor: AVATAR_OG_BORDER,
                        borderRadius: AVATAR_OG_RADIUS,
                        borderStyle: "solid",
                        borderWidth: "1px",
                        display: "flex",
                        flexShrink: 0,
                        height: `${AVATAR_OG_SIZE_PX}px`,
                        justifyContent: "center",
                        marginRight: "16px",
                        overflow: "hidden",
                        width: `${AVATAR_OG_SIZE_PX}px`,
                      }}
                    >
                      {avatarImgSrc ? (
                        <img
                          alt=""
                          src={avatarImgSrc}
                          height={AVATAR_OG_SIZE_PX}
                          width={AVATAR_OG_SIZE_PX}
                          style={{
                            height: `${AVATAR_OG_SIZE_PX}px`,
                            objectFit: "cover",
                            objectPosition: "center",
                            width: `${AVATAR_OG_SIZE_PX}px`,
                            overflow: "hidden",
                            borderRadius: AVATAR_OG_RADIUS,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            alignItems: "center",
                            color: AVATAR_OG_FALLBACK_TEXT,
                            display: "flex",
                            fontSize: "20px",
                            fontWeight: 500,
                            justifyContent: "center",
                            lineHeight: 1,
                          }}
                        >
                          {initialsFrom(primaryLine)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          color: TEXT,
                          display: "flex",
                          flexWrap: "wrap",
                          fontSize: "32px",
                          fontWeight: 700,
                          marginBottom: secondaryLine ? "8px" : "0px",
                        }}
                      >
                        {truncateGraphemeClusters(primaryLine, 52)}
                      </div>
                      {secondaryLine ? (
                        <div
                          style={{
                            color: TEXT_MUTED,
                            display: "flex",
                            flexWrap: "wrap",
                            fontSize: "26px",
                            fontWeight: 500,
                          }}
                        >
                          {truncateGraphemeClusters(secondaryLine, 56)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            {
              width: OG_WIDTH,
              height: OG_HEIGHT,
              fonts: [
                { name: "Inter", data: regular, weight: 400, style: "normal" },
                { name: "Inter", data: bold, weight: 700, style: "normal" },
              ],
              loadAdditionalAsset: loadAppleEmojiAsset as NonNullable<
                SatoriOptions["loadAdditionalAsset"]
              >,
            },
          );

          return renderOg(svg, { width: OG_WIDTH, height: OG_HEIGHT });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not render OG image.";

          return new Response(message, {
            status: 500,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          });
        }
      },
    },
  },
});
