// server.js (with polling)
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({ dest: "uploads/" });

const AZURE_ENDPOINT = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
const AZURE_KEY = process.env.AZURE_VISION_KEY;

if (!AZURE_ENDPOINT || !AZURE_KEY) {
  console.error("❌ Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY");
  process.exit(1);
}

// Document Intelligence OCR endpoint
const OCR_URL = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

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

// Polling function
async function pollResult(resultUrl) {
  while (true) {
    const r = await fetch(resultUrl, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY }
    });
    const data = await r.json();

    if (data.status === "succeeded" || data.status === "failed") {
      return data;
    }
    await new Promise((res) => setTimeout(res, 1500)); // wait 1.5s
  }
}

// ---- OCR จาก URL ----
app.post("/ocr/url", async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });

    const r = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ urlSource: imageUrl })
    });

    if (!r.ok) {
      return res.status(400).json(await r.text());
    }

    const opLoc = r.headers.get("operation-location");
    const data = await pollResult(opLoc);

    res.json({ status: "succeeded", text: extractText(data), raw: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- OCR จากไฟล์ ----
app.post("/ocr/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.path) return res.status(400).json({ error: "file required" });
    const buf = fs.readFileSync(req.file.path);

    const r = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/octet-stream"
      },
      body: buf
    });

    if (!r.ok) {
      return res.status(400).json(await r.text());
    }

    const opLoc = r.headers.get("operation-location");
    const data = await pollResult(opLoc);

    res.json({ status: "succeeded", text: extractText(data), raw: data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
  }
});

app.get("/", (_, res) => res.send("✅ OCR Backend running with polling"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Server running on", PORT));
