"use client";

/**
 * `<FundingPopoverChip/>` — pill chip on the project links row that opens a popover
 * showing the steward's at.fund channels, plans, and dependency graph. Mirrors the
 * `<ListingOAuthScopesPopoverChip/>` pattern so the funding affordance reads as one
 * more piece of project metadata alongside scopes / Germ / project links.
 */
import type {
  FundingChannelView,
  FundingDependencyView,
  FundingDetail,
  FundingPlanView,
} from "#/lib/atproto/load-funding-summaries";

import * as stylex from "@stylexjs/stylex";
import { Avatar } from "#/design-system/avatar";
import { Button } from "#/design-system/button";
import { Flex } from "#/design-system/flex";
import { Popover } from "#/design-system/popover";
import { Separator } from "#/design-system/separator";
import { uiColor } from "#/design-system/theme/color.stylex";
import { radius } from "#/design-system/theme/radius.stylex";
import {
  gap,
  horizontalSpace,
  verticalSpace,
} from "#/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize } from "#/design-system/theme/typography.stylex";
import { SmallBody } from "#/design-system/typography";
import { Text } from "#/design-system/typography/text";
import {
  deriveChannelLabel,
  formatFundingAmount,
} from "#/lib/atproto/fund-format";
import { urlsMatch } from "#/lib/atproto/load-funding-summaries";
import { getInitials } from "#/lib/get-initials";
import { ArrowRight, ExternalLink, HeartHandshake } from "lucide-react";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";

const styles = stylex.create({
  /**
   * Pill trigger for the popover — mirrors `ListingOAuthScopesPopoverChip` so the
   * Funding chip sits flush in the project-links row alongside Scopes / Germ.
   */
  chipTrigger: {
    borderColor: uiColor.border1,
    borderRadius: radius.full,
    borderStyle: "solid",
    borderWidth: 1,
    textDecoration: "none",
    alignItems: "center",
    backgroundColor: {
      default: uiColor.component1,
      ":hover": uiColor.component2,
    },
    color: uiColor.text2,
    cursor: "pointer",
    display: "inline-flex",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    outlineColor: { ":focus-visible": uiColor.border2 },
    outlineOffset: { ":focus-visible": 2 },
    outlineStyle: { ":focus-visible": "solid" },
    outlineWidth: { ":focus-visible": 2 },
    paddingBottom: verticalSpace.sm,
    paddingLeft: horizontalSpace.xl,
    paddingRight: horizontalSpace.xl,
    paddingTop: verticalSpace.sm,
  },
  chipInner: {
    gap: gap.sm,
    alignItems: "center",
    display: "inline-flex",
  },
  popoverSurface: {
    maxHeight: "min(480px, 78vh)",
    maxWidth: "min(432px, 94vw)",
    overflowX: "hidden",
    overflowY: "auto",
  },
  /** Sub-label for the "Depends on" block (small caps, like a tag). */
  sectionLabel: {
    color: uiColor.text2,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  /**
   * Pill-shaped channel/plan combo chip — same neutral palette as the surrounding
   * link chips so funding pills sit alongside other project links without competing
   * for attention.
   */
  channelPill: {
    borderColor: uiColor.border1,
    borderRadius: radius.full,
    borderStyle: "solid",
    borderWidth: 1,
    gap: gap.sm,
    paddingBlock: verticalSpace.sm,
    paddingInline: horizontalSpace.xl,
    textDecoration: "none",
    alignItems: "center",
    backgroundColor: {
      default: uiColor.component1,
      ":hover": uiColor.component2,
    },
    color: uiColor.text1,
    cursor: "pointer",
    display: "inline-flex",
    fontWeight: 600,
  },
  channelPillStatic: {
    cursor: "default",
  },
  channelPillPrice: {
    color: uiColor.text2,
    fontWeight: 500,
  },
  /** Each "Depends on" row — full row clickable, plain link semantics. */
  dependsRow: {
    borderRadius: radius.md,
    gap: gap.lg,
    paddingBlock: verticalSpace.sm,
    paddingInline: horizontalSpace.sm,
    textDecoration: "none",
    alignItems: "center",
    backgroundColor: {
      default: "transparent",
      ":hover": uiColor.component2,
    },
    color: uiColor.text1,
    cursor: "pointer",
    display: "flex",
  },
  dependsName: {
    flexGrow: 1,
    fontWeight: 600,
    minWidth: 0,
  },
  arrow: {
    color: uiColor.text2,
    flexShrink: 0,
    height: "1rem",
    width: "1rem",
  },
});

/**
 * Index plans by the channels they reference. at.fund's design suffixes each channel
 * pill with its plan price (e.g. "Open Collective $10/mo") — denser than rendering
 * plans separately. Plans without a channel reference are surfaced as standalone pills.
 */
function buildChannelPlanIndex(
  plans: ReadonlyArray<FundingPlanView>,
): Map<string, FundingPlanView> {
  const out = new Map<string, FundingPlanView>();
  for (const plan of plans) {
    if (plan.status === "inactive") continue;
    for (const atUri of plan.channelAtUris) {
      if (!out.has(atUri)) out.set(atUri, plan);
    }
  }
  return out;
}

/**
 * Hide the chip entirely when the steward declared themselves but published nothing
 * actionable — no contribute URL, no channels/plans, no dependencies. Avoids a chip
 * that opens to an empty popover.
 */
function hasActionableFunding(funding: FundingDetail): boolean {
  return (
    Boolean(funding.contribute?.url) ||
    funding.channels.length > 0 ||
    funding.plans.length > 0 ||
    funding.dependencies.length > 0
  );
}

export function FundingPopoverChip({
  funding,
  productName,
  productAccountHandle,
  productAccountDid,
}: {
  funding: FundingDetail | null;
  productName: string;
  /** Steward's resolved Bluesky handle — preferred for the at.fund profile URL. */
  productAccountHandle: string | null;
  /** Steward's DID — fallback for the at.fund profile URL when no handle is set. */
  productAccountDid: string | null;
}) {
  if (!funding || !hasActionableFunding(funding)) return null;

  return (
    <Popover
      placement="bottom start"
      trigger={
        <AriaButton
          slot="trigger"
          aria-haspopup="dialog"
          aria-label={`View funding options for ${productName}`}
          {...stylex.props(styles.chipTrigger)}
        >
          <span {...stylex.props(styles.chipInner)}>
            <HeartHandshake aria-hidden size={14} strokeWidth={2} />
            <span>Funding</span>
          </span>
        </AriaButton>
      }
      style={styles.popoverSurface}
    >
      <FundingPopoverContent
        funding={funding}
        productName={productName}
        productAccountHandle={productAccountHandle}
        productAccountDid={productAccountDid}
      />
    </Popover>
  );
}

function FundingPopoverContent({
  funding,
  productName,
  productAccountHandle,
  productAccountDid,
}: {
  funding: FundingDetail;
  productName: string;
  productAccountHandle: string | null;
  productAccountDid: string | null;
}) {
  const { contribute, channels, plans, dependencies } = funding;
  const channelPlan = buildChannelPlanIndex(plans);
  const unattachedPlans = plans.filter(
    (plan) => plan.channelAtUris.length === 0 && plan.status !== "inactive",
  );
  /**
   * Show the contribute button only when the steward's `funding.contribute.url` adds
   * info beyond the channel pills — either no channels exist or none of them carry the
   * same URL. Channel URLs that already cover the contribute link would render two
   * affordances pointing at the same place, so dedupe loosely (trailing slash / case
   * insensitive) via `urlsMatch`.
   */
  const contributeUrl = contribute?.url ?? null;
  const showContributeButton =
    contributeUrl != null &&
    !channels.some((channel) => urlsMatch(channel.channelUri, contributeUrl));
  const hasChips = channels.length > 0 || unattachedPlans.length > 0;
  /**
   * Deep link to the steward's at.fund profile so people can see the canonical
   * funding page (with the full channel/plan/graph layout). Handle is preferred for a
   * human-readable URL; DID is the fallback for stewards whose handle hasn't resolved.
   */
  const atFundIdentifier =
    productAccountHandle?.trim() || productAccountDid?.trim() || null;
  const atFundProfileHref = atFundIdentifier
    ? `https://www.at.fund/${atFundIdentifier}`
    : null;

  return (
    <Flex direction="column" gap="2xl">
      <Flex align="center" gap="md" justify="between" wrap>
        <Text size="lg" weight="semibold">
          Funding
        </Text>
        {atFundProfileHref ? (
          <Button
            variant="tertiary"
            size="sm"
            href={atFundProfileHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${productName} on at.fund (opens in new tab)`}
          >
            View on at.fund
            <ExternalLink />
          </Button>
        ) : null}
      </Flex>

      {showContributeButton || hasChips ? (
        <Flex wrap align="center" gap="sm">
          {/**
           * Fund button takes the lead in the chips row when the contribute URL adds
           * info beyond the channel pills — for stewards with no channel records (e.g.
           * just a `funding.contribute` self) this is the only affordance and replaces
           * what would otherwise be an empty pills row.
           */}
          {showContributeButton ? (
            <Button
              variant="secondary"
              href={contributeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Fund ${productName} (opens ${contributeUrl} in a new tab)`}
            >
              <HeartHandshake />
              {contribute?.label?.trim() || "Fund"}
            </Button>
          ) : null}
          {channels.map((channel) => (
            <FundingChannelPill
              key={channel.atUri}
              channel={channel}
              plan={channelPlan.get(channel.atUri) ?? null}
            />
          ))}
          {unattachedPlans.map((plan) => (
            <FundingPlanPill key={plan.atUri} plan={plan} />
          ))}
        </Flex>
      ) : null}

      {dependencies.length > 0 ? (
        <>
          <Separator />
          <Flex direction="column" gap="md">
            <SmallBody style={styles.sectionLabel}>Depends on</SmallBody>
            <Flex direction="column" gap="xs">
              {dependencies.map((dep) => (
                <FundingDependencyRow key={dep.atUri} dependency={dep} />
              ))}
            </Flex>
          </Flex>
        </>
      ) : null}
    </Flex>
  );
}

function FundingChannelPill({
  channel,
  plan,
}: {
  channel: FundingChannelView;
  plan: FundingPlanView | null;
}) {
  const label = deriveChannelLabel(channel);
  const price = plan
    ? formatFundingAmount(plan.amount, plan.currency, plan.frequency)
    : null;
  const isLink =
    channel.channelUri && /^https?:/.test(channel.channelUri.trim());

  const inner = (
    <>
      <span>{label}</span>
      {price ? (
        <span {...stylex.props(styles.channelPillPrice)}>{price}</span>
      ) : null}
    </>
  );

  if (isLink && channel.channelUri) {
    return (
      <AriaLink
        href={channel.channelUri}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(styles.channelPill)}
        aria-label={
          price
            ? `${label} — ${price} (opens in new tab)`
            : `${label} (opens in new tab)`
        }
      >
        {inner}
      </AriaLink>
    );
  }
  return (
    <span
      {...stylex.props(styles.channelPill, styles.channelPillStatic)}
      aria-label={price ? `${label} — ${price}` : label}
    >
      {inner}
    </span>
  );
}

/** Channel-less plan: render the plan name + price as its own pill. */
function FundingPlanPill({ plan }: { plan: FundingPlanView }) {
  const price = formatFundingAmount(plan.amount, plan.currency, plan.frequency);
  return (
    <span
      {...stylex.props(styles.channelPill, styles.channelPillStatic)}
      aria-label={price ? `${plan.name} — ${price}` : plan.name}
    >
      <span>{plan.name}</span>
      {price ? (
        <span {...stylex.props(styles.channelPillPrice)}>{price}</span>
      ) : null}
    </span>
  );
}

/**
 * "Depends on" row — avatar + handle/displayName + arrow. Clicks open the upstream
 * entity's at.fund profile so people land on the steward's funding page (with all
 * their channels/plans) rather than their generic Bluesky profile. Prefers handle
 * when resolved so the URL is human-readable; falls back to the DID otherwise.
 */
function FundingDependencyRow({
  dependency,
}: {
  dependency: FundingDependencyView;
}) {
  const name =
    dependency.label?.trim() ||
    dependency.displayName?.trim() ||
    dependency.handle?.trim() ||
    dependency.subjectDid;
  const handle = dependency.handle?.trim();
  const href = `https://www.at.fund/${handle || dependency.subjectDid}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} on at.fund (opens in new tab)`}
      {...stylex.props(styles.dependsRow)}
    >
      <Avatar
        size="md"
        alt={name}
        fallback={getInitials(name)}
        src={dependency.avatarUrl ?? undefined}
      />
      <Text size="base" weight="semibold" style={styles.dependsName}>
        {name}
      </Text>
      <ArrowRight {...stylex.props(styles.arrow)} aria-hidden />
    </a>
  );
}
