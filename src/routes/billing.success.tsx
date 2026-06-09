import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { CheckCircle2, Building2, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { lookupCheckoutSession } from "@/lib/checkout-session.functions";

export const Route = createFileRoute("/billing/success")({
  validateSearch: (s) => z.object({ session_id: z.string().optional() }).parse(s),
  head: () => ({ meta: [{ title: "Payment received — Mission Control" }] }),
  component: SuccessPage,
});

function formatAmount(cents: number | null, currency: string | null) {
  if (cents == null || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const MODE_LABEL: Record<string, string> = {
  topup: "Token top-up",
  seat_plan: "Seat plan",
  setup_package: "Setup package",
};

function SuccessPage() {
  const { session_id } = Route.useSearch();
  const lookupFn = useServerFn(lookupCheckoutSession);

  const { data, isLoading } = useQuery({
    queryKey: ["checkout-session", session_id],
    queryFn: () => lookupFn({ data: { sessionId: session_id! } }),
    enabled: !!session_id,
    staleTime: 60_000,
  });

  const info = data?.ok ? data : null;
  const amount = info ? formatAmount(info.amountTotal, info.currency) : null;
  const target = info?.cloneName ?? info?.tenantName ?? null;

  return (
    <div className="mx-auto max-w-xl py-16">
      <Card className="border-emerald-500/30">
        <CardHeader className="flex flex-row items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <div className="flex-1">
            <CardTitle>Payment received</CardTitle>
            {info && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {info.mode && (
                  <Badge variant="secondary" className="text-xs">
                    {MODE_LABEL[info.mode] ?? info.mode}
                  </Badge>
                )}
                {amount && <span className="text-xs text-muted-foreground">{amount}</span>}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {isLoading && session_id && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}

          {target && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div className="text-xs">
                <div className="text-muted-foreground">Billed to client</div>
                <div className="font-medium">{target}</div>
              </div>
            </div>
          )}

          {info?.itemSlug && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                Item: <span className="font-mono">{info.itemSlug}</span>
              </span>
            </div>
          )}

          <p>
            Your purchase is being finalised. Credits, seat upgrades, or setup packages will appear
            in the billing pages within a few seconds — refresh if it doesn't show right away.
          </p>

          {session_id && (
            <p className="font-mono text-[10px] text-muted-foreground break-all opacity-70">
              Session: {session_id}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link to="/settings/billing">Back to billing</Link>
            </Button>
            {info?.cloneId ? (
              <Button asChild variant="outline">
                <Link to="/pricing" search={{ clone: info.cloneId }}>
                  Buy more for this client
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/pricing">View pricing</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
