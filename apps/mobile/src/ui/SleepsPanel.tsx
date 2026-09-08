import { View } from "react-native";
import { colors, space } from "../theme";
import { DecodeLine } from "./DecodeText";
import { OracleClock } from "./OracleClock";
import { role } from "./Text";
import { GoldButton, QuietLink } from "./Button";

// Between rounds the machine is not dead, it is waiting: one line, one
// countdown to the next noon. Home says this in its own call slot (its clock
// already counts the next opening); this is the standalone panel /round shows
// when it is opened on a sleeping day.
export function SleepsPanel({
  active = true,
  failed = false,
  onHome,
  onExhibition,
}: {
  active?: boolean;
  failed?: boolean;
  onHome: () => void;
  onExhibition: () => void;
}) {
  return (
    <View style={{ gap: space(3), alignItems: "stretch" }}>
      <DecodeLine
        active={active}
        text={failed ? "COULDN'T LOAD TODAY'S ROUND" : "TODAY'S ROUND ISN'T AVAILABLE"}
        cursor
        {...role.line}
        color={colors.mutedInk}
      />
      {!failed && <OracleClock round={undefined} allSealed={false} loading={false} active={active} />}
      <GoldButton title="CHALLENGE THE ORACLE" onPress={onExhibition} />
      <QuietLink title="RETURN HOME" onPress={onHome} />
    </View>
  );
}
