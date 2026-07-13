/**
 * Customer-facing pricing page on the Aurixa Systems website. Mission Control
 * no longer serves a customer /pricing route — every user-centric purchase
 * surface lives on the storefront. PUBLIC_PRICING_SITE_URL overrides this
 * per deployment (server-side); this constant is the last-resort fallback and
 * the client-side link target. Mirrors AURIXA_PRICING_URL in the prime repo.
 */
export const DEFAULT_STOREFRONT_PRICING_URL = "https://aurixa-systems.lovable.app/pricing";
