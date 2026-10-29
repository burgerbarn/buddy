# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Cursor Cloud specific instructions

### Product / services

- **Buddy client** (this repo): Expo SDK 57 React Native app. Standard commands are in the root `package.json` / `README.md` (`npm start`, `npx expo run:ios|android`, `npx tsc --noEmit`).
- **Open WebUI backend**: not started from this repo. Production instance used for cloud testing: `https://buddy.matttesch.com`. Optional self-host walkthrough: `server/README.md`.
- Auth for API calls: `BUDDY_SERVER_URL` + `BUDDY_API_KEY` (Open WebUI account API key). If those env vars are already set in the shell, use them — do not re-prompt. Do not put the key in `EXPO_PUBLIC_*` vars or commit it.

### Cloud VM gotchas

- **No iOS/Android simulators** in this environment. `expo start --web` can serve Metro, but the app **blank-screens on web** because `expo-secure-store` (used in `src/context/SettingsContext.tsx`) is not available in the browser (`getValueUsingKeyAsync is not a function`). Treat web as Metro-only smoke; real UI needs a device/`run:ios`/`run:android`.
- For end-to-end API checks without native UI, call the same Open WebUI routes the client uses (`/api/models`, `/api/chat/completions` SSE) — see `src/api/client.ts`.
- Web peer deps (`react-dom`, `react-native-web`, `@expo/metro-runtime`) are not in `package.json`; if you need Metro web temporarily: `npx expo install react-dom react-native-web @expo/metro-runtime` (prefer `--no-save` / avoid committing unless intentionally adding them).
- `.env` is gitignored (from `.env.example`). `EXPO_PUBLIC_DEFAULT_SERVER_URL` only prefills Settings; runtime credentials live in SecureStore on device.
- Agent Open WebUI accounts may not see the `buddy` model preset; `qwen/qwen3-4b` worked for chat in cloud testing. Grant model access in Open WebUI if needed.
