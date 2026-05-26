import { createFileRoute, Link } from "@tanstack/react-router";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/billing/cancel")({
  head: () => ({ meta: [{ title: "Checkout canceled — Mission Control" }] }),
  component: CancelPage,
});

function CancelPage() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <XCircle className="h-8 w-8 text-muted-foreground" />
          <CardTitle>Checkout canceled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>No charge was made. You can return to the catalog any time.</p>
          <div className="flex gap-2 pt-2">
            <Button asChild><Link to="/billing/topup">Back to top-ups</Link></Button>
            <Button asChild variant="outline"><Link to="/billing/catalog">View catalog</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
