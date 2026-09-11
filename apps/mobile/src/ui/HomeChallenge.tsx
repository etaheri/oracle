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
      ? `${input.openCount} ${input.openCount === 1 ? "QUESTION REMAINS" : "QUESTIONS REMAIN"} · A PLACING NEEDS EVERY NON-VOID QUESTION. YOUR STAKES STILL SETTLE.`
      : state.kind === "submitted"
        ? "YOUR CALLS ARE SEALED. SEE WHERE THE PLAYERS LEAN WHILE THE MARKETS SETTLE."
        : state.kind === "waiting"
          // The state only. This line used to carry the state AND the offer
          // joined by a middot — "THE NEXT ROUND HASN'T BEEN ANNOUNCED. · TRY
          // ONE CALL NOW. REVEAL THE RESULT. UNRANKED." — which wrapped to
          // three lines and asked the reader to find the sentence boundary
          // themselves. The offer is a separate thing and now sits with the
          // control that performs it.
          ? input.nextOpensAt
            ? `NEXT ROUND OPENS ${localOpening(input.nextOpensAt)}`
            : "THE NEXT ROUND HASN'T BEEN ANNOUNCED"
          : state.kind === "live"
            ? "THE ORACLE HAS POSTED FIVE LINES."
            : "LOADING TODAY'S CHALLENGE…";

  return (
    <View style={{ gap: space(2), alignItems: "stretch" }}>
      {/* The pitch, for the one visit that needs it.
          These two lines printed on every launch, in the same size and colour
          as the state line beneath them — so a returning player met five
          near-identical rows of tracked caps where one of them was the only
          one that had changed since yesterday. The tagline above the wordmark
          already says what this is; a player who has been here before does
          not need telling twice a day. */}
      {input.firstVisit && <>
        <Mono {...role.meta} color={colors.mutedInk}>A DAILY PREDICTION GAME</Mono>
        <Mono {...role.meta} color={colors.mutedInk}>{`COMPETE AGAINST ${GAME_TERMS.opponent.toUpperCase()} AND OTHER ${GAME_TERMS.players.toUpperCase()}.`}</Mono>
      </>}
      <DecodeLine active={active} text={supporting} {...role.line} color={state.kind === "live" || state.kind === "partial" ? colors.goldText : colors.mutedInk} />
      {state.label && state.primary && (
        checking
          ? <GoldButton title="CHECKING TODAY…" disabled onPress={onPrimary} />
          : secondary
            ? <QuietLink title={state.label} onPress={state.primary === "retry" ? onRetry : onPrimary} />
            : <GoldButton title={state.label} onPress={state.primary === "retry" ? onRetry : onPrimary} />
      )}
      {/* The offer, under the control that performs it — where the state line
          used to carry it as a clause. */}
      {state.kind === "waiting" && (
        <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "center" }]}>
          ONE CALL, ANSWERED NOW · UNRANKED
        </Mono>
      )}
      {state.kind === "error" && <QuietLink title="TRY A PRACTICE QUESTION" onPress={onExhibition} />}
    </View>
  );
}
