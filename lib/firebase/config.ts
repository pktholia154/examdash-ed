import firebaseConfig from '@/firebase-applet-config.json';

/**
 * Existing Firestore Native database in examdash-ed (asia-south1).
 * Always connects to the existing (default) database without creating a new one.
 */
export const FIRESTORE_DATABASE_ID = '(default)' as const;

export const FIREBASE_CONFIG = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
} as const;
