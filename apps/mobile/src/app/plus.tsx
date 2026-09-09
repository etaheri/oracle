import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCallback, useEffect, useState } from "react";
import { View, Linking, Pressable } from "react-native";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual, role } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { RegisterMarks, numeral } from "../ui/CardChrome";
import { AsciiDust } from "../ui/TerminalPatina";
import { GoldButton, QuietButton, QuietLink } from "../ui/Button";
import { colors, space, displayScale } from "../theme";
import { PLUS_CREED_LINES, PAYWALL_CTA_LINES, PUSH_CAMPAIGN_LINES } from "@oracle/core";
import { getOffering, purchasePackage, restore } from "../monetization/purchases";
import { usePlusStore } from "../monetization/plusState";
import { capture } from "../analytics/analytics";
import { PRIVACY_URL } from "../config/links";

const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

// The offer is an artifact, not a settings row.
//
// Every other object in this app that asks a player to commit -- the card,
// the plaque, the share -- is a framed fresco face with register marks, a
// carved numeral and a terminal margin. The paywall was the one screen that
// asked for money through two undecorated rectangles, which made the most
// consequential press in the app the least considered surface in it.
//
// So the tiers are set as one plaque with two slots. The numerals are the
// card's own numerals, the prices are in the temple voice the day's points
// use, and the terminal margin carries the renewal terms where the card
// carries its provenance -- the legal line stops being a disclaimer bolted
// underneath and becomes part of the object's own chrome.
const PLAQUE_MIN_H = 300;

export default function Plus() {
  return <SafeAreaProvider><PlusContent /></SafeAreaProvider>;
}

function PlusContent() {
  const [offering, setOffering] = useState<PurchasesOffering | null | "loading">("loading");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  // A restore that finds nothing is not a failure, and it used to be printed
  // in vermilion under accessibilityRole="alert" — the app announcing an
  // error at the one player who did exactly the right thing. Status is its
  // own line, in the register the machine uses for everything else it is
  // merely reporting.
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const plusActive = usePlusStore((s) => s.plusActive);
  const privacyUrl = PRIVACY_URL;
  // The store is asked again on demand. This ran once in a mount effect, so a
  // player whose first request failed had no way to make a second one without
  // leaving the screen and coming back — the paywall was simply dead for that
  // visit, on exactly the flaky connection that caused it.
  const loadOffering = useCallback(async () => {
    setOffering("loading");
    setOffering(await getOffering());
  }, []);
  useEffect(() => { void loadOffering(); }, [loadOffering]);
  useEffect(() => { capture("paywall_viewed"); }, []);

  const buy = async (pkg: PurchasesPackage) => {
    setErrorLine(null);
    setStatusLine(null);
    if (!(await purchasePackage(pkg))) setErrorLine("PURCHASE NOT CONFIRMED. CHECK YOUR APP STORE PURCHASES BEFORE TRYING AGAIN.");
  };

  return (
    <Screen scroll overlayHeader patina header={<TopBar />}>
      <View style={{ flexGrow: 1, justifyContent: "center", gap: space(5), paddingVertical: space(4) }}>
        <Eyebrow>Outseen Plus</Eyebrow>

        <View style={{
          backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold,
          paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(12),
          minHeight: PLAQUE_MIN_H, gap: space(4),
          ...(offering === "loading" || offering === null ? { alignItems: "center", justifyContent: "center" } : null),
        }}>
          <RegisterMarks />
          {plusActive ? (
            <View style={{ alignItems: "center", gap: space(3), paddingVertical: space(6) }}>
              <AsciiDust size={120} color={[126, 101, 56]} intensity={0.24} />
              <DecodeLine text={PUSH_CAMPAIGN_LINES.plusWelcome} cursor {...role.line} color={colors.goldText} />
            </View>
          ) : offering === "loading" ? (
            // The machine is doing something, so the machine says so in its
            // own alphabet. A bare "LOADING PRICES…" is the one register this
            // app never speaks in: the flat voice of a form.
            <>
              <AsciiDust size={140} />
              <DecodeLine text="THE STORE IS CONSULTED" cursor {...role.line} color={colors.goldText} />
            </>
          ) : offering === null ? (
            <View style={{ alignItems: "center", gap: space(4) }}>
              <AsciiDust size={140} color={[102, 106, 115]} intensity={0.2} />
              <DecodeLine text="THE STORE DID NOT ANSWER." {...role.line} color={colors.mutedInk} />
              {/* The way back. "TRY AGAIN LATER" was the whole of the recovery
                  path, and it was a statement rather than a door. */}
              <QuietButton title="ASK THE STORE AGAIN" onPress={() => { void loadOffering(); }} />
            </View>
          ) : (
            <>
              {offering.annual && <Tier pkg={offering.annual} slot={1} term="PER YEAR" onPress={buy} featured />}
              {offering.annual && offering.monthly && <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.35 }} />}
              {offering.monthly && <Tier pkg={offering.monthly} slot={offering.annual ? 2 : 1} term="PER MONTH" onPress={buy} />}
            </>
          )}
          {/* The card's terminal margin, carrying what the law requires the
              way the card carries its provenance. */}
          <View style={{ position: "absolute", left: 20, right: 20, bottom: 17 }}>
            <Mono {...role.caption} color={colors.mutedInk} numberOfLines={1}>:: PLUS / RENEWS UNTIL CANCELLED</Mono>
          </View>
        </View>

        {errorLine && <Mono {...role.line} color={colors.vermilion} accessibilityRole="alert">{errorLine}</Mono>}
        {statusLine && <Mono {...role.meta} color={colors.mutedInk}>{statusLine}</Mono>}

        {/* The creed supports the offer now instead of standing in front of
            it (spec §6). Left-aligned and a step down in size: this is the
            argument, the rows above are the decision. */}
        <View style={{ gap: space(2) }}>
          {/* No decode. The stamp above these prints because three recognised
              words cost a reader nothing; a seventeen-word clause about what
              a shield does would put half a second of unreadable static
              inside the sentence someone is deciding on. Same rule the rites
              settled: the ceremony lives on the spine, the argument is read. */}
          {PLUS_CREED_LINES.map((line) => (
            <Mono key={line} {...role.supporting} color={colors.mutedInk}>{line}</Mono>
          ))}
        </View>

        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center", lineHeight: 16 }]}>
          AUTO-RENEWS UNTIL CANCELLED IN APP STORE SETTINGS. EVERY ROUND IS FREE TO PLAY.
        </Mono>
      </View>
      <View style={{ gap: space(2) }}>
        <QuietLink title={PAYWALL_CTA_LINES.restore} onPress={async () => { setErrorLine(null); await restore(); setStatusLine("RESTORE REQUEST FINISHED. SUBSCRIPTION STATUS IS SHOWN ABOVE; IF UNCHANGED, CHECK APP STORE PURCHASES."); }} />
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space(4) }}>
          <Pressable accessibilityRole="link" style={{ minHeight: 44, minWidth: 44, paddingHorizontal: space(2), justifyContent: "center" }} onPress={() => Linking.openURL(TERMS_URL)}><Mono {...role.caption} color={colors.mutedInk}>TERMS</Mono></Pressable>
          {privacyUrl && (
            <Pressable accessibilityRole="link" style={{ minHeight: 44, minWidth: 44, paddingHorizontal: space(2), justifyContent: "center" }} onPress={() => Linking.openURL(privacyUrl)}><Mono {...role.caption} color={colors.mutedInk}>PRIVACY</Mono></Pressable>
          )}
        </View>
      </View>
    </Screen>
  );
}

// One slot on the plaque. The numeral and the price share the temple voice
// because they are the two facts the object exists to state; the term is
// machine voice, because it is a label you recognise rather than read.
function Tier({ pkg, slot, term, onPress, featured }: { pkg: PurchasesPackage; slot: number; term: string; onPress: (p: PurchasesPackage) => void; featured?: boolean }) {
  const Action = featured ? GoldButton : QuietButton;
  return (
    <View style={{ gap: space(3) }}>
      <View style={{ alignItems: "center", gap: space(1) }}>
        <Ritual bold size={displayScale.inline} color={colors.goldText} letterSpacing={2} style={{ marginRight: -2 }}>{numeral(slot)}</Ritual>
        <Mono {...role.meta} color={featured ? colors.goldText : colors.mutedInk}>{term}</Mono>
        <Ritual bold size={featured ? 32 : 24} color={colors.ink} letterSpacing={1}>{pkg.product.priceString}</Ritual>
      </View>
      <Action title={PAYWALL_CTA_LINES.subscribe} onPress={() => onPress(pkg)} />
    </View>
  );
}
