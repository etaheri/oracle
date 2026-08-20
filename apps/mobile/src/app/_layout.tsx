import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0C0A07" } }} />;
}
