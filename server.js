// server.js
// Node 18+ (มี fetch ในตัว) / type: "module"
import express from "express";
import cors from "cors";
import multer from "multer";

// ===== Config =====
const PORT = process.env.PORT || 10000;
const AZURE_ENDPOINT = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
const AZURE_KEY = process.env.AZURE_VISION_KEY;

if (!AZURE_ENDPOINT || !AZURE_KEY) {
  console.error("❌ Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY env.");
  process.exit(1);
}

// Read API v3.2
const READ_ANALYZE_URL = `${AZURE_ENDPOINT}/vision/v3.2/read/analyze`;

// ===== App =====
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// รับไฟล์ไว้ในหน่วยความจำ (ไม่เขียนดิสก์)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpeg|jpg|gif|bmp|tiff|webp)/i.test(file.mimetype);
    if (!ok) return cb(new Error("Unsupported file type"));
    cb(null, true);
  },
});

// ===== Utils =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ดึงข้อความจากผลลัพธ์ Read API
 * - พยายามอ่านทั้งจาก lines[].text และ lines[].words[].text/content
 * - รองรับทั้ง schema เดิม (readResults) และ schema รูปแบบใหม่ (pages)
 */
function extractText(resultJson) {
  try {
    // ----- โครงสร้างเดิม: analyzeResult.readResults[].lines[] -----
    const rr = resultJson?.analyzeResult?.readResults;
    if (Array.isArray(rr)) {
      const chunks = [];
      for (const page of rr) {
        for (const line of page.lines || []) {
          // ถ้ามีบรรทัดตรง ๆ
          if (line.text && line.text.trim()) {
            chunks.push(line.text.trim());
            continue;
          }
          // ถ้าไม่มี line.text ให้รวมจาก words
          if (Array.isArray(line.words) && line.words.length) {
            const w = line.words
              .map((w) => (w.text || "").trim())
              .filter(Boolean)
              .join(" ");
            if (w) chunks.push(w);
          }
        }
      }
      const joined = chunks.join("\n").trim();
      if (joined) return joined;
    }

    // ----- โครงสร้างใหม่: analyzeResult.pages[].lines[] / .words[] -----
    const pages = resultJson?.analyzeResult?.pages;
    if (Array.isArray(pages)) {
      const chunks = [];
      for (const p of pages) {
        for (const l of p.lines || []) {
          const lineText = (typeof l.content === "string" ? l.content : l.text || "").trim();
          if (lineText) {
            chunks.push(lineText);
            continue;
          }
          if (Array.isArray(l.words) && l.words.length) {
            const w = l.words
              .map((w) => (w.content || w.text || "").trim())
              .filter(Boolean)
              .join(" ");
            if (w) chunks.push(w);
          }
        }
      }
      const joined = chunks.join("\n").trim();
      if (joined) return joined;
    }
  } catch {
    // ignore
  }
  return "";
}

// ส่ง URL รูปเข้าวิเคราะห์ (ไม่ส่ง language → ให้ auto-detect)
async function submitImageUrl(imageUrl) {
  const res = await fetch(READ_ANALYZE_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) throw new Error(`Analyze (url) failed: ${res.status} ${await res.text()}`);
  const opLoc = res.headers.get("operation-location");
  if (!opLoc) throw new Error("Missing operation-location header");
  return opLoc;
}

// ส่งไฟล์ไบนารีเข้าวิเคราะห์
async function submitImageBuffer(buffer) {
  const res = await fetch(READ_ANALYZE_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Analyze (upload) failed: ${res.status} ${await res.text()}`);
  const opLoc = res.headers.get("operation-location");
  if (!opLoc) throw new Error("Missing operation-location header");
  return opLoc;
}

// ดึงผลลัพธ์ด้วยการ poll
async function pollResult(operationLocation, { timeoutMs = 30000, intervalMs = 1200 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const res = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY },
    });
    if (!res.ok) throw new Error(`Poll failed: ${res.status} ${await res.text()}`);
    const data = await res.json();

    const status = (data.status || "").toLowerCase();
    if (status === "succeeded") return data;
    if (status === "failed") throw new Error(`Analyze failed: ${JSON.stringify(data)}`);

    await sleep(intervalMs);
  }
  throw new Error("Polling timed out");
}

// ===== Routes =====

// ส่ง URL รูป
app.post("/ocr/url", async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

    const opLoc = await submitImageUrl(imageUrl);
    const result = await pollResult(opLoc);
    const text = extractText(result);

    res.json({ status: "succeeded", text, raw: result });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// อัปโหลดไฟล์ภาพ
app.post("/ocr/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "file is required" });

    const opLoc = await submitImageBuffer(req.file.buffer);
    const result = await pollResult(opLoc);
    const text = extractText(result);

    res.json({ status: "succeeded", text, raw: result });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// health check
app.get("/", (_req, res) => {
  res.send("Azure Read OCR backend is running.");
});

// start
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
