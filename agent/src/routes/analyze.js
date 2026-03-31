import { Router } from 'express';
import { z, ZodError } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { createOpenAIToolsAgent, AgentExecutor } from 'langchain/agents';

const MCP_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3001';
const MODEL   = process.env.OPENAI_MODEL   ?? 'gpt-4o-mini';

// ─── MCP fetch helper ─────────────────────────────────────────────────────────

async function mcpGet(path, params = {}) {
  const url = new URL(path, MCP_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  const data = await res.json();
  return JSON.stringify(data);
}

// ─── LangChain tools ──────────────────────────────────────────────────────────

const tools = [
  tool(
    ({ city, category }) => mcpGet('/moments/score', { city, category }),
    {
      name: 'get_moment_score',
      description:
        'Get the current moment relevance score (0–100) for a city and brand category. ' +
        'Returns score, weather/time/day/trend breakdown, and top 3 signals with active flags. ' +
        'Use this for a real-time read on whether conditions favour activation.',
      schema: z.object({
        city:     z.string().describe('City name, e.g. "Austin"'),
        category: z.string().describe('Brand category slug, e.g. "coffee" or "delivery-food"'),
      }),
    }
  ),

  tool(
    ({ city, category, hours }) => mcpGet('/moments/forecast-window', { city, category, hours }),
    {
      name: 'get_forecast_window',
      description:
        'Find the best upcoming activation window within the next N hours for a city and category. ' +
        'Returns start/end time (UTC), peak score, local peak hour, and a plain-language reason. ' +
        'Use this to recommend a flight window rather than immediate activation.',
      schema: z.object({
        city:     z.string().describe('City name'),
        category: z.string().describe('Brand category slug'),
        hours:    z.number().int().min(1).max(48).optional()
                    .describe('Hours ahead to scan (default 6, max 48)'),
      }),
    }
  ),

  tool(
    ({ cities, category }) =>
      mcpGet('/moments/compare', { cities: cities.join(','), category }),
    {
      name: 'compare_moments',
      description:
        'Score and rank 2–10 cities by moment relevance for a category. ' +
        'Returns a ranked list with scores, breakdowns, and active signals per city. ' +
        'Use this for geo-targeting decisions and budget allocation across markets.',
      schema: z.object({
        cities:   z.array(z.string()).min(2).describe('List of city names to compare'),
        category: z.string().describe('Brand category slug'),
      }),
    }
  ),

  tool(
    ({ category }) => mcpGet('/moments/triggers', { category }),
    {
      name: 'get_triggers',
      description:
        'Return the raw scoring weights for every trigger in a category: ' +
        'weather conditions, time-of-day slots, and day-of-week. ' +
        'Use this to explain what drives or suppresses scores for the category.',
      schema: z.object({
        category: z.string().describe('Brand category slug'),
      }),
    }
  ),

  tool(
    ({ city }) => mcpGet('/moments/conditions', { city }),
    {
      name: 'get_conditions',
      description:
        'Return current normalized weather conditions for a city: ' +
        'temperature (°F), OWM weather code, wind speed (mph), local hour, and day of week. ' +
        'Use this when you need raw conditions before scoring.',
      schema: z.object({
        city: z.string().describe('City name'),
      }),
    }
  ),
];

// ─── Agent setup (top-level await — ESM only) ─────────────────────────────────

const SYSTEM_PROMPT =
  'You are a media buying analyst specialising in moment-based advertising activation. ' +
  'Speak in terms of ROAS, activation windows, audience receptivity, and media spend efficiency. ' +
  'Always cite the moment score (0–100) and the top signals driving it in your recommendation. ' +
  'Give a clear BUY / HOLD / WAIT recommendation based on whether the score justifies spend. ' +
  'Keep every response under 4 sentences.';

const llm = new ChatOpenAI({ model: MODEL, temperature: 0.2 });

const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', '{input}'],
  new MessagesPlaceholder('agent_scratchpad'),
]);

const agent    = await createOpenAIToolsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools, maxIterations: 5 });

// ─── Router ───────────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  question: z.string().min(1, 'question is required'),
  city:     z.string().optional(),
  category: z.string().optional(),
  cities:   z.array(z.string()).optional(),
});

const router = Router();

router.post('/analyze', async (req, res, next) => {
  try {
    const { question, city, category, cities } = analyzeSchema.parse(req.body);

    // Assemble a focused input string so the agent has upfront context
    const parts = [question];
    if (city)           parts.push(`Target city: ${city}`);
    if (category)       parts.push(`Target category: ${category}`);
    if (cities?.length) parts.push(`Target cities: ${cities.join(', ')}`);
    const input = parts.join('. ');

    const result = await executor.invoke({ input });

    res.json({ ok: true, data: { answer: result.output, question } });
  } catch (err) {
    next(err);
  }
});

// Local error handler — catches ZodError before it reaches the global handler
router.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: err.errors[0].message });
  }
  next(err);
});

export default router;
