// CORS plumbing for the storefront endpoints consumed by the customer-facing
// Aurixa Systems website (a static site on another origin). `*` is safe here:
// the catalog is public product data, and everything else is authorised by
// possession of an unguessable single-use handoff token / (session, handoff)
// pair — never by cookies or ambient credentials.
export const STOREFRONT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
} as const;

export function storefrontJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...STOREFRONT_CORS },
  });
}

export function storefrontPreflight(): Response {
  return new Response(null, { status: 204, headers: STOREFRONT_CORS });
}
