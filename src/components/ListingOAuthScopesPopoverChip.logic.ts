import type { DirectoryListingOAuthProbe } from "../integrations/tanstack-query/api-directory-listings.functions";
import type { SummaryScopeHumanRow } from "../lib/oauth-listing-auth-probe";
import {
  atprotoPermissionScopeResource,
  parseIncludeScopeToken,
} from "../lib/oauth-scope-include-parse";

/** Baseline OAuth scope token; surfaced as plain-language consent (matches typical host consent screen). */
const BASELINE_ACCOUNT_SCOPE = "atproto";

/** Parseable grouping for merged probe tokens (`repo:`, `include:…`, transitional, …). */
type ScopeBucket =
  | "profile"
  | "bundle"
  | "repo"
  | "blob"
  | "api"
  | "transitional"
  | "other";

export const BUCKET_LABEL: Record<ScopeBucket, string> = {
  profile: "Wants access to your account",
  bundle: "Included permission bundles",
  repo: "Manage records",
  blob: "Files & blobs",
  api: "API",
  transitional: "Legacy broad access",
  other: "Other",
};

const BUCKET_ORDER: Array<ScopeBucket> = [
  "profile",
  "bundle",
  "repo",
  "blob",
  "api",
  "transitional",
  "other",
];

type StorefrontSyntheticBaselineConsent = SummaryScopeHumanRow & {
  storefrontSyntheticBaselineConsent: true;
};

export function isSyntheticBaselineConsentRow(
  row: SummaryScopeHumanRow,
): boolean {
  return (
    (
      row as SummaryScopeHumanRow & {
        storefrontSyntheticBaselineConsent?: boolean;
      }
    ).storefrontSyntheticBaselineConsent === true
  );
}

/** Mirrors host consent wording; hides the bare `atproto` token elsewhere. */
function baselineConsentSyntheticRow(): SummaryScopeHumanRow {
  const row: StorefrontSyntheticBaselineConsent = {
    token: BASELINE_ACCOUNT_SCOPE,
    description: BUCKET_LABEL.profile,
    storefrontSyntheticBaselineConsent: true,
  };
  return row;
}

/** Warn only when the app's published OAuth client metadata `scope` field lists `transition:generic`. */
export function oauthProbeClientListsTransitionGeneric(
  probe: DirectoryListingOAuthProbe,
): boolean {
  const line = probe.clientScopeRawLine;
  if (!line?.trim()) return false;
  const tokens = line
    .replaceAll("\u00A0", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.includes("transition:generic");
}

function scopeTokenBucket(token: string): ScopeBucket {
  const t = token.trim();
  if (!t) return "other";
  if (parseIncludeScopeToken(t) !== null) return "bundle";
  if (t === "atproto") return "profile";
  if (t.startsWith("transition:")) return "transitional";
  const res = atprotoPermissionScopeResource(t);
  if (res === "repo") return "repo";
  if (res === "blob") return "blob";
  if (res === "rpc") return "api";
  return "other";
}

/** Human-readable probe rows grouped for display. Empty buckets omitted. */
export function groupScopeHumanRows(
  rows: Array<SummaryScopeHumanRow>,
): Array<{ bucket: ScopeBucket; rows: Array<SummaryScopeHumanRow> }> {
  const map = new Map<ScopeBucket, Array<SummaryScopeHumanRow>>();
  for (const row of rows) {
    const bucket = scopeTokenBucket(row.token);
    const next = map.get(bucket) ?? [];
    next.push(row);
    map.set(bucket, next);
  }
  return BUCKET_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
    bucket: b,
    rows: map.get(b) ?? [],
  }));
}

/** Fallback when we only have loose tokens (no `scopeHumanReadable` rows). */
function groupPlainTokens(tokens: Array<string>): Array<{
  bucket: ScopeBucket;
  tokens: Array<string>;
}> {
  const map = new Map<ScopeBucket, Array<string>>();
  const sorted = [...tokens].toSorted((a, b) => a.localeCompare(b));
  for (const t of sorted) {
    const bucket = scopeTokenBucket(t);
    const next = map.get(bucket) ?? [];
    next.push(t);
    map.set(bucket, next);
  }
  return BUCKET_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
    bucket: b,
    tokens: map.get(b) ?? [],
  }));
}

/** Storefront prefers client_metadata tokens — merged AS catalogs only when unpublished. */
export function storefrontClientScopeLensActive(
  probe: DirectoryListingOAuthProbe,
): boolean {
  return probe.oauthClientScopesDistinct.length > 0;
}

function storefrontScopeHumanReadable(
  probe: DirectoryListingOAuthProbe,
): Array<SummaryScopeHumanRow> {
  if (!storefrontClientScopeLensActive(probe)) {
    return probe.scopeHumanReadable;
  }
  const allow = new Set(probe.oauthClientScopesDistinct);
  return probe.scopeHumanReadable.filter((r) => allow.has(r.token));
}

function storefrontPlainScopeTokens(
  probe: DirectoryListingOAuthProbe,
): Array<string> {
  if (!storefrontClientScopeLensActive(probe)) {
    return [
      ...new Set([...probe.oauthScopesDistinct, ...probe.transitionalScopes]),
    ];
  }
  return probe.oauthClientScopesDistinct;
}

export function storefrontScopesPopoverListInputs(
  probe: DirectoryListingOAuthProbe,
): {
  humansForGrouped: Array<SummaryScopeHumanRow>;
  plainGrouped: ReturnType<typeof groupPlainTokens>;
} {
  const humanRaw = storefrontScopeHumanReadable(probe);
  const plainRaw = storefrontPlainScopeTokens(probe);

  const baselineRequested =
    humanRaw.some(
      (r) => r.token.trim().toLowerCase() === BASELINE_ACCOUNT_SCOPE,
    ) ||
    plainRaw.some((t) => t.trim().toLowerCase() === BASELINE_ACCOUNT_SCOPE);

  const humanWithoutBaselineToken = humanRaw.filter(
    (r) => r.token.trim().toLowerCase() !== BASELINE_ACCOUNT_SCOPE,
  );
  const plainWithoutBaselineToken = plainRaw.filter(
    (t) => t.trim().toLowerCase() !== BASELINE_ACCOUNT_SCOPE,
  );

  const humansForGrouped: Array<SummaryScopeHumanRow> = [
    ...(baselineRequested ? [baselineConsentSyntheticRow()] : []),
    ...humanWithoutBaselineToken,
  ];

  let plainGrouped = groupPlainTokens(plainWithoutBaselineToken);

  if (baselineRequested) {
    plainGrouped = [
      {
        bucket: "profile",
        tokens: [BUCKET_LABEL.profile],
      },
      ...plainGrouped.filter((g) => g.bucket !== "profile"),
    ];
  }

  return { humansForGrouped, plainGrouped };
}

function storefrontScopesPopoverHasListContent(
  probe: DirectoryListingOAuthProbe,
): boolean {
  const { humansForGrouped, plainGrouped } =
    storefrontScopesPopoverListInputs(probe);
  return humansForGrouped.length > 0 || plainGrouped.length > 0;
}

/** Whether the storefront URL row should include the OAuth scopes chip. */
export function listingOAuthScopesPopoverChipShouldRender(props: {
  oauthProbe: DirectoryListingOAuthProbe | null;
}): boolean {
  const { oauthProbe } = props;
  if (
    oauthProbe == null ||
    oauthProbe.status === "skipped_no_url" ||
    oauthProbe.status === "error"
  ) {
    return true;
  }
  if (oauthProbeClientListsTransitionGeneric(oauthProbe)) {
    return true;
  }
  return storefrontScopesPopoverHasListContent(oauthProbe);
}
