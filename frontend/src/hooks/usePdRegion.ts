// src/hooks/usePdRegion.ts
import { useState, useCallback, useEffect } from 'react';
import { getPdBoundaries, createPdBoundary, updatePdBoundary, deletePdBoundary, Boundary } from '@/services/pdApi';

/**
 * Hook managing PD regions for a selected camera.
 * It loads regions from backend, handles drawing state, and provides CRUD helpers.
 */
export const usePdRegion = (cameraId: string | null) => {
  const [regions, setRegions] = useState<Boundary[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftVertices, setDraftVertices] = useState<{ x: number; y: number }[]>([]);
  const [editingRegion, setEditingRegion] = useState<Boundary | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftWarn, setDraftWarn] = useState('20');
  const [draftAlarm, setDraftAlarm] = useState('45');

  // Load regions when cameraId changes
  const load = useCallback(async () => {
    if (!cameraId) {
      setRegions([]);
      return;
    }
    try {
      const { data } = await getPdBoundaries(cameraId);
      setRegions(data);
    } catch (e) {
      console.error('Failed to load PD regions', e);
      setRegions([]);
    }
  }, [cameraId]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Drawing helpers ----
  const startDrawing = () => {
    setIsDrawing(true);
    setDraftVertices([]);
    setEditingRegion(null);
    setDraftName('');
    setDraftWarn('20');
    setDraftAlarm('45');
  };

  const addVertex = (pt: { x: number; y: number }) => {
    if (!isDrawing) return;
    setDraftVertices(v => [...v, pt]);
  };

  const finishDrawing = (providedVertices?: { x: number; y: number }[]) => {
    const verts = providedVertices ?? draftVertices;
    if (verts.length < 3) {
      alert('Vui lòng vẽ ít nhất 3 điểm');
      return;
    }
    if (providedVertices) setDraftVertices(providedVertices);
    setIsDrawing(false);
  };

  // ---- CRUD ----
  const save = async () => {
    if (!cameraId) return;
    if (!draftName.trim()) {
      alert('Tên vùng không được để trống');
      return;
    }
    const payload = {
      name: draftName.trim(),
      vertices: editingRegion ? editingRegion.vertices : draftVertices,
      warningThreshold: parseFloat(draftWarn) || 20,
      alarmThreshold: parseFloat(draftAlarm) || 45,
    };
    try {
      if (editingRegion) {
        await updatePdBoundary(cameraId, editingRegion.id, payload);
      } else {
        await createPdBoundary(cameraId, payload);
      }
      await load();
      // reset draft state
      setEditingRegion(null);
      setDraftVertices([]);
      setIsDrawing(false);
      setDraftName('');
    } catch (e) {
      console.error('Failed to save PD region', e);
      alert('Lưu vùng thất bại');
    }
  };

  const remove = async (id: string) => {
    if (!cameraId) return;
    if (window.confirm('Xóa vùng này?')) {
      try {
        await deletePdBoundary(cameraId, id);
        await load();
      } catch (e) {
        console.error('Delete failed', e);
        alert('Xóa thất bại');
      }
    }
  };

  const edit = (region: Boundary) => {
    setEditingRegion(region);
    setDraftName(region.name);
    setDraftWarn(String(region.warningThreshold ?? 20));
    setDraftAlarm(String(region.alarmThreshold ?? 45));
    setDraftVertices(region.vertices);
    setIsDrawing(false);
  };

  const resetDraft = () => {
    setDraftName('');
    setDraftWarn('20');
    setDraftAlarm('45');
    setDraftVertices([]);
    setEditingRegion(null);
    setIsDrawing(false);
  };

  return {
    regions,
    isDrawing,
    draftVertices,
    draftName,
    draftWarn,
    draftAlarm,
    editingRegion,
    load,
    startDrawing,
    addVertex,
    finishDrawing,
    save,
    remove,
    edit,
    setDraftName,
    setDraftWarn,
    setDraftAlarm,
    setDraftVertices,
    setEditingRegion,
    resetDraft,
  };

};
