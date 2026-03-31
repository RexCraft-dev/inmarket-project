import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import analyzeRouter from './routes/analyze.js';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing required environment variable: OPENAI_API_KEY');
}

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', analyzeRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'moments-agent', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: err.errors[0].message });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`moments-agent listening on port ${port}`);
});
