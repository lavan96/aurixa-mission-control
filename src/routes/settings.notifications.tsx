import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BellOff,
  BellRing,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  CircleDot,
  GitFork,
  Trash2,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import {
  useNotificationPreferences,
  type NotificationKind,
  type NotificationSeverity,
} from "@/lib/notification-preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/notifications")({
  component: () => (
    <ProtectedRoute>
      <SettingsNotificationsPage />
    </ProtectedRoute>
  ),
  head: () => ({
    meta: [{ title: "Notification Preferences — Aurixa Systems Mission Control" }],
  }),
});

const KINDS: {
  value: NotificationKind;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "cascade_started",
    label: "Cascade started",
    description: "When a new cascade run kicks off.",
    icon: CircleDot,
  },
  {
    value: "cascade_completed",
    label: "Cascade completed",
    description: "Successful cascade runs.",
    icon: CheckCircle2,
  },
  {
    value: "cascade_partial",
    label: "Cascade partial",
    description: "Some clones synced, others didn't.",
    icon: AlertTriangle,
  },
  {
    value: "cascade_failed",
    label: "Cascade failed",
    description: "Run did not succeed for any clone.",
    icon: XCircle,
  },
  {
    value: "cascade_awaiting_approval",
    label: "Cascade awaiting approval",
    description: "A high-blast-radius cascade needs a second-operator approval.",
    icon: AlertTriangle,
  },
  {
    value: "cascade_approved",
    label: "Cascade approved",
    description: "Your pending cascade was approved by another operator.",
    icon: CheckCircle2,
  },
  {
    value: "cascade_rejected",
    label: "Cascade rejected",
    description: "Your pending cascade was rejected by another operator.",
    icon: XCircle,
  },
  {
    value: "drift_high",
    label: "Drift — high",
    description: "AI flagged a high-severity drift finding.",
    icon: AlertTriangle,
  },
  {
    value: "drift_medium",
    label: "Drift — medium",
    description: "AI flagged a medium-severity drift finding.",
    icon: AlertTriangle,
  },
  {
    value: "clone_created",
    label: "Clone created",
    description: "New clone provisioned in the fleet.",
    icon: GitFork,
  },
  {
    value: "clone_deleted",
    label: "Clone deleted",
    description: "Clone removed from the fleet.",
    icon: Trash2,
  },
  {
    value: "module_installed",
    label: "Module installed",
    description: "Module injected into a clone.",
    icon: Boxes,
  },
  {
    value: "module_removed",
    label: "Module removed",
    description: "Module removed from a clone.",
    icon: Boxes,
  },
];

const SEVERITIES: {
  value: NotificationSeverity;
  label: string;
  className: string;
  icon: LucideIcon;
}[] = [
  { value: "info", label: "Info", className: "text-info", icon: Info },
  { value: "success", label: "Success", className: "text-success", icon: CheckCircle2 },
  { value: "warning", label: "Warning", className: "text-warning", icon: AlertTriangle },
  { value: "error", label: "Error", className: "text-destructive", icon: XCircle },
];

function SettingsNotificationsPage() {
  const { prefs, loading, toggleKind, toggleSeverity, setToggle } =
    useNotificationPreferences();

  const handleToast = (next: boolean) => void setToggle("mute_toasts", next);
  const handlePush = (next: boolean) => void setToggle("mute_browser_push", next);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4 text-primary" /> Delivery channels
          </CardTitle>
          <CardDescription>
            Mute entire channels without losing the inbox history. Notifications still appear in
            the bell and on the /notifications page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChannelToggle
            id="mute-toasts"
            label="In-app toasts"
            description="Floating popups for cascade outcomes and drift findings."
            checked={!prefs.mute_toasts}
            onCheckedChange={(v) => handleToast(!v)}
            disabled={loading}
          />
          <ChannelToggle
            id="mute-push"
            label="Browser notifications"
            description="OS-level notifications when this tab is in the background."
            checked={!prefs.mute_browser_push}
            onCheckedChange={(v) => handlePush(!v)}
            disabled={loading}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellOff className="h-4 w-4 text-warning" /> Mute by severity
          </CardTitle>
          <CardDescription>
            Suppress toasts and browser push for specific severity levels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {SEVERITIES.map((s) => {
              const muted = prefs.muted_severities.includes(s.value);
              const Icon = s.icon;
              return (
                <button
                  key={s.value}
                  type="button"
                  disabled={loading}
                  onClick={() => void toggleSeverity(s.value)}
                  className={cn(
                    "flex items-center justify-between rounded-md border p-3 text-left transition-colors",
                    muted
                      ? "border-muted bg-muted/40 opacity-70"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", muted ? "text-muted-foreground" : s.className)} />
                    <span className="font-mono text-sm">{s.label}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] uppercase",
                      muted ? "border-muted text-muted-foreground" : "border-success/40 text-success",
                    )}
                  >
                    {muted ? "muted" : "on"}
                  </Badge>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellOff className="h-4 w-4 text-warning" /> Mute by kind
          </CardTitle>
          <CardDescription>
            Suppress toasts and browser push for specific event types. The bell still records them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {KINDS.map((k) => {
            const muted = prefs.muted_kinds.includes(k.value);
            const Icon = k.icon;
            return (
              <div
                key={k.value}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-surface p-3"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      muted ? "text-muted-foreground" : "text-primary",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{k.label}</div>
                    <div className="text-xs text-muted-foreground">{k.description}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={muted ? "outline" : "ghost"}
                  disabled={loading}
                  onClick={() => void toggleKind(k.value)}
                  className="shrink-0"
                >
                  {muted ? "Unmute" : "Mute"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelToggle({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-surface p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-mono text-sm">
          {label}
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
