import { useRouter } from "next/router";
import BottomNav from "@/components/bottomnav";

export default function Layout({ children, showBottomNav }) {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
      <main className="flex-1 px-4 pt-4 pb-20">{children}</main>
      {showBottomNav && <BottomNav />}
    </div>
  );
}
