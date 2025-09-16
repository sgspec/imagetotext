// index.js สำหรับ Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    // ตรวจสอบ Environment Variables
    const AZURE_ENDPOINT = (env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
    const AZURE_KEY = env.AZURE_VISION_KEY;

    if (!AZURE_ENDPOINT || !AZURE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY" }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const OCR_URL = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    // ฟังก์ชันแยกข้อความจาก Azure Response
    function extractText(diJson) {
      const pages = diJson?.analyzeResult?.pages || [];
      const lines = [];
      for (const p of pages) {
        for (const ln of p.lines || []) {
          if (ln.content) lines.push(ln.content);
        }
      }
      return lines.join("\\n").trim();
    }

    // ฟังก์ชัน Polling สำหรับรอผลลัพธ์
    async function pollResult(resultUrl) {
      while (true) {
        const r = await fetch(resultUrl, {
          headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY }
        });
        const data = await r.json();

        if (data.status === "succeeded" || data.status === "failed") {
          return data;
        }
        // รอ 1.5 วินาทีก่อน poll ครั้งต่อไป
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    try {
      // Route: หน้าแรก
      if (url.pathname === "/" && request.method === "GET") {
        return new Response("✅ OCR Backend running on Cloudflare Workers with polling", {
          headers: { "Content-Type": "text/plain", ...corsHeaders }
        });
      }

      // Route: OCR จาก URL
      if (url.pathname === "/ocr/url" && request.method === "POST") {
        const body = await request.json();
        const { imageUrl } = body || {};
        
        if (!imageUrl) {
          return new Response(
            JSON.stringify({ error: "imageUrl required" }), 
            { status: 400, headers: corsHeaders }
          );
        }

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": AZURE_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ urlSource: imageUrl })
        });

        if (!r.ok) {
          const errorText = await r.text();
          return new Response(errorText, { status: 400, headers: corsHeaders });
        }

        const opLoc = r.headers.get("operation-location");
        const data = await pollResult(opLoc);

        return new Response(
          JSON.stringify({ 
            status: "succeeded", 
            text: extractText(data), 
            raw: data 
          }), 
          { headers: corsHeaders }
        );
      }

      // Route: OCR จากไฟล์อัพโหลด
      if (url.pathname === "/ocr/upload" && request.method === "POST") {
        const formData = await request.formData();
        const file = formData.get("file");
        
        if (!file) {
          return new Response(
            JSON.stringify({ error: "file required" }), 
            { status: 400, headers: corsHeaders }
          );
        }

        const fileBuffer = await file.arrayBuffer();

        const r = await fetch(OCR_URL, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": AZURE_KEY,
            "Content-Type": "application/octet-stream"
          },
          body: fileBuffer
        });

        if (!r.ok) {
          const errorText = await r.text();
          return new Response(errorText, { status: 400, headers: corsHeaders });
        }

        const opLoc = r.headers.get("operation-location");
        const data = await pollResult(opLoc);

        return new Response(
          JSON.stringify({ 
            status: "succeeded", 
            text: extractText(data), 
            raw: data 
          }), 
          { headers: corsHeaders }
        );
      }

      // Route ไม่พบ
      return new Response(
        JSON.stringify({ error: "Route not found" }), 
        { status: 404, headers: corsHeaders }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({ error: String(error) }), 
        { status: 500, headers: corsHeaders }
      );
    }
  }
};
