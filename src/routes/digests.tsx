import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Sparkles, RefreshCw } from "lucide-react";
import { aiGenerateFleetDigest, listFleetDigests } from "@/server/ai-features.functions";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/digests")({
  component: () => (
    <ProtectedRoute>
      <DigestsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Fleet Digests — Aurixa Systems Mission Control" }] }),
});

function DigestsPage() {
  const listFn = useServerFn(listFleetDigests);
  const genFn = useServerFn(aiGenerateFleetDigest);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["digests"], queryFn: () => listFn() });
  const gen = useMutation({
    mutationFn: () => genFn(),
    onSuccess: () => { toast.success("Digest generated"); qc.invalidateQueries({ queryKey: ["digests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 ring-1 ring-accent/40">
          <Newspaper className="h-5 w-5 text-accent" />
        </div>
        <div className="flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">ai briefings</p>
          <h1 className="text-3xl font-semibold tracking-tight">Fleet Digests</h1>
          <p className="text-sm text-muted-foreground">AI-summarized weekly fleet operations briefings.</p>
        </div>
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>
          {gen.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Generate now
        </Button>
      </header>

      {q.data?.digests.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          No digests yet. Click <strong>Generate now</strong> to produce the first one.
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {q.data?.digests.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {format(new Date(d.period_start), "MMM d")} – {format(new Date(d.period_end), "MMM d, yyyy")}
                    </CardTitle>
                    <CardDescription>Generated {format(new Date(d.created_at), "PPp")}</CardDescription>
                  </div>
                  <Badge variant="outline">{d.generated_by_model}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{d.summary_markdown}</pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(d.metrics as Record<string, any>).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}: {String(v)}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
