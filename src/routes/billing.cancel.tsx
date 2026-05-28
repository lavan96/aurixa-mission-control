import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/billing/cancel")({
  validateSearch: (s) => z.object({ clone: z.string().optional() }).parse(s),
  head: () => ({ meta: [{ title: "Checkout canceled — Mission Control" }] }),
  component: CancelPage,
});

function CancelPage() {
  const { clone } = Route.useSearch();
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <XCircle className="h-8 w-8 text-muted-foreground" />
          <CardTitle>Checkout canceled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>No charge was made. You can return to pricing any time and pick up where you left off.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link to="/pricing" search={clone ? { clone } : undefined}>Back to pricing</Link>
            </Button>
            <Button asChild variant="outline"><Link to="/billing/catalog">View catalog</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
