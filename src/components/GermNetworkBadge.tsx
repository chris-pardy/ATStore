"use client";

import * as stylex from "@stylexjs/stylex";
import { uiColor } from "#/design-system/theme/color.stylex";
import { radius } from "#/design-system/theme/radius.stylex";
import {
  gap,
  horizontalSpace,
  verticalSpace,
} from "#/design-system/theme/semantic-spacing.stylex";
import { fontFamily, fontSize } from "#/design-system/theme/typography.stylex";
import { Tooltip } from "#/design-system/tooltip";
import { Link as AriaLink } from "react-aria-components";

const styles = stylex.create({
  chip: {
    borderColor: uiColor.border1,
    borderRadius: radius.full,
    borderStyle: "solid",
    borderWidth: 1,
    gap: gap.sm,
    textDecoration: "none",
    alignItems: "center",
    backgroundColor: {
      default: uiColor.component1,
      ":hover": uiColor.component2,
    },
    boxSizing: "border-box",
    color: uiColor.text2,
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    fontFamily: fontFamily.mono,
    outlineColor: {
      ":focus-visible": uiColor.border2,
    },
    outlineOffset: {
      ":focus-visible": 2,
    },
    outlineStyle: {
      ":focus-visible": "solid",
    },
    outlineWidth: {
      ":focus-visible": 2,
    },
    paddingBottom: verticalSpace.sm,
    paddingLeft: horizontalSpace.lg,
    paddingRight: horizontalSpace.xl,
    paddingTop: verticalSpace.sm,
  },
  chipMd: {
    fontSize: fontSize.base,
    paddingLeft: horizontalSpace["2xl"],
    paddingRight: horizontalSpace["2xl"],
  },
  chipSm: {
    fontSize: fontSize.sm,
  },
  germIcon: {
    display: "block",
    flexShrink: 0,
    objectFit: "contain",
  },
  germIconMd: {
    height: 24,
    width: 24,
  },
  germIconSm: {
    height: 20,
    width: 20,
  },
});

export function GermNetworkBadge({
  href,
  size: sizeProp = "sm",
}: {
  /** Germ deep link: `${messageMeUrl}/web#[profileDid]+[viewerDid]` */
  href: string;
  size?: "sm" | "md";
}) {
  const isMd = sizeProp === "md";

  return (
    <Tooltip text="Open an encrypted Germ DM with this account (AT Protocol).">
      <AriaLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(styles.chip, isMd ? styles.chipMd : styles.chipSm)}
        aria-label="Open Germ DM"
      >
        <img
          src="/germ-logo.png"
          alt=""
          decoding="async"
          {...stylex.props(
            styles.germIcon,
            isMd ? styles.germIconMd : styles.germIconSm,
          )}
          draggable={false}
        />
        Germ DM
      </AriaLink>
    </Tooltip>
  );
}
