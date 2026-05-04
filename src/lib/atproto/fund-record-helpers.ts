/**
 * Shared helpers for the five `tap-fund-*-sync.ts` modules. Each fund collection ingester
 * needs the same three primitives:
 *
 *   1. `cloneRecordJson` — deep clone the inbound record body for storage in `record_json`,
 *      so we can re-derive new columns later without re-crawling. structuredClone first,
 *      JSON fallback for environments where it throws.
 *   2. `parseRecordCreatedAt` — turn the optional `createdAt` ISO string into a Date or null.
 *   3. `atUriFor` — assemble `at://<did>/<collection>/<rkey>`; the per-table at-URI helpers
 *      used to live in each sync module before this consolidation.
 */
export function cloneRecordJson(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(body) as Record<string, unknown>;
    } catch {
      // structuredClone can throw on exotic values; fall through to JSON below.
    }
  }
  // eslint-disable-next-line unicorn/prefer-structured-clone -- last-resort deep clone when structuredClone is unavailable or throws
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

/** Parse an optional ISO timestamp from the record body. Returns null on missing/invalid. */
export function parseRecordCreatedAt(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compose `at://<did>/<collection>/<rkey>` for an upsert target. */
export function atUriFor(
  did: string,
  collection: string,
  rkey: string,
): string {
  return `at://${did}/${collection}/${rkey}`;
}
