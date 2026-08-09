# Server setup guide

This walks through standing up the backend Buddy talks to, assuming you've never self-hosted an AI stack before. No specific hardware is required — an old laptop, a spare desktop, a mini PC, a Raspberry Pi 4/5, or a cheap cloud VM all work. More RAM and a GPU let you run bigger, faster models, but a modest machine running CPU-only is enough to get everything working end to end.

## What you're building

```
 Buddy (this repo's app)
        │  HTTPS/HTTP, one API key
        ▼
 ┌─────────────────────────────────────────────┐
 │ Open WebUI  (the server Buddy actually talks to)
 │   - chat API, accounts, API keys
 │   - optionally: web search, text-to-speech,
 │     speech-to-text, "Tools" (e.g. smart home)
 └───────────────┬───────────────────────────────┘
                 │ Open WebUI calls out to...
     ┌───────────┼──────────────┬──────────────┐
     ▼           ▼              ▼              ▼
  Your LLM    SearXNG        Kokoro       Home Assistant
 (Ollama /   (private web  (text-to-      (smart home
  LM Studio  search, opt.)  speech, opt.)  control, opt.)
  / etc.)
```

Only **Open WebUI** and **an LLM backend** are required. Everything else (web search, voice, smart home) is optional and can be added later — the app works fine without them.

## Requirements

- A computer or VM that can stay powered on while you use the app (doesn't need to be dedicated — a machine you already leave on works fine).
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose. Docker Desktop (macOS/Windows) or Docker Engine (Linux) both work. On Windows, install via WSL2.
- Your LLM backend of choice installed (see [Part 1](#part-1-pick-and-run-a-local-llm-backend)) — this is the one piece that isn't a Docker container in this setup.
- Your phone and this server on the same Wi-Fi/LAN, at least to start. (Reaching it from outside your home network is possible later via port forwarding + a domain, or a VPN like Tailscale/WireGuard, but isn't required to get started.)

You do **not** need: a GPU, a specific OS, a public domain name, or a static IP, to get a working setup.

## Part 1: Pick and run a local LLM backend

This is the actual "brain" — whatever generates the responses. Open WebUI (and Buddy, through it) just needs something that speaks the OpenAI-compatible chat API on your network. Pick whichever of these fits you; they're interchangeable.

**Option A — Ollama (recommended if you're not sure):** cross-platform (Linux/macOS/Windows), command-line, no GUI needed, runs on CPU or GPU automatically.

```bash
# Install (see https://ollama.com/download for Windows/manual options)
curl -fsSL https://ollama.com/install.sh | sh

# Download a small, fast model to start with
ollama pull llama3.2

# Ollama runs its API automatically at http://localhost:11434 after install
```

Small models (3B–8B parameters, e.g. `llama3.2`, `qwen2.5:7b`) run acceptably on CPU-only hardware with 8GB+ RAM. Bigger models need more RAM and benefit heavily from a GPU, but aren't required to get a working assistant.

**Option B — [LM Studio](https://lmstudio.ai/):** a GUI app (macOS/Windows/Linux) if you'd rather browse and download models visually and click "Start Server" than use a terminal. Works especially well on Apple Silicon Macs, but isn't Mac-specific.

Either way, note the address it's serving on (Ollama: `http://<server-ip>:11434`, LM Studio: `http://<server-ip>:1234` by default) — you'll point Open WebUI at it in Part 3.

## Part 2: Run the Docker Compose stack

This repo includes [`docker-compose.example.yml`](./docker-compose.example.yml) and [`.env.example`](./.env.example) — copy both into a folder on your server:

```bash
mkdir -p ~/buddy-server && cd ~/buddy-server
curl -o docker-compose.yml https://raw.githubusercontent.com/burgerbarn/buddy/main/server/docker-compose.example.yml
curl -o .env.example https://raw.githubusercontent.com/burgerbarn/buddy/main/server/.env.example
cp .env.example .env
```

Edit `.env` and set real random values for both secret keys (don't skip this — `openssl rand -hex 32` generates one).

If you don't want the optional add-ons yet, delete their blocks from `docker-compose.yml` (and the two `depends_on` / environment lines in `open-webui` that reference them) — you can always add them back later. At minimum, keep just the `open-webui` service and the `networks` block.

Bring it up:

```bash
docker compose up -d
docker compose logs -f open-webui   # watch it start; Ctrl-C to stop watching
```

Find your server's LAN IP (`ip addr` on Linux, `ipconfig getifaddr en0` on macOS, `ipconfig` on Windows), then visit `http://<that-ip>:3000` from a browser on the same network. You should see Open WebUI's setup screen.

## Part 3: First-time Open WebUI setup

1. The first account you create becomes the admin account. Sign up, then in **Admin Panel → Settings → General**, turn off new signups so nobody else can register.
2. Connect your LLM: **Admin Panel → Settings → Connections**, add an OpenAI-compatible connection pointing at your backend from Part 1 (e.g. `http://localhost:11434/v1` for Ollama if it's on the same machine as Open WebUI, or `http://<llm-host-ip>:11434/v1` if it's on a different machine — API key can be anything if the backend doesn't require one).
3. Pick that model as your default in a new chat and confirm you get a response — this is your "it all works" checkpoint before involving the phone app at all.
4. Enable API keys for Buddy: **Admin Panel → Settings → General**, toggle `Enable API Keys` on. Then, in your own account (top-right avatar → **Settings → Account → API Keys**), generate one and save it somewhere — you'll paste it into the Buddy app.

## Part 4: Point Buddy at your server

Follow the [main README](../README.md#setup) to build and run the app, then in its Settings screen enter:
- **Server URL**: `http://<your-server-ip>:3000` for LAN-only use, or `https://your-domain` if you've set up the optional reverse proxy below.
- **API key**: the one you generated in Part 3.

If you're testing on Android with a plain `http://` LAN address (no HTTPS yet), that's expected to work out of the box — the app is explicitly configured to allow local HTTP traffic (see `expo-build-properties` in `app.config.js`) instead of requiring a certificate for local testing.

## Optional add-ons

### Web search

Requires the `searxng` service from the compose file. Once it's running, in Open WebUI go to **Admin Panel → Settings → Web Search** and confirm it's enabled and pointing at `http://searxng:8080` (the compose file's `ENABLE_WEB_SEARCH`/`SEARCH_API`/`SEARXNG_URL` env vars on `open-webui` already do this). Buddy's 🔎 toggle in the chat input just asks Open WebUI to search before answering — no app-side setup needed.

### Voice (text-to-speech)

Requires the `kokoro` service. The compose file's `AUDIO_TTS_*` env vars on `open-webui` already point at it. Once both are running, the 🔊 button on any Buddy reply will work. (Speech-to-text for the mic/wake-word feature uses Open WebUI's *built-in* Whisper support — no extra container needed, just make sure an STT engine is configured under **Admin Panel → Settings → Audio** if it isn't automatically.)

### Smart home control (Home Assistant)

Requires the `homeassistant` service. Once it's running (first boot can take a minute or two), see the [main README's Home Assistant section](../README.md#3-enable-home-assistant-control-optional) — the tool source (`openwebui-tools/home_assistant.py`) and full wiring instructions live there, not here, since it's an Open WebUI Tool rather than a server container concern.

### HTTPS / access from outside your home

Requires the `nginx-proxy-manager` service, a domain name pointed at your public IP, and ports 80/443 forwarded on your router. This is only needed if you want Buddy to work over cellular data or from outside your Wi-Fi — for LAN-only use, skip it entirely and use `http://<lan-ip>:3000` as your server URL.

## Troubleshooting

- **Can't reach `http://<ip>:3000` from your phone**: confirm both devices are on the same network, and that your server's firewall allows inbound connections on port 3000 (`sudo ufw allow 3000` on most Linux firewalls).
- **Open WebUI can't reach your LLM backend**: if they're on different machines, make sure the backend (Ollama/LM Studio) is configured to listen on `0.0.0.0`, not just `127.0.0.1` — by default some of these tools only bind to localhost.
- **Responses are very slow**: normal on CPU-only hardware, especially for larger models. Try a smaller model (3B–4B parameters) before assuming something's broken.
- **Home Assistant container seems to hang on first boot, specifically on Docker Desktop for Mac**: this is a known quirk — `network_mode: host` doesn't work reliably there because Docker Desktop for Mac emulates host networking through a Linux VM. The example compose file already avoids this by using bridge networking (`ports:`) instead, which works everywhere.
