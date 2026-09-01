import { useEffect, useState } from "react";
import { scheduleHeroCues } from "../game/heroCues";

// Turns the landing moment into the two staggered print cues Home needs.
// `landed` true on first render (warm mount) still walks the same schedule —
// a 350/850ms stagger on a screen re-entry is invisible and keeps one path.
export function useHeroCues(landed: boolean): { title: boolean; epigraph: boolean } {
  const [title, setTitle] = useState(false);
  const [epigraph, setEpigraph] = useState(false);
  useEffect(() => {
    if (!landed) return;
    return scheduleHeroCues(() => setTitle(true), () => setEpigraph(true));
  }, [landed]);
  return { title, epigraph };
}
