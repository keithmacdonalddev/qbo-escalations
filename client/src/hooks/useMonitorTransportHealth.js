import { useEffect, useState } from 'react';
import {
  getMonitorTransportSnapshot,
  subscribeMonitorTransports,
} from '../lib/monitorTransport.js';

export function useMonitorTransportHealth() {
  const [snapshot, setSnapshot] = useState(() => getMonitorTransportSnapshot());

  useEffect(() => {
    const unsubscribe = subscribeMonitorTransports(() => {
      setSnapshot(getMonitorTransportSnapshot());
    });
    setSnapshot(getMonitorTransportSnapshot());
    return unsubscribe;
  }, []);

  return snapshot;
}
