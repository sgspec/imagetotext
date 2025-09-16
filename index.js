// index.js — Cloudflare Worker (OCR with polling + better errors)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { AZURE_VISION_ENDPOINT, AZURE_VISION_KEY } = env;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // Health
    if (url.pathname === "/" && request.method === "GET") {
      return okText("✅ OCR Worker running with polling");
    }

    // Validate env (บอกชัด ๆ)
    if (!AZURE_VISION_ENDPOINT || !AZURE_VISION_KEY) {
      return json({ error: "Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY" }, 500);
    }
    const endpoint = AZURE_VISION_ENDPOINT.replace(/\/+$/, "");
    const OCR_URL = `${endpoint}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    try {
      if (url.pathname === "/ocr/url" && request.method === "POST") {
        const { imageUrl } = await safeJson(request);
        if (!imageUrl) return json({ error: "imageUrl required" }, 400);

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": AZURE_VISION_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ urlSource: imageUrl })
        });

        if (!r.ok) {
          const t = await r.text();
          console.error("Azure /ocr/url error", r.status, t);
          return json({ error: `Azure error ${r.status}`, detail: tryParseJSON(t) ?? t }, r.status);
        }

        const op = r.headers.get("operation-location");
        if (!op) {
          return json({ error: "Azure did not return operation-location header" }, 502);
        }

        const data = await poll(op, AZURE_VISION_KEY);
        if (data.status !== "succeeded") {
          return json({ error: "Azure analyze failed", detail: data }, 502);
        }

        return json({ status: "succeeded", text: extractText(data), raw: data });
      }

      if (url.pathname === "/ocr/upload" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "file required" }, 400);

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": AZURE_VISION_KEY,
            "Content-Type": "application/octet-stream"
          },
          body: await file.arrayBuffer()
        });

        if (!r.ok) {
          const t = await r.text();
          console.error("Azure /ocr/upload error", r.status, t);
          return json({ error: `Azure error ${r.status}`, detail: tryParseJSON(t) ?? t }, r.status);
        }

        const op = r.headers.get("operation-location");
        if (!op) {
          return json({ error: "Azure did not return operation-location header" }, 502);
        }

        const data = await poll(op, AZURE_VISION_KEY);
        if (data.status !== "succeeded") {
          return json({ error: "Azure analyze failed", detail: data }, 502);
        }

        return json({ status: "succeeded", text: extractText(data), raw: data });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error("Worker fatal error:", e);
      return json({ error: "Worker error", detail: String(e) }, 500);
    }
  }
};

/* -------- helpers -------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function okText(msg) {
  return new Response(msg, { headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders() } });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}
async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
function tryParseJSON(t) { try { return JSON.parse(t); } catch { return null; } }

async function poll(resultUrl, key) {
  const maxWaitMs = 60_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const r = await fetch(resultUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key }
    });
    const data = await r.json().catch(() => ({}));
    if (data.status === "succeeded" || data.status === "failed") return data;
    await new Promise(res => setTimeout(res, 1500));
  }
  return { status: "failed", error: "timeout" };
}

function extractText(diJson) {
  const pages = diJson?.analyzeResult?.pages || [];
  const lines = [];
  for (const p of pages) for (const ln of (p.lines || [])) if (ln.content) lines.push(ln.content);
  return lines.join("\n").trim();
}
