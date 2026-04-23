/**
 * Client-side Web Push subscription management.
 * Handles service worker registration, VAPID subscription,
 * and syncing with the backend push_subscriptions table.
 */

import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Convert a base64url string to a Uint8Array for applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!VAPID_PUBLIC_KEY
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.error("SW registration failed:", err);
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(userId: string): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  const reg = await navigator.serviceWorker.ready;

  // Check if already subscribed
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
    });
  }

  // Extract keys
  const rawKey = subscription.getKey("p256dh");
  const rawAuth = subscription.getKey("auth");
  if (!rawKey || !rawAuth) {
    throw new Error("Push subscription missing p256dh or auth keys");
  }

  const p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
  const auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)));

  // Upsert into push_subscriptions
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("Failed to save push subscription:", error);
  }

  return subscription;
}

export async function unsubscribeFromPush(userId: string): Promise<boolean> {
  const subscription = await getExistingSubscription();
  if (!subscription) return true;

  // Remove from DB
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", subscription.endpoint);

  // Unsubscribe from browser
  return subscription.unsubscribe();
}

export async function getUserSubscriptions(userId: string) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at, last_used_at")
    .eq("user_id", userId)
    .order("last_used_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function removeSubscriptionById(id: string) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
  if (error) throw error;
}
