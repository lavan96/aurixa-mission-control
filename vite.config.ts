// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The Lovable preset sets TanStack Start's client import-protection deny list to
// ["**/server/**"], which is broader than TanStack's own default ("**/*.server.*").
// Our callable server functions live in `src/server/*.functions.ts` and are meant
// to be imported by route components (the createServerFn compiler replaces their
// handlers with RPC stubs on the client). Allowlist those files so the client may
// import them, while every real `*.server.ts` module stays denied in the browser.
export default defineConfig({
  tanstackStart: {
    importProtection: {
      client: {
        excludeFiles: ["**/node_modules/**", "**/*.functions.ts"],
      },
    },
  },
});
