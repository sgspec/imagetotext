// server.js
import express from "express";
import cors from "cors";
import multer from "multer";

// --- Config ---
const PORT = process.env.PORT || 10000;
const AZURE_ENDPOINT = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, ""); // ตัด / ท้าย
const AZURE_KEY = process.env.AZURE_VISION_KEY;

if (!AZURE_ENDPOINT || !AZURE_KEY) {
  console.error("❌ Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY");
  process.exit(1);
}

// ใช้ Read API v3.2
const READ_ANALYZE_URL = `${AZURE_ENDPOINT}/vision/v3.2/read/analyze`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// รับไฟล์ด้วย memory storage (ไม่เขียนลงดิสก์)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpeg|jpg|gif|bmp|tiff|webp)/i.test(file.mimetype);
    if (!ok) return cb(new Error("Unsupported file type"));
    cb(null, true);
  },
});

// Helper: หน่วงเวลา
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper: ดึงข้อความจากผลลัพธ์ Read API (รองรับโครงสร้างเก่า/ใหม่)
function extractText(resultJson) {
  try {
    // v3.2: analyzeResult.readResults[n].lines[].text
    const rr = resultJson.analyzeResult?.readResults;
    if (Array.isArray(rr)) {
      const lines = rr.flatMap((p) => (p.lines || []).map((l) => l.text));
      return lines.join("\n").trim();
    }
    // เผื่อโครงสร้างใหม่ (pages/blocks/lines)
    const pages = resultJson.analyzeResult?.pages;
    if (Array.isArray(pages)) {
      const lines = pages.flatMap((p) =>
        (p.lines || []).map((l) => (typeof l.content === "string" ? l.content : l.text || ""))
      );
      return lines.join("\n").trim();
    }
  } catch (_) {}
  return "";
}

// Helper: โพสต์ภาพ (URL) ไป Read API
async function submitImageUrl(imageUrl) {
  const res = await fetch(READ_ANALYZE_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/json",
    },
    // ❌ ไม่ส่ง language → ให้ Azure auto-detect
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Analyze (url) failed: ${res.status} ${t}`);
  }
  const opLoc = res.headers.get("operation-location");
  if (!opLoc) throw new Error("Missing operation-location header");
  return opLoc;
}

// Helper: โพสต์ภาพ (binary) ไป Read API
async function submitImageBuffer(buffer) {
  const res = await fetch(READ_ANALYZE_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Analyze (upload) failed: ${res.status} ${t}`);
  }
  const opLoc = res.headers.get("operation-location");
  if (!opLoc) throw new Error("Missing operation-location header");
  return opLoc;
}

// Helper: poll จนกว่าจะได้ผลลัพธ์
async function pollResult(operationLocation, { timeoutMs = 30000, intervalMs = 1200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Poll failed: ${res.status} ${t}`);
    }
    const data = await res.json();
    const status = data.status?.toLowerCase();
    if (status === "succeeded") return data;
    if (status === "failed") throw new Error(`Analyze failed: ${res.status} ${JSON.stringify(data)}`);
    await sleep(intervalMs);
  }
  throw new Error("Polling timed out");
}

// --- Routes ---

// 1) ส่ง URL รูป
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

// 2) อัปโหลดไฟล์รูป
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

app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
