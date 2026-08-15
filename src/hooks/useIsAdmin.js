// hooks/useIsAdmin.js
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";

// Client-side convenience only — real enforcement happens in Firestore
// rules via the same "admin" custom claim.
export default function useIsAdmin() {
  const [status, setStatus] = useState("checking"); // checking | admin | not-admin

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus("not-admin");
        return;
      }
      try {
        const result = await user.getIdTokenResult();
        setStatus(result.claims?.admin === true ? "admin" : "not-admin");
      } catch {
        setStatus("not-admin");
      }
    });
    return unsub;
  }, []);

  return status;
}
