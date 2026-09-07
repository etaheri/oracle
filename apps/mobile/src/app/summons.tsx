import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { SUMMONS_LINES } from "@oracle/core";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Mono } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { appleRestore } from "../api/identity";
import { requestPushPermission } from "../notifications/onesignal";
import { KEYS } from "../config/keys";
import { colors, space } from "../theme";

export default function Summons() {
  return <SafeAreaProvider><SummonsContent /></SafeAreaProvider>;
}

function SummonsContent() {
  const router = useRouter();
  const qc = useQueryClient();
  const [restoreState, setRestoreState] = useState<"idle" | "none">("idle");
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const handleRestore = () => {
    void (async () => {
      const r = await appleRestore();
      if (r === "restored") {
        qc.invalidateQueries();
        router.dismissTo("/");
      } else if (r === "none") {
        setRestoreState("none");
      }
    })();
  };
  const onSpeak = async () => {
    try {
      // OneSignal owns the ask when it's live; local reminders still need OS
      // permission in dark mode, so that path falls back to the plain
      // expo-notifications prompt.
      if (KEYS.oneSignalAppId) await requestPushPermission();
      else await Notifications.requestPermissionsAsync();
    } catch {}
    leave();
  };
  return (
    <Screen scroll header={<TopBar />} footer={
      <View style={{ gap: space(2) }}>
        <GoldButton title="LET IT SPEAK" onPress={onSpeak} />
        <QuietLink title="Not now" onPress={leave} />
        {restoreState === "none" && (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>
            NO RECORD BEARS THIS NAME.
          </Mono>
        )}
        {/* The restore link is not part of the question — it is a door for
            someone who arrived here by accident. It sits apart. */}
        <View style={{ paddingTop: space(3) }}>
          <QuietLink title="Restore a claimed record" onPress={handleRestore} />
        </View>
      </View>
    }>
      {/* One question, and almost nothing else (spec §6). This screen exists
          to be answered in two seconds; every line that is not the question
          is weight the answer has to carry. */}
      <View style={{ flexGrow: 1, justifyContent: "center", paddingVertical: space(4) }}>
        <View style={{ gap: space(3) }}>
          {SUMMONS_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 160} durationMs={450} size={13} color={colors.ink} letterSpacing={2} style={{ lineHeight: 22, textAlign: "center" }} />
          ))}
        </View>
      </View>
    </Screen>
  );
}
