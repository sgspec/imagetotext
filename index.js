<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Workers OCR Converter</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen p-6">
    <div class="max-w-4xl mx-auto">
        <div class="bg-white rounded-xl shadow-lg p-8 mb-6">
            <h1 class="text-3xl font-bold text-gray-800 mb-2">🔄 Express to Cloudflare Workers Converter</h1>
            <p class="text-gray-600 mb-6">แปลงโค้ด server.js เป็น index.js สำหรับ Cloudflare Workers</p>
            
            <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                <div class="flex">
                    <div class="flex-shrink-0">
                        <svg class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </div>
                    <div class="ml-3">
                        <p class="text-sm text-yellow-700">
                            <strong>สำคัญ:</strong> คุณจะต้องตั้งค่า Environment Variables ใน Cloudflare Workers Dashboard:
                            <code class="bg-yellow-100 px-1 rounded">AZURE_VISION_ENDPOINT</code> และ 
                            <code class="bg-yellow-100 px-1 rounded">AZURE_VISION_KEY</code>
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-xl shadow-lg p-8">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-xl font-semibold text-gray-800">📄 index.js สำหรับ Cloudflare Workers</h2>
                <button onclick="copyCode()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                    คัดลอกโค้ด
                </button>
            </div>
            
            <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre id="codeBlock" class="text-sm text-gray-100"><code>// index.js สำหรับ Cloudflare Workers
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
};</code></pre>
            </div>
        </div>

        <div class="bg-white rounded-xl shadow-lg p-8 mt-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-4">📋 ขั้นตอนการใช้งาน</h3>
            <div class="space-y-4">
                <div class="flex items-start gap-3">
                    <span class="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full">1</span>
                    <p class="text-gray-700">คัดลอกโค้ด index.js ข้างบน</p>
                </div>
                <div class="flex items-start gap-3">
                    <span class="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full">2</span>
                    <p class="text-gray-700">สร้าง Cloudflare Worker ใหม่ในแดชบอร์ด</p>
                </div>
                <div class="flex items-start gap-3">
                    <span class="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full">3</span>
                    <p class="text-gray-700">ตั้งค่า Environment Variables: <code class="bg-gray-100 px-1 rounded">AZURE_VISION_ENDPOINT</code> และ <code class="bg-gray-100 px-1 rounded">AZURE_VISION_KEY</code></p>
                </div>
                <div class="flex items-start gap-3">
                    <span class="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full">4</span>
                    <p class="text-gray-700">Deploy และทดสอบ API endpoints: <code class="bg-gray-100 px-1 rounded">/ocr/url</code> และ <code class="bg-gray-100 px-1 rounded">/ocr/upload</code></p>
                </div>
            </div>
        </div>

        <div class="bg-green-50 border border-green-200 rounded-xl p-6 mt-6">
            <h4 class="text-green-800 font-semibold mb-2">✨ ความแตกต่างหลัก</h4>
            <ul class="text-green-700 space-y-1 text-sm">
                <li>• ใช้ Fetch API แทน Express.js</li>
                <li>• ไม่ต้องใช้ multer - ใช้ FormData API แทน</li>
                <li>• ไม่ต้องจัดการไฟล์ระบบ - ใช้ ArrayBuffer</li>
                <li>• CORS ถูกจัดการแบบ manual</li>
                <li>• Environment Variables ผ่าน env parameter</li>
            </ul>
        </div>
    </div>

    <script>
        function copyCode() {
            const codeBlock = document.getElementById('codeBlock');
            const text = codeBlock.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                // แสดงข้อความยืนยัน
                const button = event.target.closest('button');
                const originalText = button.innerHTML;
                button.innerHTML = `
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    คัดลอกแล้ว!
                `;
                button.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                button.classList.add('bg-green-600');
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.classList.remove('bg-green-600');
                    button.classList.add('bg-blue-600', 'hover:bg-blue-700');
                }, 2000);
            }).catch(() => {
                alert('ไม่สามารถคัดลอกได้ กรุณาคัดลอกด้วยตนเอง');
            });
        }
    </script>
<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'98039e3351398208',t:'MTc1ODA1OTgzMC4wMDAwMDA='};var a=document.createElement('script');a.nonce='';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script></body>
</html>
