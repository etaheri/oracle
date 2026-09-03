import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack, usePathname } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BootRite } from "../ui/BootRite";
import { CallingRite } from "../ui/CallingRite";
import { getCallingSeen } from "../api/flags";
import { chooseRite, openedOnHome } from "../game/calling";
import { isOrbLanded, markBootDone, markOrbLanded, onOrbLanded } from "../game/bootGate";
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

// The opening rite, and the one thing that can call it off.
//
// Its own component because usePathname subscribes to every navigation, and
// the Stack above must not re-render each time the player changes screens.
function Rites() {
  // Where the app actually opened. A cold start onto anything but Home — a
  // push tap into a reveal, a shared link — gets no rite: the ceremony is a
  // handoff into Home's orb, so anywhere else it is a curtain over the very
  // screen the player was sent to (and the orb, with no anchor to reach, can
  // only dissolve in place). A deep link that lands mid-rite calls it off the
  // same way.
  const pathname = usePathname();
  // Which rite opens the app: the one-time Calling on the very first open,
  // the plain boot rite ever after. null while the flag reads — a bare cover
  // holds the field so the wrong rite never flashes.
  const [callingSeen, setCallingSeen] = useState<boolean | null>(null);
  useEffect(() => {
    getCallingSeen().then(setCallingSeen);
  }, []);

  const choice = chooseRite(callingSeen, openedOnHome(pathname));

  // Standing down still has to open the boot gate. Nothing else fires these
  // two signals, and Home's cold-start choreography waits on them — reached
  // later in the session by walking back from the deep-linked screen, Home
  // must arrive live rather than sit forever in its pre-rite state.
  useEffect(() => {
    if (choice === "none") {
      markBootDone();
      markOrbLanded();
    }
  }, [choice]);

  // A rite belongs to the cold start alone. orbLanded is the end of one —
  // fired by the boot rite as its orb touches down, by the Calling as it
  // resolves, and immediately by the stand-down above — so once it has rung,
  // walking back to Home can never raise the curtain a second time.
  const [spent, setSpent] = useState(isOrbLanded);
  useEffect(() => onOrbLanded(() => setSpent(true)), []);
  if (spent) return null;

  return choice === "calling" ? (
    <CallingRite />
  ) : choice === "boot" ? (
    <BootRite />
  ) : choice === "hold" ? (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite, zIndex: 100 }]} />
  ) : null;
}

function RootLayout() {
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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.museumWhite } }}>
          {/* Everything else keeps the filesystem default (the iOS slide), which is
              right for ledger and reveal/[date] — those are drill-downs into a record.
              The round is a change of mode, not a step down a hierarchy, so it dissolves
              rather than slides. Plus and summons are interstitials, not places: as
              modals they're dismissible and don't pretend to occupy a spot in history. */}
          <Stack.Screen name="round" options={{ animation: "fade", animationDuration: 260 }} />
          <Stack.Screen name="plus" options={{ presentation: "modal" }} />
          <Stack.Screen name="summons" options={{ presentation: "modal" }} />
        </Stack>
        <Rites />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
