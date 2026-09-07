import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow } from "../ui/Text";
import { GoldButton } from "../ui/Button";
import { PracticeCard } from "../ui/PracticeCard";
import { markPracticeSeen, markRitesSeen } from "../api/flags";
import { capture } from "../analytics/analytics";
import { space } from "../theme";
export default function Practice() {
  const router = useRouter(); const { opening } = useLocalSearchParams<{ opening?: string }>();
  const completed = useRef(false); const started = useRef(Date.now());
  useEffect(() => { capture("practice_started"); return () => { if (!completed.current) capture("practice_skipped"); }; }, []);
  return <Screen scroll header={<TopBar />}><Stack.Screen options={{ gestureEnabled: false }} /><View style={{ gap: space(5), paddingVertical: space(5) }}>
    <Eyebrow>Practice · nothing is recorded</Eyebrow>
    <PracticeCard onCompleted={() => { if (!completed.current) { completed.current = true; capture("practice_completed", { elapsed_ms: Date.now() - started.current }); void markPracticeSeen(); } }} />
    <GoldButton title={opening === "1" ? "BEGIN" : "RETURN"} onPress={() => { if (opening === "1") { void markRitesSeen(); router.replace("/round"); } else router.back(); }} />
  </View></Screen>;
}
