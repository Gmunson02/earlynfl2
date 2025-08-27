// hooks/useRequireProfile.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Redirects any *registered* (non-anonymous) user to /profile if any required
 * profile fields are missing/blank. Anonymous users are ignored.
 *
 * Returns "checking" | "ok" | "redirected" so the page can avoid flashing.
 */
export default function useRequireProfile({
  requiredFields = ["firstName", "lastName", "displayName"],
  redirectTo = "/profile",
} = {}) {
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | ok | redirected

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // Not logged in or anonymous? Do nothing here.
      if (!user || user.isAnonymous) {
        setStatus("ok");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? snap.data() : {};

        const missing = requiredFields.some((f) => {
          const v = data?.[f];
          return v == null || String(v).trim() === "";
        });

        const onProfile = router.pathname === "/profile";
        if (missing && !onProfile) {
          const from = encodeURIComponent(router.asPath || "/");
          router.replace(`${redirectTo}?from=${from}`);
          setStatus("redirected");
        } else {
          setStatus("ok");
        }
      } catch (e) {
        console.error("profile check failed", e);
        // Fail-open so users aren’t locked out if Firestore hiccups
        setStatus("ok");
      }
    });

    return () => unsub();
  }, [router, requiredFields, redirectTo]);

  return status;
}
