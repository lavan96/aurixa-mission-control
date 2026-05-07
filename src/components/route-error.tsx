import { useRouter, Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reusable per-route error boundary. Drop into createFileRoute({ errorComponent: RouteError })
 * for routes with loaders or heavy data fetching.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/30">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="font-mono text-xl font-semibold tracking-tight">This screen failed to load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong rendering this route. The rest of the app is still working.
        </p>
        {import.meta.env.DEV && error?.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-[11px] text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">
              <Home className="mr-1.5 h-3.5 w-3.5" />
              Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
