import { useEffect, useState } from "react";

const DESKTOP_BREAKPOINT = 768;
const DETAIL_BREAKPOINT = 1280;

type BreakpointState = {
  isDesktop: boolean;
  isMobile: boolean;
  showDetailPanel: boolean;
};

function getBreakpointState(): BreakpointState {
  if (typeof window === "undefined") {
    return {
      isDesktop: false,
      isMobile: true,
      showDetailPanel: false,
    };
  }

  const width = window.innerWidth;

  return {
    isDesktop: width >= DESKTOP_BREAKPOINT,
    isMobile: width < DESKTOP_BREAKPOINT,
    showDetailPanel: width >= DETAIL_BREAKPOINT,
  };
}

export function useBreakpoint() {
  const [state, setState] = useState<BreakpointState>(getBreakpointState);

  useEffect(() => {
    const desktopMedia = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const detailMedia = window.matchMedia(`(min-width: ${DETAIL_BREAKPOINT}px)`);

    const syncState = () => {
      setState(getBreakpointState());
    };

    syncState();
    desktopMedia.addEventListener("change", syncState);
    detailMedia.addEventListener("change", syncState);
    window.addEventListener("resize", syncState);

    return () => {
      desktopMedia.removeEventListener("change", syncState);
      detailMedia.removeEventListener("change", syncState);
      window.removeEventListener("resize", syncState);
    };
  }, []);

  return state;
}

export { DESKTOP_BREAKPOINT, DETAIL_BREAKPOINT };
