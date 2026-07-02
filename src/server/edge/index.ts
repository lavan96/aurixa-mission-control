// Registers all edge providers. Import once from server-side entrypoints
// (server functions, hook routes) to ensure the registry is populated before
// getEdgeProvider() is called.
import { registerEdgeProvider } from "./providers";
import { cloudflareProvider } from "./cloudflare-provider";
import { awsProvider } from "./aws-provider";
import { azureProvider } from "./azure-provider";

registerEdgeProvider(cloudflareProvider);
registerEdgeProvider(awsProvider);
registerEdgeProvider(azureProvider);

export * from "./providers";
