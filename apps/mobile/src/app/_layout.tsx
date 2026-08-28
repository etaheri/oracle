import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BootRite } from "../ui/BootRite";
import { colors } from "../theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
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
        <BootRite />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
