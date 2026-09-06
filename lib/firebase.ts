import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  projectId: "gen-lang-client-0558990988",
  appId: "1:412517143083:web:40e06ef2f6abef93c3506e",
  apiKey: "AIzaSyDz8qChA3pH8yapWJQiW33aHyRM5qZV1N0",
  authDomain: "gen-lang-client-0558990988.firebaseapp.com",
  storageBucket: "gen-lang-client-0558990988.firebasestorage.app",
  messagingSenderId: "412517143083"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
// Use the specific firestoreDatabaseId if provided in the config
const db = getFirestore(app, "ai-studio-c500976a-162c-4a55-b2a9-71047e0508de");
const storage = getStorage(app);
storage.maxUploadRetryTime = 7000;
storage.maxOperationRetryTime = 7000;

const googleProvider = new GoogleAuthProvider();

export { app, auth, db, storage, googleProvider, signInWithPopup, signOut };
