import { View } from "react-native";
import { COPY_BANK } from "@oracle/core";
import { colors, space, typeScale, ROW_H, trackTail } from "../theme";
import { Mono, role } from "./Text";
import { DecodeLine } from "./DecodeText";
import { useNextRound } from "../api/hooks";
import { formatCountdown, msUntil } from "../game/countdown";
import { useNow } from "../game/useNow";
import { useChromeScale } from "./useChromeScale";
import { scaledRow } from "../game/typeScaling";

const READING_LINE = COPY_BANK.find((l) => l.id === "system.reading-1")!.text;

// The wordmark's companion. It replaced the daily epigraph, which was a static
// placard sitting in the screen's most valuable slot; what belongs under the
// wordmark is what the oracle is doing right now. It also absorbs the countdown
// that used to sit down in the call block, so the time is stated once.
//
// It is also the bridge the type system needed: the temple's one carved word
// now has a machine-voice partner at the same optical centre, instead of a
// serif standing alone on a screen of mono.
//
// The block holds a fixed height whichever line it is printing, so a round
// resolving — or a countdown running out — never moves the wordmark above it.

export type ClockRound = { locks_at: string | null } | null | undefined;

export function OracleClock({ round, allSealed, loading, active }: {
  round: ClockRound;
  allSealed: boolean;
  loading: boolean;
  active: boolean;
}) {
  // Only ask when there is no round to count down to; while `today` is still
  // in flight we say nothing rather than flash "THE ORACLE SPEAKS IN".
  const asleep = !round && !loading;
  const next = useNextRound(asleep);
  const now = useNow(1000);
  const scale = useChromeScale();
  const clockH = scaledRow(ROW_H.meta, scale) + space(1) + scaledRow(ROW_H.clock, scale);

  const until = round ? round.locks_at : asleep ? (next.data?.opens_at ?? null) : null;
  const prefix = round
    ? allSealed ? "TODAY'S LEDGER IS READ IN" : "THE ORACLE CLOSES IN"
    : "THE ORACLE SPEAKS IN";
  // Past the lock the round is being read; asleep with no schedule yet, the
  // machine is stirring. Neither is a countdown, so both print as one line.
  const fallback = round ? (allSealed ? READING_LINE : null) : next.data ? "THE ORACLE STIRS" : null;
  const ms = msUntil(until, now);

  return (
    <View style={{ height: clockH, alignItems: "center", justifyContent: "center", gap: space(1) }}>
      {ms !== null ? (
        <>
          <DecodeLine active={active} text={prefix} seed={prefix} {...role.meta} color={colors.mutedInk} />
          {active && (
            <Mono {...typeScale.clock} color={colors.goldText} style={{ ...trackTail(typeScale.clock.letterSpacing) }}>
              {formatCountdown(ms)}
            </Mono>
          )}
        </>
      ) : (
        fallback && <DecodeLine active={active} text={fallback} seed={fallback} {...role.meta} color={colors.mutedInk} />
      )}
    </View>
  );
}
