// Vim-style keyboard shortcuts: press `g` then a target key.
// Mounted once in AppShell — silent, zero UI footprint.
import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

const MAP: Record<string, { to: string; label: string }> = {
  d: { to: "/dashboard", label: "Fleet" },
  m: { to: "/modules", label: "Modules" },
  c: { to: "/cascades", label: "Cascades" },
  b: { to: "/branding", label: "Branding" },
  s: { to: "/schedules", label: "Schedules" },
  h: { to: "/health", label: "Health" },
  a: { to: "/audit-log", label: "Audit log" },
  n: { to: "/notifications", label: "Notifications" },
  e: { to: "/cloudflare", label: "Cloudflare" },
  l: { to: "/slo", label: "SLO" },
  q: { to: "/approvals", label: "Approvals queue" },
};

export function KeyboardShortcuts() {
  const nav = useNavigate();
  const armed = useRef<number | null>(null);

  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === "g") {
        if (armed.current) window.clearTimeout(armed.current);
        armed.current = window.setTimeout(() => { armed.current = null; }, 1200);
        return;
      }
      if (armed.current) {
        const target = MAP[e.key.toLowerCase()];
        window.clearTimeout(armed.current);
        armed.current = null;
        if (target) {
          e.preventDefault();
          nav({ to: target.to as never });
          toast(target.label, { description: `g${e.key}`, duration: 1200 });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  return null;
}
