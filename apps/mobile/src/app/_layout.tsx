import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BootRite } from "../ui/BootRite";
import { CallingRite } from "../ui/CallingRite";
import { getCallingSeen } from "../api/flags";
import { chooseRite } from "../game/calling";
import { colors } from "../theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
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
