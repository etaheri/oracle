import { View } from "react-native";
import { DecodeLine } from "./DecodeText";
import { Countdown } from "./Countdown";
import { useNextRound } from "../api/hooks";
import { colors, space } from "../theme";

// Between rounds the machine is not dead, it is waiting: one line, one
// countdown to the next noon. "THE ORACLE STIRS" covers the ≤10 minutes
// between a scheduled noon and the cron tick that opens it.
export function SleepsPanel({ active = true }: { active?: boolean }) {
  const next = useNextRound(true);
  return (
    <View style={{ gap: space(2), alignItems: "center" }}>
      <DecodeLine active={active} text="THE ORACLE SLEEPS" cursor size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
      <Countdown until={next.data?.opens_at ?? null} prefix="THE ORACLE SPEAKS IN" fallback={next.data ? "THE ORACLE STIRS" : undefined} />
    </View>
  );
}
