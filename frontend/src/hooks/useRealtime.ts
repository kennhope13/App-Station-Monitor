import { useEffect, useRef } from 'react';
import { createRealtimeHub } from '@/services/realtime.service';
import { HubConnection } from '@microsoft/signalr';

interface RealtimeHandlers {
  onSensorUpdate?: (data: any[]) => void;
  onAlertNew?: (data: any) => void;
  onAlertUpdated?: (data: any) => void;
}

/** Hook quản lý vòng đời kết nối SignalR WebSocket: tự động connect khi mount, cleanup khi unmount. */
export function useRealtime(handlers: RealtimeHandlers, dependencies: any[] = []) {
  const hubRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    const hub = createRealtimeHub();
    hubRef.current = hub;

    if (handlers.onSensorUpdate) {
      hub.on('SensorUpdate', handlers.onSensorUpdate);
    }
    if (handlers.onAlertNew) {
      hub.on('AlertNew', handlers.onAlertNew);
    }
    if (handlers.onAlertUpdated) {
      hub.on('AlertUpdated', handlers.onAlertUpdated);
    }

    hub.start().catch(err => console.warn('[useRealtime] SignalR Connection Error:', err));

    return () => {
      hub.stop();
      hubRef.current = null;
    };
  }, dependencies);

  return hubRef.current;
}
