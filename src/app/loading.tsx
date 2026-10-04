import { ModernLoader } from "@/components/modern-loader";

export default function GlobalLoading() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-bg">
      <ModernLoader />
    </div>
  );
}
