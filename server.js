import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// In-memory cache for PDF buffer to avoid repeated remote fetches
let cachedPdfBuffer = null;

// Proxy route for PDF to guarantee zero-CORS access within AI Studio
app.get('/api/pdf-proxy', async (req, res) => {
  try {
    if (cachedPdfBuffer) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', cachedPdfBuffer.length);
      return res.send(cachedPdfBuffer);
    }

    const pdfUrl = 'https://raw.githubusercontent.com/OmethKotelawala/NSBM-AR/main/NSBM%20AR%202025-2026%20Book%20(1).pdf';
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch PDF from upstream');
    }

    const arrayBuffer = await response.arrayBuffer();
    cachedPdfBuffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', cachedPdfBuffer.length);
    res.send(cachedPdfBuffer);
  } catch (err) {
    console.error('PDF proxy error:', err);
    res.status(500).send('Error proxying PDF');
  }
});

// Serve static assets from project root
app.use(express.static(__dirname));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
