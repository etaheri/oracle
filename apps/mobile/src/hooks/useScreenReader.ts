import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// Live screen-reader state. The card's swipe input has an accessible twin
// (hold-to-charge buttons); this decides which renders.
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => { if (mounted) setEnabled(v); });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => { mounted = false; sub.remove(); };
  }, []);
  return enabled;
}
