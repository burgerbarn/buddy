import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useSettings } from "../context/SettingsContext";
import { fetchModels, ApiError } from "../api/client";

export default function SettingsScreen({ navigation }: any) {
  const { serverUrl, apiKey, saveSettings } = useSettings();
  const [url, setUrl] = useState(serverUrl);
  const [key, setKey] = useState(apiKey);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    if (!url.trim() || !key.trim()) {
      Alert.alert("Missing info", "Please enter both a server URL and API key.");
      return;
    }
    setTesting(true);
    try {
      await fetchModels(url, key);
      await saveSettings(url.trim(), key.trim());
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : "Could not reach server. Check the URL and try again.";
      Alert.alert("Connection failed", message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.label}>Server URL</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://your-server.example.com"
        placeholderTextColor="#888"
      />

      <Text style={styles.label}>API Key</Text>
      <TextInput
        style={styles.input}
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="sk-..."
        placeholderTextColor="#888"
      />
      <Text style={styles.hint}>
        Generate one in Open WebUI under Settings → Account → API Keys.
      </Text>

      <Pressable
        style={[styles.button, testing && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={testing}
      >
        <Text style={styles.buttonText}>
          {testing ? "Testing connection…" : "Save"}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0c", padding: 20 },
  label: { color: "#ddd", fontSize: 14, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: "#1c1c1e",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { color: "#888", fontSize: 12, marginTop: 6 },
  button: {
    marginTop: 28,
    backgroundColor: "#3478f6",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
