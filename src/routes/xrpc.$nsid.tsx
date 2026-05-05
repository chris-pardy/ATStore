import { createFileRoute } from "@tanstack/react-router";
import { handleAtstoreXrpc } from "#/server/atproto-xrpc/atstore-xrpc-handler.server";

export const Route = createFileRoute("/xrpc/$nsid")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleAtstoreXrpc(request, decodeURIComponent(params.nsid)),
      POST: ({ request, params }) =>
        handleAtstoreXrpc(request, decodeURIComponent(params.nsid)),
      OPTIONS: ({ request, params }) =>
        handleAtstoreXrpc(request, decodeURIComponent(params.nsid)),
    },
  },
});
