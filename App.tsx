import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SettingsProvider, useSettings } from "./src/context/SettingsContext";
import ChatScreen from "./src/screens/ChatScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

export type RootStackParamList = {
  Chat: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#0b0b0c",
    card: "#0b0b0c",
    border: "#2c2c2e",
    primary: "#3478f6",
  },
};

function RootNavigator() {
  const { isReady, isConfigured } = useSettings();

  if (!isReady) return null;

  if (!isConfigured) {
    return (
      <Stack.Navigator>
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "Connect to Buddy" }}
        />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator>
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ presentation: "modal", title: "Connect to Buddy" }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <NavigationContainer theme={theme}>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="light" />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
