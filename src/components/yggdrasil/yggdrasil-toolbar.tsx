/**
 * YggdrasilToolbar — filters, search, and refresh controls for the tree.
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, RefreshCw, X, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusFilter = "in_sync" | "behind" | "failed";

interface Props {
  activeFilters: StatusFilter[];
  onFiltersChange: (filters: StatusFilter[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults: { id: string; name: string; repo: string }[];
  onSearchSelect: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string; color: string }[] = [
  { value: "in_sync", label: "In Sync", color: "oklch(0.78 0.18 150)" },
  { value: "behind", label: "Behind", color: "oklch(0.82 0.17 80)" },
  { value: "failed", label: "Failed", color: "oklch(0.66 0.24 25)" },
];

export function YggdrasilToolbar({
  activeFilters,
  onFiltersChange,
  searchQuery,
  onSearchChange,
  searchResults,
  onSearchSelect,
  onRefresh,
  refreshing,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const toggleFilter = (f: StatusFilter) => {
    onFiltersChange(
      activeFilters.includes(f)
        ? activeFilters.filter((x) => x !== f)
        : [...activeFilters, f],
    );
  };

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status filters */}
      <div className="flex items-center gap-1.5">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        {STATUS_OPTIONS.map((opt) => {
          const active = activeFilters.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggleFilter(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-all",
                active
                  ? "border-transparent text-background"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              style={active ? { background: opt.color } : undefined}
            >
              {opt.label}
            </button>
          );
        })}
        {activeFilters.length > 0 && (
          <button
            onClick={() => onFiltersChange([])}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Search */}
      <div ref={searchRef} className="relative">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Find clone…"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setSearchOpen(e.target.value.length > 0);
            }}
            onFocus={() => searchQuery.length > 0 && setSearchOpen(true)}
            className="h-8 w-48 pl-8 font-mono text-xs"
          />
        </div>
        <AnimatePresence>
          {searchOpen && searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSearchSelect(r.id);
                    setSearchOpen(false);
                  }}
                  className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                >
                  <span className="font-mono text-xs font-medium">{r.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{r.repo}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1 rounded-md border border-border/60 px-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomIn} title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomReset} title="Reset">
          <Maximize className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Refresh */}
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="font-mono text-xs"
      >
        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
        {refreshing ? "Syncing…" : "Refresh statuses"}
      </Button>
    </div>
  );
}
