import re
with open('/home/admin-/stationos-main/frontend/src/pages/device-management/components/PdRegionTab.tsx', 'r') as f:
    content = f.read()

# 1. Update formData state
content = content.replace('''  const [formData, setFormData] = useState({
    name: '',
    severity: 'warning' as 'warning' | 'alarm',
    strokeWidth: '2',
    labelPosition: 'top',
    fontSize: '14'
  });''', '''  const [formData, setFormData] = useState({
    code: '',
    fullName: '',
    severity: 'warning' as 'warning' | 'alarm',
    strokeWidth: '2',
    labelPosition: 'top',
    fontSize: '14'
  });
  const [dragVertex, setDragVertex] = useState<number | null>(null);
  const [dragPoly, setDragPoly] = useState<boolean>(false);''')

# 2. Update Mouse Handlers
content = content.replace('''  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    if (!pos) return;

    // Polygon mode: click thêm điểm
    setDraftVertices(prev => [...prev, pos]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    if (!pos) return;
    setMousePos(pos);
  };

  const handleMouseUp = (_e: React.MouseEvent) => {
    // Không làm gì khi nhả chuột trong chế độ click polygon
  };''', '''  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (!pos) return;

    if (isDrawing) {
      setDraftVertices(prev => [...prev, pos]);
      return;
    }

    if (editingId) {
      const radius = 0.03;
      for (let i = 0; i < draftVertices.length; i++) {
        const dx = draftVertices[i][0] - pos[0];
        const dy = draftVertices[i][1] - pos[1];
        if (dx*dx + dy*dy < radius*radius) {
          setDragVertex(i);
          return;
        }
      }
      const minX = Math.min(...draftVertices.map(v => v[0]));
      const maxX = Math.max(...draftVertices.map(v => v[0]));
      const minY = Math.min(...draftVertices.map(v => v[1]));
      const maxY = Math.max(...draftVertices.map(v => v[1]));
      if (pos[0] >= minX && pos[0] <= maxX && pos[1] >= minY && pos[1] <= maxY) {
        setDragPoly(true);
        setMousePos(pos);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (!pos) return;

    if (isDrawing) {
      setMousePos(pos);
      return;
    }

    if (editingId) {
      if (dragVertex !== null) {
        const newVertices = [...draftVertices];
        newVertices[dragVertex] = pos;
        setDraftVertices(newVertices);
      } else if (dragPoly && mousePos) {
        const dx = pos[0] - mousePos[0];
        const dy = pos[1] - mousePos[1];
        const newVertices = draftVertices.map(v => [v[0] + dx, v[1] + dy] as [number, number]);
        setDraftVertices(newVertices);
        setMousePos(pos);
      }
    }
  };

  const handleMouseUp = (_e: React.MouseEvent) => {
    setDragVertex(null);
    setDragPoly(false);
  };''')

# 3. Update drawing state resets
content = content.replace('''  const finishPolygonDrawing = () => {
    if (draftVertices.length < 3) return;
    setIsDrawing(false);
    setEditingId('__new__');
    setFormData({ name: `Vùng PD ${boundaries.length + 1}`, severity: 'warning', strokeWidth: '2', labelPosition: 'bottom', fontSize: '14' });
  };''', '''  const finishPolygonDrawing = () => {
    if (draftVertices.length < 3) return;
    setIsDrawing(false);
    setEditingId('__new__');
    setFormData({ code: `PD_${boundaries.length + 1}`, fullName: `Vùng PD ${boundaries.length + 1}`, severity: 'warning', strokeWidth: '2', labelPosition: 'bottom', fontSize: '14' });
  };''')

# 4. handleSave
content = content.replace('''  const handleSave = async () => {
    if (!cam || !formData.name.trim()) return;
    try {
      const payload: Partial<Boundary> = {
        name: formData.name.trim(),
        type: 'pd',
        polygon: JSON.stringify(draftVertices),
        thresholds: JSON.stringify({ strokeWidth: formData.strokeWidth, labelPos: formData.labelPosition, fontSize: formData.fontSize }),''', '''  const handleSave = async () => {
    if (!cam || !formData.code.trim()) return;
    try {
      const payload: Partial<Boundary> = {
        name: formData.code.trim(),
        type: 'pd',
        polygon: JSON.stringify(draftVertices),
        thresholds: JSON.stringify({ fullName: formData.fullName.trim(), strokeWidth: formData.strokeWidth, labelPos: formData.labelPosition, fontSize: formData.fontSize }),''')

# 5. handleEdit
content = content.replace('''  const handleEdit = (b: Boundary) => {
    try {
      const poly: [number, number][] = JSON.parse(b.polygon);
      let strokeWidth = '2';
      let labelPosition = 'bottom';
      let fontSize = '14';
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          if (t.strokeWidth) strokeWidth = t.strokeWidth;
          if (t.labelPos) labelPosition = t.labelPos;
          if (t.fontSize) fontSize = t.fontSize;
        }
      } catch {}

      setDraftVertices(poly);
      setEditingId(b.id);
      setFormData({ name: b.name, severity: b.severityLevel as 'warning' | 'alarm', strokeWidth, labelPosition, fontSize });
      setIsDrawing(false);
    } catch {
      console.error('[PdRegionTab] Failed to parse polygon for edit');
    }
  };''', '''  const handleEdit = (b: Boundary) => {
    try {
      const poly: [number, number][] = JSON.parse(b.polygon);
      let strokeWidth = '2';
      let labelPosition = 'bottom';
      let fontSize = '14';
      let fullName = b.name;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          if (t.strokeWidth) strokeWidth = t.strokeWidth;
          if (t.labelPos) labelPosition = t.labelPos;
          if (t.fontSize) fontSize = t.fontSize;
          if (t.fullName) fullName = t.fullName;
        }
      } catch {}

      setDraftVertices(poly);
      setEditingId(b.id);
      setFormData({ code: b.name, fullName, severity: b.severityLevel as 'warning' | 'alarm', strokeWidth, labelPosition, fontSize });
      setIsDrawing(false);
    } catch {
      console.error('[PdRegionTab] Failed to parse polygon for edit');
    }
  };''')

# 6. Sidebar form inputs
content = content.replace('''            <div style={{ marginBottom:8 }}>
              <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>TÊN VÙNG</label>
              <input
                className="form-input"
                style={{ width:'100%', fontSize: '.85rem' }}
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="VD: T1 - Bushing pha A"
                autoFocus
              />
            </div>''', '''            <div style={{ marginBottom:8 }}>
              <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>MÃ VÙNG (Ký hiệu)</label>
              <input
                className="form-input"
                style={{ width:'100%', fontSize: '.85rem' }}
                value={formData.code}
                onChange={e => setFormData({...formData, code: e.target.value})}
                placeholder="VD: PD_01"
                autoFocus
              />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>TÊN VÙNG (Hiển thị chi tiết)</label>
              <input
                className="form-input"
                style={{ width:'100%', fontSize: '.85rem' }}
                value={formData.fullName}
                onChange={e => setFormData({...formData, fullName: e.target.value})}
                placeholder="VD: T1 - Bushing pha A"
              />
            </div>''')

# 7. Cursor style and live preview
content = content.replace('''                zIndex:2, cursor: isDrawing ? 'crosshair' : 'default',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}''', '''                zIndex:2, cursor: isDrawing ? 'crosshair' : (editingId ? (dragVertex !== null ? 'grabbing' : 'move') : 'default'),
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}''')

# 8. Live preview HTML logic (after the `boundaries.filter` div map)
# Find the exact ending block of the HTML divs
old_html_labels = '''                return (
                  <div key={b.id} style={style}>
                    {b.name}
                  </div>
                );
              })}'''
new_html_labels = '''                return (
                  <div key={b.id} style={style}>
                    {b.name}
                  </div>
                );
              })}

              {/* Nhãn Live Preview */}
              {editingId && draftVertices.length >= 3 && (() => {
                const minX = Math.min(...draftVertices.map(p => p[0])) * 100;
                const maxX = Math.max(...draftVertices.map(p => p[0])) * 100;
                const minY = Math.min(...draftVertices.map(p => p[1])) * 100;
                const maxY = Math.max(...draftVertices.map(p => p[1])) * 100;
                const cx = draftVertices.reduce((s, p) => s + p[0], 0) / draftVertices.length * 100;
                const cy = draftVertices.reduce((s, p) => s + p[1], 0) / draftVertices.length * 100;

                const style: React.CSSProperties = {
                  position: 'absolute', color: '#fff', fontSize: `${formData.fontSize}px`, fontWeight: 700,
                  textShadow: '0 1px 3px rgba(0,0,0,0.9)', pointerEvents: 'none', whiteSpace: 'nowrap',
                  transform: 'translate(-50%, -50%)', zIndex: 10
                };

                const labelPos = formData.labelPosition;
                if (labelPos === 'top') { style.top = `calc(${minY}% - 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, -100%)'; }
                else if (labelPos === 'bottom') { style.top = `calc(${maxY}% + 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, 0)'; }
                else if (labelPos === 'left') { style.top = `${cy}%`; style.left = `calc(${minX}% - 10px)`; style.transform = 'translate(-100%, -50%)'; }
                else if (labelPos === 'right') { style.top = `${cy}%`; style.left = `calc(${maxX}% + 10px)`; style.transform = 'translate(0, -50%)'; }
                else { style.top = `${cy}%`; style.left = `${cx}%`; }

                return (
                  <div style={style}>
                    {formData.code || 'MÃ VÙNG'}
                  </div>
                );
              })()}'''
content = content.replace(old_html_labels, new_html_labels)

# 9. Remove 8px padding to maximize stream size, wait, padding is in the root div:
# <div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0, padding: 8 }}>
content = content.replace('''<div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0, padding: 8 }}>''', '''<div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0, padding: 0 }}>''')
# Wait, DeviceManagementPage also has padding!
# Let's write the modified content back.
with open('/home/admin-/stationos-main/frontend/src/pages/device-management/components/PdRegionTab.tsx', 'w') as f:
    f.write(content)
