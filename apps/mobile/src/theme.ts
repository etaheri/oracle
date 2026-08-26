// Palette sampled from the art direction (design/art-direction/): fresco
// hands + glass orb on warm parchment; midnight navy is the night realm.
export const colors = {
  parchment: "#E6DECA", // ground — the fresco's own paper
  vellum: "#EFE8D6", // lifted card face
  ink: "#2A2118", // primary text, warm sepia-black (11.8:1)
  inkDim: "#4E4334", // secondary text (7.2:1)
  umber: "#6E5F4B", // captions, machine chrome (4.6:1)
  gold: "#C9A24B", // gilt — borders, fills, large display only; fails AA as small text
  goldDeep: "#75571F", // text-tier gold, from the ochre sleeve (5:1)
  goldBright: "#E4C878", // glint — night surfaces only
  lapis: "#2A4364", // YES — the blue sleeve (7.5:1)
  oxblood: "#9C3F22", // NO, losses — the red sleeve (5:1)
  night: "#061020", // midnight realm: sealed states, share card
  nightBone: "#E9E1CD", // text on night
  line: "rgba(42,33,24,0.28)",
  lineSoft: "rgba(42,33,24,0.13)",
  goldWash: "rgba(201,162,75,0.14)",
  lapisWash: "rgba(42,67,100,0.08)",
  oxbloodWash: "rgba(156,63,34,0.07)",
  orbLavender: "#B2A6CB",
  orbPeach: "#EDBC94",
} as const;

// Two voices (design spec §3b): temple (Marcellus display, Cinzel carved caps)
// owns moments; machine (IBM Plex Mono) owns structure and chrome.
export const fonts = {
  display: "Marcellus",
  ritual: "Cinzel",
  ritualBold: "Cinzel-SemiBold",
  mono: "IBMPlexMono",
  monoMedium: "IBMPlexMono-Medium",
};

export const space = (n: number) => n * 4;
