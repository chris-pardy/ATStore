import type { Client } from "@atcute/client";

export type GermMessageMePayload = {
  messageMeUrl: string;
  showButtonTo: string;
};

/**
 * Parses `messageMe` from a mirrored `com.germnetwork.declaration` record JSON body.
 * Returns null when messaging is disabled (`showButtonTo === "none"`) or fields are absent.
 */
export function extractGermMessageMe(
  recordJson: unknown,
): GermMessageMePayload | null {
  if (!recordJson || typeof recordJson !== "object") return null;
  const o = recordJson as Record<string, unknown>;
  const mm = o.messageMe;
  if (!mm || typeof mm !== "object" || Array.isArray(mm)) return null;
  const m = mm as Record<string, unknown>;
  const messageMeUrl =
    typeof m.messageMeUrl === "string" ? m.messageMeUrl.trim() : "";
  const showButtonTo =
    typeof m.showButtonTo === "string" ? m.showButtonTo.trim() : "";
  if (!messageMeUrl || !showButtonTo) return null;
  if (showButtonTo === "none") return null;
  return { messageMeUrl, showButtonTo };
}

/**
 * Germ spec: fragment is `[profile/messagee DID]+[viewer's DID]` (see Germ AppView guidance).
 * Path may include a platform segment before `#`, e.g. `.../web#subjectDid+viewerDid`.
 */
export function buildGermWebDmHref(
  messageMeUrl: string,
  viewerDid: string,
  subjectDid: string,
): string {
  const base = messageMeUrl.trim().replace(/\/+$/, "");
  const v = viewerDid.trim();
  const s = subjectDid.trim();
  return `${base}/web#${s}+${v}`;
}

type GetProfileResponse = {
  ok: boolean;
  data?: { viewer?: { followedBy?: string | null } };
};

/** Bluesky query not on default Client typings; runtime handler supports it when session is OAuth-backed. */
async function appBskyActorGetProfile(
  client: Client,
  actor: string,
): Promise<GetProfileResponse> {
  const untyped = client as unknown as {
    get(
      nsid: string,
      opts: { params: { actor: string } },
    ): Promise<GetProfileResponse>;
  };
  return untyped.get("app.bsky.actor.getProfile", {
    params: { actor },
  });
}

async function profileActorFollowsViewer(
  client: Client,
  profileActorDid: string,
): Promise<boolean> {
  try {
    const res = await appBskyActorGetProfile(client, profileActorDid);
    if (!res.ok || !res.data) return false;
    const followedBy = res.data.viewer?.followedBy;
    return typeof followedBy === "string" && followedBy.length > 0;
  } catch {
    return false;
  }
}

/**
 * Grain visibility rules (`social.grain` / declaration lexicon semantics):
 * - Same DID as viewer: do not show — the fragment would be `did+did` (same twice) and Germ treats that as a self-DM.
 * - `everyone`: show.
 * - `usersIFollow`: show when the subject follows the viewer (`viewer.followedBy` on profile).
 */
async function shouldShowGermDmButton(opts: {
  showButtonTo: string;
  viewerDid: string;
  subjectDid: string;
  client: Client | undefined;
}): Promise<boolean> {
  const viewerDid = opts.viewerDid.trim();
  const subjectDid = opts.subjectDid.trim();

  if (viewerDid === subjectDid) return false;

  const policy = opts.showButtonTo.trim();
  if (policy === "everyone") return true;

  if (policy === "usersIFollow") {
    if (!opts.client) return false;
    return profileActorFollowsViewer(opts.client, subjectDid);
  }

  return false;
}

export async function resolveGermDmHrefFromRecordJson(input: {
  recordJson: unknown;
  viewerDid: string | undefined;
  subjectDid: string;
  client: Client | undefined;
}): Promise<string | null> {
  const mm = extractGermMessageMe(input.recordJson);
  if (!mm) return null;

  const viewerDid = input.viewerDid?.trim();
  if (!viewerDid?.startsWith("did:")) return null;

  const subjectDid = input.subjectDid.trim();
  if (!subjectDid.startsWith("did:")) return null;

  const okShow = await shouldShowGermDmButton({
    showButtonTo: mm.showButtonTo,
    viewerDid,
    subjectDid,
    client: input.client,
  });
  if (!okShow) return null;

  return buildGermWebDmHref(mm.messageMeUrl, viewerDid, subjectDid);
}
