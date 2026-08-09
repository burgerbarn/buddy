import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";

const SERVER_URL_KEY = "buddy_server_url";
const API_KEY_KEY = "buddy_api_key";
const DEFAULT_SERVER_URL = "https://your-server.example.com";

type SettingsContextValue = {
  serverUrl: string;
  apiKey: string;
  isReady: boolean;
  isConfigured: boolean;
  saveSettings: (serverUrl: string, apiKey: string) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [apiKey, setApiKey] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [storedUrl, storedKey] = await Promise.all([
        SecureStore.getItemAsync(SERVER_URL_KEY),
        SecureStore.getItemAsync(API_KEY_KEY),
      ]);
      if (storedUrl) setServerUrl(storedUrl);
      if (storedKey) setApiKey(storedKey);
      setIsReady(true);
    })();
  }, []);

  const saveSettings = async (newServerUrl: string, newApiKey: string) => {
    await Promise.all([
      SecureStore.setItemAsync(SERVER_URL_KEY, newServerUrl),
      SecureStore.setItemAsync(API_KEY_KEY, newApiKey),
    ]);
    setServerUrl(newServerUrl);
    setApiKey(newApiKey);
  };

  return (
    <SettingsContext.Provider
      value={{
        serverUrl,
        apiKey,
        isReady,
        isConfigured: isReady && apiKey.length > 0,
        saveSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
