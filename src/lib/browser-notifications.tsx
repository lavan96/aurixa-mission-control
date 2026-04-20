import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getMutedSnapshot, isMuted } from "@/lib/notification-preferences";
import type { Database } from "@/integrations/supabase/types";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];
type Severity = Database["public"]["Enums"]["notification_severity"];

const PERMISSION_KEY = "mc:browser-push:enabled";

export type BrowserPushState = {
  supported: boolean;
  permission: NotificationPermission;
  enabled: boolean;
  request: () => Promise<void>;
  disable: () => void;
};

/**
 * Hook + side-effect component for OS-level browser notifications.
 *
 * Uses the Web Notification API directly — fires whenever a new row lands
 * in `notifications` while the tab is alive (foreground or background).
 * For true server-pushed alerts when the tab is closed, a VAPID/Push API
 * subscription would need backend infra; this covers the common "I left
 * the dashboard in a tab" workflow.
 */
export function useBrowserPushSettings(): BrowserPushState {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported ? Notification.permission : "default",
  );
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(PERMISSION_KEY) === "1";
  });

  const request = useCallback(async () => {
    if (!supported) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      localStorage.setItem(PERMISSION_KEY, "1");
      setEnabled(true);
    }
  }, [supported]);

  const disable = useCallback(() => {
    localStorage.removeItem(PERMISSION_KEY);
    setEnabled(false);
  }, []);

  return { supported, permission, enabled, request, disable };
}

function severityIcon(severity: Severity): string {
  // Use favicon-style emoji as fallback icon (most browsers ignore data URIs
  // for the icon field on some OSes; the title carries the meaning).
  switch (severity) {
    case "error":
      return "/favicon.ico";
    case "warning":
      return "/favicon.ico";
    case "success":
      return "/favicon.ico";
    default:
      return "/favicon.ico";
  }
}

/**
 * Mounts global listener: shows a system Notification for every new row
 * inserted into `notifications`, when the user has opted in.
 */
export function BrowserPushNotifications() {
  const { session } = useAuth();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!session) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const channel = supabase
      .channel(`notif:browser-push:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notification;
          if (seen.current.has(n.id)) return;
          seen.current.add(n.id);

          const optedIn = localStorage.getItem(PERMISSION_KEY) === "1";
          if (!optedIn) return;
          if (Notification.permission !== "granted") return;
          // Honor user mute preferences for browser push.
          const snap = getMutedSnapshot();
          if (snap.mute_browser_push) return;
          if (isMuted(snap, n.kind, n.severity)) return;
          // Suppress when the tab is focused — toasts handle it; OS notifs
          // would be redundant and noisy.
          if (typeof document !== "undefined" && document.visibilityState === "visible") return;

          try {
            const sysNotif = new Notification(n.title, {
              body: n.body ?? undefined,
              icon: severityIcon(n.severity),
              tag: `mc-${n.kind}-${n.id}`,
              silent: n.severity === "info",
            });
            sysNotif.onclick = () => {
              window.focus();
              if (n.url) {
                window.location.href = n.url;
              }
              sysNotif.close();
            };
          } catch {
            // Some browsers throw if called from a non-secure context or
            // background workers; fail silently.
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session]);

  return null;
}
