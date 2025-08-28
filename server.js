import express from "express";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
const upload = multer({ dest: "uploads/" });

const AZURE_ENDPOINT = process.env.AZURE_VISION_ENDPOINT; 
const AZURE_KEY = process.env.AZURE_VISION_KEY;

app.use(express.json());

// OCR by image URL
app.post("/ocr/url", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    const url = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
      },
      body: JSON.stringify({ urlSource: imageUrl })
    });

    const result = await response.json();
    const text = result.analyzeResult?.content || "";

    res.json({ text, raw: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// OCR by file upload
app.post("/ocr/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const url = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    const imgData = fs.readFileSync(filePath);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
      },
      body: imgData
    });

    const result = await response.json();
    const text = result.analyzeResult?.content || "";

    res.json({ text, raw: result });

    fs.unlinkSync(filePath); // ลบไฟล์หลังใช้งาน
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
