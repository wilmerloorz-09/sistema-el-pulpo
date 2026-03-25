import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const THEME_ATTRIBUTE = "data-theme";
const THEME_EVENT = "app-theme-change";

function resolveInitialTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }

  const root = document.documentElement;
  const attrTheme = root.getAttribute(THEME_ATTRIBUTE);

  if (attrTheme === "dark" || attrTheme === "light") {
    return attrTheme;
  }

  return root.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    const handleThemeSync = (event: Event) => {
      const nextTheme = (event as CustomEvent<Theme>).detail;
      if (nextTheme === "light" || nextTheme === "dark") {
        setTheme((current) => (current === nextTheme ? current : nextTheme));
      }
    };

    window.addEventListener(THEME_EVENT, handleThemeSync);
    return () => window.removeEventListener(THEME_EVENT, handleThemeSync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === "dark";

    root.setAttribute(THEME_ATTRIBUTE, theme);
    root.style.setProperty("--theme", theme);
    root.style.colorScheme = theme;
    root.classList.toggle("dark", isDark);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return {
    theme,
    setTheme,
    toggle,
    isDark: theme === "dark",
  };
}
