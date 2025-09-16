// index.js — Cloudflare Worker (no Express/fs/multer)

const API_VERSION = "2023-07-31";

function extractText(diJson) {
  const pages = diJson?.analyzeResult?.pages || [];
  const lines = [];
  for (const p of pages) {
    for (const ln of p.lines || []) {
      if (ln.content) lines.push(ln.content);
    }
  }
  return lines.join("\n").trim();
}

async function pollResult(resultUrl, key) {
  // Poll จนกว่าจะ "succeeded" หรือ "failed"
  while (true) {
    const r = await fetch(resultUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key }
    });
    const data = await r.json().catch(() => ({}));
    if (data.status === "succeeded" || data.status === "failed") {
      return data;
    }
    // รอ 1.5 วิ ก่อนถามอีกรอบ
    await new Promise((res) => setTimeout(res, 1500));
  }
}

function withCors(body, init = {}, request) {
  const origin = request.headers.get("Origin") || "*";
  const headers = new Headers(init.headers || {});
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Vary", "Origin");
  return new Response(body, { ...init, headers });
}

function json(data, status = 200, request) {
  return withCors(
    JSON.stringify(data),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
    request
  );
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return withCors(null, { status: 204 }, request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ตรวจ env
    const ENDPOINT = (env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
    const KEY = env.AZURE_VISION_KEY;
    if (!ENDPOINT || !KEY) {
      return json({ error: "Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY" }, 500, request);
    }

    const OCR_URL = `${ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`;

    // Root
    if (path === "/" && request.method === "GET") {
      return withCors("✅ OCR Worker running with polling", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      }, request);
    }

    // ---- OCR จาก URL ----
    if (path === "/ocr/url" && request.method === "POST") {
      try {
        const { imageUrl } = await request.json().catch(() => ({}));
        if (!imageUrl) return json({ error: "imageUrl required" }, 400, request);

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ urlSource: imageUrl })
        });

        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          return json({ error: "Azure initial request failed", detail: txt }, r.status, request);
        }

        const opLoc = r.headers.get("operation-location");
        if (!opLoc) return json({ error: "Missing operation-location header" }, 500, request);

        const data = await pollResult(opLoc, KEY);
        return json({ status: data.status, text: extractText(data), raw: data }, 200, request);
      } catch (e) {
        return json({ error: String(e) }, 500, request);
      }
    }

    // ---- OCR จากไฟล์ (multipart/form-data, field: "file") ----
    if (path === "/ocr/upload" && request.method === "POST") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ error: "file required (multipart/form-data, field name 'file')" }, 400, request);
        }

        const buf = await file.arrayBuffer();

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": KEY,
            "Content-Type": "application/octet-stream"
          },
          body: buf
        });

        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          return json({ error: "Azure initial upload failed", detail: txt }, r.status, request);
        }

        const opLoc = r.headers.get("operation-location");
        if (!opLoc) return json({ error: "Missing operation-location header" }, 500, request);

        const data = await pollResult(opLoc, KEY);
        return json({ status: data.status, text: extractText(data), raw: data }, 200, request);
      } catch (e) {
        return json({ error: String(e) }, 500, request);
      }
    }

    return json({ error: "Not found" }, 404, request);
  }
};
