import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Clone } from "@/lib/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, X, Minus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Bulk tag editor for selected clones.
 *
 *   • Add tags — appended to every selected clone (de-duplicated)
 *   • Remove tags — pulled from every selected clone
 *
 * Performs one Supabase update per clone so RLS + audit_log fire normally.
 */
export function BulkTagDialog({
  open,
  onOpenChange,
  clones,
  selectedIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clones: Clone[];
  selectedIds: Set<string>;
  onDone: () => void;
}) {
  const selected = useMemo(
    () => clones.filter((c) => selectedIds.has(c.id)),
    [clones, selectedIds],
  );

  // Existing tags across the fleet, surfaced as quick-add chips
  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of clones) for (const t of c.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [clones]);

  const [adds, setAdds] = useState<string[]>([]);
  const [removes, setRemoves] = useState<string[]>([]);
  const [draftAdd, setDraftAdd] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setAdds([]);
    setRemoves([]);
    setDraftAdd("");
  };

  const apply = async () => {
    if (selected.length === 0) {
      toast.error("No clones selected");
      return;
    }
    if (adds.length === 0 && removes.length === 0) {
      toast.info("Nothing to change");
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const c of selected) {
      const current = new Set(c.tags ?? []);
      for (const t of removes) current.delete(t);
      for (const t of adds) current.add(t);
      const next = Array.from(current).sort();
      const { error } = await supabase
        .from("clones")
        .update({ tags: next })
        .eq("id", c.id);
      if (error) failed++;
      else ok++;
    }
    setBusy(false);
    if (failed > 0) {
      toast.error(`Updated ${ok}/${selected.length} — ${failed} failed`);
    } else {
      toast.success(`Updated ${ok} clone${ok === 1 ? "" : "s"}`);
    }
    reset();
    onOpenChange(false);
    onDone();
  };

  const commitDraft = () => {
    const t = draftAdd.trim().toLowerCase().replace(/\s+/g, "-");
    if (!t) return;
    if (!adds.includes(t)) setAdds((prev) => [...prev, t]);
    setDraftAdd("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            Bulk edit tags
          </DialogTitle>
          <DialogDescription>
            Applies to {selected.length} selected clone
            {selected.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Add */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-success">
              <Plus className="h-3 w-3" /> add tags
            </div>
            <div className="flex gap-2">
              <Input
                value={draftAdd}
                onChange={(e) => setDraftAdd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDraft();
                  }
                }}
                placeholder="staging, client-acme…"
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={commitDraft}
                disabled={!draftAdd.trim()}
              >
                Add
              </Button>
            </div>
            {adds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {adds.map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="cursor-pointer border-success/40 text-success"
                    onClick={() => setAdds((prev) => prev.filter((x) => x !== t))}
                  >
                    + {t} <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
            {existingTags.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  existing tags · click to add
                </div>
                <div className="flex flex-wrap gap-1">
                  {existingTags.map((t) => {
                    const active = adds.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          active
                            ? setAdds((prev) => prev.filter((x) => x !== t))
                            : setAdds((prev) => [...prev, t])
                        }
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                          active
                            ? "border-success/50 bg-success/10 text-success"
                            : "border-border bg-muted text-muted-foreground hover:border-success/40 hover:text-foreground",
                        )}
                      >
                        #{t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Remove */}
          {existingTags.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-destructive">
                <Minus className="h-3 w-3" /> remove tags
              </div>
              <div className="flex flex-wrap gap-1">
                {existingTags.map((t) => {
                  const active = removes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        active
                          ? setRemoves((prev) => prev.filter((x) => x !== t))
                          : setRemoves((prev) => [...prev, t])
                      }
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                        active
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : "border-border bg-muted text-muted-foreground hover:border-destructive/40 hover:text-foreground",
                      )}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy || (adds.length === 0 && removes.length === 0)}>
            {busy ? "Updating…" : `Update ${selected.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
