import { createServerFn } from "@tanstack/react-start";
import { fetchPublicCatalog } from "@/server/public-catalog.server";

/**
 * Public, unauthenticated read of the pricing catalog for Mission Control's
 * own pricing console. Only safe, non-PII product/pricing data is returned.
 * The customer-facing Aurixa Systems website reads the same catalog via
 * GET /api/public/storefront/catalog.
 */
export const getPublicPricing = createServerFn({ method: "GET" }).handler(async () => {
  return await fetchPublicCatalog();
});
