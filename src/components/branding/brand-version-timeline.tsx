// Version history timeline for a brand profile. Lists every published
// snapshot with diff vs current published version + one-click rollback.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listBrandVersions,
  rollbackBrandProfile,
} from "@/server/branding-extensions.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, RotateCcw, GitCommit, Star } from "lucide-react";
import { formatDistanceToNow } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Version = {
  id: string;
  profile_id: string;
  version: number;
  config_hash: string | null;
  notes: string | null;
  published_by: string | null;
  published_at: string;
};

export function BrandVersionTimelineDialog({
  open,
  onClose,
  profileId,
  profileName,
  currentVersion,
  onRolledBack,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  profileName: string;
  currentVersion: number;
  onRolledBack: () => void;
}) {
  const listFn = useServerFn(listBrandVersions);
  const rollbackFn = useServerFn(rollbackBrandProfile);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    listFn({ data: { profileId } })
      .then((r) => {
        if (cancelled) return;
        setVersions(r.versions as Version[]);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(
          err instanceof Error ? err.message : "Failed to load versions",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, profileId, listFn]);

  const handleRollback = async (v: Version) => {
    if (
      !confirm(
        `Roll "${profileName}" back to version ${v.version}? This creates a NEW version with the old payload and re-cascades to drifted clones.`,
      )
    )
      return;
    setRollingBack(v.id);
    const r = await rollbackFn({ data: { profileId, versionId: v.id } });
    setRollingBack(null);
    if (r.ok) {
      toast.success(`Rolled back to v${v.version} → new v${r.newVersion}`);
      onRolledBack();
      onClose();
    } else {
      toast.error(r.error ?? "Rollback failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Version history · {profileName}
          </DialogTitle>
          <DialogDescription>
            Every publish creates an immutable snapshot. Rollbacks copy the
            payload forward as a new version — history is never mutated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          {loading && (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          )}
          {!loading && versions.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No versions yet. Publish the profile to create the first snapshot.
            </div>
          )}
          {!loading &&
            versions.map((v, idx) => {
              const isCurrent = v.version === currentVersion;
              const prev = versions[idx + 1];
              const hashChanged =
                prev && prev.config_hash !== v.config_hash;
              return (
                <div
                  key={v.id}
                  className={cn(
                    "relative flex items-start gap-3 rounded-lg border bg-card p-3",
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border",
                  )}
                >
                  <div className="flex flex-col items-center pt-1">
                    <div
                      className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center border-2",
                        isCurrent
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {isCurrent ? (
                        <Star className="h-3.5 w-3.5 fill-current" />
                      ) : (
                        <GitCommit className="h-3.5 w-3.5" />
                      )}
                    </div>
                    {idx < versions.length - 1 && (
                      <div className="h-full w-px bg-border mt-1 min-h-6" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        Version {v.version}
                      </span>
                      {isCurrent && (
                        <Badge
                          variant="outline"
                          className="bg-primary/10 text-primary border-primary/30 text-[10px]"
                        >
                          Current
                        </Badge>
                      )}
                      {hashChanged && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-amber-500/30 text-amber-300"
                        >
                          Config changed
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Published {formatDistanceToNow(v.published_at)} ago
                    </div>
                    {v.config_hash && (
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">
                        hash: {v.config_hash.slice(0, 16)}…
                      </div>
                    )}
                    {v.notes && (
                      <div className="text-xs mt-1 italic">{v.notes}</div>
                    )}
                  </div>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rollingBack === v.id}
                      onClick={() => handleRollback(v)}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      {rollingBack === v.id ? "Rolling back…" : "Rollback"}
                    </Button>
                  )}
                </div>
              );
            })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
