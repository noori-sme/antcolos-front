"use client";

import { useEffect, useRef } from "react";
import { scrollToTop } from "@/lib/utils/scroll";

/**
 * Moves focus to the screen's heading and scrolls to top whenever the step changes.
 *
 * That is what tells a screen-reader user the screen moved on; without it focus
 * stays on a button that no longer exists. Skipped on first paint by default,
 * so arriving on the page does not yank focus out of the browser chrome.
 *
 * `focusOnMount` is for a sub-screen that REPLACES another one when a button is
 * pressed: the button that was focused has just been unmounted, so focus has
 * already fallen to the body and there is nothing to preserve. Leave it off for
 * a screen somebody can land on directly.
 */
export function useStageFocus<T extends HTMLElement>(stage: string, focusOnMount = false) {
  const ref = useRef<T>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (!focusOnMount) return;
    }
    scrollToTop();
    ref.current?.focus();
    // focusOnMount is fixed for the lifetime of a screen; only the stage moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  return ref;
}
