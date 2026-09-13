"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A one-second countdown used by the verification screen for the code's
 * lifetime and the resend cooldown.
 *
 * It starts at the full duration on the very first render, so the server and
 * the client agree, and only begins ticking after mount.
 */
export function useCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);
  const deadlineRef = useRef<number | null>(null);

  const restart = useCallback((next: number = seconds) => {
    deadlineRef.current = Date.now() + next * 1000;
    setRemaining(next);
  }, [seconds]);

  useEffect(() => {
    if (deadlineRef.current === null) deadlineRef.current = Date.now() + seconds * 1000;
    // Reading the wall clock each tick keeps the count honest when the tab is
    // backgrounded and timers are throttled.
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  return { remaining, expired: remaining <= 0, restart };
}

/** 95 -> "1:35", 8 -> "0:08" */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
