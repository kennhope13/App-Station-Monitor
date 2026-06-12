import { useEffect } from 'react';
import { getRealtimeHub, startRealtimeConnection } from '@/services/realtime.service';
import { HubConnection } from '@microsoft/signalr';

interface RealtimeHandlers {
  onSensorUpdate?: (data: any[]) => void;
  onAlertNew?: (data: any) => void;
  onAlertUpdated?: (data: any) => void;
  onDeviceStatus?: (data: any) => void;
}

/** Hook quản lý vòng đời kết nối SignalR WebSocket sử dụng kết nối singleton dùng chung. */
export function useRealtime(handlers: RealtimeHandlers, dependencies: any[] = []) {
  useEffect(() => {
    const hub = getRealtimeHub();

    const sensorHandler = handlers.onSensorUpdate;
    const alertNewHandler = handlers.onAlertNew;
    const alertUpdatedHandler = handlers.onAlertUpdated;
    const deviceStatusHandler = handlers.onDeviceStatus;

    if (sensorHandler) {
      hub.on('SensorUpdate', sensorHandler);
    }
    if (alertNewHandler) {
      hub.on('AlertNew', alertNewHandler);
    }
    if (alertUpdatedHandler) {
      hub.on('AlertUpdated', alertUpdatedHandler);
    }
    if (deviceStatusHandler) {
      hub.on('DeviceStatus', deviceStatusHandler);
    }

    startRealtimeConnection().catch(() => {});

    return () => {
      if (sensorHandler) {
        hub.off('SensorUpdate', sensorHandler);
      }
      if (alertNewHandler) {
        hub.off('AlertNew', alertNewHandler);
      }
      if (alertUpdatedHandler) {
        hub.off('AlertUpdated', alertUpdatedHandler);
      }
      if (deviceStatusHandler) {
        hub.off('DeviceStatus', deviceStatusHandler);
      }
    };
  }, dependencies);

  return getRealtimeHub();
}

