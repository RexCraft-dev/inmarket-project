# Environment Variables

Each service has its own `.env` file. Copy from `.env.example` in each service directory and fill in the required values. Variables are validated at startup — missing required vars cause the service to exit with a clear error message.

## mcp-server

File: `mcp-server/.env` (copy from `mcp-server/.env.example`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `OWM_API_KEY` | Yes | — | OpenWeatherMap API key. Free tier is sufficient. Get one at [openweathermap.org/api](https://openweathermap.org/api). |
| `OWM_BASE_URL` | No | `https://api.openweathermap.org/data/2.5` | Override to point at a different OWM endpoint version or a mock server in tests. |
| `MCP_PORT` | No | `3001` | Port the MCP server listens on. |
| `CORS_ORIGIN` | No | `http://localhost:5000,http://localhost:3000` | Comma-separated list of allowed CORS origins. Set to your frontend's domain in production. |

## agent

File: `agent/.env` (copy from `agent/.env.example`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key. Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model to use. Swap to `gpt-4o` for higher reasoning quality at increased cost. |
| `MCP_SERVER_URL` | No | `http://localhost:3001` | Base URL of the MCP server. Set to `http://mcp-server:3001` automatically by docker-compose. |
| `PORT` | No | `3000` | Port the agent listens on. |
| `CORS_ORIGIN` | No | `http://localhost:5000` | Allowed CORS origin for browser requests. Set to your frontend's domain in production. |

## docker-compose overrides

When running via `docker compose up`, the following variables are injected via the `environment` block in `docker-compose.yml` and override anything in `.env`:

| Variable | Service | Value set by compose |
|---|---|---|
| `NODE_ENV` | both | `production` |
| `MCP_SERVER_URL` | agent | `http://mcp-server:3001` |
| `CORS_ORIGIN` | mcp-server | `http://localhost:8080,http://localhost:3000` |
| `CORS_ORIGIN` | agent | `http://localhost:8080` |
