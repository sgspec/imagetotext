import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const app = express();
app.use(cors());                   // อนุญาต front-end เรียกได้
app.use(express.json({ limit: "10mb" })); // เผื่อรับ base64
const upload = multer();           // ใช้รับไฟล์แบบ multipart/form-data

const ENDPOINT = process.env.AZURE_VISION_ENDPOINT?.replace(/\/+$/, "") || "";
const KEY = process.env.AZURE_VISION_KEY;

if (!ENDPOINT || !KEY) {
  console.error("Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY");
  process.exit(1);
}

// ฟังก์ชันเรียก Read API (แบบ URL ของรูป)
async function readFromImageUrl(imageUrl, language = "th") {
  const analyzeUrl = `${ENDPOINT}/vision/v3.2/read/analyze?language=${encodeURIComponent(language)}`;

  const res = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url: imageUrl })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analyze failed: ${res.status} ${text}`);
  }

  const opLocation = res.headers.get("operation-location");
  if (!opLocation) throw new Error("No Operation-Location header");

  // poll จนเสร็จ
  let result;
  for (let i = 0; i < 20; i++) {    // ลองรอได้ถึง ~20 วิ
    await new Promise(r => setTimeout(r, 1000));
    const poll = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": KEY }
    });
    result = await poll.json();
    if (result.status && result.status !== "running" && result.status !== "notStarted") break;
  }

  if (!result?.analyzeResult) {
    throw new Error(`No analyzeResult. Status: ${result?.status || "unknown"}`);
  }

  // รวมบรรทัดเป็นข้อความธรรมดา
  const lines = [];
  for (const readRes of result.analyzeResult.readResults || []) {
    for (const line of readRes.lines || []) lines.push(line.text);
  }

  return {
    status: result.status,
    text: lines.join("\n"),
    raw: result
  };
}

// ฟังก์ชันเรียก Read API (แบบอัปโหลดไฟล์ image binary)
async function readFromUploadedFile(buffer, language = "th") {
  const analyzeUrl = `${ENDPOINT}/vision/v3.2/read/analyze?language=${encodeURIComponent(language)}`;

  const res = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "application/octet-stream"
    },
    body: buffer
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analyze failed: ${res.status} ${text}`);
  }

  const opLocation = res.headers.get("operation-location");
  if (!opLocation) throw new Error("No Operation-Location header");

  let result;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const poll = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": KEY }
    });
    result = await poll.json();
    if (result.status && result.status !== "running" && result.status !== "notStarted") break;
  }

  if (!result?.analyzeResult) {
    throw new Error(`No analyzeResult. Status: ${result?.status || "unknown"}`);
  }

  const lines = [];
  for (const readRes of result.analyzeResult.readResults || []) {
    for (const line of readRes.lines || []) lines.push(line.text);
  }

  return {
    status: result.status,
    text: lines.join("\n"),
    raw: result
  };
}

// --- Routes ---
// 1) ส่ง URL ของรูป
app.post("/ocr/url", async (req, res) => {
  try {
    const { imageUrl, language = "th" } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });
    const out = await readFromImageUrl(imageUrl, language);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 2) อัปโหลดไฟล์รูป (multipart/form-data, field name = "file")
app.post("/ocr/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "file is required" });
    const { language = "th" } = req.body || {};
    const out = await readFromUploadedFile(req.file.buffer, language);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`OCR server running on :${port}`);
});
