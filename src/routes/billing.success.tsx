import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/billing/success")({
  validateSearch: (s) => z.object({ session_id: z.string().optional() }).parse(s),
  head: () => ({ meta: [{ title: "Payment received — Mission Control" }] }),
  component: SuccessPage,
});

function SuccessPage() {
  const { session_id } = Route.useSearch();
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <CardTitle>Payment received</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>Your purchase is being finalised by Stripe. Credits, seat upgrades, or setup packages will appear in the billing pages within a few seconds — refresh if it doesn't show right away.</p>
          {session_id && (
            <p className="font-mono text-xs text-muted-foreground break-all">Session: {session_id}</p>
          )}
          <div className="flex gap-2 pt-2">
            <Button asChild><Link to="/settings/billing">Back to billing</Link></Button>
            <Button asChild variant="outline"><Link to="/billing/topup">Top up more</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
