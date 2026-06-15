/**
 * Patches applied before anything else loads.
 *
 * Bun v1.3.14 on Windows crashes with "Internal assertion failure" in
 * brotli decompression (array_list.zig:1389 → unusedCapacitySlice).
 * The crash happens on the HTTP thread when a server responds with
 * Content-Encoding: br (brotli).
 *
 * Fix: strip "br" from Accept-Encoding on every outgoing fetch so
 * upstream servers never send brotli. gzip/deflate are safe.
 *
 * Coverage:
 *   - globalThis.fetch (covers most app-level requests)
 *   - node:http  request / get
 *   - node:https request / get
 *
 * Anything that escapes these (e.g. Bun's internal HTTP/2/3 paths,
 * native Bun.fetch symbols not aliased to globalThis.fetch) is out of
 * reach from JS. The supervisor catches those crashes via auto-restart.
 */

// ---------- 1. globalThis.fetch ----------
const _originalFetch = globalThis.fetch;

globalThis.fetch = function patchedFetch(
  input: string | URL | globalThis.Request,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const current = headers.get("Accept-Encoding") || "";
  if (current.includes("br")) {
    headers.set("Accept-Encoding", current.replace(/,?\s*br\s*/g, "").trim() || "gzip, deflate");
  } else if (!current) {
    headers.set("Accept-Encoding", "gzip, deflate");
  }
  return _originalFetch(input, { ...init, headers });
};

// ---------- 2. node:http and node:https ----------
// Some libraries (axios, got with http agent, etc.) reach the lower-level
// node http/https modules directly, bypassing the fetch shim above.
// We patch their request() and get() to enforce the same Accept-Encoding policy.

function sanitizeAcceptEncoding(headers: Record<string, any> | undefined): Record<string, any> {
  const h: Record<string, any> = headers ? { ...headers } : {};
  // Find any case-variant of accept-encoding
  let key: string | undefined;
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === "accept-encoding") { key = k; break; }
  }
  if (key) {
    const val = String(h[key] || "");
    if (val.includes("br")) {
      const cleaned = val.replace(/,?\s*br\s*/gi, "").trim();
      h[key] = cleaned || "gzip, deflate";
    }
  } else {
    h["Accept-Encoding"] = "gzip, deflate";
  }
  return h;
}

function patchNodeHttpModule(modName: "http" | "https") {
  try {
    // Use require to avoid TS dynamic import complications; Bun provides node compat.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modName) as any;
    if (!mod || mod.__brotliPatched) return;

    const _origRequest = mod.request;
    const _origGet = mod.get;

    mod.request = function patchedRequest(...args: any[]) {
      // Signatures: request(url, options?, callback?) | request(options, callback?)
      // Mutate the options bag's headers in place where we can.
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a && typeof a === "object" && !Array.isArray(a) && (a.headers !== undefined || a.method !== undefined || a.host !== undefined || a.hostname !== undefined || a.path !== undefined)) {
          a.headers = sanitizeAcceptEncoding(a.headers);
        }
      }
      return _origRequest.apply(mod, args);
    };

    mod.get = function patchedGet(...args: any[]) {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a && typeof a === "object" && !Array.isArray(a) && (a.headers !== undefined || a.method !== undefined || a.host !== undefined || a.hostname !== undefined || a.path !== undefined)) {
          a.headers = sanitizeAcceptEncoding(a.headers);
        }
      }
      return _origGet.apply(mod, args);
    };

    mod.__brotliPatched = true;
  } catch {
    // Module unavailable (shouldn't happen in Bun, but don't crash the patch loader)
  }
}

patchNodeHttpModule("http");
patchNodeHttpModule("https");
