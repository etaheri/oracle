import { useEffect, useState } from "react";
import { scheduleHeroCues } from "../game/heroCues";

// Turns the landing moment into the two staggered print cues Home needs:
// the wordmark, then the clock beneath it.
// `landed` true on first render (warm mount) still walks the same schedule —
// a 350/850ms stagger on a screen re-entry is invisible and keeps one path.
export function useHeroCues(landed: boolean): { title: boolean; subtitle: boolean } {
  const [title, setTitle] = useState(false);
  const [subtitle, setSubtitle] = useState(false);
  useEffect(() => {
    if (!landed) return;
    return scheduleHeroCues(() => setTitle(true), () => setSubtitle(true));
  }, [landed]);
  return { title, subtitle };
}
