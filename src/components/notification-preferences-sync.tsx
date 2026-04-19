import { useNotificationPreferences } from "@/lib/notification-preferences";

/**
 * Side-effect-only component: mounts the preferences hook so the
 * localStorage cache is hydrated from the database on auth/session
 * change, keeping `getMutedSnapshot()` accurate for non-React readers.
 */
export function NotificationPreferencesSync() {
  useNotificationPreferences();
  return null;
}
