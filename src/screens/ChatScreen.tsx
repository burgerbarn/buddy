import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { useSettings } from "../context/SettingsContext";
import {
  ChatMessage,
  Model,
  fetchModels,
  streamChatCompletion,
  transcribeAudio,
  synthesizeSpeech,
  getBeepUri,
} from "../api/client";

type DisplayMessage = ChatMessage & { id: string; searching?: boolean };

const AUTO_SPEAK_LENGTH_LIMIT = 400;
const WAKE_CLIP_MS = 3000;
const WAKE_FOLLOWUP_CLIP_MS = 6000;
const WAKE_WORD_RE = /\b(hey|hi|ok|okay)[,]?\s+buddy\b[,]?/i;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripEmojis(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripCitations(text: string): string {
  return text.replace(/\s?\[\d+(?:,\s*\d+)*\]/g, "");
}

function containsWakeWord(raw: string): boolean {
  return WAKE_WORD_RE.test(raw);
}

export default function ChatScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { serverUrl, apiKey } = useSettings();
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speechUri, setSpeechUri] = useState<string | null>(null);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const listRef = useRef<FlatList>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(speechUri);
  const playerStatus = useAudioPlayerStatus(player);
  const isFocused = useIsFocused();

  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const isRecordingRef = useRef(isRecording);
  const sendingRef = useRef(sending);
  const transcribingRef = useRef(transcribing);
  const isFocusedRef = useRef(isFocused);
  const playingRef = useRef(playerStatus.playing);
  const wakeLoopRunningRef = useRef(false);
  const sendRef = useRef<typeof send | undefined>(undefined);

  wakeWordEnabledRef.current = wakeWordEnabled;
  isRecordingRef.current = isRecording;
  sendingRef.current = sending;
  transcribingRef.current = transcribing;
  isFocusedRef.current = isFocused;
  playingRef.current = playerStatus.playing;

  useEffect(() => {
    if (speechUri) player.play();
  }, [speechUri]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: modelId ?? "Buddy",
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={[styles.wakeToggle, wakeWordEnabled && styles.wakeToggleActive]}
            onPress={() => setWakeWordEnabled((v) => !v)}
          >
            <Text style={styles.wakeToggleText}>👂</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate("Settings")}>
            <Text style={styles.headerAction}>Settings</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, modelId, wakeWordEnabled]);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchModels(serverUrl, apiKey);
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      } catch {
        // surfaced implicitly by empty model list / disabled send
      }
    })();
  }, [serverUrl, apiKey]);

  const speakMessage = useCallback(
    async (id: string, text: string) => {
      const cleaned = stripEmojis(stripCitations(text));
      if (!cleaned || speakingId) return;
      setSpeakingId(id);
      try {
        const uri = await synthesizeSpeech(serverUrl, apiKey, cleaned);
        setSpeechUri(uri);
      } catch {
        // playback failure is non-fatal
      } finally {
        setSpeakingId(null);
      }
    },
    [serverUrl, apiKey, speakingId]
  );

  const send = useCallback(async (
    override?: string,
    opts?: { autoSpeak?: boolean; webSearch?: boolean }
  ) => {
    const text = (override ?? input).trim();
    if (!text || !modelId || sending) return;

    const userMsg: DisplayMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      content: text,
    };
    const assistantId = `${Date.now()}-a`;
    const history = [...messages, userMsg];
    const isSearching = opts?.webSearch ?? webSearchEnabled;

    setMessages([
      ...history,
      { id: assistantId, role: "assistant", content: "", searching: isSearching },
    ]);
    setInput("");
    setSending(true);

    let fullReply = "";

    try {
      await streamChatCompletion(
        serverUrl,
        apiKey,
        modelId,
        history.map(({ role, content }) => ({ role, content })),
        (token) => {
          fullReply += token;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + token, searching: false }
                : m
            )
          );
        },
        undefined,
        isSearching
      );
      if (opts?.autoSpeak && fullReply) {
        const toSpeak =
          fullReply.length > AUTO_SPEAK_LENGTH_LIMIT
            ? "Here are my findings — take a look at the chat."
            : fullReply;
        speakMessage(assistantId, toSpeak);
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || "⚠️ Something went wrong." }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }, [input, modelId, sending, messages, serverUrl, apiKey, webSearchEnabled, speakMessage]);
  sendRef.current = send;

  const recordClip = useCallback(
    async (durationMs: number): Promise<string | null> => {
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch {
        return null;
      }
      await sleep(durationMs);
      try {
        await recorder.stop();
      } catch {
        return null;
      }
      return recorder.uri ?? null;
    },
    [recorder]
  );

  useEffect(() => {
    if (!wakeWordEnabled || wakeLoopRunningRef.current) return;
    wakeLoopRunningRef.current = true;

    (async () => {
      let blockedCycles = 0;
      while (wakeWordEnabledRef.current) {
        // playingRef is a backstop, not a hard gate — if playback status ever
        // gets stuck "true" (native status callback glitch), don't let the
        // whole loop hang forever; give up waiting on it after ~16s.
        const waitingOnPlayback = playingRef.current && blockedCycles < 40;
        if (
          !isFocusedRef.current ||
          isRecordingRef.current ||
          sendingRef.current ||
          transcribingRef.current ||
          waitingOnPlayback
        ) {
          blockedCycles++;
          await sleep(400);
          continue;
        }
        blockedCycles = 0;

        const uri = await recordClip(WAKE_CLIP_MS);
        if (!wakeWordEnabledRef.current) break;
        if (!uri) {
          await sleep(400);
          continue;
        }

        let transcript = "";
        try {
          transcript = await transcribeAudio(serverUrl, apiKey, uri);
        } catch {
          await sleep(400);
          continue;
        }

        if (!containsWakeWord(transcript) || !wakeWordEnabledRef.current) continue;

        player.replace(getBeepUri());
        player.play();
        await sleep(350);

        let command = "";
        const followUri = await recordClip(WAKE_FOLLOWUP_CLIP_MS);
        if (followUri && wakeWordEnabledRef.current) {
          try {
            command = (await transcribeAudio(serverUrl, apiKey, followUri)).trim();
          } catch {
            command = "";
          }
        }

        if (command) {
          sendRef.current?.(command, { autoSpeak: true });
          await sleep(800);
        }
      }
      wakeLoopRunningRef.current = false;
    })();
  }, [wakeWordEnabled, recordClip, serverUrl, apiKey, player]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      setIsRecording(false);
      try {
        await recorder.stop();
      } catch {
        Alert.alert("Couldn't finish recording", "Please try again.");
        return;
      }
      const uri = recorder.uri;
      if (!uri) {
        Alert.alert("Couldn't finish recording", "Please try again.");
        return;
      }
      setTranscribing(true);
      try {
        const text = await transcribeAudio(serverUrl, apiKey, uri);
        const combined = input.trim() ? `${input.trim()} ${text}` : text;
        send(combined, { autoSpeak: true });
      } catch {
        Alert.alert("Transcription failed", "Check your connection and try again.");
      } finally {
        setTranscribing(false);
      }
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone access needed", "Enable it in system settings to use voice input.");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch {
      Alert.alert("Couldn't start recording", "Please try again.");
    }
  }, [isRecording, recorder, serverUrl, apiKey, input, send]);

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { marginBottom: androidKeyboardHeight > 0 ? androidKeyboardHeight + 50 : 0 },
      ]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {models.length > 1 && (
        <FlatList
          horizontal
          data={models}
          keyExtractor={(m) => m.id}
          style={styles.modelBar}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setModelId(item.id)}
              style={[
                styles.modelChip,
                item.id === modelId && styles.modelChipActive,
              ]}
            >
              <Text
                style={[
                  styles.modelChipText,
                  item.id === modelId && styles.modelChipTextActive,
                ]}
              >
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}

      {wakeWordEnabled && (
        <View style={styles.wakeBanner}>
          <Text style={styles.wakeBannerText}>👂 Listening for "Hey Buddy"…</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={styles.bubbleText}>
              {(item.role === "assistant"
                ? stripCitations(item.content)
                : item.content) || (item.searching ? "🔎 Searching the web…" : "…")}
            </Text>
            {item.role === "assistant" && !!item.content && (
              <Pressable
                style={styles.speakButton}
                onPress={() => speakMessage(item.id, item.content)}
                disabled={speakingId === item.id}
              >
                {speakingId === item.id ? (
                  <ActivityIndicator color="#aaa" size="small" />
                ) : (
                  <Text style={styles.speakButtonText}>🔊</Text>
                )}
              </Pressable>
            )}
          </View>
        )}
      />

      <View
        style={[
          styles.inputRow,
          { paddingBottom: androidKeyboardHeight > 0 ? 10 : Math.max(insets.bottom, 10) },
        ]}
      >
        <Pressable
          style={[styles.searchToggle, webSearchEnabled && styles.searchToggleActive]}
          onPress={() => setWebSearchEnabled((v) => !v)}
        >
          <Text
            style={[
              styles.searchToggleText,
              webSearchEnabled && styles.searchToggleTextActive,
            ]}
          >
            🔎
          </Text>
        </Pressable>
        <Pressable
          style={[styles.searchToggle, isRecording && styles.micButtonActive]}
          onPress={toggleRecording}
          disabled={transcribing || wakeWordEnabled}
        >
          {transcribing ? (
            <ActivityIndicator color="#aaa" size="small" />
          ) : (
            <Text
              style={[styles.searchToggleText, isRecording && styles.searchToggleTextActive]}
            >
              {isRecording ? "⏹️" : "🎤"}
            </Text>
          )}
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={modelId ? "Message Buddy…" : "Loading models…"}
          placeholderTextColor="#888"
          multiline
          editable={!!modelId}
        />
        <Pressable
          style={[styles.sendButton, (!modelId || sending) && styles.sendButtonDisabled]}
          onPress={() => send()}
          disabled={!modelId || sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0c" },
  headerAction: { color: "#3478f6", fontSize: 16, marginRight: 4 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  wakeToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
  },
  wakeToggleActive: { backgroundColor: "#3478f6" },
  wakeToggleText: { fontSize: 15 },
  wakeBanner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  wakeBannerText: { color: "#3478f6", fontSize: 13 },
  modelBar: { flexGrow: 0, paddingVertical: 8, paddingHorizontal: 12 },
  modelChip: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  modelChipActive: { backgroundColor: "#3478f6" },
  modelChipText: { color: "#aaa", fontSize: 13 },
  modelChipTextActive: { color: "#fff", fontWeight: "600" },
  messages: { padding: 12, gap: 10 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "82%" },
  bubbleUser: { backgroundColor: "#3478f6", alignSelf: "flex-end" },
  bubbleAssistant: { backgroundColor: "#1c1c1e", alignSelf: "flex-start" },
  bubbleText: { color: "#fff", fontSize: 16, lineHeight: 21 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2c2c2e",
  },
  input: {
    flex: 1,
    backgroundColor: "#1c1c1e",
    color: "#fff",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: "#3478f6",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontWeight: "600" },
  searchToggle: {
    backgroundColor: "#1c1c1e",
    borderRadius: 18,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchToggleActive: { backgroundColor: "#3478f6" },
  searchToggleText: { fontSize: 17, opacity: 0.6 },
  searchToggleTextActive: { opacity: 1 },
  micButtonActive: { backgroundColor: "#e0483e" },
  speakButton: { marginTop: 6, alignSelf: "flex-start" },
  speakButtonText: { fontSize: 15, opacity: 0.7 },
});
