// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHandoffReturnInfo } from "@/lib/handoff.functions";

export const Route = createFileRoute("/billing/cancel")({
  // `h` = billing handoff token: gives a clone end-user (no Mission Control
  // login) the way back to the command center they came from.
  validateSearch: (s) =>
    z.object({ clone: z.string().optional(), h: z.string().optional() }).parse(s),
  head: () => ({ meta: [{ title: "Checkout canceled — Mission Control" }] }),
  component: CancelPage,
});

function CancelPage() {
  const { clone, h } = Route.useSearch();

  const returnInfoFn = useServerFn(getHandoffReturnInfo);
  const returnInfoQ = useQuery({
    queryKey: ["handoff-return", h],
    queryFn: () => returnInfoFn({ data: { h: h! } }),
    enabled: !!h,
    staleTime: Infinity,
    retry: false,
  });
  const returnInfo = returnInfoQ.data?.ok ? returnInfoQ.data : null;

  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <XCircle className="h-8 w-8 text-muted-foreground" />
          <CardTitle>Checkout canceled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            No charge was made. You can return to pricing any time and pick up where you left off.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {returnInfo?.returnUrl && (
              <Button asChild>
                <a href={returnInfo.returnUrl}>
                  Return to {returnInfo.cloneName ?? "your dashboard"}
                </a>
              </Button>
            )}
            <Button asChild variant={returnInfo?.returnUrl ? "outline" : "default"}>
              <Link to="/pricing" search={clone ? { clone } : undefined}>
                Back to pricing
              </Link>
            </Button>
            {!h && (
              <Button asChild variant="outline">
                <Link to="/billing/catalog">View catalog</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
