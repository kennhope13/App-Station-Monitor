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
    <div className="modal-overlay active">
      <div className="modal-content" style={{ width: 360, background: 'var(--admin-panel)', borderRadius: 4, border: '1px solid var(--admin-border)', padding: 0 }}>
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '.85rem', fontWeight: 800, letterSpacing: '.5px' }}>
            {initial ? 'SỬA VÙNG PHÓNG ĐIỆN' : 'THÊM VÙNG PHÓNG ĐIỆN'}
          </h3>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="form-group">
            <label>Tên vùng</label>
            <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Ngưỡng cảnh báo (dB)</label>
            <input type="number" className="form-input" value={warning} onChange={e => setWarning(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Ngưỡng cấp cao (dB)</label>
            <input type="number" className="form-input" value={alarm} onChange={e => setAlarm(e.target.value)} />
          </div>
        </div>

        <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn-industrial" onClick={onClose}>Hủy</button>
          <button className="btn-industrial btn-primary" onClick={handleSubmit}>Lưu vùng</button>
        </div>
      </div>
    </div>
  );
};
