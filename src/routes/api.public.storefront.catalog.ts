import { createFileRoute } from "@tanstack/react-router";
import { fetchPublicCatalog } from "@/server/public-catalog.server";
import { storefrontJson, storefrontPreflight } from "@/server/storefront-cors.server";

/**
 * GET /api/public/storefront/catalog
 *
 * Public, CORS-enabled pricing catalog for the customer-facing pricing page
 * on the Aurixa Systems website. All user-centric monetisation flows through
 * that site; Mission Control is the headless billing engine behind it.
 * Returns only safe, non-PII product/pricing data (active items only).
 */
export const Route = createFileRoute("/api/public/storefront/catalog")({
  server: {
    handlers: {
      OPTIONS: async () => storefrontPreflight(),
      GET: async () => {
        try {
          const catalog = await fetchPublicCatalog();
          return storefrontJson({ ok: true, ...catalog });
        } catch (err) {
          console.error("storefront catalog failed", err);
          return storefrontJson({ ok: false, error: "catalog_unavailable" }, 500);
        }
      },
    },
  },
});
