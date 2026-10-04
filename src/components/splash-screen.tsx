"use client";

import { useState, useEffect } from "react";
import { ModernLoader } from "@/components/modern-loader";

export function SplashScreen() {
  const [show, setShow] = useState(true);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    // Wait until the truck hits exactly 100% at 2000ms, then start fading
    const fadeTimer = setTimeout(() => {
      setFade(true);
    }, 2000);

    // Completely remove from DOM after fade transition completes
    const removeTimer = setTimeout(() => {
      setShow(false);
    }, 2300);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!show) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex min-h-[100dvh] w-full flex-col items-center justify-center bg-surface transition-opacity duration-300 ${fade ? "opacity-0" : "opacity-100"}`}
    >
      <ModernLoader />
    </div>
  );
}
