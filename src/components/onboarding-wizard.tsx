// First-run onboarding wizard — shown once when the operator has no clones.
// Persists dismissal in localStorage.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, GitFork, Boxes, Palette, Bell, Sparkles } from "lucide-react";
import { useClones } from "@/lib/queries";

const KEY = "mc:onboarded:v1";

const STEPS = [
  {
    icon: GitFork,
    title: "Provision your first clone",
    desc: "Fork, template, or clone an existing repo. Mission Control wires up backend, branding, and webhooks.",
    to: "/clones/new" as const,
  },
  {
    icon: Boxes,
    title: "Detect modules",
    desc: "Run AI module detection to map your codebase. Curate modules to make them reusable across the fleet.",
    to: "/modules" as const,
  },
  {
    icon: Palette,
    title: "Set a brand profile",
    desc: "Define a default brand profile so every new clone inherits a consistent identity from day one.",
    to: "/branding" as const,
  },
  {
    icon: Bell,
    title: "Tune notifications",
    desc: "Pick what pings you in real time vs the daily/weekly digest.",
    to: "/settings/notifications" as const,
  },
];

export function OnboardingWizard() {
  const { data: clones, loading } = useClones();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    const dismissed = typeof window !== "undefined" && window.localStorage.getItem(KEY);
    if (!dismissed && clones.length === 0) setOpen(true);
  }, [clones.length, loading]);

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) dismiss();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Welcome to Mission Control
          </DialogTitle>
          <DialogDescription>
            Four quick steps to spin up your fleet. You can revisit any of these later — nothing is
            locked in.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li
              key={s.to}
              className="flex items-start gap-3 rounded-md border border-border bg-surface p-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="text-sm font-semibold">{s.title}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
              </div>
              <Link to={s.to} onClick={dismiss}>
                <Button size="sm" variant="ghost">
                  Open
                </Button>
              </Link>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Skip — I'll explore on my own
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
