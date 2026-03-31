import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import momentsRouter from './routes/moments.js';
import { OwmError } from './services/owmClient.js';

const app = express();
app.disable('x-powered-by');

const CORS_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5000', 'http://localhost:3000'];
app.use(cors({ origin: CORS_ORIGINS }));
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
app.use(express.json());

app.use('/moments', momentsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'moments-mcp-server', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: err.errors[0].message });
  }
  if (err instanceof OwmError) {
    return res.status(err.statusCode).json({ ok: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

const port = process.env.MCP_PORT || 3001;
app.listen(port, () => {
  console.log(`moments-mcp-server listening on port ${port}`);
});
