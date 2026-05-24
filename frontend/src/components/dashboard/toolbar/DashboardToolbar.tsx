

interface DashboardToolbarProps {
  stationName: string;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  onFit: () => void;
  onRotate: () => void;
  onColorChange: (hex: string) => void;
  filters: { thermal: boolean; pd: boolean; camera: boolean };
  onFilterChange: (filters: { thermal: boolean; pd: boolean; camera: boolean }) => void;
}

export default function DashboardToolbar(props: DashboardToolbarProps) {
  const { stationName, isEditMode, onToggleEditMode, onFit, onRotate, showLabels, onToggleLabels, onColorChange, filters, onFilterChange } = props;

  const btnStyle = (active: boolean) => ({
    background: active ? 'var(--admin-accent)' : 'var(--admin-btn-secondary-bg)', 
    border: '1px solid ' + (active ? 'var(--admin-accent)' : 'var(--admin-btn-secondary-border)'),
    color: active ? 'var(--admin-text-on-accent)' : 'var(--admin-btn-secondary-text)', borderRadius: 5, padding: '3px 9px', fontSize: '0.68rem', cursor: 'pointer'
  });

  return (
    <div
      id="sldToolbar"
      className={isEditMode ? 'edit-mode-active' : ''}
      style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: 'var(--admin-overlay)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--admin-border)', borderRadius: 10, padding: '6px 14px',
        transition: 'left 0.25s ease',
        boxShadow: 'var(--admin-shadow)'
      }}
    >
      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--admin-text)', whiteSpace: 'nowrap' }}>
        {stationName.toUpperCase() || 'SƠ ĐỒ TRẠM'}
      </span>
      <div style={{ width: 1, height: 18, background: 'var(--admin-border-light)' }}></div>
      
      {/* Filters */}
      <label style={{ fontSize: 10, color: 'var(--admin-text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.thermal} onChange={e => onFilterChange({ ...filters, thermal: e.target.checked })} /> Nhiệt
      </label>
      <label style={{ fontSize: 10, color: 'var(--admin-text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.pd} onChange={e => onFilterChange({ ...filters, pd: e.target.checked })} /> PD
      </label>
      <label style={{ fontSize: 10, color: 'var(--admin-text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.camera} onChange={e => onFilterChange({ ...filters, camera: e.target.checked })} /> Camera
      </label>
      
      <div style={{ width: 1, height: 18, background: 'var(--admin-border-light)' }}></div>
      
      {/* Actions */}
      <button onClick={onFit} style={btnStyle(false)}>⊞ Fit</button>
      <button onClick={onRotate} style={btnStyle(false)}>Xoay</button>
      <button onClick={onToggleEditMode} style={{...btnStyle(isEditMode), color: isEditMode ? '#fbbf24' : 'var(--admin-text)'}}>
        {isEditMode ? 'Đang chỉnh' : 'Chỉnh sơ đồ'}
      </button>
      
      {isEditMode && (
        <button onClick={onToggleLabels} style={btnStyle(showLabels)}>
          {showLabels ? 'Ẩn tên' : 'Hiện tên'}
        </button>
      )}

      <label title="Màu đường nét" style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: 'var(--admin-text-muted)', fontSize: 10 }}>
        <input 
          type="color" 
          defaultValue="#38bdf8"
          onChange={e => onColorChange(e.target.value)}
          style={{ width: 18, height: 14, border: 'none', padding: 0, background: 'none', cursor: 'pointer', borderRadius: 2 }} 
        />
      </label>
    </div>
  );
}
