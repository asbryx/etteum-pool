# Etteum Pool

**AI Proxy Pool for Multiple Providers** — Load balancing, auto-warmup, and credit tracking for Kiro, CodeBuddy, Codex, Canva, and Qoder accounts.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun)](https://bun.sh)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)

> **Fork note:** This fork includes Windows compatibility fixes not yet in the upstream repo. See [Windows Fixes](#windows-fixes) for details.

---

## Features

- **Multi-Provider Support** — Kiro, Kiro Pro, CodeBuddy, Codex, Canva, Qoder
- **Automatic Load Balancing** — Distributes requests across healthy accounts
- **Credit Tracking** — Real-time quota monitoring and exhaustion detection
- **Auto-Warmup** — Periodic health checks to keep accounts ready
- **Token Compression** — RTK / DCP / Caveman / Cache Markers / Image Dedupe pipeline ([docs](docs/compression.md))
- **Dashboard** — Beautiful web UI for monitoring and management
- **Proxy Pool** — Optional residential proxy support for geo-restricted providers
- **WebSocket Updates** — Real-time status updates in the dashboard
- **Filter Rules** — Custom routing rules for different users/models
- **Usage Analytics** — Track requests, tokens, and costs

---

## Quick Start

### One-Command Install

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/priyo000/etteum-pool/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/priyo000/etteum-pool/main/install.ps1 | iex
```

The installer will:
- ✅ Install dependencies (Bun, Python, Playwright, Camoufox)
- ✅ Clone the repository
- ✅ Configure `.env` with secure encryption key
- ✅ Install Node.js and Python packages
- ✅ Build the dashboard
- ✅ Run database migrations
- ✅ Set up CLI commands

### Start the Server

```bash
etteum start
```

### Access the Dashboard

Open your browser to **http://localhost:1931**

---

## Installation

### Prerequisites

- **Bun 1.x** — JavaScript runtime (auto-installed)
- **Python 3.10+** — For browser automation (auto-installed)
- **Git** — For cloning the repo (auto-installed)
- **500MB disk space** — For browsers and dependencies

### Manual Installation

If you prefer manual installation:

```bash
# Clone the repository
git clone https://github.com/asbryx/etteum-pool.git
cd etteum-pool

# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
cd dashboard && bun install && cd ..

# Set up Python environment
python3 -m venv scripts/auth/.venv
source scripts/auth/.venv/bin/activate  # On Windows: scripts\auth\.venv\Scripts\activate
pip install -r scripts/auth/requirements.txt

# Install browsers
python -m playwright install chromium
python -m camoufox fetch

# Configure environment
cp .env.example .env
# Edit .env with your preferred editor

# Build dashboard
cd dashboard && bun run build && cd ..

# Run migrations
bun src/db/migrate.ts

# Start the server
etteum start
```

---

## Usage

### CLI Commands

```bash
etteum start          # Start server in background
etteum stop           # Stop server
etteum restart        # Restart server
etteum status         # Check server status
etteum logs           # View server logs
etteum build          # Rebuild dashboard and restart
```

### Adding Accounts

1. Open the dashboard at **http://localhost:1931**
2. Navigate to **Accounts** page
3. Click **Add Account** for your provider
4. Choose your method:
   - **Bulk Import** — Paste `email|password` lines (recommended)
   - **Single Account** — Manual email/password entry

### Configuring Auto-Warmup

1. Go to **Accounts** page
2. Toggle **Auto WarmUp** for each provider
3. Set interval in **Settings** (default: 15 minutes)

### Using the Proxy Pool (Optional)

For providers with geo-restrictions:

1. Go to **Proxy Pool** page
2. Add proxies in format: `protocol://user:pass@host:port`
3. Enable proxies in **Settings**

---

## Configuration

Edit `.env` to customize:

```bash
# Server ports
PORT=1930                    # API port
DASHBOARD_PORT=1931          # Dashboard port

# Security
API_KEY=your-secret-key      # API authentication
ENCRYPTION_KEY=...           # Auto-generated, don't change

# Database
DATABASE_PATH=./data/poolprox3.db

# Browser automation
BROWSER_ENGINE=camoufox      # or chromium

# Proxy (optional)
PROXY_URL=                   # Global proxy for outbound requests
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1930` | Backend API port |
| `DASHBOARD_PORT` | `1931` | Dashboard web UI port |
| `API_KEY` | `pool-proxy-secret-key` | API authentication key |
| `ENCRYPTION_KEY` | auto-generated | 32-char hex key for encrypting tokens |
| `DATABASE_PATH` | `./data/poolprox3.db` | SQLite database location |
| `BROWSER_ENGINE` | `camoufox` | Browser for login automation |
| `PROXY_URL` | empty | Global proxy for all outbound requests |

---

## Windows Fixes

This fork includes several fixes for Windows compatibility that are not yet in the upstream repository:

### 1. `authScriptPath` Double-Path Bug

**Problem:** When `AUTH_SCRIPT_PATH` in `.env` was set to a relative path like `./scripts/auth/login.py`, and `AUTH_SCRIPT_CWD` was `./scripts/auth`, the login script path would resolve to `scripts/auth/scripts/auth/login.py` (doubled), causing `ENOENT` errors.

**Fix:** `src/config.ts` now uses `path.resolve(projectRoot, ...)` to always produce an absolute path.

### 2. `etteum.ps1` Project Directory Detection

**Problem:** When running `etteum` from `~/.local/bin` (where the CLI wrapper is installed), the script couldn't find the actual project directory because it used the script's own location as the project root.

**Fix:** The script now checks if `package.json` exists in the script directory, and falls back to `~/etteum-pool` (default install location).

### 3. `Start-Process` stderr Redirect

**Problem:** PowerShell 5.1 doesn't allow `RedirectStandardOutput` and `RedirectStandardError` to point to the same file.

**Fix:** stderr is now redirected to a separate `.etteum.err.log` file.

### 4. Bun PATH Resolution in Hidden Window

**Problem:** When `Start-Process -WindowStyle Hidden` spawns bun, child processes (like `bun run build`) couldn't find `bun` in PATH.

**Fix:** A `start.cmd` wrapper script sets the PATH to include `~/.bun/bin` before running the production script.

### 5. `production.ts` Windows Compatibility

**Problem:** `Bun.spawn(["bun", ...])` fails on Windows when bun isn't in PATH. Also, `new URL("..", import.meta.url).pathname` produces incorrect paths on Windows.

**Fix:** Uses `process.execPath` for the bun binary and `fileURLToPath` + `resolve` for path construction. Also adds `taskkill` fallback for process cleanup.

### 6. `normalizeToolChoice` for CodeBuddy

**Problem:** CodeBuddy's API expects `tool_choice` as a string (`"auto"`, `"none"`, `"required"`), but OpenAI/Anthropic formats send objects.

**Fix:** Added `normalizeToolChoice()` method that converts object formats to the expected string value.

---

## Architecture

### Providers

| Provider | Auth Method | Features |
|----------|-------------|----------|
| **Kiro** | Email/Password | Claude Sonnet, free tier |
| **Kiro Pro** | Refresh Token | Claude Opus, higher limits |
| **CodeBuddy** | Email/Password | Multiple models, Tencent Cloud |
| **Codex** | OAuth/Token | OpenAI models, GPT-4o |
| **Canva** | Email/Password | Image generation (Flux Pro) |
| **Qoder** | PAT Token | Claude models, job-based auth |

### How It Works

```
User Request → Etteum API → Load Balancer → Provider → Response
                  ↓
            Dashboard (WebSocket updates)
                  ↓
            Auto-Warmup (periodic health checks)
```

1. **Request Routing** — API receives OpenAI-compatible requests
2. **Account Selection** — Load balancer picks healthy account with credits
3. **Provider Translation** — Transform request to provider-specific format
4. **Response Streaming** — Stream response back in OpenAI format
5. **Credit Tracking** — Update quota usage after each request

---

## API Endpoints

### Chat Completions (OpenAI-compatible)

```bash
curl http://localhost:1930/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### List Models

```bash
curl http://localhost:1930/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Dashboard Stats

```bash
curl http://localhost:1930/api/stats \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Development

### Project Structure

```
etteum-pool/
├── src/
│   ├── api/              # API routes (Hono)
│   ├── auth/             # Login automation & warmup
│   ├── db/               # Database schema & migrations
│   ├── proxy/            # Provider implementations
│   └── ws/               # WebSocket server
├── dashboard/            # React dashboard
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Page components
│   │   └── hooks/        # Custom hooks
│   └── public/           # Static assets
├── scripts/
│   ├── auth/             # Python browser automation
│   ├── production.ts     # Production server
│   └── bootstrap-db.ts   # DB bootstrap for fresh installs
├── etteum.ps1            # Windows CLI script
├── etteum.cmd            # Windows CMD wrapper
└── start.cmd             # Windows bun PATH wrapper
```

### Running in Development Mode

```bash
# Terminal 1: Backend with hot reload
bun run dev

# Terminal 2: Dashboard with HMR
cd dashboard
bun run dev
```

### Building for Production

```bash
cd dashboard
bun run build
cd ..
etteum start
```

---

## Troubleshooting

### Playwright/Camoufox Not Found

```bash
# Reinstall browsers
source scripts/auth/.venv/bin/activate
python -m playwright install chromium
python -m camoufox fetch
```

### Database Migration Failed

```bash
# Bootstrap database from scratch
bun scripts/bootstrap-db.ts

# Or delete database and start fresh
rm -rf data/poolprox3.db
bun src/db/migrate.ts
```

### Port Already in Use

```bash
# Check what's using the port
lsof -i :1930              # macOS/Linux
netstat -ano | findstr :1930  # Windows

# Change ports in .env
echo "PORT=1940" >> .env
echo "DASHBOARD_PORT=1941" >> .env
```

### Accounts Show "Exhausted"

- Wait for auto-warmup to refresh credits
- Click **Warmup** button manually
- Check provider's quota limits

### Windows: `etteum` Command Not Found

Make sure `~/.local/bin` is in your PATH:

```powershell
# Temporary (current session)
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"

# Permanent (add to system PATH)
[Environment]::SetEnvironmentVariable("Path", "$env:USERPROFILE\.local\bin;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")
```

---

## Updating

```bash
cd ~/etteum-pool
git pull
bun install
cd dashboard && bun install && bun run build && cd ..
etteum restart
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Credits

Original project by [priyo000](https://github.com/priyo000/etteum-pool).

---

**Made with ❤️ for the AI community**
