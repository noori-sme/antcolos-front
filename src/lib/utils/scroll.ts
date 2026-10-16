"use client";

import { useEffect } from "react";

/**
 * Reliably scrolls the window, document, and main content container to the top.
 */
export function scrollToTop(behavior: ScrollBehavior = "instant") {
  if (typeof window === "undefined") return;

  try {
    window.scrollTo({ top: 0, left: 0, behavior });
  } catch {
    window.scrollTo(0, 0);
  }

  if (document.documentElement) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body) {
    document.body.scrollTop = 0;
  }

  const main = document.getElementById("main");
  if (main) {
    try {
      main.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      main.scrollTop = 0;
    }
  }
}

/**
 * Hook to scroll to top whenever any dependency in `deps` changes,
 * or on mount if no deps are provided.
 */
export function useScrollToTop(deps?: React.DependencyList) {
  useEffect(() => {
    scrollToTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}

/**
 * Component that scrolls to top when mounted.
 */
export function ScrollToTopOnMount() {
  useEffect(() => {
    scrollToTop();
  }, []);
  return null;
}
