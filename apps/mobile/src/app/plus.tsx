import { useEffect, useState } from "react";
import { View, Linking, Pressable } from "react-native";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space } from "../theme";
import { COPY_BANK, PAYWALL_CTA_LINES, PUSH_CAMPAIGN_LINES } from "@oracle/core";
import { getOffering, purchasePackage, restore } from "../monetization/purchases";
import { usePlusStore } from "../monetization/plusState";
import { capture } from "../analytics/analytics";

const CREED = COPY_BANK.filter((l) => l.pool === "paywall" && l.id.startsWith("paywall.creed"));
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://PRIVACY_URL_TBD_TASK_12"; // Task 12 replaces with Erik's real URL before submission

export default function Plus() {
  const [offering, setOffering] = useState<PurchasesOffering | null | "loading">("loading");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const plusActive = usePlusStore((s) => s.plusActive);
  useEffect(() => { getOffering().then(setOffering); }, []);
  useEffect(() => { capture("paywall_viewed"); }, []);

  const buy = async (pkg: PurchasesPackage) => {
    setErrorLine(null);
    if (!(await purchasePackage(pkg))) setErrorLine("THE STORE DID NOT ANSWER. NOTHING WAS CHARGED.");
  };

  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>Oracle plus</Eyebrow>
        {plusActive ? (
          <Mono size={11} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{PUSH_CAMPAIGN_LINES.plusWelcome}</Mono>
        ) : offering === "loading" ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>CONSULTING THE STORE…</Mono>
        ) : offering === null ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>THE STORE IS BEYOND THE VEIL. RETURN LATER.</Mono>
        ) : (
          <View style={{ gap: space(3) }}>
            {offering.annual && <PriceRow pkg={offering.annual} tag="TWELVE MOONS" onPress={buy} featured />}
            {offering.monthly && <PriceRow pkg={offering.monthly} tag="ONE MOON" onPress={buy} />}
          </View>
        )}
        {errorLine && <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{errorLine}</Mono>}
        {/* The creed supports the offer now instead of standing in front of
            it (spec §6). Left-aligned and a step down in size: this is the
            argument, the rows above are the decision. */}
        <View style={{ gap: space(2) }}>
          {CREED.map((l, i) => (
            <DecodeLine key={l.id} text={l.text} delayMs={i * 160} durationMs={450} size={11} color={colors.mutedInk} letterSpacing={2} style={{ lineHeight: 19 }} />
          ))}
        </View>
        <Mono size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center", lineHeight: 16 }}>
          AUTO-RENEWS UNTIL CANCELLED IN APP STORE SETTINGS. THE FREE GAME IS NEVER GATED.
        </Mono>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <QuietLink title={PAYWALL_CTA_LINES.restore} onPress={() => restore()} />
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space(4) }}>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}><Mono size={10} color={colors.mutedInk} letterSpacing={1}>TERMS</Mono></Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}><Mono size={10} color={colors.mutedInk} letterSpacing={1}>PRIVACY</Mono></Pressable>
        </View>
      </View>
    </Screen>
  );
}

function PriceRow({ pkg, tag, onPress, featured }: { pkg: PurchasesPackage; tag: string; onPress: (p: PurchasesPackage) => void; featured?: boolean }) {
  return (
    <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: featured ? colors.agedGold : colors.line, padding: space(4), gap: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Mono size={10} color={featured ? colors.goldText : colors.mutedInk} letterSpacing={2}>{tag}</Mono>
        <Ritual bold size={featured ? 24 : 18} color={colors.ink} letterSpacing={1}>{pkg.product.priceString}</Ritual>
      </View>
      <GoldButton title={PAYWALL_CTA_LINES.subscribe} onPress={() => onPress(pkg)} />
    </View>
  );
}
