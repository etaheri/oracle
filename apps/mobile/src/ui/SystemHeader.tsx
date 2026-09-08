import { View } from "react-native";
import { colors, space } from "../theme";
import { Mono, role } from "./Text";

// Home's top register: the machine stamping itself and the day it is serving,
// closed by a hairline. It replaces a lone centred eyebrow that read "ORACLE
// OS v1.0" — the word ORACLE said twice on one screen, once in mono and again
// in Cinzel 120px below, was the loudest of the screen's type inconsistencies.
// The stamp is deliberately not the wordmark: this is the terminal talking,
// the carved word underneath is the artifact.
export function SystemHeader({ stamp }: { stamp: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), paddingBottom: space(2) }}>
        <Mono {...role.eyebrow} color={colors.goldText} style={[role.eyebrow.style, { textAlign: "left", flexShrink: 1 }]}>OUTSEE</Mono>
        <Mono {...role.eyebrow} color={colors.mutedInk} style={[role.eyebrow.style, { textAlign: "right", flexShrink: 1 }]}>{stamp}</Mono>
    </View>
  );
}
