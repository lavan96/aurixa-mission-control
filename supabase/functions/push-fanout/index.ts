/**
 * Push Fan-out Edge Function
 *
 * Called by a database webhook on INSERT to `notifications`.
 * Looks up all push_subscriptions, filters by user preferences,
 * and sends Web Push to each device.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Web Push crypto helpers using Web Crypto API
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; gone: boolean }> {
  try {
    const audience = new URL(subscription.endpoint).origin;
    const jwt = await createVapidJwt(audience, vapidSubject, vapidPrivateKey, vapidPublicKey);
    const encrypted = await encryptPayload(subscription.p256dh, subscription.auth, payload);

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
        Urgency: "normal",
      },
      body: encrypted,
    });

    // 410 Gone / 404 Not Found = permanently dead → delete subscription.
    // Other failures (429, 5xx, network) are transient → keep subscription.
    if (res.status === 410 || res.status === 404) {
      return { ok: false, gone: true };
    }
    if (!res.ok) {
      console.error(`Push failed (transient): ${res.status} ${await res.text()}`);
      return { ok: false, gone: false };
    }
    return { ok: true, gone: false };
  } catch (err) {
    console.error("sendWebPush error:", err);
    return { ok: false, gone: false };
  }
}

function base64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyBase64url: string,
  _publicKeyBase64url: string,
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject,
  };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const unsigned = `${headerB64}.${claimsB64}`;

  // Import private key
  const privateKeyBytes = base64urlDecode(privateKeyBase64url);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    buildPkcs8FromRaw(privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );

  // Convert DER signature to raw r||s format
  const rawSig = derToRaw(new Uint8Array(signature));
  return `${unsigned}.${base64urlEncode(rawSig)}`;
}

function buildPkcs8FromRaw(rawPrivateKey: Uint8Array): ArrayBuffer {
  // PKCS8 wrapper for P-256 private key
  const prefix = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20,
  ]);
  const suffix = new Uint8Array([0xa1, 0x44, 0x03, 0x42, 0x00]);
  // We need the public key too, but for signing we can omit it
  // Use a simpler PKCS8 format without the public key
  const simplePrefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const result = new Uint8Array(simplePrefix.length + rawPrivateKey.length);
  result.set(simplePrefix);
  result.set(rawPrivateKey, simplePrefix.length);
  return result.buffer;
}

function derToRaw(derSig: Uint8Array): Uint8Array {
  // If it's already 64 bytes, it's raw format
  if (derSig.length === 64) return derSig;

  // Parse DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = 2; // skip 0x30 and length
  if (derSig[0] !== 0x30) return derSig; // not DER

  // R
  offset++; // skip 0x02
  const rLen = derSig[offset++];
  const rStart = offset;
  offset += rLen;

  // S
  offset++; // skip 0x02
  const sLen = derSig[offset++];
  const sStart = offset;

  const raw = new Uint8Array(64);
  // Copy R (right-aligned to 32 bytes)
  const rBytes = derSig.slice(rStart, rStart + rLen);
  const rPad = 32 - rBytes.length;
  if (rPad >= 0) {
    raw.set(rBytes, rPad);
  } else {
    raw.set(rBytes.slice(-32), 0);
  }
  // Copy S (right-aligned to 32 bytes)
  const sBytes = derSig.slice(sStart, sStart + sLen);
  const sPad = 32 - sBytes.length;
  if (sPad >= 0) {
    raw.set(sBytes, 32 + sPad);
  } else {
    raw.set(sBytes.slice(-32), 32);
  }

  return raw;
}

async function encryptPayload(
  p256dhBase64: string,
  authBase64: string,
  plaintext: string,
): Promise<Uint8Array> {
  const clientPublicKey = base64Decode(p256dhBase64);
  const clientAuth = base64Decode(authBase64);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  // Import client's public key
  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKey as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientKey },
    localKeyPair.privateKey,
    256,
  );

  // Export local public key
  const localPublicKey = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKey);

  // Derive encryption key and nonce using HKDF
  const authInfo = new TextEncoder().encode("Content-Encoding: auth\0");
  const ikm = await hkdf(new Uint8Array(sharedSecret), clientAuth, authInfo, 32);

  const keyInfo = createInfo("aesgcm", clientPublicKey, localPublicKeyBytes);
  const contentKey = await hkdf(ikm, new Uint8Array(0), keyInfo, 16);

  const nonceInfo = createInfo("nonce", clientPublicKey, localPublicKeyBytes);
  const nonce = await hkdf(ikm, new Uint8Array(0), nonceInfo, 12);

  // Build padded plaintext (2 bytes padding length + padding + data)
  const paddingLength = 0;
  const padded = new Uint8Array(2 + paddingLength + plaintextBytes.length);
  padded[0] = (paddingLength >> 8) & 0xff;
  padded[1] = paddingLength & 0xff;
  padded.set(plaintextBytes, 2 + paddingLength);

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
    aesKey,
    padded as BufferSource,
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
  header.set(salt);
  header[16] = (rs >> 24) & 0xff;
  header[17] = (rs >> 16) & 0xff;
  header[18] = (rs >> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = localPublicKeyBytes.length;
  header.set(localPublicKeyBytes, 21);

  // Recalculate content key and nonce with the actual salt
  const ikm2 = await hkdf(new Uint8Array(sharedSecret), clientAuth, authInfo, 32);
  const contentKey2 = await hkdf(ikm2, salt, keyInfo, 16);
  const nonce2 = await hkdf(ikm2, salt, nonceInfo, 12);

  const aesKey2 = await crypto.subtle.importKey(
    "raw",
    contentKey2 as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  // Re-build padded with record delimiter
  const recordPadded = new Uint8Array(plaintextBytes.length + 1);
  recordPadded.set(plaintextBytes);
  recordPadded[plaintextBytes.length] = 2; // delimiter

  const encryptedRecord = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce2 as BufferSource, tagLength: 128 },
    aesKey2,
    recordPadded as BufferSource,
  );

  const result = new Uint8Array(header.length + encryptedRecord.byteLength);
  result.set(header);
  result.set(new Uint8Array(encryptedRecord), header.length);

  return result;
}

function createInfo(
  type: string,
  clientPublicKey: Uint8Array,
  serverPublicKey: Uint8Array,
): Uint8Array {
  const typeBytes = new TextEncoder().encode(`Content-Encoding: ${type}\0`);
  const p256dhBytes = new TextEncoder().encode("P-256\0");

  const info = new Uint8Array(
    typeBytes.length + p256dhBytes.length + 2 + clientPublicKey.length + 2 + serverPublicKey.length,
  );

  let offset = 0;
  info.set(typeBytes, offset);
  offset += typeBytes.length;
  info.set(p256dhBytes, offset);
  offset += p256dhBytes.length;
  info[offset++] = 0;
  info[offset++] = clientPublicKey.length;
  info.set(clientPublicKey, offset);
  offset += clientPublicKey.length;
  info[offset++] = 0;
  info[offset++] = serverPublicKey.length;
  info.set(serverPublicKey, offset);

  return info;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    (salt.length > 0 ? salt : new Uint8Array(32)) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm as BufferSource));

  const prkKey = await crypto.subtle.importKey(
    "raw",
    prk as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const infoWithCounter = new Uint8Array(info.length + 1);
  infoWithCounter.set(info);
  infoWithCounter[info.length] = 1;

  const okm = new Uint8Array(
    await crypto.subtle.sign("HMAC", prkKey, infoWithCounter as BufferSource),
  );
  return okm.slice(0, length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@aurixa.systems";

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("VAPID keys not configured");
      return new Response(JSON.stringify({ error: "VAPID not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    // Payload from database webhook: { type: "INSERT", record: { ... } }
    const notification = body.record || body;

    if (!notification?.id || !notification?.title) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all push subscriptions
    const { data: subscriptions, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth");

    if (subErr || !subscriptions?.length) {
      console.log("No subscriptions found or error:", subErr?.message);
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch notification preferences for all subscribed users
    const userIds = [...new Set(subscriptions.map((s) => s.user_id))];
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, muted_kinds, muted_severities, mute_browser_push")
      .in("user_id", userIds);

    const prefsMap = new Map(prefs?.map((p) => [p.user_id, p]) ?? []);

    const pushPayload = JSON.stringify({
      title: notification.title,
      body: notification.body || "",
      url: notification.url || "/notifications",
      tag: `mc-${notification.kind}-${notification.id}`,
      severity: notification.severity,
      notificationId: notification.id,
    });

    let sent = 0;
    let expired = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const userPref = prefsMap.get(sub.user_id);
        if (userPref) {
          if (userPref.mute_browser_push) return;
          if (userPref.muted_kinds?.includes(notification.kind)) return;
          if (userPref.muted_severities?.includes(notification.severity)) return;
        }

        const result = await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          pushPayload,
          vapidPublicKey,
          vapidPrivateKey,
          vapidSubject,
        );

        if (result.ok) {
          sent++;
          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", sub.id);
        } else if (result.gone) {
          // Only delete on permanent 410/404 — transient failures keep the row.
          expired++;
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          failed++;
        }
      }),
    );

    console.log(
      `Push fan-out: ${sent} sent, ${expired} expired (410), ${failed} transient-failed, ${results.length} total`,
    );

    return new Response(JSON.stringify({ sent, expired, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Push fan-out error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
