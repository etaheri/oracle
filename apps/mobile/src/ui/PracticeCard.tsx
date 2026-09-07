import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { leanRelease, holdConfidence } from "../game/swipeLean";
import { confidenceMeaning } from "../game/confidence";
import { payoffLine } from "../game/payoffLine";
import { useScreenReader } from "../hooks/useScreenReader";
import { Mono, Serif } from "./Text";
import { GoldFrame } from "./GoldFrame";
import { QuietLink } from "./Button";
import { colors, space } from "../theme";

// Local mechanics only: this component deliberately has no game store or API imports.
export function PracticeCard({ onCompleted }: { onCompleted: () => void }) {
  const width = useRef(300);
  const screenReader = useScreenReader();
  const [buttons, setButtons] = useState(false);
  const [live, setLive] = useState<{ answer: boolean; confidence: number } | null>(null);
  const [receipt, setReceipt] = useState<typeof live>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const held = useRef<{ answer: boolean; start: number } | null>(null);
  const completed = useRef(onCompleted); completed.current = onCompleted;
  function cancel() { if (timer.current) clearInterval(timer.current); timer.current = null; held.current = null; setLive(null); }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  function finish(value: typeof live) { cancel(); if (value) { setReceipt(value); completed.current(); } }
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !receipt && !screenReader && !buttons && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => setLive(leanRelease(g.dx, width.current)),
    onPanResponderRelease: (_, g) => finish(leanRelease(g.dx, width.current)),
    onPanResponderTerminate: cancel,
  });
  function begin(answer: boolean) {
    cancel(); const start = Date.now(); held.current = { answer, start }; setLive({ answer, confidence: 55 });
    timer.current = setInterval(() => setLive({ answer, confidence: holdConfidence(Date.now() - start) }), 50);
  }
  return <View style={{ gap: space(3) }}>
    <GoldFrame>
      <View {...pan.panHandlers} onLayout={e => { width.current = e.nativeEvent.layout.width; }} style={{ minHeight: 200, padding: space(5), gap: space(4), justifyContent: "center" }}>
        <Serif style={{ textAlign: "center" }}>{receipt ? "A practice answer. Nothing recorded." : "Choose either side. See how belief feels."}</Serif>
        <Mono accessibilityLiveRegion="polite" style={{ textAlign: "center" }}>
          {receipt ? `${receipt.answer ? "YES" : "NO"} AT ${receipt.confidence}%` : live ? `${live.answer ? "YES" : "NO"} ${live.confidence}% · ${confidenceMeaning(live.confidence)}` : "← NO · YES →"}
        </Mono>
        {live && <Mono size={10} style={{ textAlign: "center" }}>{payoffLine(live.confidence, false)}</Mono>}
      </View>
    </GoldFrame>
    {!receipt && <Mono size={11}>PULL TO ADJUST. RETURN TO THE CENTER TO CANCEL. RELEASE TO SEAL.</Mono>}
    {!receipt && (buttons || screenReader) && <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: "row", gap: space(3) }}>{[false, true].map(answer => <Pressable key={String(answer)} accessibilityRole="button" accessibilityLabel={`Hold ${answer ? "yes" : "no"} to raise confidence`} onPressIn={() => begin(answer)} onPressOut={() => { const h = held.current; if (h) finish({ answer: h.answer, confidence: holdConfidence(Date.now() - h.start) }); }} onTouchCancel={cancel} style={{ flex: 1, minHeight: 48, padding: space(3), borderWidth: 1, borderColor: colors.agedGold }}><Mono>{answer ? "YES" : "NO"} · HOLD</Mono></Pressable>)}</View>
      <QuietLink title="CANCEL PRACTICE CHOICE" onPress={cancel} />
    </View>}
    {!receipt && !screenReader && <QuietLink title={buttons ? "USE THE PULL" : "USE HOLD BUTTONS"} onPress={() => { cancel(); setButtons(!buttons); }} />}
    {receipt && <QuietLink title="TRY AGAIN" onPress={() => setReceipt(null)} />}
  </View>;
}
