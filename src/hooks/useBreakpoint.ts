import { useEffect, useState } from "react";

const DESKTOP_BREAKPOINT = 768;
const TABLET_10_BREAKPOINT = 1024;
const DETAIL_BREAKPOINT = 1280;

type BreakpointState = {
  isDesktop: boolean;
  isMobile: boolean;
  isTablet10: boolean;
  showDetailPanel: boolean;
};

function getBreakpointState(): BreakpointState {
  if (typeof window === "undefined") {
    return {
      isDesktop: false,
      isMobile: true,
      isTablet10: false,
      showDetailPanel: false,
    };
  }

  const width = window.innerWidth;

  return {
    isDesktop: width >= DESKTOP_BREAKPOINT,
    isMobile: width < DESKTOP_BREAKPOINT,
    isTablet10: width >= TABLET_10_BREAKPOINT,
    showDetailPanel: width >= DETAIL_BREAKPOINT,
  };
}

export function useBreakpoint() {
  const [state, setState] = useState<BreakpointState>(getBreakpointState);

  useEffect(() => {
    const desktopMedia = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const tablet10Media = window.matchMedia(`(min-width: ${TABLET_10_BREAKPOINT}px)`);
    const detailMedia = window.matchMedia(`(min-width: ${DETAIL_BREAKPOINT}px)`);

    const syncState = () => {
      setState(getBreakpointState());
    };

    syncState();
    desktopMedia.addEventListener("change", syncState);
    tablet10Media.addEventListener("change", syncState);
    detailMedia.addEventListener("change", syncState);
    window.addEventListener("resize", syncState);

    return () => {
      desktopMedia.removeEventListener("change", syncState);
      tablet10Media.removeEventListener("change", syncState);
      detailMedia.removeEventListener("change", syncState);
      window.removeEventListener("resize", syncState);
    };
  }, []);

  return state;
}

export { DESKTOP_BREAKPOINT, TABLET_10_BREAKPOINT, DETAIL_BREAKPOINT };
