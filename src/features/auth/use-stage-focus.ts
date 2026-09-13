"use client";

import { useEffect, useRef } from "react";

/**
 * Moves focus to the screen's heading whenever the step changes.
 *
 * That is what tells a screen-reader user the screen moved on; without it focus
 * stays on a button that no longer exists. Skipped on first paint, so arriving
 * on the page does not yank focus out of the browser chrome.
 */
export function useStageFocus<T extends HTMLElement>(stage: string) {
  const ref = useRef<T>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    ref.current?.focus();
  }, [stage]);

  return ref;
}
