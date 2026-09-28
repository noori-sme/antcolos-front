"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Truck, MoveRight, MapPinOff } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export default function NotFound() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleReturn = () => {
    const hasToken = typeof document !== "undefined" && document.cookie.includes("antcolos_token=");
    if (hasToken) {
      router.push("/home");
    } else {
      router.push("/sign-in");
    }
  };

  if (!mounted) return null; // Avoid hydration mismatch on initial render

  return (
    <div 
      className="flex min-h-screen flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{
        backgroundImage: "url('/images/404-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/60 z-0" />

      {/* Dynamic background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
        className="relative z-10 flex w-full max-w-md flex-col items-center justify-center space-y-6 rounded-2xl border border-border-strong bg-surface/80 backdrop-blur-xl p-8 text-center shadow-2xl"
      >
        <motion.div
          initial={{ rotate: -180, scale: 0 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ duration: 0.7, type: "spring", bounce: 0.5, delay: 0.1 }}
          className="flex size-16 items-center justify-center rounded-full bg-surface-sunken border border-border shadow-e1"
        >
          <Truck className="size-8 text-primary" />
        </motion.div>

        <div className="space-y-3">
          <h1 className="text-5xl font-black tracking-tight text-fg font-mono">404</h1>
          <h2 className="text-xl font-semibold text-fg">Dead End</h2>
          <p className="text-[0.875rem] leading-relaxed text-fg-muted px-4">
            Looks like you took a wrong turn. This route doesn't exist on our map or the load has already been dispatched.
          </p>
        </div>

        <div className="w-full pt-4">
          <Button onClick={handleReturn} variant="primary" size="lg" className="w-full group overflow-hidden relative">
            <span className="relative z-10 flex items-center justify-center">
              Reroute to safety
              <MoveRight className="ml-2 size-4 transition-transform duration-300 group-hover:translate-x-1.5" />
            </span>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
