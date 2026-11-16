// Web Push sin dependencias, con WebCrypto (funciona en Cloudflare Workers).
//  - Cifrado del mensaje: RFC 8291 (aes128gcm, RFC 8188)
//  - Identificación del servidor: VAPID, RFC 8292 (JWT ES256)

const te = new TextEncoder();

export const b64u = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  },
};

function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// Par de claves VAPID del servidor (se genera una sola vez)
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u.enc(pub), privateJwk: jwk };
}

const jwtCache = new Map();
export async function vapidAuthorization(endpoint, vapid, subject, nowMs = Date.now()) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  if (hit && hit.pub === vapid.publicKey && hit.exp - 3600 > nowMs / 1000) return hit.header;
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`)));
  const header = `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${vapid.publicKey}`;
  jwtCache.set(aud, { header, exp, pub: vapid.publicKey });
  return header;
}

// Cifra el contenido para una suscripción { endpoint, p256dh, auth }
export async function encryptPayload(sub, plaintext) {
  const uaPublic = b64u.dec(sub.p256dh);
  const authSecret = b64u.dec(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(plaintext, new Uint8Array([2])); // 0x02 = último registro
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// Envía un mensaje. Devuelve { ok, status, gone, detail }.
// gone = la suscripción ya no existe (404/410) y debe borrarse.
export async function sendPush(sub, payload, vapid, { ttl = 21600, urgency = 'high', subject, nowMs } = {}) {
  try {
    const body = await encryptPayload(sub, te.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid, subject, nowMs),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    let detail = '';
    if (!res.ok) detail = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: String((e && e.message) || e).slice(0, 200) };
  }
}
