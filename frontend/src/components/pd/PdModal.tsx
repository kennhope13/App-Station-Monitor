// src/components/pd/PdModal.tsx
import React, { useState, useEffect } from 'react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; warning: string; alarm: string }) => void;
  initial?: any;
};

export const PdModal: React.FC<Props> = ({ isOpen, onClose, onSubmit, initial }) => {
  const [name, setName] = useState('');
  const [warning, setWarning] = useState('20');
  const [alarm, setAlarm] = useState('45');

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setWarning(String(initial.warningThreshold ?? 20));
      setAlarm(String(initial.alarmThreshold ?? 45));
    } else {
      setName('');
      setWarning('20');
      setAlarm('45');
    }
  }, [initial, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!name.trim()) {
      alert('Tên vùng không được để trống');
      return;
    }
    onSubmit({ name: name.trim(), warning, alarm });
  };

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="modal-content" style={{
        background: '#fff', borderRadius: 8, padding: 24, minWidth: 300,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>{initial ? 'Sửa vùng PD' : 'Thêm vùng PD'}</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Tên vùng</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Ngưỡng cảnh báo (dB)</label>
          <input type="number" value={warning} onChange={e => setWarning(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Ngưỡng cấp cao (dB)</label>
          <input type="number" value={alarm} onChange={e => setAlarm(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-industrial" onClick={onClose}>Hủy</button>
          <button className="btn-industrial btn-primary" onClick={handleSubmit}>Lưu</button>
        </div>
      </div>
    </div>
  );
};
