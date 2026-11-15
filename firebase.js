import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuração do app web do Firebase (projeto machine-registration).
const firebaseConfig = {
  apiKey: "AIzaSyDeQeTEX9g1pCeTVHfXfxpTOYqZwiCseHs",
  authDomain: "machine-registration.firebaseapp.com",
  projectId: "machine-registration",
  storageBucket: "machine-registration.firebasestorage.app",
  messagingSenderId: "584291485427",
  appId: "1:584291485427:web:1202143e707570b2221986"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
