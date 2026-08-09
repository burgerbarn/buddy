require("dotenv").config();

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || "YOUR_TEAM_ID";
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || "com.example.buddy";
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || "com.example.buddy";

module.exports = {
  expo: {
    name: "Buddy",
    slug: "buddy",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    ios: {
      supportsTablet: true,
      bundleIdentifier: IOS_BUNDLE_ID,
      appleTeamId: APPLE_TEAM_ID,
    },
    android: {
      package: ANDROID_PACKAGE,
      adaptiveIcon: {
        backgroundColor: "#0b0b0c",
        foregroundImage: "./assets/icon.png",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-secure-store",
      "expo-audio",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#0b0b0c",
        },
      ],
      [
        "expo-build-properties",
        {
          // Android blocks plain HTTP to non-localhost hosts by default.
          // Allow it so a plain http://<lan-ip>:port server URL works
          // without requiring a reverse proxy / TLS cert for local use.
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  },
};
