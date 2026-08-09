# Buddy

A native chat app (iOS + Android) for a self-hosted AI stack — talks to [Open WebUI](https://github.com/open-webui/open-webui) instead of a browser tab, with voice, web search, and real smart-home control built in.

Built with React Native + Expo (SDK 57), TypeScript.

## Features

- **Text chat** — streams responses from Open WebUI's OpenAI-compatible `/api/chat/completions` endpoint (SSE).
- **Voice in/out** — record a question with the mic, get it transcribed via Open WebUI's Whisper endpoint and auto-sent; tap 🔊 on any reply to hear it spoken back via Open WebUI's TTS endpoint.
- **"Hey Buddy" wake word** — optional hands-free mode that listens for "hey/hi/ok buddy", beeps, then records and sends your command automatically.
- **Web search** — toggle to have replies backed by a self-hosted SearXNG instance.
- **Home Assistant control** — ask Buddy to turn things on/off, dim lights, change colors, or control media players; it calls a real Home Assistant instance through a custom Open WebUI tool (included in this repo, see below).
- Auth via a single API key stored in `expo-secure-store` — no accounts, no cloud, everything stays on the local network.

## Stack

| Layer | What it is |
|---|---|
| Client | This app — React Native / Expo, TypeScript |
| Chat/API gateway | [Open WebUI](https://github.com/open-webui/open-webui) |
| LLM | Local model served by [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible backend Open WebUI supports) |
| STT / TTS | Whisper / Kokoro, proxied through Open WebUI |
| Web search | Self-hosted [SearXNG](https://github.com/searxng/searxng) |
| Smart home | [Home Assistant](https://www.home-assistant.io/), driven via `openwebui-tools/home_assistant.py` |

Buddy itself only ever talks to Open WebUI's API — it has no direct knowledge of LM Studio, Whisper, Kokoro, SearXNG, or Home Assistant; those are all wired up server-side.

## Requirements

**To run the app:**
- Node.js 20+ and npm
- [Expo CLI](https://docs.expo.dev/more/expo-cli/) (via `npx`, no global install needed)
- macOS + Xcode, for iOS builds (physical device or simulator)
- Android Studio + SDK, for Android builds (physical device or emulator)
- A free Apple Developer account (for `appleTeamId` / device code signing) if building for a physical iPhone

**Backend:**
- An [Open WebUI](https://github.com/open-webui/open-webui) instance, reachable from your phone, with `ENABLE_API_KEYS=true`
- At least one model available through it (a local backend like Ollama/LM Studio, or any configured provider)
- *(optional, for web search)* a SearXNG instance wired into Open WebUI's web search settings
- *(optional, for smart-home control)* a Home Assistant instance reachable from wherever Open WebUI runs, plus a Long-Lived Access Token for it

Don't have any of this running yet? **[server/README.md](./server/README.md)** is a full beginner-friendly walkthrough — no self-hosting experience or specific hardware assumed, just a computer that can stay on and Docker installed.

## Setup

### 1. Install and configure the app

```bash
git clone https://github.com/burgerbarn/buddy.git
cd buddy
npm install
```

Copy `.env.example` to `.env` and fill in your own values — this file is gitignored, so your real identifiers and server URL never end up in git (see [Privacy note](#privacy-note) below):

```bash
cp .env.example .env
```

```ini
# .env
EXPO_PUBLIC_DEFAULT_SERVER_URL=https://your-openwebui-host
APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
IOS_BUNDLE_ID=com.yourname.buddy
ANDROID_PACKAGE=com.yourname.buddy
```

`app.config.js` reads these at build time; if `.env` is missing or a value is unset, it falls back to generic placeholders.

Then build and run on a device or simulator:

```bash
npx expo run:ios       # or
npx expo run:android
```

On first launch, open the app's **Settings** screen and enter:
- **Server URL** — your Open WebUI instance, e.g. `https://your-openwebui-host`
- **API key** — from Open WebUI: Settings → Account → API Keys (enable `ENABLE_API_KEYS` in the admin panel first if that section isn't visible)

These are stored locally via `expo-secure-store`, not in the app's source.

### 2. Enable web search (optional)

In Open WebUI's Admin Panel → Settings → Web Search, point it at your SearXNG instance and enable web search. Buddy's 🔎 toggle just sets `features: { web_search: true }` on the chat request — Open WebUI does the retrieval/RAG server-side.

### 3. Enable Home Assistant control (optional)

The tool source lives at [`openwebui-tools/home_assistant.py`](./openwebui-tools/home_assistant.py) in this repo. It's a standard [Open WebUI Tool](https://docs.openwebui.com/features/plugin/tools/) — install it once into your Open WebUI instance:

1. In Open WebUI, go to **Workspace → Tools → + Create new tool**.
2. Paste in the contents of `openwebui-tools/home_assistant.py`, give it the id `home_assistant`, and save.
3. Open the tool's **Valves** and set:
   - `ha_url` — your Home Assistant's base URL, reachable from the Open WebUI container/host (e.g. `http://homeassistant:8123` if they're on the same Docker network, or `http://<ha-host>:8123` otherwise)
   - `ha_token` — a Home Assistant Long-Lived Access Token (create one under your HA profile → Security → Long-Lived Access Tokens)
4. Attach the tool to whichever model you want Buddy to use, and make sure requests use **legacy** function calling (not native) so tool calls actually execute server-side instead of being returned raw to the client — Buddy's API client already sends `params: { function_calling: "legacy" }` and `tool_ids: ["home_assistant"]` on every chat request (see `src/api/client.ts`), so no extra client-side work is needed once the tool is installed with that id.

The tool exposes:
- `control_device_by_name` — fuzzy-matches an everyday name ("living room lights", "front door", "office light") to one or more entities and turns them on/off/toggles them, with optional brightness/color/effect for lights.
- `control_media_player` — play/pause/stop/skip/volume for media players.
- `list_entities`, `get_entity_state`, `call_service` — lower-level fallbacks for anything the two helpers above don't cover.

It's a good idea to give your model a system prompt describing your actual rooms/devices in plain language — the tool matches against Home Assistant's real entity/friendly names, not aliases, so tell the model what those real names are.

## Project layout

```
App.tsx                        navigation shell
src/context/                   settings/credentials state
src/api/client.ts               Open WebUI API client (chat, STT, TTS, wake-word beep)
src/screens/ChatScreen.tsx      chat UI, mic/wake-word/search controls
src/screens/SettingsScreen.tsx  server URL / API key entry
openwebui-tools/home_assistant.py   Open WebUI Tool for Home Assistant control (installed server-side, not part of the app bundle)
server/                        backend setup guide + example docker-compose.yml (see server/README.md)
```

## Privacy note

Personal config (real server URL, bundle identifiers, Apple Team ID) lives in a gitignored `.env` file, read by `app.config.js` and `src/context/SettingsContext.tsx` at build time — see [`.env.example`](./.env.example) for the fields. Nothing in tracked source ever has real values baked in. The `ios/` and `android/` native project folders (generated by `expo prebuild`/`expo run:*`) are also gitignored and never committed, since they'd otherwise bake real signing identifiers into tracked files.

## Status

Personal project, actively evolving alongside a homelab AI stack. iOS and Android both work on physical devices; there's no App Store / Play Store distribution — it's built and run locally.
