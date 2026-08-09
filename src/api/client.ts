import { File, Paths } from "expo-file-system";

export type Model = {
  id: string;
  name: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export class ApiError extends Error {}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string
): Promise<Model[]> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new ApiError(`Failed to fetch models (${res.status})`);
  }
  const json = await res.json();
  const list = json.data ?? json.models ?? [];
  return list.map((m: any) => ({ id: m.id, name: m.name ?? m.id }));
}

export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
  webSearch?: boolean
): Promise<void> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    tool_ids: ["home_assistant"],
    params: { function_calling: "legacy" },
  };
  if (webSearch) {
    body.features = { web_search: true };
  }

  const res = await fetch(
    `${normalizeBaseUrl(baseUrl)}/api/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    }
  );

  if (!res.ok || !res.body) {
    throw new ApiError(`Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }
}

export async function transcribeAudio(
  baseUrl: string,
  apiKey: string,
  fileUri: string
): Promise<string> {
  const file = new File(fileUri);
  const formData = new FormData();
  formData.append("file", file, "recording.m4a");

  const res = await fetch(
    `${normalizeBaseUrl(baseUrl)}/api/v1/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    }
  );

  if (!res.ok) {
    throw new ApiError(`Transcription failed (${res.status})`);
  }
  const json = await res.json();
  return json.text ?? "";
}

export async function synthesizeSpeech(
  baseUrl: string,
  apiKey: string,
  text: string
): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text }),
  });

  if (!res.ok) {
    throw new ApiError(`Speech synthesis failed (${res.status})`);
  }

  const buffer = await res.arrayBuffer();
  const file = new File(Paths.cache, `buddy-speech-${Date.now()}.mp3`);
  file.create();
  file.write(new Uint8Array(buffer));
  return file.uri;
}

let cachedBeepUri: string | null = null;

function generateBeepWavBytes(): Uint8Array {
  const sampleRate = 44100;
  const durationSec = 0.3;
  const freq = 880;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const fadeLen = sampleRate * 0.03;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let env = 1;
    if (i < fadeLen) env = i / fadeLen;
    else if (i > numSamples - fadeLen) env = (numSamples - i) / fadeLen;
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.6;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  return new Uint8Array(buffer);
}

export function getBeepUri(): string {
  if (cachedBeepUri) return cachedBeepUri;
  const file = new File(Paths.cache, "buddy-wake-beep.wav");
  file.create({ overwrite: true });
  file.write(generateBeepWavBytes());
  cachedBeepUri = file.uri;
  return cachedBeepUri;
}
