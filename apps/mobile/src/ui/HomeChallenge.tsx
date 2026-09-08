import { View } from "react-native";
import { GAME_TERMS } from "@oracle/core";
import type { ArrivalInput, ArrivalState } from "../game/arrivalState";
import { colors, space } from "../theme";
import { GoldButton, QuietLink } from "./Button";
import { DecodeLine } from "./DecodeText";
import { Mono, role } from "./Text";

function localOpening(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function HomeChallenge({
  state,
  input,
  active,
  secondary = false,
  checking = false,
  onPrimary,
  onRetry,
  onExhibition,
}: {
  state: ArrivalState;
  input: ArrivalInput;
  active: boolean;
  secondary?: boolean;
  checking?: boolean;
  onPrimary: () => void;
  onRetry: () => void;
  onExhibition: () => void;
}) {
  const supporting = state.kind === "error"
    ? "COULDN'T LOAD TODAY'S ROUND."
    : state.kind === "partial"
      ? `${input.openCount} ${input.openCount === 1 ? "QUESTION REMAINS" : "QUESTIONS REMAIN"} · A COMPETITIVE RESULT REQUIRES EVERY NON-VOID QUESTION. YOU CAN STILL SEE RESULTS FOR THE CALLS YOU MAKE.`
      : state.kind === "submitted"
        ? "YOUR CALLS ARE SEALED. RESULTS ARRIVE AFTER THE OUTCOMES ARE KNOWN."
        : state.kind === "waiting"
          ? input.nextOpensAt
            ? `NEXT ROUND OPENS ${localOpening(input.nextOpensAt)} · ONE PRACTICE QUESTION. IMMEDIATE RESULT. UNRANKED.`
            : "THE NEXT ROUND HASN'T BEEN ANNOUNCED. · ONE PRACTICE QUESTION. IMMEDIATE RESULT. UNRANKED."
          : state.kind === "live"
            ? "CAN YOU SEE SOMETHING IT DOESN'T? · FIVE QUESTIONS ABOUT WHAT HAPPENS NEXT."
            : "LOADING TODAY'S CHALLENGE…";

  return (
    <View style={{ gap: space(2), alignItems: "stretch" }}>
      <Mono {...role.meta} color={colors.mutedInk}>A DAILY PREDICTION GAME</Mono>
      <Mono {...role.meta} color={colors.mutedInk}>{`COMPETE AGAINST ${GAME_TERMS.opponent.toUpperCase()} AND OTHER ${GAME_TERMS.players.toUpperCase()}.`}</Mono>
      <DecodeLine active={active} text={supporting} {...role.line} color={state.kind === "live" || state.kind === "partial" ? colors.goldText : colors.mutedInk} />
      {state.label && state.primary && (
        checking
          ? <GoldButton title="CHECKING TODAY…" disabled onPress={onPrimary} />
          : secondary
            ? <QuietLink title={state.label} onPress={state.primary === "retry" ? onRetry : onPrimary} />
            : <GoldButton title={state.label} onPress={state.primary === "retry" ? onRetry : onPrimary} />
      )}
      {state.kind === "error" && <QuietLink title="TRY AN EXHIBITION" onPress={onExhibition} />}
    </View>
  );
}
