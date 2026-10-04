"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export function ModernLoader() {
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const startTime = performance.now();
    let frame: number;

    const update = () => {
      const elapsed = performance.now() - startTime;
      // Match the 2000ms animation duration
      const p = Math.min(1, elapsed / 2000);
      setProgress(Math.floor(p * 100));
      
      if (p < 1) {
        frame = requestAnimationFrame(update);
      }
    };
    
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <style>{`
        @keyframes drive {
          0% { transform: translateX(-40px); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateX(340px); opacity: 0; }
        }
        .animate-drive {
          animation: drive 2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes truck-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .animate-truck-bounce {
          animation: truck-bounce 0.3s ease-in-out infinite;
        }

        @keyframes load-road {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-load-road {
          animation: load-road 2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
      `}</style>

      <Logo size="lg" className="scale-[1.35] mb-10" />

      <div className="relative w-80 h-16 flex flex-col justify-end">
        {/* The Truck */}
        <div className={`absolute bottom-2.5 left-0 text-primary drop-shadow-sm ${mounted ? "animate-drive" : "opacity-0"}`}>
          <div className="animate-truck-bounce">
            <Truck className="size-8" strokeWidth={1.5} />
          </div>
        </div>
        
        {/* The Road / Progress Bar */}
        <div className="w-full h-1.5 bg-border/50 rounded-full overflow-hidden relative">
          <div className={`absolute inset-0 bg-primary/40 rounded-full ${mounted ? "animate-load-road" : "opacity-0"}`} />
          <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full ${mounted ? "animate-load-road" : "opacity-0"}`} />
        </div>
      </div>

      <p className="text-[0.875rem] font-semibold uppercase tracking-[0.2em] text-fg-muted mt-5 flex items-center gap-2">
        <span>Loading Antcolos</span>
        <span className="tabular-nums font-mono font-bold text-primary">{progress}%</span>
      </p>
    </div>
  );
}
