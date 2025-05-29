// lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ✅ Your Firebase config here — get it from Firebase Console → Project Settings → General
const firebaseConfig = {
    apiKey: "AIzaSyBqY4QzZsxfle-OyQVVkQCGxs0VxXMKp6Y",
    authDomain: "earlynfl-c3de6.firebaseapp.com",
    projectId: "earlynfl-c3de6",
    storageBucket: "earlynfl-c3de6.firebasestorage.app",
    messagingSenderId: "812360421758",
    appId: "1:812360421758:web:9f183c9dbc31eed759232f"
  };

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
