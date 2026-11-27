import { TelegramAccountScreen } from "@/features/telegram/telegram-account-screen";

export const metadata = { title: "Notifications" };

// Drivers reach the same Telegram connection as office users (plan 29).
export default function Page() {
  return <TelegramAccountScreen />;
}
