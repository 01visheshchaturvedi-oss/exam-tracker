/**
 * AuthContext.tsx
 *
 * Provides:
 *  - Firebase email/password auth (sign-up, sign-in, sign-out, password reset)
 *  - Cross-device Firestore sync for all examrigor localStorage keys
 *
 * Data layout in Firestore:
 *   users/{uid}/keys/{keyName}  →  { value: "<JSON string>", updatedAt: serverTimestamp }
 *
 * Sync strategy:
 *  - On login  → pull all keys from Firestore → hydrate localStorage
 *  - On write  → LS.set already triggers pushToCloud() for BACKUP_KEYS
 *  - On logout → clear in-memory user; localStorage stays (local cache)
 */

import React, {
  createContext, useContext, useEffect, useState, useRef, useCallback,
} from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  doc, getDoc, setDoc, collection, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

// ── Keys that get synced to Firestore ────────────────────────────────────────
export const SYNC_KEYS = [
  'examrigor_settings',
  'examrigor_library',
  'examrigor_daily_tasks',
  'examrigor_logs',
  'examrigor_benchmarks',
  'examrigor_daily_goals',
  'examrigor_reminders',
];

// ── Types ────────────────────────────────────────────────────────────────────
interface AuthContextType {
  user: User | null;
  loading: boolean;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  pushToCloud: (key: string, value: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function keysRef(uid: string) {
  return collection(db, 'users', uid, 'keys');
}
function keyDocRef(uid: string, key: string) {
  return doc(db, 'users', uid, 'keys', key);
}

// Pull all synced keys from Firestore → write to localStorage
async function hydrateFromFirestore(uid: string): Promise<boolean> {
  try {
    const snap = await getDocs(keysRef(uid));
    if (snap.empty) return false;
    let count = 0;
    snap.forEach(d => {
      const data = d.data();
      if (data?.value) { localStorage.setItem(d.id, data.value); count++; }
    });
    return count > 0;
  } catch (e) {
    console.error('[AuthContext] hydrateFromFirestore error:', e);
    return false;
  }
}

// Push a single key to Firestore (fire-and-forget)
async function writeKeyToFirestore(uid: string, key: string, value: string) {
  try {
    await setDoc(keyDocRef(uid, key), { value, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error('[AuthContext] writeKeyToFirestore error:', e);
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]             = useState<User | null>(null);
  const [loading, setLoading]       = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle'|'syncing'|'synced'|'error'>('idle');
  const userRef                     = useRef<User | null>(null);
  const pendingWrites               = useRef<Map<string, string>>(new Map());
  const flushTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush all pending writes to Firestore (debounced)
  const flush = useCallback(async () => {
    const uid = userRef.current?.uid;
    if (!uid || pendingWrites.current.size === 0) return;
    setSyncStatus('syncing');
    const entries = Array.from(pendingWrites.current.entries());
    pendingWrites.current.clear();
    try {
      await Promise.all(entries.map(([k, v]) => writeKeyToFirestore(uid, k, v)));
      setSyncStatus('synced');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch {
      setSyncStatus('error');
    }
  }, []);

  // Enqueue a key write (debounced 2s)
  const pushToCloud = useCallback((key: string, value: string) => {
    if (!SYNC_KEYS.includes(key)) return;
    if (!userRef.current) return;
    pendingWrites.current.set(key, value);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 2000);
  }, [flush]);

  // Listen for auth state changes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      userRef.current = firebaseUser;
      setUser(firebaseUser);

      if (firebaseUser) {
        // Pull cloud data into localStorage on login
        setSyncStatus('syncing');
        const restored = await hydrateFromFirestore(firebaseUser.uid);
        setSyncStatus(restored ? 'synced' : 'idle');
        if (restored) setTimeout(() => setSyncStatus('idle'), 3000);
      }

      setLoading(false);
    });
    return () => { unsub(); if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, [flush]);

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
    // Push any existing local data to the new cloud account
    const uid = auth.currentUser?.uid;
    if (uid) {
      const writes = SYNC_KEYS.map(k => {
        const v = localStorage.getItem(k);
        return v ? writeKeyToFirestore(uid, k, v) : Promise.resolve();
      });
      await Promise.all(writes);
    }
  };

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // hydrateFromFirestore is called inside onAuthStateChanged above
  };

  const logOut = async () => {
    await flush(); // flush pending writes before logout
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, loading, syncStatus, signUp, signIn, logOut, resetPassword, pushToCloud }}>
      {children}
    </AuthContext.Provider>
  );
}
