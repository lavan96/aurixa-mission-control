import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Boxes,
  GitBranch,
  Waves,
  CalendarClock,
  Sparkles,
  ScrollText,
  Plus,
  Settings,
  Bot,
  Shield,
  LayoutDashboard,
  Bell,
  Package,
  GitFork,
  History,
} from "lucide-react";
import { useClones, useModules, useCascadeEvents } from "@/lib/queries";
import { formatDistanceToNow } from "@/lib/format";

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  onSelect: () => void;
  keywords?: string;
};

/**
 * Global ⌘K / Ctrl+K command palette.
 * - Quick navigation to any clone, module, or cascade.
 * - Common actions (new clone, fire cascade, open audit log, …).
 * Mounted once in AppShell so it's available on every authenticated page.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: clones } = useClones();
  const { data: modules } = useModules();
  const { data: events } = useCascadeEvents(15);

  // Toggle on ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback(
    (fn: () => void) => {
      setOpen(false);
      // defer so the dialog finishes closing before route change
      setTimeout(fn, 10);
    },
    [],
  );

  const actions: Action[] = [
    {
      id: "new-clone",
      label: "New clone",
      hint: "Provision a new fleet clone",
      icon: <Plus className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/clones/new" })),
      keywords: "create provision fork template",
    },
    {
      id: "fire-cascade",
      label: "Fire cascade",
      hint: "Push prime updates downstream",
      icon: <Waves className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/cascades" })),
      keywords: "waterfall push update",
    },
    {
      id: "drift",
      label: "Open drift dashboard",
      hint: "Fleet-wide drift suggestions",
      icon: <Sparkles className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/drift" })),
      keywords: "ai suggestions drift",
    },
    {
      id: "schedules",
      label: "Manage schedules",
      hint: "Recurring cascades",
      icon: <CalendarClock className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/schedules" })),
      keywords: "cron recurring",
    },
    {
      id: "audit",
      label: "Audit log",
      hint: "Operator activity",
      icon: <ScrollText className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/audit-log" })),
      keywords: "activity history log",
    },
    {
      id: "fleet-manager",
      label: "AI fleet manager",
      icon: <Bot className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/fleet-manager" })),
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: <Bell className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/notifications" })),
    },
    {
      id: "cloudflare",
      label: "Cloudflare",
      icon: <Shield className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/cloudflare" })),
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/settings" })),
    },
    {
      id: "dashboard",
      label: "Fleet overview",
      icon: <LayoutDashboard className="h-4 w-4" />,
      onSelect: () => run(() => navigate({ to: "/dashboard" })),
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to clone, module, cascade — or type a command…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          {actions.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.label} ${a.keywords ?? ""}`}
              onSelect={a.onSelect}
            >
              <span className="text-muted-foreground">{a.icon}</span>
              <span>{a.label}</span>
              {a.hint && (
                <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {a.hint}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {clones.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Clones · ${clones.length}`}>
              {clones.slice(0, 30).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`clone ${c.name} ${c.slug} ${c.github_owner}/${c.github_repo} ${(c.tags ?? []).join(" ")}`}
                  onSelect={() =>
                    run(() =>
                      navigate({ to: "/clones/$cloneId", params: { cloneId: c.id } }),
                    )
                  }
                >
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                    {c.sync_status}
                    {c.commits_behind ? ` · ${c.commits_behind} behind` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {modules.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Modules · ${modules.length}`}>
              {modules.slice(0, 30).map((m) => (
                <CommandItem
                  key={m.id}
                  value={`module ${m.name} ${m.slug}`}
                  onSelect={() =>
                    run(() =>
                      navigate({ to: "/modules/$slug", params: { slug: m.slug } }),
                    )
                  }
                >
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {m.status}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {events.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent cascades">
              {events.slice(0, 10).map((e) => (
                <CommandItem
                  key={e.id}
                  value={`cascade ${e.id} ${e.mode} ${e.status} ${e.summary ?? ""}`}
                  onSelect={() =>
                    run(() =>
                      navigate({ to: "/cascades/$eventId", params: { eventId: e.id } }),
                    )
                  }
                >
                  <History className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs">
                    {e.mode.replace("_", " ")} · {e.status}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {formatDistanceToNow(e.created_at)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Tip">
          <CommandItem disabled value="tip">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Press <CommandShortcut>⌘K</CommandShortcut> anywhere to open this palette.
            </span>
          </CommandItem>
          <CommandItem disabled value="tip2">
            <GitFork className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Type to filter — clones, modules, cascades, and actions all match.
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
