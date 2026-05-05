import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { Flex } from "#/design-system/flex";
import { Link } from "#/design-system/link";
import { Page } from "#/design-system/page";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "#/design-system/table";
import {
  horizontalSpace,
  verticalSpace,
} from "#/design-system/theme/semantic-spacing.stylex";
import {
  Blockquote,
  Body,
  Heading2,
  Heading3,
} from "#/design-system/typography";
import { Text } from "#/design-system/typography/text";
import { ATSTORE_XRPC_METHOD, NSID } from "#/lib/atproto/nsids";
import { buildRouteOgMeta } from "#/lib/og-meta";

const METHOD_ROWS: ReadonlyArray<{
  nsid: string;
  method: "GET" | "POST";
  summary: string;
}> = [
  {
    nsid: ATSTORE_XRPC_METHOD.serverDescribe,
    method: "GET",
    summary: "Capabilities, limits, and registered method NSIDs.",
  },
  {
    nsid: ATSTORE_XRPC_METHOD.directorySearchListings,
    method: "GET",
    summary: "Search public listings with pagination (`q`, `sort`, `cursor`).",
  },
  {
    nsid: ATSTORE_XRPC_METHOD.directoryGetListing,
    method: "GET",
    summary: "Detail projection by `listingId` or `slug`.",
  },
  {
    nsid: ATSTORE_XRPC_METHOD.directoryResolveListing,
    method: "GET",
    summary: "Resolve `externalUrl` to listing identifiers.",
  },
  {
    nsid: ATSTORE_XRPC_METHOD.reviewsListForListing,
    method: "GET",
    summary: "Reviews for a listing (`listingId`, pagination).",
  },
  {
    nsid: ATSTORE_XRPC_METHOD.reviewsSubmitReview,
    method: "POST",
    summary:
      "Create a listing review via the user PDS (requires signed-in at-store session cookie today).",
  },
];

type MethodTableColumn = {
  id: "method" | "nsid" | "summary";
  name: string;
};

const METHOD_TABLE_COLUMNS: Array<MethodTableColumn> = [
  { id: "method", name: "HTTP" },
  { id: "nsid", name: "NSID" },
  { id: "summary", name: "Summary" },
];

const styles = stylex.create({
  page: {
    marginInline: "auto",
    paddingInline: horizontalSpace.xl,
    maxWidth: 920,
    paddingBottom: verticalSpace["10xl"],
    paddingTop: verticalSpace["6xl"],
  },
  monoTight: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  methodsTable: {
    width: "100%",
  },
});

export const Route = createFileRoute("/_header-layout/developers/atproto")({
  head: () =>
    buildRouteOgMeta({
      title: "AT Protocol API | at-store",
      description:
        "AT Store XRPC methods and OAuth permission bundle for third-party review integrations.",
    }),
  component: DevelopersAtprotoPage,
});

function DevelopersAtprotoPage() {
  const origin =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : "https://your-deployment.example";

  return (
    <Page.Root variant="large" style={styles.page}>
      <Flex direction="column" gap="7xl">
        <Flex direction="column" gap="6xl">
          <Heading2>AT Protocol on AT Store</Heading2>
          <Body variant="secondary">
            Directory queries are public GET endpoints under{" "}
            <Text weight="medium">/xrpc/&lt;nsid&gt;</Text>, shaped by the{" "}
            <Link href="https://atproto.com/specs/xrpc">XRPC</Link> and{" "}
            <Link href="https://atproto.com/specs/lexicon">Lexicon</Link> specs.
            Lexicon JSON lives in this repository under{" "}
            <Text weight="medium">lexicons/fyi/atstore/</Text>.
          </Body>
        </Flex>

        <Flex direction="column" gap="4xl">
          <Heading3>Base URL</Heading3>
          <Body variant="secondary">
            Replace the origin with your deployment (local dev shown when opened
            in the browser):
          </Body>
          <Blockquote>{`${origin}/xrpc/`}</Blockquote>
        </Flex>

        <Flex direction="column" gap="4xl">
          <Heading3>Methods</Heading3>
          <Table aria-label="AT Store XRPC methods" style={styles.methodsTable}>
            <TableHeader columns={METHOD_TABLE_COLUMNS}>
              {(column) => <TableColumn>{column.name}</TableColumn>}
            </TableHeader>
            <TableBody items={[...METHOD_ROWS]}>
              {(row) => (
                <TableRow
                  columns={METHOD_TABLE_COLUMNS}
                  id={row.nsid}
                  textValue={`${row.method} ${row.nsid} ${row.summary}`}
                >
                  {(column) => (
                    <TableCell>
                      {column.id === "method" ? (
                        <Text weight="medium">{row.method}</Text>
                      ) : column.id === "nsid" ? (
                        <span {...stylex.props(styles.monoTight)}>
                          {row.nsid}
                        </span>
                      ) : (
                        <Body>{row.summary}</Body>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Flex>

        <Flex direction="column" gap="4xl">
          <Heading3>Third-party review OAuth bundle</Heading3>
          <Body variant="secondary">
            Published permission-set lexicon{" "}
            <Text weight="medium">{NSID.authThirdPartyReviews}</Text> grants{" "}
            <Text weight="medium">repo:create</Text> on{" "}
            <Text weight="medium">{NSID.profile}</Text> and{" "}
            <Text weight="medium">{NSID.listingReview}</Text>, plus{" "}
            <Text weight="medium">rpc</Text> access (with{" "}
            <Text weight="medium">inheritAud</Text>) to{" "}
            <Text weight="medium">
              {ATSTORE_XRPC_METHOD.reviewsSubmitReview}
            </Text>
            . Third-party apps request it using an{" "}
            <Link href="https://atproto.com/specs/permission">
              include scope
            </Link>{" "}
            such as:
          </Body>
          <Blockquote>
            <code>{`include:${NSID.authThirdPartyReviews}?aud=<resource-service-did#fragment>`}</code>
          </Blockquote>
          <Body variant="secondary">
            The aud fragment must match your deployment&apos;s OAuth protected
            resource metadata. Blob uploads are{" "}
            <Link href="https://atproto.com/specs/permission">not bundled</Link>
            ; apps still need explicit <Text weight="medium">blob:</Text> scopes
            when uploading media to a PDS.
          </Body>
          <Body variant="secondary">
            Today <Text weight="medium">submitReview</Text> authenticates with
            the same signed-in browser session as the web app (cookie). Pure
            bearer-token clients should fall back to{" "}
            <Text weight="medium">com.atproto.repo.createRecord</Text> on the
            user&apos;s PDS using the review lexicon until bearer verification
            lands here.
          </Body>
        </Flex>
      </Flex>
    </Page.Root>
  );
}
