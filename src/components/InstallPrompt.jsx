import { useEffect, useState } from "react";
import { Share, ChevronDown, PlusSquare, X } from "lucide-react";

const FOREVER_KEY = "installPromptHiddenForever";
const SNOOZE_KEY = "installPromptSnoozedUntil";
const SNOOZE_DAYS = 7;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator?.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden until checks pass

  useEffect(() => {
    if (isStandalone()) return; // already installed

    if (localStorage.getItem(FOREVER_KEY) === "true") return;
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (Date.now() < snoozedUntil) return;

    setDismissed(false);

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000));
    setDismissed(true);
  };

  const hideForever = () => {
    localStorage.setItem(FOREVER_KEY, "true");
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === "accepted") hideForever();
      else snooze();
      return;
    }
    if (isIOS()) {
      setShowIosHelp(true);
      return;
    }
    snooze();
  };

  if (dismissed || isStandalone()) return null;
  // Only show if we have a real install path (Chrome/Android prompt or iOS instructions)
  if (!deferredPrompt && !isIOS()) return null;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 p-3 sm:p-4">
      {showIosHelp ? (
        <div className="text-sm text-indigo-900 dark:text-indigo-100">
          <p className="font-semibold mb-2">Add EarlyNFL to your Home Screen</p>
          <p className="flex items-center gap-1 mb-1">
            1. Tap the Share button <Share size={14} className="inline" /> in Safari
          </p>
          <p className="flex items-center gap-1 mb-1">
            2. Tap &quot;View More&quot; <ChevronDown size={14} className="inline" />
          </p>
          <p className="flex items-center gap-1 mb-3">
            3. Tap <PlusSquare size={14} className="inline" /> &quot;Add to Home Screen&quot;
          </p>
          <button
            onClick={hideForever}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
          >
            Hide this forever
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
            Install EarlyNFL for quicker access and reminders
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Install
            </button>
            <button
              onClick={snooze}
              aria-label="Remind me later"
              title="Remind me later"
              className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-300"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
