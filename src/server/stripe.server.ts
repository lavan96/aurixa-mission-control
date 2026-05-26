// Server-only Stripe SDK helper.
// Uses subtle-crypto provider so it works on the Cloudflare Worker runtime.
import Stripe from "stripe";

let _stripe: Stripe | undefined;
let _provider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | undefined;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  _stripe = new Stripe(key, {
    apiVersion: "2024-06-20" as Stripe.StripeConfig["apiVersion"],
    httpClient: Stripe.createFetchHttpClient(),
  });
  return _stripe;
}

export function getStripeCryptoProvider() {
  if (!_provider) _provider = Stripe.createSubtleCryptoProvider();
  return _provider;
}
