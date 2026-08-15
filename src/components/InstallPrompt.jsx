import { useEffect, useState } from "react";
import { X, Share, PlusSquare } from "lucide-react";

const DISMISS_KEY = "installPromptDismissedUntil";
const DISMISS_DAYS = 14;

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

    const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() < dismissedUntil) return;

    setDismissed(false);

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === "accepted" || outcome === "dismissed") dismiss();
      return;
    }
    if (isIOS()) {
      setShowIosHelp(true);
      return;
    }
    dismiss();
  };

  if (dismissed || isStandalone()) return null;
  // Only show if we have a real install path (Chrome/Android prompt or iOS instructions)
  if (!deferredPrompt && !isIOS()) return null;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 p-3 sm:p-4">
      {showIosHelp ? (
        <div className="text-sm text-indigo-900 dark:text-indigo-100">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="font-semibold">Add EarlyNFL to your Home Screen</p>
            <button onClick={dismiss} aria-label="Dismiss" className="shrink-0">
              <X size={18} />
            </button>
          </div>
          <p className="flex items-center gap-1 mb-1">
            1. Tap the Share button <Share size={14} className="inline" /> in Safari
          </p>
          <p className="flex items-center gap-1">
            2. Tap <PlusSquare size={14} className="inline" /> &quot;Add to Home Screen&quot;
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
            📱 Install EarlyNFL for quicker access and reminders
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Install
            </button>
            <button onClick={dismiss} aria-label="Dismiss" className="text-indigo-500 hover:text-indigo-700">
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
