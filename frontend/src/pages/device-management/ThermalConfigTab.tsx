import React, { useEffect, useState, useRef } from 'react';
import { stationApi, RoiPoint, CameraDevice, Boundary } from '@/services/StationApiService';
import { GO2RTC_URL } from '@/utils/env';
import { confirmDialog } from '@/utils/confirm';
import { createRealtimeHub } from '@/services/realtime.service';

// ============================================================
// ThermalConfigTab — Giao diện cấu hình nhiệt (Điểm & Vùng)
// ============================================================

// Helper để sắp xếp các điểm của đa giác xoay tròn theo centroid, giúp tránh hiện tượng chéo nét
const sortPolygonPoints = (poly: [number, number][]): [number, number][] => {
  if (poly.length <= 3) return poly;
  
  // Tính tọa độ trọng tâm (centroid)
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  cx /= poly.length;
  cy /= poly.length;

  // Sắp xếp các điểm theo góc cực relative to centroid
  return [...poly].sort((a, b) => {
    const angleA = Math.atan2(a[1] - cy, a[0] - cx);
    const angleB = Math.atan2(b[1] - cy, b[0] - cx);
    return angleA - angleB;
  });
};

export function ThermalConfigPanel({ device, onBack }: { device: CameraDevice, onBack: () => void }) {
  const deviceId = device.id;

  const [points, setPoints] = useState<RoiPoint[]>([]);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time readings
  const [readings, setReadings] = useState<Record<string, number>>({});

  // Mode: Point (điểm) vs Area (vùng polygon)
  const [configMode, setConfigMode] = useState<'point' | 'area'>('point');

  // Editor State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Area drawing state
  const [activePolygon, setActivePolygon] = useState<[number, number][]>([]);
  
  // Picker State
  const [pickerMode, setPickerMode] = useState<'thermal' | 'optical'>('thermal');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  // @ts-ignore
  const [overlayOpacity, setOverlayOpacity] = useState<number>(100);
  
  // VisibleValidRect — Hikvision ISAPI trả về hình chữ nhật mô tả vùng optical tương ứng
  // với toàn bộ ảnh nhiệt. Công thức: optical = thermal_norm * vvr.width + vvr.x
  // Giá trị mặc định Hikvision dual-spectrum (bi-spectrum cameras)
  const [vvr, setVvr] = useState({ x: 0.20, y: 0.084, width: 0.63, height: 0.841 });
  // const [vvrFetching, setVvrFetching] = useState(false);

  // Draft Point Coordinates
  const [tx, setTx] = useState<string>('');
  const [ty, setTy] = useState<string>('');
  const [ox, setOx] = useState<string>('');
  const [oy, setOy] = useState<string>('');
  const [pointName, setPointName] = useState<string>('');
  const [preAlarm, setPreAlarm] = useState<string>('50');
  const [alarm, setAlarm] = useState<string>('70');

  // Continuous Mode & Drag State
  const [continuousMode, setContinuousMode] = useState<boolean>(false);
  const [roiDragState, setRoiDragState] = useState<{ pt: RoiPoint, hasMoved: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Pan & Zoom State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Real-time setup
  useEffect(() => {
    if (!deviceId) return;

    const hub = createRealtimeHub();
    hub.on('SensorUpdate', (data: any[]) => {
      if (!Array.isArray(data)) return;
      setReadings(prev => {
        const next = { ...prev };
        let hasChanges = false;
        data.forEach(item => {
          if (item.deviceId === deviceId) {
            next[item.pointId] = item.value;
            hasChanges = true;
          }
        });
        return hasChanges ? next : prev;
      });
    });

    hub.start().catch(console.error);

    // Initial fetch of latest readings
    stationApi.getLatestPoints().then(data => {
      const initial: Record<string, number> = {};
      data.forEach(r => {
        if (r.deviceId === deviceId) initial[r.pointId] = r.value;
      });
      setReadings(initial);
    }).catch(console.error);

    return () => { hub.stop(); };
  }, [deviceId]);

  // Xử lý kéo bằng nút giữa (nút lăn)
  const handlePanMouseDown = (e: React.MouseEvent) => {
    // 1: Middle button (nút lăn)
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePanMouseMove = (e: React.MouseEvent) => {
    // Phải gọi handler drag điểm nếu đang kéo điểm
    if (roiDragState) {
      handleContainerMouseMove(e);
      return;
    }

    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePanMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (roiDragState) {
      handleContainerMouseUp();
    }
  };



  // ─── Calibration key per device ───────────────────────────────────────────
  const calibKey = `roi_calib_${deviceId}`;

  // Load VVR from localStorage when device changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(calibKey);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.x === 'number') setVvr({ x: p.x, y: p.y, width: p.width, height: p.height });
      }
    } catch {}
  }, [calibKey]);

  /** Công thức Hikvision: thermal_norm → optical_norm */
  const thermalToOptical = (normTx: number, normTy: number) => ({
    ox: Math.max(0, Math.min(1, normTx * vvr.width + vvr.x)),
    oy: Math.max(0, Math.min(1, normTy * vvr.height + vvr.y)),
  });

  /** Công thức ngược: optical_norm → thermal_norm */
  const opticalToThermal = (normOx: number, normOy: number) => ({
    tx: Math.max(0, Math.min(1, (normOx - vvr.x) / vvr.width)),
    ty: Math.max(0, Math.min(1, (normOy - vvr.y) / vvr.height)),
  });

  /*
  // Lưu VVR vào localStorage và Database để làm mặc định vĩnh viễn
  const saveCalibration = async () => {
    try {
      // 1. Lưu vào localStorage cho trình duyệt hiện tại
      localStorage.setItem(calibKey, JSON.stringify(vvr));

      // 2. Lưu vào DB để làm mặc định cho thiết bị (cho mọi người dùng và các điểm về sau)
      const currentConfig = device.config as any || {};
      const updatedConfig = { 
        ...currentConfig, 
        visible_valid_rect: vvr 
      };
      
      await stationApi.updateDevice(deviceId!, {
        config: JSON.stringify(updatedConfig)
      });

      alert(`Đã lưu cấu hình đồng bộ thành công!\nTừ giờ các điểm mới sẽ tự động sử dụng thông số này.`);
    } catch (e) {
      console.error("Lỗi saveCalibration:", e);
      alert('Không thể lưu cấu hình mặc định vào máy chủ. Vui lòng thử lại.');
    }
  };

  // Tự động lấy VisibleValidRect từ camera qua backend và lưu làm mặc định
  const fetchVvrFromCamera = async () => {
    if (!deviceId) return;
    setVvrFetching(true);
    try {
      // Gọi backend để lấy trực tiếp từ camera Hikvision
      const result = await stationApi.getThermalMapping(deviceId);
      
      if (result && typeof result.x === 'number') {
        setVvr(result);
        
        // Lưu vào localStorage cho trình duyệt hiện tại
        localStorage.setItem(calibKey, JSON.stringify(result));

        // Cập nhật vào DB để làm mặc định cho thiết bị (cho mọi người dùng khác)
        const currentConfig = device.config as any || {};
        const updatedConfig = { 
          ...currentConfig, 
          visible_valid_rect: result 
        };
        
        await stationApi.updateDevice(deviceId, {
          config: JSON.stringify(updatedConfig)
        });

        alert(`Đã lấy và lưu thông số mặc định thành công!\nx=${result.x.toFixed(4)}, y=${result.y.toFixed(4)}, w=${result.width.toFixed(4)}, h=${result.height.toFixed(4)}`);
      } else {
        alert('Camera không trả về thông số VisibleValidRect. Vui lòng kiểm tra model camera hoặc nhập thủ công.');
      }
    } catch (e) {
      console.error("Lỗi fetchVvrFromCamera:", e);
      alert('Không thể kết nối tới camera để lấy thông số. Vui lòng nhập thủ công hoặc kiểm tra cấu hình mạng.');
    } finally {
      setVvrFetching(false);
    }
  };

  // Tính lại và lưu ox/oy cho TẤT CẢ điểm hiện có
  const applyCalibrationToAll = async () => {
    if (points.length === 0) { alert('Chưa có điểm nào.'); return; }
    const ok = window.confirm(
      `Áp dụng VisibleValidRect cho tất cả ${points.length} điểm?\n` +
      `x=${vvr.x.toFixed(3)} y=${vvr.y.toFixed(3)} w=${vvr.width.toFixed(3)} h=${vvr.height.toFixed(3)}`
    );
    if (!ok) return;
    setLoading(true);
    try {
      await Promise.all(points.map(pt => {
        const txVal = pt.tx !== undefined && pt.tx !== null ? pt.tx : (pt.x ?? 0) / 100;
        const tyVal = pt.ty !== undefined && pt.ty !== null ? pt.ty : (pt.y ?? 0) / 100;
        const { ox: newOx, oy: newOy } = thermalToOptical(txVal, tyVal);
        return stationApi.updateRoiPoint(deviceId!, pt.id, {
          label: pt.label || pt.name,
          tx: txVal, ty: tyVal, ox: newOx, oy: newOy,
          alarmThreshold: pt.alarmThreshold, warningThreshold: pt.warningThreshold,
        });
      }));
      await loadData();
      alert(`Đã cập nhật optical cho ${points.length} điểm!`);
    } catch (err) {
      alert('Lỗi: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };
  */

  /** Dùng một điểm có sẵn làm chuẩn để hiệu chỉnh VVR và cập nhật tất cả điểm khác */
  // @ts-ignore
  const setPointAsCalibrationAnchor = async (pt: RoiPoint) => {
    const txVal = pt.tx !== undefined && pt.tx !== null ? pt.tx : (pt.x ?? 0) / 100;
    const tyVal = pt.ty !== undefined && pt.ty !== null ? pt.ty : (pt.y ?? 0) / 100;
    const oxVal = pt.ox !== undefined && pt.ox !== null ? pt.ox : txVal;
    const oyVal = pt.oy !== undefined && pt.oy !== null ? pt.oy : tyVal;

    // Tính ngược VVR x, y từ: ox = tx * width + x => x = ox - tx * width
    const newX = oxVal - txVal * vvr.width;
    const newY = oyVal - tyVal * vvr.height;

    const newVvr = {
      ...vvr,
      x: parseFloat(newX.toFixed(4)),
      y: parseFloat(newY.toFixed(4))
    };

    const ok = window.confirm(
      `Sử dụng điểm "${pt.label || pt.name}" làm điểm chuẩn?\n` +
      `Hệ thống sẽ cập nhật VisibleValidRect mới:\n` +
      `x=${newVvr.x.toFixed(4)}, y=${newVvr.y.toFixed(4)}\n` +
      `và đồng bộ lại tọa độ của tất cả ${points.length} điểm khác.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      // 1. Lưu vào state & localStorage
      setVvr(newVvr);
      localStorage.setItem(calibKey, JSON.stringify(newVvr));

      // 2. Lưu cấu hình camera vào DB
      const currentConfig = device.config as any || {};
      const updatedConfig = { 
        ...currentConfig, 
        visible_valid_rect: newVvr 
      };
      await stationApi.updateDevice(deviceId!, {
        config: JSON.stringify(updatedConfig)
      });

      // 3. Đồng bộ hóa ox/oy của tất cả các điểm theo VVR mới
      await Promise.all(points.map(p => {
        const pTx = p.tx !== undefined && p.tx !== null ? p.tx : (p.x ?? 0) / 100;
        const pTy = p.ty !== undefined && p.ty !== null ? p.ty : (p.y ?? 0) / 100;
        
        // Nếu là điểm chuẩn hiện tại, giữ nguyên ox, oy thực tế mà người dùng đã chấm
        const isCurrent = p.id === pt.id;
        const newOx = isCurrent ? oxVal : Math.max(0, Math.min(1, pTx * newVvr.width + newVvr.x));
        const newOy = isCurrent ? oyVal : Math.max(0, Math.min(1, pTy * newVvr.height + newVvr.y));

        return stationApi.updateRoiPoint(deviceId!, p.id, {
          label: p.label || p.name,
          tx: pTx, ty: pTy, ox: newOx, oy: newOy,
          alarmThreshold: p.alarmThreshold, warningThreshold: p.warningThreshold,
        });
      }));

      await loadData();
      alert(`Đã hiệu chỉnh và đồng bộ thành công theo điểm chuẩn "${pt.label || pt.name}"!`);
    } catch (err) {
      console.error(err);
      alert('Lỗi hiệu chỉnh điểm chuẩn: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pts, bnds] = await Promise.all([
        stationApi.getRoiPoints(deviceId),
        stationApi.getBoundaries(deviceId, 'roi')
      ]);
      setPoints(pts);
      setBoundaries(bnds);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!deviceId) return;
    loadData();
  }, [deviceId]);

  // Update optical draft coordinate in real-time when vvr changes
  useEffect(() => {
    if (isEditing && tx && ty) {
      const { ox: calcOx, oy: calcOy } = thermalToOptical(parseFloat(tx), parseFloat(ty));
      setOx(calcOx.toFixed(4));
      setOy(calcOy.toFixed(4));
    }
  }, [vvr, tx, ty, isEditing]);

  const activeX = pickerMode === 'thermal' ? parseFloat(tx) : parseFloat(ox);
  const activeY = pickerMode === 'thermal' ? parseFloat(ty) : parseFloat(oy);
  const showDot = !isNaN(activeX) && !isNaN(activeY) && activeX >= 0 && activeY >= 0;

  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wrapperRef.current) return;
    
    // In Area mode, clicking adds a vertex to the polygon only if actively editing
    if (configMode === 'area') {
      if (!isEditing) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      let nx = (e.clientX - rect.left) / rect.width;
      let ny = (e.clientY - rect.top) / rect.height;
      nx = Math.max(0, Math.min(1, nx));
      ny = Math.max(0, Math.min(1, ny));
      
      setActivePolygon(prev => [...prev, [nx, ny]]);
      return;
    }

    // Only allow coordinate selection if in editing mode OR continuous mode is active
    if (!isEditing && !continuousMode) {
      return;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    
    let nx = (e.clientX - rect.left) / rect.width;
    let ny = (e.clientY - rect.top) / rect.height;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));

    const sx = nx.toFixed(4);
    const sy = ny.toFixed(4);

    if (continuousMode && deviceId) {
      const nextIndex = points.length + 1;
      const defaultLabel = `Điểm đo ${nextIndex}`;
      
      // Lưu ox/oy đã tính qua VVR Hikvision
      try {
        const { ox: calcOx2, oy: calcOy2 } = thermalToOptical(nx, ny);
        const payload: any = {
          label: defaultLabel, alarmThreshold: 80, warningThreshold: 60,
          x: nx * 100, y: ny * 100, tx: nx, ty: ny, ox: calcOx2, oy: calcOy2,
        };
        await stationApi.createRoiPoint(deviceId, payload);
        await loadData();
      } catch (err) {
        console.error("Lỗi thêm nhanh điểm đo:", err);
      }
      return;
    }

    if (pickerMode === 'thermal') {
      setTx(sx);
      setTy(sy);
      // Tự động tính optical theo công thức VisibleValidRect Hikvision
      const { ox: calcOx, oy: calcOy } = thermalToOptical(nx, ny);
      setOx(calcOx.toFixed(4));
      setOy(calcOy.toFixed(4));
    } else {
      setOx(sx);
      setOy(sy);
      // Cập nhật VVR từ click optical (nếu thermal đã có)
      if (tx && ty) {
        const txf = parseFloat(tx);
        const tyf = parseFloat(ty);
        // Tính ngược VVR từ: optical = thermal * width + x
        // Nếu cơsở scale không đổi, chỉ cập nhật offset
        const newX = nx - txf * vvr.width;
        const newY = ny - tyf * vvr.height;
        setVvr(prev => ({ ...prev, x: parseFloat(newX.toFixed(4)), y: parseFloat(newY.toFixed(4)) }));
      }
    }
  };

  const handlePointMouseDown = (e: React.MouseEvent, pt: RoiPoint) => {
    e.stopPropagation();
    setRoiDragState({ pt, hasMoved: false });
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (!roiDragState || !deviceId) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    let nx = (e.clientX - rect.left) / rect.width;
    let ny = (e.clientY - rect.top) / rect.height;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));

    setPoints(prev => prev.map(p => {
      if (p.id === roiDragState.pt.id) {
        if (pickerMode === 'thermal') {
          const { ox: calcOx, oy: calcOy } = thermalToOptical(nx, ny);
          return { ...p, tx: nx, ty: ny, ox: calcOx, oy: calcOy, x: nx * 100, y: ny * 100 };
        } else {
          const { tx: calcTx, ty: calcTy } = opticalToThermal(nx, ny);
          return { ...p, ox: nx, oy: ny, tx: calcTx, ty: calcTy, x: calcTx * 100, y: calcTy * 100 };
        }
      }
      return p;
    }));
    setRoiDragState(prev => prev ? { ...prev, hasMoved: true } : null);
  };

  const handleContainerMouseUp = async () => {
    if (!roiDragState) return;
    const ptToSave = points.find(p => p.id === roiDragState.pt.id);
    const moved = roiDragState.hasMoved;
    setRoiDragState(null);

    if (!moved) {
      if (ptToSave) openEditor(ptToSave);
      return;
    }

    if (!ptToSave || !deviceId) return;
    try {
      const payload: Partial<Omit<RoiPoint, 'id'>> = {
        label: ptToSave.label || ptToSave.name,
        tx: ptToSave.tx,
        ty: ptToSave.ty,
        ox: ptToSave.ox,
        oy: ptToSave.oy,
        alarmThreshold: ptToSave.alarmThreshold,
        warningThreshold: ptToSave.warningThreshold,
      };
      await stationApi.updateRoiPoint(deviceId, ptToSave.id, payload);
    } catch (err) {
      console.error('Lỗi khi kéo thả lưu điểm', err);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();

    // Mouse coordinates relative to the inner wrapper
    const mouseXOnWrapper = e.clientX - wrapperRect.left;
    const mouseYOnWrapper = e.clientY - wrapperRect.top;

    // Percentages on the inner wrapper
    const percentageX = mouseXOnWrapper / wrapperRect.width;
    const percentageY = mouseYOnWrapper / wrapperRect.height;

    // Calculate new zoom level
    const oldZoom = zoomLevel;
    const zoomStep = 10;
    let newZoom = oldZoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(300, oldZoom + zoomStep);
    } else {
      newZoom = Math.max(50, oldZoom - zoomStep);
    }

    if (newZoom === oldZoom) return;

    // Apply the zoom update
    setZoomLevel(newZoom);

    // Calculate actual pixel width/height changes
    const newWidth = wrapperRect.width * (newZoom / oldZoom);
    const newHeight = wrapperRect.height * (newZoom / oldZoom);

    const deltaScrollLeft = percentageX * (newWidth - wrapperRect.width);
    const deltaScrollTop = percentageY * (newHeight - wrapperRect.height);

    // Schedule scroll adjustments in next frame after React re-renders the wrapper sizing
    requestAnimationFrame(() => {
      container.scrollLeft += deltaScrollLeft;
      container.scrollTop += deltaScrollTop;
    });
  };

  const openAreaEditor = (b?: Boundary) => {
    if (b) {
      setEditingId(b.id);
      setPointName(b.name);
      try {
        setActivePolygon(JSON.parse(b.polygon));
      } catch { setActivePolygon([]); }
      
      const thresholds = b.thresholds ? JSON.parse(b.thresholds) : {};
      setPreAlarm((thresholds.warning || 50).toString());
      setAlarm((thresholds.alarm || 70).toString());
    } else {
      setEditingId(null);
      setPointName(`Vùng ${boundaries.length + 1}`);
      setPreAlarm('50');
      setAlarm('70');
      // activePolygon already set by clicks
    }
    setIsEditing(true);
  };

  useEffect(() => {
    // Tự động chuyển sang form nhập liệu khi vẽ đủ 4 điểm
    if (configMode === 'area' && activePolygon.length === 4 && !isEditing) {
      openAreaEditor();
    }
  }, [activePolygon, configMode, isEditing]);

  const syncWithAi = async () => {
    try {
      // Re-fetch current state to ensure we send latest to AI
      const [pts, bnds] = await Promise.all([
        stationApi.getRoiPoints(deviceId),
        stationApi.getBoundaries(deviceId, 'roi')
      ]);
      await stationApi.syncThermalConfig(deviceId, pts, bnds);
    } catch (err) {
      console.warn("Failed to sync with AI Engine:", err);
    }
  };

  const saveArea = async () => {
    if (!pointName) { alert('Vui lòng nhập tên vùng'); return; }
    if (activePolygon.length < 3) { alert('Vùng phải có ít nhất 3 điểm'); return; }
    if (!await confirmDialog({
      title: 'Lưu vùng nhiệt',
      message: `Xác nhận lưu vùng nhiệt "${pointName}"?`,
      confirmText: 'Lưu lại',
      cancelText: 'Hủy'
    })) return;

    const payload: Partial<Boundary> = {
      name: pointName,
      type: 'roi',
      polygon: JSON.stringify(sortPolygonPoints(activePolygon)),
      thresholds: JSON.stringify({
        warning: parseFloat(preAlarm) || 50,
        alarm: parseFloat(alarm) || 70
      }),
      severityLevel: 'warning',
      enabled: true
    };

    try {
      if (editingId) {
        await stationApi.updateBoundary(editingId, payload);
      } else {
        await stationApi.createBoundary(deviceId!, payload);
      }
      setIsEditing(false);
      setActivePolygon([]);
      await loadData();
      await syncWithAi();
      onBack();
    } catch (err) {
      alert('Lỗi lưu vùng');
    }
  };

  const deleteArea = async (id: string) => {
    if (!await confirmDialog({
      title: 'Xóa vùng nhiệt',
      message: 'Xác nhận xóa vùng nhiệt này?',
      confirmText: 'Xóa vùng',
      cancelText: 'Hủy',
      danger: true
    })) return;
    try {
      await stationApi.deleteBoundary(id);
      await loadData();
      await syncWithAi();
    } catch (err) {
      alert('Lỗi xóa vùng');
    }
  };

  const openEditor = (pt?: RoiPoint) => {
    if (pt) {
      setEditingId(pt.id);
      setPointName(pt.name || pt.label || '');
      setTx((pt.tx ?? 0).toFixed(4));
      setTy((pt.ty ?? 0).toFixed(4));
      setOx((pt.ox ?? 0).toFixed(4));
      setOy((pt.oy ?? 0).toFixed(4));
      setPreAlarm((pt.warningThreshold ?? pt.preAlarmThreshold ?? 50).toString());
      setAlarm((pt.alarmThreshold ?? 70).toString());
    } else {
      setEditingId(null);
      setPointName(`Điểm ${points.length + 1}`);
      setTx(''); setTy(''); setOx(''); setOy('');
      setPreAlarm('50'); setAlarm('70');
    }
    setIsEditing(true);
    setPickerMode('thermal');
  };

  const savePoint = async () => {
    if (!pointName) { alert('Vui lòng nhập tên điểm'); return; }
    if (!await confirmDialog({
      title: 'Lưu điểm nhiệt',
      message: `Xác nhận lưu điểm nhiệt "${pointName}"?`,
      confirmText: 'Lưu lại',
      cancelText: 'Hủy'
    })) return;
    
    let ftx = parseFloat(tx);
    let fty = parseFloat(ty);
    let fox = parseFloat(ox);
    let foy = parseFloat(oy);

    // Fallback if one is missing
    if (isNaN(ftx) && !isNaN(fox)) ftx = fox;
    if (isNaN(fty) && !isNaN(foy)) fty = foy;
    if (isNaN(fox) && !isNaN(ftx)) fox = ftx;
    if (isNaN(foy) && !isNaN(fty)) foy = fty;

    if (isNaN(ftx) || isNaN(fty)) {
      alert('Vui lòng click vào ảnh để chọn tọa độ');
      return;
    }

    const payload = {
      label: pointName,
      name: pointName,
      tx: ftx, ty: fty,
      ox: fox, oy: foy,
      x: ftx * 100,
      y: fty * 100,
      warningThreshold: parseFloat(preAlarm) || 50,
      alarmThreshold: parseFloat(alarm) || 70
    };

    try {
      if (editingId) {
        await stationApi.updateRoiPoint(deviceId!, editingId, payload);
      } else {
        await stationApi.createRoiPoint(deviceId!, payload);
      }
      setIsEditing(false);
      await loadData();
      await syncWithAi();
      onBack();
    } catch (err) {
      alert('Lỗi lưu điểm');
    }
  };

  const confirmDelete = async (id: string) => {
    setDeletingId(null);
    try {
      console.log('Deleting ROI Point:', id, 'for device:', deviceId);
      await stationApi.deleteRoiPoint(deviceId!, id);
      console.log('Deleted successfully. Reloading data...');
      await loadData();
      await syncWithAi();
    } catch (err) {
      console.error('Delete point error:', err);
      alert('Lỗi kết nối/Xóa thất bại: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleTabSwitch = async (mode: 'point' | 'area') => {
    if (configMode === mode) return;
    if (isEditing) {
      const typeStr = configMode === 'point' ? 'Điểm nhiệt' : 'Vùng nhiệt';
      if (!await confirmDialog({
        title: 'Thay đổi chưa lưu',
        message: `${typeStr} đang được tạo/sửa chưa lưu lại. Bạn có chắc muốn chuyển tab và hủy bỏ các thay đổi này không?`,
        confirmText: 'Chuyển tab (Hủy)',
        cancelText: 'Quay lại',
        danger: true
      })) return;
    }
    setConfigMode(mode);
    setIsEditing(false);
    setActivePolygon([]);
    setEditingId(null);
    setTx(''); setTy(''); setOx(''); setOy(''); // Clear point editing coordinate dots!
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--admin-text)' }}>Đang tải...</div>;
  if (!device) return <div style={{ padding: 24, color: 'var(--admin-text)' }}>Không tìm thấy thiết bị</div>;

  const cfg = device.config || {};
  
  // Use go2rtc stream. For thermal/optical separation, we use the respective go2rtc IDs.
  let streamSrc = '';
  if (pickerMode === 'thermal' && cfg.go2rtc_thermal) streamSrc = cfg.go2rtc_thermal;
  else if (pickerMode === 'optical' && cfg.go2rtc_optical) streamSrc = cfg.go2rtc_optical;
  else streamSrc = cfg.go2rtc_id || '';

  const streamUrl = streamSrc ? `${GO2RTC_URL}/api/stream.mp4?src=${encodeURIComponent(streamSrc)}` : '';

  const roiColor = (pt: RoiPoint) => {
    if (pt.alarmThreshold && pt.alarmThreshold < 60) return 'var(--admin-danger)';
    if (pt.warningThreshold && pt.warningThreshold < 50) return 'var(--admin-warning)';
    return 'var(--admin-accent)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 0, flex: 1, background: 'var(--admin-bg)' }}>
      {/* Standard Modal Header */}
      <div className="modal-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800 }}>
          CẤU HÌNH NHIỆT
          <span style={{ fontSize: '.7rem', background: 'var(--admin-layer-3)', padding: '2px 8px', border: '1px solid var(--admin-border)', color: 'var(--admin-accent)' }}>

            {device.name}
          </span>
        </h3>
        <button className="modal-close-btn" onClick={onBack}>✕</button>
      </div>

      {/* Standard Modal Body split inside */}
      <div className="modal-body" style={{ flex: 1, display: 'flex', flexDirection: 'row', gap: 20, overflow: 'hidden', padding: '20px 24px', minHeight: 0 }}>
        
        {/* LEFT COLUMN: Camera stream canvas & control toolbar */}
        <div 
          style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', overflow: 'hidden' }}
        >

          {/* Native industrial toolbar */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', display: 'flex', alignItems: 'center', gap: 16, zIndex: 10, flexWrap: 'wrap' }}>
            {/* Mode toggle: Point vs Area */}
            <div style={{ display: 'flex', background: 'var(--admin-layer-2)', padding: 2, borderRadius: 4, border: '1px solid var(--admin-border)' }}>
              <button 
                className={`btn-industrial btn-sm ${configMode === 'point' ? 'btn-primary' : ''}`}
                style={{ height: 26, fontSize: '.65rem', border: 'none' }}
                onClick={() => handleTabSwitch('point')}
              >
                Điểm nhiệt
              </button>
              <button 
                className={`btn-industrial btn-sm ${configMode === 'area' ? 'btn-primary' : ''}`}
                style={{ height: 26, fontSize: '.65rem', border: 'none' }}
                onClick={() => handleTabSwitch('area')}
              >
                Vùng nhiệt
              </button>
            </div>

            {/* Thermal / Optical toggle */}
            <div style={{ display: 'flex', background: 'var(--admin-layer-2)', padding: 2, borderRadius: 4, border: '1px solid var(--admin-border)' }}>
              <button 
                className={`btn-industrial btn-sm ${pickerMode === 'thermal' ? 'btn-primary' : ''}`}
                style={{ height: 26, fontSize: '.65rem', border: 'none' }}
                onClick={() => setPickerMode('thermal')}
              >
                Ảnh nhiệt
              </button>
              <button 
                className={`btn-industrial btn-sm ${pickerMode === 'optical' ? 'btn-primary' : ''}`}
                style={{ height: 26, fontSize: '.65rem', border: 'none' }}
                onClick={() => setPickerMode('optical')}
              >
                Ảnh quang
              </button>
            </div>

            {/* Area drawing actions */}
            {configMode === 'area' && activePolygon.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-industrial btn-sm" onClick={() => setActivePolygon([])}>Xóa vẽ</button>
              </div>
            )}

            {loading && <span style={{ color: 'var(--admin-text-muted)', fontSize: '11px' }}>⏳ Đang tải...</span>}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <label className="checkbox-label" style={{ fontWeight: 700, fontSize: '.75rem' }}>
                <input type="checkbox" checked={continuousMode} onChange={(e) => setContinuousMode(e.target.checked)} style={{ cursor: 'pointer' }} />
                Chấm nhanh liên tục
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.75rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                <span>Zoom:</span>
                <input type="range" min="50" max="500" step="10" value={zoomLevel} onChange={(e) => setZoomLevel(parseInt(e.target.value))} style={{ width: 80, cursor: 'pointer', accentColor: 'var(--admin-accent)' }} />
                <span style={{ color: 'var(--admin-text)', minWidth: 32, textAlign: 'right' }}>{zoomLevel}%</span>
              </div>
            </div>
          </div>

          {/* Camera Viewport Canvas */}
          <div
            ref={containerRef}
            style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', background: '#000' }}
            onWheel={handleWheel}
            onMouseMove={handlePanMouseMove}
            onMouseUp={handlePanMouseUp}
            onMouseLeave={handlePanMouseUp}
            onMouseDown={handlePanMouseDown}
          >
            <div
              ref={wrapperRef}
              onClick={handleImageClick}
              style={{
                position: 'relative',
                width: `${zoomLevel}%`,
                aspectRatio: '16/9',
                margin: 'auto',
                cursor: isPanning ? 'grabbing' : (isEditing || continuousMode) ? 'crosshair' : 'default',
                flexShrink: 0,
                background: '#000',
                overflow: 'hidden',
                border: '1px solid var(--admin-border)',
                transform: `translate(${pan.x}px, ${pan.y}px)`
              }}
            >
              {streamUrl ? (
                <iframe
                  src={`/camera-stream.html?src=${encodeURIComponent(streamSrc)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`}
                  allow="autoplay; camera; microphone"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    opacity: overlayOpacity / 100,
                    pointerEvents: 'none'
                  }}
                />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '0.75rem', opacity: 0.3, userSelect: 'none', pointerEvents: 'none' }}>
                  📷 Frame Camera — {device.name}
                </div>
              )}

              {/* Standard SVG Overlay mapping */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
                {/* Nested SVG with viewBox for relative coordinate scaling of shapes */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                >
                  {/* Existing Boundaries (Regions) */}
                  {boundaries.map((b) => {
                    let poly: [number, number][] = [];
                    try {
                      poly = JSON.parse(b.polygon);
                    } catch (e) { console.error("Invalid polygon JSON", b.polygon); }
                    
                    const pointsStr = poly.map(p => `${p[0] * 100},${p[1] * 100}`).join(' ');
                    return (
                      <polygon 
                        key={b.id}
                        points={pointsStr} 
                        fill="none"
                        stroke="var(--admin-accent)"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        opacity={0.9}
                      />
                    );
                  })}

                  {/* Active drawing polygon shapes */}
                  {activePolygon.length > 0 && (
                    <g>
                      {activePolygon.length === 2 && activePolygon[0] && activePolygon[1] ? (
                        <line
                          x1={activePolygon[0][0] * 100}
                          y1={activePolygon[0][1] * 100}
                          x2={activePolygon[1][0] * 100}
                          y2={activePolygon[1][1] * 100}
                          stroke="var(--admin-warning)"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          strokeDasharray="5 3"
                        />
                      ) : activePolygon.length > 2 ? (
                        <polygon 
                          points={sortPolygonPoints(activePolygon).map(p => `${p[0] * 100},${p[1] * 100}`).join(' ')} 
                          fill="rgba(245, 158, 11, 0.15)"
                          stroke="var(--admin-warning)"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          strokeDasharray="5 3"
                        />
                      ) : null}
                    </g>
                  )}
                </svg>

                {/* Labels for Existing Boundaries */}
                {boundaries.map((b) => {
                  let poly: [number, number][] = [];
                  try {
                    poly = JSON.parse(b.polygon);
                  } catch (e) { return null; }
                  if (poly.length === 0 || !poly[0]) return null;

                  const lookupId = b.id.toLowerCase();
                  const temp = readings[lookupId] ?? readings[b.id] ?? readings[b.name] ?? readings[b.name.toLowerCase()];
                  let color = 'var(--admin-accent)';
                  if (temp !== undefined && b.thresholds) {
                    try {
                      const t = JSON.parse(b.thresholds);
                      if (temp >= (t.alarm || 70)) color = 'var(--admin-danger)';
                      else if (temp >= (t.warning || 50)) color = 'var(--admin-warning)';
                    } catch {}
                  }

                  return (
                    <text 
                      key={`label-${b.id}`}
                      x={`${poly[0][0] * 100}%`} 
                      y={`${poly[0][1] * 100}%`} 
                      dy={-10}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight="bold"
                      style={{ fill: color, paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 3 }}
                    >
                      {b.name} {temp !== undefined ? `[${temp.toFixed(1)}°C]` : ''}
                    </text>
                  );
                })}

                {/* Active drawing vertices (orange circles) */}
                {sortPolygonPoints(activePolygon).map((p, i) => (
                  <circle 
                    key={`active-vertex-${i}`} 
                    cx={`${p[0] * 100}%`} 
                    cy={`${p[1] * 100}%`} 
                    r={4} 
                    fill="var(--admin-warning)" 
                  />
                ))}

                {points.map((pt) => {
                  const txVal = pt.tx !== undefined && pt.tx !== null ? pt.tx : (pt.x !== undefined && pt.x !== null ? pt.x / 100 : 0);
                  const tyVal = pt.ty !== undefined && pt.ty !== null ? pt.ty : (pt.y !== undefined && pt.y !== null ? pt.y / 100 : 0);
                  
                  let rx = txVal;
                  let ry = tyVal;

                  if (pickerMode === 'thermal') {
                    rx = txVal;
                    ry = tyVal;
                  } else {
                    const oxVal = pt.ox !== undefined && pt.ox !== null ? pt.ox : txVal;
                    const oyVal = pt.oy !== undefined && pt.oy !== null ? pt.oy : tyVal;

                    // Nếu ox/oy chưa lưu riêng (bằng tx/ty), áp dụng công thức VVR Hikvision
                    if (Math.abs(oxVal - txVal) < 0.0001 && Math.abs(oyVal - tyVal) < 0.0001) {
                      const { ox: calcOx, oy: calcOy } = thermalToOptical(txVal, tyVal);
                      rx = calcOx;
                      ry = calcOy;
                    } else {
                      rx = oxVal;
                      ry = oyVal;
                    }
                  }
                  
                  const px = rx * 100;
                  const py = ry * 100;

                  const lookupId = (pt.pointId || pt.label || pt.name || '').toLowerCase();
                  const temp = readings[lookupId] ?? readings[pt.pointId || ''] ?? readings[pt.label || ''] ?? readings[pt.name || ''];
                  
                  let color = roiColor(pt);
                  if (temp !== undefined) {
                    if (temp >= (pt.alarmThreshold || 70)) color = 'var(--admin-danger)';
                    else if (temp >= (pt.warningThreshold || 50)) color = 'var(--admin-warning)';
                  }

                  return (
                    <g 
                      key={pt.id} 
                      style={{ cursor: roiDragState?.pt.id === pt.id ? 'grabbing' : 'grab', pointerEvents: 'auto' }} 
                      onMouseDown={(e) => handlePointMouseDown(e, pt)}
                    >
                      <circle 
                        cx={`${px}%`} 
                        cy={`${py}%`} 
                        r={8}
                        fill={color} 
                        opacity={0.85}
                        stroke="white" 
                        strokeWidth={1.5} 
                      />
                      <text 
                        x={`${px}%`} 
                        y={`${py}%`} 
                        dy={-16} 
                        textAnchor="middle"
                        fontSize={12} 
                        fontWeight="bold"
                        style={{ fontFamily: 'Consolas, monospace', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 4, fill: '#fff' }}
                      >
                        {pt.label || pt.name} {temp !== undefined ? `[${temp.toFixed(1)}°C]` : ''}
                      </text>
                    </g>
                  );
                })}

                {/* Unsaved draft point dot */}
                {showDot && (
                  <circle 
                    cx={`${activeX * 100}%`} 
                    cy={`${activeY * 100}%`} 
                    r={8}
                    fill="var(--admin-danger)" 
                    opacity={0.8}
                    stroke="white" 
                    strokeWidth={1.5} 
                    strokeDasharray="3 2" 
                  />
                )}
              </svg>

            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Point List and Configuration Form */}
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--admin-border)', paddingLeft: 20, height: '100%', minWidth: 0 }}>
          
          {/* Edit form */}
          {isEditing && (
            <div style={{ padding: '0 0 16px 0', borderBottom: '1px solid var(--admin-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: '.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--admin-accent)', letterSpacing: '.8px' }}>
                {configMode === 'area' 
                  ? (editingId ? '✎ Chỉnh sửa vùng' : '⊕ Vùng mới')
                  : (editingId ? '✎ Chỉnh sửa điểm' : '⊕ Điểm mới')}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '.68rem', fontWeight: 800 }}>Nhãn *</label>
                <input 
                  className="form-input" 
                  placeholder={configMode === 'area' ? "VD: Vùng máy biến áp" : "VD: Đầu cáp Pha A"}
                  value={pointName} 
                  onChange={e => setPointName(e.target.value)} 
                />
              </div>

              {/* Calibration controls removed - using standard anchor #2 */}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ color: 'var(--admin-warning)', fontSize: '.68rem', whiteSpace: 'nowrap' }}>Ngưỡng vàng (°C)</label>
                  <input 
                    className="form-input" 
                    type="number"
                    style={{ width: '100%' }}
                    value={preAlarm} 
                    onChange={e => setPreAlarm(e.target.value)} 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ color: 'var(--admin-danger)', fontSize: '.68rem', whiteSpace: 'nowrap' }}>Ngưỡng đỏ (°C)</label>
                  <input 
                    className="form-input" 
                    type="number"
                    style={{ width: '100%' }}
                    value={alarm} 
                    onChange={e => setAlarm(e.target.value)} 
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn-industrial" style={{ flex: 1, height: 34 }} onClick={() => { setIsEditing(false); if (!editingId) setActivePolygon([]); }}>Hủy</button>
                <button 
                  className="btn-industrial btn-primary" 
                  style={{ flex: 1, height: 34 }}
                  onClick={configMode === 'area' ? saveArea : savePoint} 
                  disabled={!pointName.trim()}
                >
                  Lưu {configMode === 'area' ? 'vùng' : 'điểm'}
                </button>
              </div>
            </div>
          )}

          {/* Sidebar Header list title */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--admin-border)', fontSize: '.72rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {configMode === 'area' ? `Danh sách vùng nhiệt (${boundaries.length})` : `Danh sách điểm nhiệt (${points.length})`}
            </span>
            {!isEditing && (
              <button 
                onClick={() => {
                  if (configMode === 'point') {
                    openEditor();
                  } else {
                    setActivePolygon([]);
                    openAreaEditor();
                  }
                }} 
                className="btn-industrial btn-sm btn-primary"
              >
                + Thêm
              </button>
            )}
          </div>

          {/* Scrollable list items */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {configMode === 'point' ? (
              points.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '.8rem', color: 'var(--admin-text-muted)', lineHeight: 1.6 }}>
                  Chưa có điểm nhiệt nào.<br />Click lên ảnh để thêm nhanh.
                </div>
              ) : (
                points.map((pt, idx) => (
                  <div 
                    key={pt.id} 
                    style={{
                      padding: '12px 0', 
                      borderBottom: '1px solid var(--admin-border)',
                      background: editingId === pt.id ? 'var(--admin-layer-2)' : 'transparent',
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 10
                    }}
                  >
                    {/* Clean circular point indicator */}
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: roiColor(pt), flexShrink: 0, border: '1.5px solid var(--admin-border-light)' }} />
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {idx + 1}. {pt.label || pt.name}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {pt.warningThreshold !== undefined && (
                          <span className="tag tag-warning" style={{ fontSize: '.6rem', padding: '1px 6px' }}>
                            ⚠ {pt.warningThreshold}°
                          </span>
                        )}
                        {pt.alarmThreshold !== undefined && (
                          <span className="tag tag-danger" style={{ fontSize: '.6rem', padding: '1px 6px' }}>
                            🔴 {pt.alarmThreshold}°
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Standard industrial actions buttons */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {deletingId === pt.id ? (
                        <>
                          <button 
                            className="btn-industrial btn-sm" 
                            onClick={() => confirmDelete(pt.id)} 
                            title="Xác nhận"
                            style={{ 
                              background: 'var(--admin-tag-danger-bg)', 
                              color: 'var(--admin-tag-danger-text)', 
                              border: '1px solid var(--admin-danger)',
                              padding: '2px 8px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}
                          >
                            Xác nhận
                          </button>
                          <button 
                            className="btn-industrial btn-sm" 
                            onClick={() => setDeletingId(null)} 
                            title="Hủy"
                            style={{ 
                              padding: '2px 8px',
                              fontSize: '0.7rem'
                            }}
                          >
                            Hủy
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-industrial btn-sm" onClick={() => openEditor(pt)} title="Sửa">✎</button>
                          <button 
                            className="btn-industrial btn-sm btn-danger" 
                            onClick={() => setDeletingId(pt.id)} 
                            title="Xóa"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              ))
            ) : (
              boundaries.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '.8rem', color: 'var(--admin-text-muted)', lineHeight: 1.6 }}>
                  Chưa có vùng nhiệt nào.<br />Click lên ảnh để vẽ các đỉnh.
                </div>
              ) : (
                boundaries.map((b, idx) => (
                  <div 
                    key={b.id} 
                    style={{
                      padding: '12px 0', 
                      borderBottom: '1px solid var(--admin-border)',
                      background: editingId === b.id ? 'var(--admin-layer-2)' : 'transparent',
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 10
                    }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--admin-accent)', flexShrink: 0, border: '1.5px solid var(--admin-border-light)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {idx + 1}. {b.name}
                      </div>
                      {b.thresholds && (() => {
                        const t = JSON.parse(b.thresholds);
                        return (
                          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <span className="tag tag-warning" style={{ fontSize: '.6rem', padding: '1px 6px' }}>⚠ {t.warning}°</span>
                            <span className="tag tag-danger" style={{ fontSize: '.6rem', padding: '1px 6px' }}>🔴 {t.alarm}°</span>
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button className="btn-industrial btn-sm" onClick={() => openAreaEditor(b)} title="Sửa">✎</button>
                      <button className="btn-industrial btn-sm btn-danger" onClick={() => deleteArea(b.id)} title="Xóa">✕</button>
                    </div>
                  </div>
                ))
              )
            )}
          </div>

            {/* Tips for Area Mode */}
            {configMode === 'area' && (
              <div style={{
                padding: '12px 0 0 0',
                borderTop: '1px solid var(--admin-border)',
                fontSize: '0.7rem',
                color: 'var(--admin-text-muted)',
                lineHeight: 1.5,
                marginTop: 'auto'
              }}>
                <b style={{ color: 'var(--admin-accent)' }}>Mẹo vẽ vùng nhiệt:</b><br />
                • Click 4 góc **theo thứ tự vòng tròn** (clockwise hoặc counter-clockwise).<br />
                • **Tránh click chéo** (ví dụ: trên-trái xong click chéo xuống dưới-phải) để nét vẽ không bị chéo tạo thành 2 hình tam giác.<br />
                • **Tự động hoàn thành:** Vùng sẽ tự động đóng sau khi bạn click đủ 4 góc.
              </div>
            )}
          </div>

        </div>

      </div>
  );
}

// ── Orchestrator Component ───────────────────────────────────
export default function ThermalConfigTab({ cameras, initialCamera }: { cameras: CameraDevice[], initialCamera?: CameraDevice | null }) {
  const [selectedCamera, setSelectedCamera] = useState<CameraDevice | null>(initialCamera ?? null);
  const [hoveredCamId, setHoveredCamId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flex: 1, gap: 8, overflow: 'hidden', minHeight: 0, height: '100%', width: '100%' }}>
      {/* Left sidebar: camera list */}
      <div className="admin-card" style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRight: '1px solid var(--admin-border)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', background: 'var(--admin-layer-1)' }}>
          Camera nhiệt ({cameras.length})
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cameras.length === 0 ? (
            <div style={{ padding: 16, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chưa có camera nhiệt.</div>
          ) : cameras.map(cam => {
            const isSelected = selectedCamera?.id === cam.id;
            const isHovered = hoveredCamId === cam.id;
            return (
              <div 
                key={cam.id} 
                onClick={() => setSelectedCamera(cam)}
                onMouseEnter={() => setHoveredCamId(cam.id)}
                onMouseLeave={() => setHoveredCamId(null)}
                style={{
                  padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--admin-border)',
                  background: isSelected ? 'rgba(59,130,246,.08)' : (isHovered ? 'rgba(255,255,255,.02)' : 'transparent'),
                  borderLeft: isSelected ? '3px solid var(--admin-accent)' : '3px solid transparent',
                  transition: 'all 0.15s ease-in-out',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '.8rem', color: isSelected ? 'var(--admin-accent)' : 'var(--admin-text)' }}>{cam.name}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>IP: {cam.config?.ip || 'N/A'}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right side: configuration panel */}
      <div className="admin-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', minWidth: 0, border: 'none', background: 'transparent' }}>
        {selectedCamera ? (
          <ThermalConfigPanel device={selectedCamera} onBack={() => setSelectedCamera(null)} />
        ) : (
          <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 12, padding: 32 }}>
            <span style={{ fontSize: '3rem', opacity: 0.75 }}>🌡️</span>
            <div style={{ fontSize: '.85rem', fontWeight: 700 }}>Chọn camera nhiệt bên trái để bắt đầu cấu hình</div>
            <div style={{ fontSize: '.75rem', opacity: 0.6 }}>Hệ thống hỗ trợ chấm điểm nhiệt độ tùy chỉnh và vẽ vùng đa giác cảnh báo.</div>
          </div>
        )}
      </div>
    </div>
  );
}
