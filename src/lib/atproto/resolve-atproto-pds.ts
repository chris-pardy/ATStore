/**
 * Resolve the personal data server origin (no trailing slash) for a DID.
 * Uses `@atcute/identity-resolver`: `did:plc` via plc.directory and `did:web`
 * via the host's DID document (`/.well-known/did.json` or DID URL rules).
 */
import type { Did } from "@atcute/lexicons/syntax";

import {
  CompositeDidDocumentResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
} from "@atcute/identity-resolver";

function pdsOriginFromDidLikeDoc(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const raw = (doc as { service?: unknown }).service;
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as {
      id?: string;
      type?: string;
      serviceEndpoint?: string | string[];
    };
    if (s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer") {
      const ep = s.serviceEndpoint;
      const url = Array.isArray(ep) ? ep[0] : ep;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        return url.replace(/\/+$/, "");
      }
    }
  }
  return null;
}

let compositeDidResolver:
  | CompositeDidDocumentResolver<"plc" | "web">
  | undefined;

function getCompositeDidResolver(): CompositeDidDocumentResolver<
  "plc" | "web"
> {
  compositeDidResolver ??= new CompositeDidDocumentResolver({
    methods: {
      plc: new PlcDidDocumentResolver(),
      web: new WebDidDocumentResolver(),
    },
  });
  return compositeDidResolver;
}

export async function resolveAtprotoPdsBaseUrl(
  did: string,
): Promise<string | null> {
  const trimmed = did.trim();
  if (!trimmed.startsWith("did:")) return null;
  try {
    const doc = await getCompositeDidResolver().resolve(
      trimmed as Did<"plc" | "web">,
    );
    return pdsOriginFromDidLikeDoc(doc);
  } catch {
    return null;
  }
}
