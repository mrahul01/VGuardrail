"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeMode = "light" | "dark" | "system";

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Cycles the next-themes mode: light → dark → system.
 *
 * Renders a fixed-size placeholder until mounted — the resolved theme is only
 * known on the client, so rendering the real icon during SSR would cause a
 * hydration mismatch.
 */
export function ThemeToggle(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Same footprint as the button (p-2 + h-5 icon = 36px square) so the
    // Topbar layout doesn't shift when the real toggle hydrates in.
    return <span className="inline-block h-9 w-9" aria-hidden="true" />;
  }

  const mode: ThemeMode =
    theme === "light" || theme === "dark" ? theme : "system";
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT_MODE[mode])}
      className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      aria-label={`Theme: ${MODE_LABEL[mode]}. Switch to ${MODE_LABEL[NEXT_MODE[mode]].toLowerCase()} theme`}
      title={`Theme: ${MODE_LABEL[mode]}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
