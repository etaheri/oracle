import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BootRite } from "../ui/BootRite";
import { CallingRite } from "../ui/CallingRite";
import { getCallingSeen } from "../api/flags";
import { chooseRite } from "../game/calling";
import { initPurchases } from "../monetization/purchases";
import { initAnalytics } from "../analytics/analytics";
import { initOneSignal } from "../notifications/onesignal";
import { KEYS } from "../config/keys";
import { colors } from "../theme";

SplashScreen.preventAutoHideAsync();

// Missing DSN = dark, no crash (Global Constraint): init is guarded, but
// wrap() itself is inert with no DSN, so it's always applied to the export
// below rather than branched.
if (KEYS.sentryDsn) Sentry.init({ dsn: KEYS.sentryDsn });

const queryClient = new QueryClient();

function RootLayout() {
  // Which rite opens the app: the one-time Calling on the very first open,
  // the plain boot rite ever after. null while the flag reads — a bare cover
  // holds the field so the wrong rite never flashes.
  const [callingSeen, setCallingSeen] = useState<boolean | null>(null);
  useEffect(() => {
    getCallingSeen().then(setCallingSeen);
  }, []);

  const [fontsLoaded] = useFonts({
    Marcellus: require("../../assets/fonts/Marcellus-Regular.ttf"),
    Cinzel: require("../../assets/fonts/Cinzel-Regular.ttf"),
    "Cinzel-SemiBold": require("../../assets/fonts/Cinzel-SemiBold.ttf"),
    IBMPlexMono: require("../../assets/fonts/IBMPlexMono-Regular.ttf"),
    "IBMPlexMono-Medium": require("../../assets/fonts/IBMPlexMono-Medium.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Fire-and-forget: no key or no device id yet both degrade to plus-off,
  // never block the boot rite on a store round-trip. Analytics and push
  // init the same way — a missing key just leaves that sense dark.
  useEffect(() => {
    if (fontsLoaded) {
      void initPurchases();
      initAnalytics();
      void initOneSignal();
    }
  }, [fontsLoaded]);

  // React Query's refetch-on-focus assumes web visibility events; RN needs
  // AppState wired in explicitly.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    // GestureDetector (card swipe) requires a gesture-handler root; expo-router
    // does not provide one.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.museumWhite } }} />
        {chooseRite(callingSeen) === "calling" ? (
          <CallingRite />
        ) : chooseRite(callingSeen) === "boot" ? (
          <BootRite />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite, zIndex: 100 }]} />
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
