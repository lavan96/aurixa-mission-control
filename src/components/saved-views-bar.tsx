import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSavedViews, type SavedView } from "@/lib/use-saved-views";

type Props<T> = {
  storageKey: string;
  current: T;
  onApply: (state: T) => void;
  emptyLabel?: string;
};

export function SavedViewsBar<T>({
  storageKey,
  current,
  onApply,
  emptyLabel = "no saved views",
}: Props<T>) {
  const { views, save, remove } = useSavedViews<T>(storageKey);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const handleSave = () => {
    const res = save(name, current);
    if (!res.ok) return toast.error(res.error);
    setName("");
    setNaming(false);
    toast.success(`Saved view "${name.trim()}"`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
      {views.length === 0 && !naming && (
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{emptyLabel}</span>
      )}
      {views.map((v: SavedView<T>) => (
        <span
          key={v.id}
          className="group inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground hover:bg-muted/40"
        >
          <button onClick={() => onApply(v.state)}>{v.label}</button>
          <button
            onClick={() => remove(v.id)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`Remove ${v.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {naming ? (
        <span className="inline-flex items-center gap-1">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setNaming(false);
                setName("");
              }
            }}
            placeholder="View name…"
            className="h-6 w-32 font-mono text-[10px]"
          />
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={handleSave}>
            Save
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 font-mono text-[10px] uppercase"
          onClick={() => setNaming(true)}
        >
          + Save view
        </Button>
      )}
    </div>
  );
}
