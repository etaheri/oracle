// The channel (design 2026-09-25 §6.3): a mono block with a one-line header
// and the log under it. Each line is `HH:MM <nick> text`, the stamp in
// eastern time, the nick in its tone colour, the words as the member wrote
// them. The header and the room's lines are machine voice; what a member
// says is read, so it takes the reading register and keeps its own case.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LogLine } from "@oracle/core";
import { Mono, role } from "./Text";
import { DecodeLine } from "./DecodeText";
import { channelHeader, printLines, summaryRow, spokenSummary, DARK_FLOOR, type PrintLine } from "../game/channel";
import { colors, space } from "../theme";

const LINE_STAGGER_MS = 120;
const LINE_PRINT_MS = 400;
const LEFT = { textAlign: "left" as const };

const toneColor = (tone: LogLine["tone"]) => (tone === "win" ? colors.goldText : tone === "loss" ? colors.vermilion : colors.mutedInk);

function ChannelLine({ line, index }: { line: PrintLine; index: number }) {
  const room = line.kind === "system";
  const base = room ? role.meta : role.supporting;
  return (
    <DecodeLine
      {...base}
      text={line.body}
      seed={line.key}
      delayMs={index * LINE_STAGGER_MS}
      durationMs={LINE_PRINT_MS}
      color={line.kind === "say" ? colors.ink : colors.mutedInk}
      accessibilityLabel={line.spoken}
      style={[base.style, LEFT, line.kind === "note" ? { opacity: 0.7 } : null]}
      prefix={
        <>
          <Text accessible={false} style={{ color: colors.mutedInk }}>{`${line.stamp} `}</Text>
          <Text accessible={false} style={{ color: toneColor(line.tone) }}>{`${line.nick} `}</Text>
        </>
      }
    />
  );
}

export function ChannelLog({ date, log, defaultOpen, collapsible = true, onOpen }: {
  // The round's date; the header prints its month and day.
  date: string;
  log: ReadonlyArray<LogLine>;
  defaultOpen: boolean;
  // False where the block is the whole panel and has nothing to fold into.
  collapsible?: boolean;
  // Fires each time the reader opens a closed block.
  onOpen?: () => void;
}) {
  // Remembers nothing between visits (design §6.3): the state dies with the mount.
  const [open, setOpen] = useState(defaultOpen);
  const header = channelHeader(date);
  const lines = printLines(log);
  const summary = summaryRow(log);
  // The collapsed row is the only thing the closed block shows, so the label
  // that opens it says it too — otherwise the shares are visible and unspoken.
  const spoken = spokenSummary(log);
  const head = <Mono {...role.meta} color={colors.goldText} style={[role.meta.style, LEFT]}>{header}</Mono>;

  if (lines.length === 0) {
    return (
      <View style={{ gap: space(1) }}>
        {head}
        <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, LEFT]}>{DARK_FLOOR}</Mono>
      </View>
    );
  }

  const shown = open || !collapsible;
  return (
    <View style={{ gap: space(1) }}>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? "Close the channel" : spoken ? `Open the channel. ${spoken}` : "Open the channel"}
          onPress={() => { if (!open) onOpen?.(); setOpen((v) => !v); }}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", gap: space(1), opacity: pressed ? 0.5 : 1 })}
        >
          {head}
          {!open && summary && <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, LEFT]}>{summary}</Mono>}
        </Pressable>
      ) : head}
      {shown && lines.map((line, i) => <ChannelLine key={line.key} line={line} index={i} />)}
    </View>
  );
}
