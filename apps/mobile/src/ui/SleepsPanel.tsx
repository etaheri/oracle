import { View } from "react-native";
import { colors, space } from "../theme";
import { DecodeLine } from "./DecodeText";
import { OracleClock } from "./OracleClock";
import { Mono, role } from "./Text";
import { GoldButton } from "./Button";

// Between rounds the machine is not dead, it is waiting: one line, one
// countdown to the next noon. Home says this in its own call slot (its clock
// already counts the next opening); this is the standalone panel /round shows
// when it is opened on a sleeping day.
export function SleepsPanel({
  active = true,
  failed = false,
  onExhibition,
}: {
  active?: boolean;
  failed?: boolean;
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
      {/* An empty state should teach the interface rather than only report
          that there is nothing here. This was one line floating in a screen
          of white above a button labelled CHALLENGE THE ORACLE — Home's word
          for the real round, pointing at a practice question instead. */}
      <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>
        An exhibition is one practice question with a known answer. It scores
        nothing and changes no record — a way to meet the call while you wait.
      </Mono>
      <GoldButton title="TRY AN EXHIBITION" onPress={onExhibition} />
    </View>
  );
}
