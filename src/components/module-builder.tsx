import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Boxes, GripVertical, Plus, X, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClones, useModules, useFleetModules, type Clone, type Module } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DragItem = {
  moduleId: string;
  moduleName: string;
  moduleSlug: string;
  source: "available" | "attached";
};

export function ModuleBuilder() {
  const { data: clones, loading: clonesLoading } = useClones();
  const { data: modules, loading: modulesLoading } = useModules();
  const { byClone, loading: fleetLoading, refresh: refreshFleet } = useFleetModules();

  const [selectedCloneId, setSelectedCloneId] = useState<string>("");
  const [attachedModuleIds, setAttachedModuleIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState<"available" | "attached" | null>(null);

  const approvedModules = modules.filter((m) => m.status === "approved");

  // Sync from fleet data when clone changes
  useEffect(() => {
    if (!selectedCloneId) {
      setAttachedModuleIds(new Set());
      setDirty(false);
      return;
    }
    const existing = (byClone[selectedCloneId] ?? []).map((cm) => cm.module_id);
    setAttachedModuleIds(new Set(existing));
    setDirty(false);
  }, [selectedCloneId, byClone]);

  const selectedClone = clones.find((c) => c.id === selectedCloneId);
  const attached = approvedModules.filter((m) => attachedModuleIds.has(m.id));
  const available = approvedModules.filter((m) => !attachedModuleIds.has(m.id));

  const attachModule = useCallback(
    (moduleId: string) => {
      setAttachedModuleIds((prev) => {
        const next = new Set(prev);
        next.add(moduleId);
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const detachModule = useCallback(
    (moduleId: string) => {
      setAttachedModuleIds((prev) => {
        const next = new Set(prev);
        next.delete(moduleId);
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const handleDragStart = (e: React.DragEvent, item: DragItem) => {
    e.dataTransfer.setData("application/json", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, target: "available" | "attached") => {
    e.preventDefault();
    setDragOver(null);
    try {
      const item: DragItem = JSON.parse(e.dataTransfer.getData("application/json"));
      if (target === "attached" && item.source === "available") {
        attachModule(item.moduleId);
      } else if (target === "available" && item.source === "attached") {
        detachModule(item.moduleId);
      }
    } catch {
      // ignore
    }
  };

  const handleDragOver = (e: React.DragEvent, zone: "available" | "attached") => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(zone);
  };

  const handleDragLeave = () => setDragOver(null);

  const save = async () => {
    if (!selectedCloneId) return;
    setSaving(true);
    try {
      // Remove all existing clone_modules for this clone
      const { error: delError } = await supabase
        .from("clone_modules")
        .delete()
        .eq("clone_id", selectedCloneId);
      if (delError) throw delError;

      // Insert the new set
      if (attachedModuleIds.size > 0) {
        const rows = Array.from(attachedModuleIds).map((module_id) => ({
          clone_id: selectedCloneId,
          module_id,
        }));
        const { error: insError } = await supabase.from("clone_modules").insert(rows);
        if (insError) throw insError;
      }

      toast.success(`Saved ${attachedModuleIds.size} module(s) for ${selectedClone?.name}`);
      setDirty(false);
      refreshFleet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const loading = clonesLoading || modulesLoading || fleetLoading;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4" /> Module builder
            </CardTitle>
            <CardDescription>
              Drag and drop modules to attach or detach them from a clone. Changes are saved
              explicitly.
            </CardDescription>
          </div>
          {dirty && (
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-2 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Clone selector */}
        <div className="space-y-1.5">
          <label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Select clone
          </label>
          <Select value={selectedCloneId} onValueChange={setSelectedCloneId}>
            <SelectTrigger>
              <SelectValue placeholder={loading ? "Loading…" : "Choose a clone"} />
            </SelectTrigger>
            <SelectContent>
              {clones.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{" "}
                  <span className="text-muted-foreground">
                    ({c.github_owner}/{c.github_repo})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCloneId && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Available modules */}
            <div
              className={cn(
                "space-y-2 rounded-lg border-2 border-dashed p-3 transition-colors",
                dragOver === "available"
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/60",
              )}
              onDrop={(e) => handleDrop(e, "available")}
              onDragOver={(e) => handleDragOver(e, "available")}
              onDragLeave={handleDragLeave}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Available ({available.length})
                </span>
              </div>
              {available.length === 0 ? (
                <div className="rounded-md border border-border bg-surface/50 p-4 text-center text-xs text-muted-foreground">
                  All modules attached
                </div>
              ) : (
                <div className="space-y-1.5">
                  {available.map((m) => (
                    <ModuleChip
                      key={m.id}
                      module={m}
                      source="available"
                      onDragStart={handleDragStart}
                      onAction={() => attachModule(m.id)}
                      actionIcon={<Plus className="h-3 w-3" />}
                      actionLabel="Attach"
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Attached modules */}
            <div
              className={cn(
                "space-y-2 rounded-lg border-2 border-dashed p-3 transition-colors",
                dragOver === "attached"
                  ? "border-success/60 bg-success/5"
                  : "border-success/20 bg-success/5",
              )}
              onDrop={(e) => handleDrop(e, "attached")}
              onDragOver={(e) => handleDragOver(e, "attached")}
              onDragLeave={handleDragLeave}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-success">
                  Attached ({attached.length})
                </span>
              </div>
              {attached.length === 0 ? (
                <div className="rounded-md border border-success/20 bg-surface/50 p-4 text-center text-xs text-muted-foreground">
                  Drag modules here to attach
                </div>
              ) : (
                <div className="space-y-1.5">
                  {attached.map((m) => (
                    <ModuleChip
                      key={m.id}
                      module={m}
                      source="attached"
                      onDragStart={handleDragStart}
                      onAction={() => detachModule(m.id)}
                      actionIcon={<X className="h-3 w-3" />}
                      actionLabel="Detach"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedCloneId && !loading && (
          <div className="rounded-md border border-border bg-surface/50 p-6 text-center text-sm text-muted-foreground">
            Select a clone above to manage its module configuration.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModuleChip({
  module: m,
  source,
  onDragStart,
  onAction,
  actionIcon,
  actionLabel,
}: {
  module: Module;
  source: "available" | "attached";
  onDragStart: (e: React.DragEvent, item: DragItem) => void;
  onAction: () => void;
  actionIcon: React.ReactNode;
  actionLabel: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) =>
        onDragStart(e, {
          moduleId: m.id,
          moduleName: m.name,
          moduleSlug: m.slug,
          source,
        })
      }
      className="group flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40 active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs font-medium truncate">{m.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground truncate">{m.slug}</div>
      </div>
      {m.ai_confidence != null && (
        <Badge variant="outline" className="shrink-0 font-mono text-[9px]">
          {Math.round(Number(m.ai_confidence) * 100)}%
        </Badge>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        className={cn(
          "shrink-0 rounded-sm p-1 opacity-0 transition-opacity group-hover:opacity-100",
          source === "available"
            ? "hover:bg-success/20 hover:text-success"
            : "hover:bg-destructive/20 hover:text-destructive",
        )}
        title={actionLabel}
      >
        {actionIcon}
      </button>
    </div>
  );
}
