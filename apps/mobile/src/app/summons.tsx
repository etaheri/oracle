import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { SUMMONS_LINES } from "@oracle/core";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { appleRestore } from "../api/identity";
import { requestPushPermission } from "../notifications/onesignal";
import { KEYS } from "../config/keys";
import { colors, space } from "../theme";

export default function Summons() {
  const router = useRouter();
  const qc = useQueryClient();
  const [restoreState, setRestoreState] = useState<"idle" | "none">("idle");
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const handleRestore = () => {
    void (async () => {
      const r = await appleRestore();
      if (r === "restored") {
        qc.invalidateQueries();
        router.replace("/");
      } else if (r === "none") {
        setRestoreState("none");
      }
    })();
  };
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The summons</Eyebrow>
        <View style={{ gap: space(2) }}>
          {SUMMONS_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 160} durationMs={450} size={12} color={colors.ink} letterSpacing={2} style={{ lineHeight: 20, textAlign: "center" }} />
          ))}
        </View>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <GoldButton
          title="LET IT SPEAK"
          onPress={async () => {
            try {
              // OneSignal owns the ask when it's live; local reminders still
              // need OS permission in dark mode, so that path falls back to
              // the plain expo-notifications prompt.
              if (KEYS.oneSignalAppId) await requestPushPermission();
              else await Notifications.requestPermissionsAsync();
            } catch {}
            leave();
          }}
        />
        <QuietLink title="Not now" onPress={leave} />
        {restoreState === "none" && (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>
            NO RECORD BEARS THIS NAME.
          </Mono>
        )}
        <QuietLink title="Restore a claimed record" onPress={handleRestore} />
      </View>
    </Screen>
  );
}
