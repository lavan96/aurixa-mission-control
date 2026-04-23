/// <reference lib="webworker" />

/**
 * Service Worker for Web Push notifications.
 * Handles push events and notification click routing.
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Aurixa Mission Control", body: event.data.text() };
  }

  const title = payload.title || "Aurixa Mission Control";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || `mc-${Date.now()}`,
    data: {
      url: payload.url || "/",
      notificationId: payload.notificationId,
    },
    silent: payload.severity === "info",
    requireInteraction: payload.severity === "error" || payload.severity === "warning",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        // Open new window
        return self.clients.openWindow(url);
      })
  );
});
