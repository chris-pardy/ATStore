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
import { getInitials } from "#/lib/get-initials";
import { ArrowRight, HeartHandshake } from "lucide-react";
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
}: {
  funding: FundingDetail | null;
  productName: string;
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
      <FundingPopoverContent funding={funding} />
    </Popover>
  );
}

function FundingPopoverContent({ funding }: { funding: FundingDetail }) {
  const { channels, plans, dependencies } = funding;
  const channelPlan = buildChannelPlanIndex(plans);
  const unattachedPlans = plans.filter(
    (plan) => plan.channelAtUris.length === 0 && plan.status !== "inactive",
  );
  const hasChips = channels.length > 0 || unattachedPlans.length > 0;

  return (
    <Flex direction="column" gap="2xl">
      <Text size="lg" weight="semibold">
        Funding
      </Text>

      {hasChips ? (
        <Flex wrap gap="sm">
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
 * entity's Bluesky profile (no in-store DID detail page yet; if a matching listing
 * exists later, swap to a router link).
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
  const href = handle
    ? `https://bsky.app/profile/${handle}`
    : `https://bsky.app/profile/${dependency.subjectDid}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} on Bluesky (opens in new tab)`}
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
