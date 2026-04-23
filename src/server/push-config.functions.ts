import { createServerFn } from "@tanstack/react-start";

/**
 * Return the VAPID public key so the client can subscribe to push.
 */
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(
  async () => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return { vapidPublicKey: null };
    return { vapidPublicKey: key };
  }
);
