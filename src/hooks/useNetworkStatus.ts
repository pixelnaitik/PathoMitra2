/**
 * Network state for the dashboard chrome.
 *
 * Firestore is configured with a persistent local cache, so every write succeeds
 * immediately even with no connection — nothing in the UI *looks* broken while
 * the queue grows. That makes an explicit offline state worth surfacing rather
 * than leaving the user to discover it when a report never reaches the cloud.
 */
import { useEffect, useState } from 'react';
import { waitForPendingWrites, db } from '../data/fs';

export type NetworkStatus = 'online' | 'syncing' | 'offline';

function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function useNetworkStatus(): NetworkStatus {
  const [online, setOnline] = useState(readOnline);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const goOnline = () => {
      setOnline(true);
      // Reconnected: the queued writes still have to be acknowledged before the
      // app can honestly claim to be up to date.
      setSyncing(true);
      waitForPendingWrites(db)
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSyncing(false);
        });
    };
    const goOffline = () => {
      setOnline(false);
      setSyncing(false);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (!online) return 'offline';
  return syncing ? 'syncing' : 'online';
}
