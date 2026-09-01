import { View } from "react-native";
import { colors, space } from "../theme";
import { DecodeLine } from "./DecodeText";
import { OracleClock } from "./OracleClock";
import { role } from "./Text";

// Between rounds the machine is not dead, it is waiting: one line, one
// countdown to the next noon. Home says this in its own call slot (its clock
// already counts the next opening); this is the standalone panel /round shows
// when it is opened on a sleeping day.
export function SleepsPanel({ active = true }: { active?: boolean }) {
  return (
    <View style={{ gap: space(2), alignItems: "center" }}>
      <DecodeLine active={active} text="THE ORACLE SLEEPS" cursor {...role.line} color={colors.mutedInk} />
      <OracleClock round={undefined} allSealed={false} loading={false} active={active} />
    </View>
  );
}
