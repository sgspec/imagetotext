// server.js
import express from "express";
import cors from "cors";
import multer from "multer";

const PORT = process.env.PORT || 10000;
const AZURE_ENDPOINT = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
const AZURE_KEY = process.env.AZURE_VISION_KEY;

if (!AZURE_ENDPOINT || !AZURE_KEY) {
  console.error("❌ Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY");
  process.exit(1);
}

// Document Intelligence OCR (prebuilt-read)
const OCR_URL = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({ storage: multer.memoryStorage() });

// helper extract text
function extractText(resultJson) {
  const chunks = [];
  try {
    const pages = resultJson.analyzeResult?.pages || [];
    for (const p of pages) {
      for (const line of p.lines || []) {
        if (line.content) chunks.push(line.content);
      }
    }
  } catch (e) {
    console.error("extractText error", e);
  }
  return chunks.join("\n").trim();
}

// === Routes ===

// OCR from URL
app.post("/ocr/url", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });

    const response = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urlSource: imageUrl }),
    });

    if (!response.ok) {
      return res.status(400).json({ error: await response.text() });
    }
    const data = await response.json();
    res.json({ status: "succeeded", text: extractText(data), raw: data });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// OCR from file upload
app.post("/ocr/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "file required" });

    const response = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: req.file.buffer,
    });

    if (!response.ok) {
      return res.status(400).json({ error: await response.text() });
    }
    const data = await response.json();
    res.json({ status: "succeeded", text: extractText(data), raw: data });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// health check
app.get("/", (_, res) => res.send("✅ Document Intelligence OCR backend running"));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
