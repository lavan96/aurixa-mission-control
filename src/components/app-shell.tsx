import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  GitFork,
  Boxes,
  Waves,
  Bot,
  Shield,
  Settings,
  LogOut,
  Radio,
  ScrollText,
  CalendarClock,
  Sparkles,
  Activity,
  TreePine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/notifications-bell";
import { CommandPalette } from "@/components/command-palette";

const NAV = [
  { to: "/dashboard", label: "Fleet", icon: LayoutDashboard },
  { to: "/health", label: "Health", icon: Activity },
  { to: "/clones/new", label: "New Clone", icon: GitFork },
  { to: "/modules", label: "Modules", icon: Boxes },
  { to: "/cascades", label: "Cascades", icon: Waves },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
  { to: "/drift", label: "Drift", icon: Sparkles },
  { to: "/fleet-manager", label: "AI Manager", icon: Bot },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  { to: "/cloudflare", label: "Cloudflare", icon: Shield },
  { to: "/yggdrasil", label: "Yggdrasil", icon: TreePine },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar p-4 md:flex">
        <Link to="/dashboard" className="mb-8 flex items-center gap-2">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
            <Radio className="h-5 w-5 text-primary" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-accent" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Aurixa Systems</span>
            <span className="font-mono text-sm font-semibold tracking-wide text-foreground">MISSION CONTROL</span>
          </div>
        </Link>

        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            const active = loc.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4", active && "text-primary")} />
                <span>{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-md border border-border/60 bg-surface p-3">
          <div className="mb-2 truncate font-mono text-[11px] text-muted-foreground">
            {user?.email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={async () => {
              await signOut();
              nav({ to: "/auth" });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur">
          <Radio className="h-5 w-5 text-primary" />
          <div className="flex flex-col leading-none">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Aurixa Systems</span>
            <span className="font-mono text-sm font-semibold tracking-wide">MISSION CONTROL</span>
          </div>
          <div className="ml-auto">
            <NotificationsBell />
          </div>
        </header>
        {/* Desktop top bar */}
        <header className="hidden md:flex sticky top-0 z-30 h-12 items-center justify-end gap-2 border-b border-border/60 bg-background/80 px-6 backdrop-blur">
          <kbd className="hidden lg:inline-flex items-center gap-1 rounded border border-border/60 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
            <span className="text-muted-foreground/60">command palette</span>
          </kbd>
          <NotificationsBell />
        </header>
        <div className="p-6 md:p-8">{children}</div>
      </main>
      <CommandPalette />
    </div>
  );
}
