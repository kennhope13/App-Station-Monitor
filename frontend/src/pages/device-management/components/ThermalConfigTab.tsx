import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Trash2, Edit2, X } from 'lucide-react';
import { stationApi } from '../../../services/StationApiService';
import { CameraDevice } from '../../../types/api.types';
import { authService } from '../../../services/AuthService';
import { GO2RTC_URL } from '../../../utils/env';
import { createRealtimeHub } from '../../../services/realtime.service';
import { confirmDialog } from '@/utils/confirm';

type VVR = { x:number, y:number, width:number, height:number };

const EMPTY_FORM = {
  open: false, isNew: true, type: 'marker' as 'marker'|'roi',
  id: '', name: '', shortName: '',
  tx: '', ty: '', tx1: '', ty1: '', tx2: '', ty2: '',
  preAlarm: '50', alarm: '70', markerSize: '28', labelPos: 'top',
  fontSize: '11', borderWidth: '0.5'
};

const pct = (v:number) => `${(v*100).toFixed(2)}%`;
const clr = (t:number|null, w:number, a:number) => t==null?'#9ca3af':t>=a?'#ef4444':t>=w?'#f59e0b':'#10b981';

export default function ThermalConfigTab({ device: dev, onBack }: { device:CameraDevice, onBack:()=>void, onConfigChange?:()=>void, loading?:boolean }) {
  const did = dev.id;
  const [markers, setMarkers] = useState<any[]>([]);
  const [rois, setRois] = useState<any[]>([]);
  const mksRef = useRef(markers); mksRef.current = markers;
  const roisRef = useRef(rois); roisRef.current = rois;
  const [vvr, setVvr] = useState<VVR>({x:0.2,y:0.084,width:0.63,height:0.841});
  
  const [viewMode, setViewMode] = useState<'op'|'th'>('op');
  const [drawMode, setDrawMode] = useState<'none'|'point'|'rect'>('none');
  const dragMkRef = useRef<string|null>(null);
  const [dragRoi, setDragRoi] = useState<{sx:number,sy:number,ex:number,ey:number}|null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formTemp, setFormTemp] = useState<number|null>(null);
  const [cursor, setCursor] = useState<{temp:number, px:number, py:number}|null>(null);
  const [hoverPos, setHoverPos] = useState<{nx:number,ny:number}|null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cursorTimer = useRef<any>(null);

  const opSrc = dev.config?.go2rtc_optical || `cam_${(dev.config?.ip||'').replace(/\./g,'_')}_optical`;
  const thSrc = dev.config?.go2rtc_thermal || dev.config?.go2rtc_id || `cam_${(dev.config?.ip||'').replace(/\./g,'_')}_thermal`;

  const load = useCallback(async () => {
    try {
      const [pts, rjs] = await Promise.all([
        stationApi.getRoiPoints(did),
        stationApi.getBoundaries(did, 'roi')
      ]);
      setMarkers(prev => {
        const prevTemps: Record<string,number|null> = Object.fromEntries(prev.map(m=>[m.id, m.temp]));
        return pts.map(p => ({
          id:p.id, name:p.name, shortName:p.pointId,
          tx:p.tx||0.5, ty:p.ty||0.5, ox:p.ox||0.5, oy:p.oy||0.5,
          preAlarm:p.warningThreshold||50, alarm:p.alarmThreshold||70,
          markerSize:p.sortOrder||28, labelPos:(p as any).description||'top',
          temp: prevTemps[p.id] ?? null
        }));
      });
      setRois(prev => {
        const prevTemps: Record<string,number|null> = Object.fromEntries(prev.map(r=>[r.id, r.maxTemp]));
        return rjs.map(r => {
          let p:any=[]; try{ p=JSON.parse(r.polygon); }catch{}
          let t:any={}; try{ t=JSON.parse(r.thresholds||'{}'); }catch{}
          if(p.length<4) return null;
          const xs = p.map((x:any)=>x[0]), ys = p.map((x:any)=>x[1]);
          return {
            id:r.id, name:r.name,
            tx1:Math.min(...xs), ty1:Math.min(...ys), tx2:Math.max(...xs), ty2:Math.max(...ys),
            preAlarm:t.warning||t.preAlarm||50, alarm:t.alarm||70,
            maxTemp: prevTemps[r.id] ?? null,
            labelPos: t.labelPos || 'top', fontSize: t.fontSize || 11, borderWidth: t.borderWidth || 0.5
          };
        }).filter(Boolean);
      });
    } catch(e) {}
  }, [did]);

  useEffect(() => { load(); }, [load]);

  // Lắng nghe SignalR SensorUpdate — cùng nguồn với realtime page
  useEffect(() => {
    const hub = createRealtimeHub();
    hub.on('SensorUpdate', (data: any[]) => {
      if (!Array.isArray(data)) return;
      const mine = data.filter(d => d.deviceId === did || d.deviceId?.toLowerCase() === did.toLowerCase());
      if (!mine.length) return;
      setMarkers(prev => prev.map(m => {
        const upd = mine.find(u =>
          (u.pointId && (u.pointId === m.shortName || u.pointId === m.name)) ||
          (u.tx != null && Math.abs(u.tx - m.tx) < 0.002 && Math.abs(u.ty - m.ty) < 0.002)
        );
        return upd ? { ...m, temp: upd.value } : m;
      }));
      setRois(prev => prev.map(r => {
        const upd = mine.find(u => u.roiId === r.id || u.pointId === r.name);
        return upd?.max != null ? { ...r, maxTemp: upd.max } : r;
      }));
    });
    hub.start().catch(() => {});
    return () => { hub.stop(); };
  }, [did]);

  useEffect(() => {
    let timer:any;
    const poll = async () => {
      const mks = mksRef.current;
      const rs  = roisRef.current;
      if(mks.length===0 && rs.length===0 && !form.open) { timer = setTimeout(poll, 600); return; }
      try {
        const res = await fetch(`/api/v1/devices/${did}/thermal/live-temps`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${authService.getToken()}` },
          body: JSON.stringify({
            points: [
              ...mks.map(m=>({ id:m.id, x:m.tx, y:m.ty })),
              ...(form.open && form.type==='marker' && form.tx ? [{ id:'__form__', x:parseFloat(form.tx), y:parseFloat(form.ty) }] : [])
            ],
            rois: rs.map(r=>({ id:r.id, x1:r.tx1, y1:r.ty1, x2:r.tx2, y2:r.ty2 })),
          }),
        });
        if(res.ok) {
          const d = await res.json();
          if(d.mapping) setVvr(d.mapping);
          if(d.temps)   setMarkers(prev => prev.map(m => { const t=d.temps.find((x:any)=>x.id===m.id); return t?.temp!=null?{...m,temp:t.temp}:m; }));
          if(d.rois)    setRois(prev => prev.map(r => { const t=d.rois.find((x:any)=>x.id===r.id); return t?{...r,maxTemp:t.max}:r; }));
          
          if(form.open && form.type==='marker' && form.tx) {
            const t = d.temps?.find((x:any)=>x.id==='__form__');
            if(t?.temp!=null) setFormTemp(t.temp);
          }
        }
      } catch {}
      timer = setTimeout(poll, 600);
    };
    poll();
    return () => clearTimeout(timer);
  }, [did, form]);

  const syncAI = () => fetch(`/api/v1/devices/${did}/sync`, { method:'POST', headers:{Authorization:`Bearer ${authService.getToken()}`} }).catch(()=>{});

  const getPos = (e:React.MouseEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [ Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)), Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)) ];
  };

  const o2t = (ox:number, oy:number, v:VVR) => ({ tx: Math.max(0, Math.min(1, (ox-v.x)/v.width)), ty: Math.max(0, Math.min(1, (oy-v.y)/v.height)) });
  const t2o = (tx:number, ty:number, v:VVR) => ({ ox: Math.max(0, Math.min(1, tx*v.width+v.x)), oy: Math.max(0, Math.min(1, ty*v.height+v.y)) });

  const toThermal = (nx:number, ny:number): [number,number] => viewMode==='th' ? [nx,ny] : [o2t(nx,ny,vvr).tx, o2t(nx,ny,vvr).ty];

  const onDown = (e:React.MouseEvent) => {
    if(e.button!==0) return;
    e.preventDefault();
    if(drawMode === 'rect') {
      const [nx,ny] = getPos(e);
      setDragRoi({ sx:nx, sy:ny, ex:nx, ey:ny });
    }
  };

  const onMove = (e:React.MouseEvent) => {
    const [nx,ny] = getPos(e);
    if(drawMode === 'point') setHoverPos({nx,ny});
    else if(hoverPos) setHoverPos(null);
    if(dragRoi)   setDragRoi(p => p?{...p,ex:nx,ey:ny}:null);
    if(dragMkRef.current && drawMode === 'none') {
      const [tx,ty] = toThermal(nx,ny);
      const {ox,oy} = t2o(tx,ty,vvr);
      setMarkers(prev => prev.map(m => m.id===dragMkRef.current ? {...m,tx,ty,ox,oy} : m));
    }
    
    // Live Cursor query
    if(viewMode==='th' && !dragMkRef.current && !dragRoi) {
      if(cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/devices/${did}/thermal/live-temps`, {
            method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${authService.getToken()}` },
            body: JSON.stringify({ points:[{ id:'__cur__', x:nx, y:ny }], rois:[] }),
          });
          if(res.ok) { const d=await res.json(); const t=d.temps?.[0]; if(t?.temp!=null) setCursor({temp:t.temp,px:e.clientX,py:e.clientY}); }
        } catch {}
      }, 100);
    } else {
      setCursor(null);
    }
  };

  // Auto-tạo điểm ngay khi click — không cần form
  const autoPlaceMarker = async (tx:number, ty:number) => {
    const {ox,oy} = t2o(tx,ty,vvr);
    
    // Quét tìm chỉ số lớn nhất hiện tại để cộng thêm 1, tránh bị trùng lặp ID khi xóa
    let maxIdx = 0;
    mksRef.current.forEach(m => {
      if (m.id.startsWith('__')) return;
      const match = m.name?.match(/\d+/) || m.shortName?.match(/\d+/);
      if (match) {
        const val = parseInt(match[0]);
        if (val > maxIdx) maxIdx = val;
      }
    });
    const idx = maxIdx + 1;
    
    const tmpId = `__tmp_${Date.now()}`;
    setMarkers(prev=>[...prev,{id:tmpId,name:`Điểm ${idx}`,shortName:`P${idx}`,tx,ty,ox,oy,preAlarm:50,alarm:70,markerSize:28,labelPos:'top',temp:null}]);
    // Fetch nhiệt ngay lập tức
    fetch(`/api/v1/devices/${did}/thermal/live-temps`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authService.getToken()}`},body:JSON.stringify({points:[{id:tmpId,x:tx,y:ty}],rois:[]})})
      .then(r=>r.json()).then(d=>{const t=d.temps?.[0];if(t?.temp!=null)setMarkers(prev=>prev.map(m=>m.id===tmpId?{...m,temp:t.temp}:m));}).catch(()=>{});
    // Lưu DB, thay tempId bằng ID thật
    try {
      const saved:any = await stationApi.createRoiPoint(did,{label:`Điểm ${idx}`,name:`Điểm ${idx}`,pointId:`P${idx}`,tx,ty,ox,oy,x:tx*100,y:ty*100,sortOrder:28,warningThreshold:50,alarmThreshold:70} as any);
      setMarkers(prev=>prev.map(m=>m.id===tmpId?{...m,id:saved.id}:m));
      syncAI();
    } catch { setMarkers(prev=>prev.filter(m=>m.id!==tmpId)); }
  };

  // Auto-tạo vùng ngay khi kéo xong — không cần form
  const autoPlaceRoi = async (tx1:number,ty1:number,tx2:number,ty2:number) => {
    // Quét tìm chỉ số lớn nhất hiện tại cho Vùng đo
    let maxIdx = 0;
    roisRef.current.forEach(r => {
      if (r.id.startsWith('__')) return;
      const match = r.name?.match(/\d+/);
      if (match) {
        const val = parseInt(match[0]);
        if (val > maxIdx) maxIdx = val;
      }
    });
    const idx = maxIdx + 1;
    
    const tmpId = `__roi_${Date.now()}`;
    setRois(prev=>[...prev,{id:tmpId,name:`Vùng ${idx}`,tx1,ty1,tx2,ty2,preAlarm:50,alarm:70,maxTemp:null,labelPos:'top',fontSize:11,borderWidth:0.5}]);
    // Fetch nhiệt ngay lập tức
    fetch(`/api/v1/devices/${did}/thermal/live-temps`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authService.getToken()}`},body:JSON.stringify({points:[],rois:[{id:tmpId,x1:tx1,y1:ty1,x2:tx2,y2:ty2}]})})
      .then(r=>r.json()).then(d=>{const t=d.rois?.[0];if(t?.max!=null)setRois(prev=>prev.map(r=>r.id===tmpId?{...r,maxTemp:t.max}:r));}).catch(()=>{});
    // Lưu DB, thay tempId bằng ID thật
    try {
      const poly=JSON.stringify([[tx1,ty1],[tx2,ty1],[tx2,ty2],[tx1,ty2]]);
      const saved:any = await stationApi.createBoundary(did,{name:`Vùng ${idx}`,type:'roi',polygon:poly,thresholds:JSON.stringify({warning:50,alarm:70,labelPos:'top',fontSize:11,borderWidth:0.5}),enabled:true,severityLevel:'warning'} as any);
      setRois(prev=>prev.map(r=>r.id===tmpId?{...r,id:saved.id}:r));
      syncAI();
    } catch { setRois(prev=>prev.filter(r=>r.id!==tmpId)); }
  };

  const onUp = async (e:React.MouseEvent) => {
    if(dragMkRef.current) {
      const m = markers.find(x=>x.id===dragMkRef.current);
      if(m) await stationApi.updateRoiPoint(did, m.id, { tx:m.tx, ty:m.ty, ox:m.ox, oy:m.oy, x:m.tx*100, y:m.ty*100 } as any).catch(()=>{});
      dragMkRef.current = null;
      syncAI();
      return;
    }
    if(drawMode === 'point') {
      const [nx,ny] = getPos(e);
      const [tx,ty] = toThermal(nx,ny);
      if(viewMode==='op' && (nx<vvr.x||nx>vvr.x+vvr.width||ny<vvr.y||ny>vvr.y+vvr.height)) return;
      setHoverPos(null);
      setDrawMode('none');
      autoPlaceMarker(tx, ty);
      return;
    }
    if(dragRoi) {
      const {sx,sy,ex,ey} = dragRoi;
      setDragRoi(null);
      if(Math.abs(ex-sx)<0.02 || Math.abs(ey-sy)<0.02) return;
      let tx1=sx,ty1=sy,tx2=ex,ty2=ey;
      if(viewMode==='op'){const tl=o2t(sx,sy,vvr);const br=o2t(ex,ey,vvr);tx1=tl.tx;ty1=tl.ty;tx2=br.tx;ty2=br.ty;}
      setDrawMode('none');
      autoPlaceRoi(tx1,ty1,tx2,ty2);
    }
  };

  // saveForm chỉ dùng để CẬP NHẬT (edit) — tạo mới dùng autoPlace
  const saveForm = async () => {
    try {
      if(form.type==='marker') {
        const tx=parseFloat(form.tx),ty=parseFloat(form.ty);
        const {ox:cox,oy:coy}=t2o(tx,ty,vvr);
        await stationApi.updateRoiPoint(did,form.id,{label:form.name,name:form.name,pointId:form.shortName,tx,ty,ox:cox,oy:coy,x:tx*100,y:ty*100,sortOrder:parseInt(form.markerSize)||28,warningThreshold:parseFloat(form.preAlarm)||50,alarmThreshold:parseFloat(form.alarm)||70} as any);
        setMarkers(prev=>prev.map(m=>m.id===form.id?{...m,name:form.name,shortName:form.shortName,preAlarm:parseFloat(form.preAlarm)||50,alarm:parseFloat(form.alarm)||70,markerSize:parseInt(form.markerSize)||28}:m));
      } else {
        await stationApi.updateBoundary(form.id,{name:form.name,thresholds:JSON.stringify({warning:parseFloat(form.preAlarm),alarm:parseFloat(form.alarm),labelPos:form.labelPos,fontSize:parseFloat(form.fontSize)||11,borderWidth:parseFloat(form.borderWidth)||0.5})} as any);
        setRois(prev=>prev.map(r=>r.id===form.id?{...r,name:form.name,preAlarm:parseFloat(form.preAlarm)||50,alarm:parseFloat(form.alarm)||70,labelPos:form.labelPos,fontSize:parseFloat(form.fontSize)||11,borderWidth:parseFloat(form.borderWidth)||0.5}:r));
      }
      setForm(EMPTY_FORM); setFormTemp(null);
      syncAI();
    } catch(e) { alert("Lưu thất bại!"); }
  };

  const delMarker = async (id:string) => {
    try {
      if (await confirmDialog({ title: 'Xóa điểm đo', message: 'Bạn có chắc chắn muốn xóa điểm đo nhiệt này?', danger: true })) {
        await stationApi.deleteRoiPoint(did, id);
        await load();
        syncAI();
      }
    } catch (err: any) {
      console.error("[ThermalConfigTab] Delete marker failed:", err);
      alert("Xóa điểm đo thất bại: " + (err.message || err));
    }
  };
  const delRoi = async (id:string) => {
    try {
      if (await confirmDialog({ title: 'Xóa vùng đo', message: 'Bạn có chắc chắn muốn xóa vùng đo nhiệt này?', danger: true })) {
        await stationApi.deleteBoundary(id);
        await load();
        syncAI();
      }
    } catch (err: any) {
      console.error("[ThermalConfigTab] Delete ROI failed:", err);
      alert("Xóa vùng đo thất bại: " + (err.message || err));
    }
  };

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'var(--admin-bg)' }}>
      {/* ── Camera area ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {/* Toolbar & View Tabs */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'6px 10px', background:'var(--admin-layer-1)', borderBottom:'1px solid var(--admin-border)', flexShrink:0 }}>
          
          <button className="btn-industrial btn-sm" onClick={onBack} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span>← Quay lại</span>
          </button>

          <div style={{ width:1, height:24, background:'var(--admin-border)' }} />
          
          <div style={{ display:'flex', background:'var(--admin-layer-2)', borderRadius:4, padding:2 }}>
            <button className={`btn-industrial btn-sm ${viewMode==='op'?'btn-primary':''}`} onClick={() => setViewMode('op')}>Ảnh quang học</button>
            <button className={`btn-industrial btn-sm ${viewMode==='th'?'btn-primary':''}`} onClick={() => setViewMode('th')}>Ảnh nhiệt độ</button>
          </div>

          <div style={{ width:1, height:24, background:'var(--admin-border)' }} />

          <div style={{ display:'flex', background:'var(--admin-layer-2)', borderRadius:4, padding:2 }}>
            <button className={`btn-industrial btn-sm ${drawMode==='point'?'btn-primary':''}`} onClick={() => setDrawMode(drawMode==='point'?'none':'point')}>📍 Chấm Điểm</button>
            <button className={`btn-industrial btn-sm ${drawMode==='rect'?'btn-primary':''}`} onClick={() => setDrawMode(drawMode==='rect'?'none':'rect')}>🟧 Vẽ Vùng</button>
            <button className={`btn-industrial btn-sm ${drawMode==='none'?'btn-primary':''}`} onClick={() => setDrawMode('none')}>✋ Di chuyển</button>
          </div>

        </div>

        {/* video-container */}
        <div style={{ flex:1, position:'relative', background:'#000', overflow:'hidden' }} ref={containerRef}>
          {viewMode === 'op' && (
            <>
              <iframe src={`/camera-stream.html?src=${encodeURIComponent(opSrc)}&mode=webrtcmode=webrtc&go2rtc=${GO2RTC_URL}&go2rtc=${encodeURIComponent(GO2RTC_URL)}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none', pointerEvents:'none', zIndex:1 }} />
              {/* Overlay boundaries */}
              <div style={{ position:'absolute', left:pct(vvr.x), top:pct(vvr.y), width:pct(vvr.width), height:pct(vvr.height), border:'1px dashed rgba(255,255,255,0.3)', pointerEvents:'none', zIndex:5 }}>
                <div style={{ position:'absolute', top:-20, left:0, color:'#fff', fontSize:10, opacity:0.5 }}>Khung nhiệt (VVR)</div>
              </div>
            </>
          )}

          {viewMode === 'th' && (
            <iframe src={`/camera-stream.html?src=${encodeURIComponent(thSrc)}&mode=webrtc&go2rtc=${encodeURIComponent(GO2RTC_URL)}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none', pointerEvents:'none', zIndex:1 }} />
          )}

          {/* Interactive Overlay */}
          <div style={{ position:'absolute', inset:0, zIndex:10, cursor: drawMode!=='none'?'crosshair':'default' }}
               onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
               onMouseLeave={()=>setHoverPos(null)}
               onContextMenu={e => e.preventDefault()}>
            
            {/* Draw Rois */}
            {rois.map(r => {
              const nx1 = viewMode==='th' ? r.tx1 : t2o(r.tx1, r.ty1, vvr).ox;
              const ny1 = viewMode==='th' ? r.ty1 : t2o(r.tx1, r.ty1, vvr).oy;
              const nx2 = viewMode==='th' ? r.tx2 : t2o(r.tx2, r.ty2, vvr).ox;
              const ny2 = viewMode==='th' ? r.ty2 : t2o(r.tx2, r.ty2, vvr).oy;
              const c = clr(r.maxTemp, r.preAlarm, r.alarm);
              const lp = r.labelPos || 'top';
              const fs = r.fontSize || 11;
              const bw = r.borderWidth || 0.5;
              const labelStyle: React.CSSProperties =
                lp === 'bottom' ? { top:'calc(100% + 3px)', left:0 } :
                lp === 'left'   ? { top:'50%', right:'calc(100% + 3px)', transform:'translateY(-50%)' } :
                lp === 'right'  ? { top:'50%', left:'calc(100% + 3px)', transform:'translateY(-50%)' } :
                                  { bottom:'calc(100% + 3px)', left:0 };
              return (
                <div key={r.id} style={{ position:'absolute', left:pct(nx1), top:pct(ny1), width:pct(nx2-nx1), height:pct(ny2-ny1), border:`${bw}px solid ${c}`, background:c+'10' }}>
                  <div style={{ position:'absolute', ...labelStyle, background:'rgba(0,0,0,0.72)', padding:'1px 5px', borderRadius:2, color:'#fff', fontSize:fs, fontFamily:'monospace', whiteSpace:'nowrap' }}>
                    <b>{r.name}</b> <span style={{color:c}}>{r.maxTemp?.toFixed(1)??'--'}°C</span>
                  </div>
                </div>
              );
            })}

            {/* Draw Markers */}
            {markers.map(m => {
              const nx = viewMode==='th' ? m.tx : m.ox;
              const ny = viewMode==='th' ? m.ty : m.oy;
              const c = clr(m.temp, m.preAlarm, m.alarm);
              const armLen = m.markerSize || 28;
              const labelOffset = Math.round(armLen / 2) + 5;
              return (
                <div key={m.id} style={{ position:'absolute', left:pct(nx), top:pct(ny), transform:'translate(-50%,-50%)', cursor:drawMode==='none'?'move':'crosshair', pointerEvents:drawMode==='none'?'auto':'none' }}
                     onMouseDown={e=>{ if(drawMode==='none'&&e.button===0){ e.stopPropagation(); dragMkRef.current = m.id; }}}>
                  {/* Ngang */}
                  <div style={{ position:'absolute', top:0, left:0, width:armLen, height:1.5, background:c, transform:'translate(-50%,-50%)', boxShadow:'0 0 3px rgba(0,0,0,.9)' }} />
                  {/* Dọc */}
                  <div style={{ position:'absolute', top:0, left:0, width:1.5, height:armLen, background:c, transform:'translate(-50%,-50%)', boxShadow:'0 0 3px rgba(0,0,0,.9)' }} />
                  {/* Hit area */}
                  <div style={{ position:'absolute', top:0, left:0, width:armLen, height:armLen, transform:'translate(-50%,-50%)' }} />
                  {/* Label: Mã + nhiệt độ */}
                  <div style={{ position:'absolute', top:0, left:labelOffset, transform:'translateY(-50%)', background:'rgba(8,8,12,.88)', borderRadius:3, padding:'1px 6px', display:'flex', flexDirection:'column', alignItems:'flex-start', whiteSpace:'nowrap', pointerEvents:'none' }}>
                    <span style={{fontSize:10, color:'#94a3b8', lineHeight:1.3}}>{m.shortName||m.name}</span>
                    <span style={{fontSize:11, fontWeight:800, color:c, fontFamily:'monospace', lineHeight:1.3}}>{m.temp?.toFixed(1)??'--'}°C</span>
                  </div>
                </div>
              );
            })}

            {/* Hover preview dấu + khi đang ở chế độ chấm điểm */}
            {drawMode==='point' && hoverPos && (
              <div style={{ position:'absolute', left:pct(hoverPos.nx), top:pct(hoverPos.ny), transform:'translate(-50%,-50%)', pointerEvents:'none', zIndex:20 }}>
                <div style={{ position:'absolute', top:0, left:0, width:28, height:2, background:'#fff', transform:'translate(-50%,-50%)', opacity:.9, boxShadow:'0 0 5px rgba(0,0,0,1)' }} />
                <div style={{ position:'absolute', top:0, left:0, width:2, height:28, background:'#fff', transform:'translate(-50%,-50%)', opacity:.9, boxShadow:'0 0 5px rgba(0,0,0,1)' }} />
              </div>
            )}


            {/* Dragging ROI */}
            {dragRoi && (() => {
              const x1=Math.min(dragRoi.sx,dragRoi.ex), y1=Math.min(dragRoi.sy,dragRoi.ey);
              const x2=Math.max(dragRoi.sx,dragRoi.ex), y2=Math.max(dragRoi.sy,dragRoi.ey);
              return <div style={{ position:'absolute', left:pct(x1), top:pct(y1), width:pct(x2-x1), height:pct(y2-y1), border:'2px dashed #ff9900', background:'rgba(255,153,0,.06)', pointerEvents:'none' }} />;
            })()}

          </div>

          {/* Live Cursor Temp overlay */}
          {cursor && viewMode==='th' && (
            <div style={{ position:'absolute', left:cursor.px+14, top:cursor.py, transform:'translateY(-50%)', pointerEvents:'none', background:'rgba(0,0,0,.88)', border:'1px solid rgba(255,255,255,.15)', borderRadius:4, padding:'2px 8px', fontSize:11, fontFamily:'monospace', color:'#fff', whiteSpace:'nowrap', zIndex:20 }}>
              {cursor.temp.toFixed(1)}°C
            </div>
          )}

        </div>
      </div>

      {/* ── Config Sidebar ── */}
      <div style={{ width:260, borderLeft:'1px solid var(--admin-border)', background:'var(--admin-layer-1)', display:'flex', flexDirection:'column', flexShrink:0 }}>
        {form.open ? (
          <div style={{ display:'flex', flexDirection:'column', height:'100%', animation:'fadeIn .2s ease' }}>
            <div style={{ padding:'12px', borderBottom:'1px solid var(--admin-border)', display:'flex', justifyContent:'space-between', alignItems:'center', fontWeight:800, fontSize:'.85rem' }}>
              <span>Chỉnh sửa {form.type==='marker'?'điểm':'vùng'}</span>
              <button className="btn-industrial btn-sm" style={{ padding:'0 8px', height:22 }} onClick={()=>setForm(EMPTY_FORM)}><X size={12}/></button>
            </div>
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
              <div className="form-group"><label>Tên *</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
              {form.type==='marker' && (
                <>
                  <div className="form-group"><label>Mã</label><input className="form-input" value={form.shortName} onChange={e=>setForm(f=>({...f,shortName:e.target.value}))} placeholder="P1, P2..." /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                    <div className="form-group"><label>Cỡ dấu +</label><input className="form-input" type="number" min="12" max="60" step="2" value={form.markerSize} onChange={e=>setForm(f=>({...f,markerSize:e.target.value}))} /></div>
                    <div className="form-group"><label style={{color:'var(--admin-warning)'}}>Vàng °C</label><input className="form-input" type="number" value={form.preAlarm} onChange={e=>setForm(f=>({...f,preAlarm:e.target.value}))}/></div>
                    <div className="form-group"><label style={{color:'var(--admin-danger)'}}>Đỏ °C</label><input className="form-input" type="number" value={form.alarm} onChange={e=>setForm(f=>({...f,alarm:e.target.value}))}/></div>
                  </div>
                </>
              )}
              {form.type==='roi' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div className="form-group"><label style={{color:'var(--admin-warning)'}}>Vàng (°C)</label><input className="form-input" type="number" value={form.preAlarm} onChange={e=>setForm(f=>({...f,preAlarm:e.target.value}))}/></div>
                  <div className="form-group"><label style={{color:'var(--admin-danger)'}}>Đỏ (°C)</label><input className="form-input" type="number" value={form.alarm} onChange={e=>setForm(f=>({...f,alarm:e.target.value}))}/></div>
                </div>
              )}
              {form.type==='roi' && (
                <>
                  <div className="form-group">
                    <label>Vị trí tên vùng</label>
                    <select className="form-input" value={form.labelPos} onChange={e=>setForm(f=>({...f,labelPos:e.target.value}))}>
                      <option value="top">Trên</option>
                      <option value="bottom">Dưới</option>
                      <option value="left">Trái</option>
                      <option value="right">Phải</option>
                    </select>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <div className="form-group">
                      <label>Cỡ chữ (px)</label>
                      <input className="form-input" type="number" min="8" max="24" step="1" value={form.fontSize} onChange={e=>setForm(f=>({...f,fontSize:e.target.value}))} />
                    </div>
                    <div className="form-group">
                      <label>Độ dày viền (px)</label>
                      <input className="form-input" type="number" min="0.5" max="4" step="0.5" value={form.borderWidth} onChange={e=>setForm(f=>({...f,borderWidth:e.target.value}))} />
                    </div>
                  </div>
                </>
              )}
              {form.type==='marker' && form.tx && (
                <div style={{ fontSize:'.68rem', fontFamily:'monospace', padding:'6px 10px', background:'var(--admin-layer-2)', borderRadius:4, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'var(--admin-text-muted)' }}>T({parseFloat(form.tx).toFixed(3)}, {parseFloat(form.ty).toFixed(3)})</span>
                  {formTemp != null ? <span style={{ fontWeight:800, fontSize:'.9rem', color: formTemp>=(parseFloat(form.alarm)||70)?'#ef4444':formTemp>=(parseFloat(form.preAlarm)||50)?'#f59e0b':'#10b981' }}>{formTemp.toFixed(1)}°C</span> : <span style={{ color:'var(--admin-text-muted)', fontSize:'.7rem' }}>đang đọc...</span>}
                </div>
              )}
              <div style={{ display:'flex', gap:10, marginTop:6 }}>
                <button className="btn-industrial" style={{ flex:1, height:32, padding:'0 12px', background:'var(--admin-layer-3)', border:'1px solid var(--admin-border)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:'.8rem', fontWeight:600 }} onClick={()=>{ setForm(EMPTY_FORM); setFormTemp(null); }}>
                  <X size={14}/> Hủy
                </button>
                <button className="btn-industrial" style={{ flex:1, height:32, padding:'0 12px', background:'var(--admin-accent)', border:'none', borderRadius:6, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:'.8rem', fontWeight:700, boxShadow:'0 2px 4px rgba(0,0,0,0.1)' }} onClick={saveForm}>
                  <Save size={14}/> Lưu
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding:'10px 12px', background:'var(--admin-layer-2)', borderBottom:'1px solid var(--admin-border)', fontSize:'.68rem', fontWeight:800, color:'var(--admin-text-muted)', textTransform:'uppercase', letterSpacing:'.8px' }}>Điểm đo ({markers.length})</div>
            <div style={{ flex:1, overflowY:'auto', maxHeight:'50%' }}>
              {markers.map(m => {
                const c = clr(m.temp, m.preAlarm, m.alarm);
                return (
                  <div key={m.id} style={{padding:'10px 12px', borderBottom:'1px solid var(--admin-border)', display:'flex', alignItems:'center', gap:10}}>
                    <div style={{width:8, height:8, borderRadius:'50%', background:c, flexShrink:0, boxShadow:`0 0 4px ${c}88`}}/>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:'.85rem', fontWeight:800, color:'var(--admin-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.shortName||m.name}</div>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:2, fontSize:'.72rem', color:'var(--admin-text-muted)', fontFamily:'monospace'}}>
                        <span style={{fontWeight:800, color:c}}>{m.temp!=null?`${m.temp.toFixed(1)}°C`:'--°C'}</span>
                        <span style={{opacity:0.25, fontWeight:100}}>|</span>
                        <span style={{color:'#f59e0b', display:'flex', alignItems:'center', gap:3}}><span style={{fontSize:'10px', transform:'translateY(-1px)'}}>△</span> {m.preAlarm}°</span>
                        <span style={{color:'#ef4444', display:'flex', alignItems:'center', gap:3}}><span style={{fontSize:'10px'}}>●</span> {m.alarm}°</span>
                      </div>
                    </div>
                    <div style={{display:'flex', gap:6}}>
                      <button className="btn-industrial" style={{width:26, height:26, padding:0, background:'var(--admin-layer-3)', border:'1px solid var(--admin-border)', borderRadius:4}} onClick={()=>setForm({...EMPTY_FORM,open:true,isNew:false,type:'marker',id:m.id,name:m.name,shortName:m.shortName,markerSize:String(m.markerSize||28),preAlarm:String(m.preAlarm),alarm:String(m.alarm),tx:m.tx.toFixed(4),ty:m.ty.toFixed(4)})}><Edit2 size={13}/></button>
                      <button className="btn-industrial" style={{width:26, height:26, padding:0, background:'#fee2e2', border:'1px solid #fecaca', color:'#991b1b', borderRadius:4}} onClick={()=>delMarker(m.id)}><Trash2 size={13}/></button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding:'10px 12px', background:'var(--admin-layer-2)', borderBottom:'1px solid var(--admin-border)', borderTop:'1px solid var(--admin-border)', fontSize:'.68rem', fontWeight:800, color:'var(--admin-text-muted)', textTransform:'uppercase', letterSpacing:'.8px' }}>Vùng đo ({rois.length})</div>
            <div style={{flex:1, overflowY:'auto'}}>
              {rois.map(r => {
                const c = clr(r.maxTemp, r.preAlarm, r.alarm);
                return (
                  <div key={r.id} style={{padding:'10px 12px', borderBottom:'1px solid var(--admin-border)', display:'flex', alignItems:'center', gap:10}}>
                    <div style={{width:8, height:8, background:c, flexShrink:0, boxShadow:`0 0 4px ${c}88`}}/>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:'.85rem', fontWeight:800, color:'var(--admin-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.name}</div>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:2, fontSize:'.72rem', color:'var(--admin-text-muted)', fontFamily:'monospace'}}>
                        <span style={{fontWeight:800, color:c}}>{r.maxTemp!=null?`Max ${r.maxTemp.toFixed(1)}°C`:'Max --°C'}</span>
                        <span style={{opacity:0.25, fontWeight:100}}>|</span>
                        <span style={{color:'#f59e0b', display:'flex', alignItems:'center', gap:3}}><span style={{fontSize:'10px', transform:'translateY(-1px)'}}>△</span> {r.preAlarm}°</span>
                        <span style={{color:'#ef4444', display:'flex', alignItems:'center', gap:3}}><span style={{fontSize:'10px'}}>●</span> {r.alarm}°</span>
                      </div>
                    </div>
                    <div style={{display:'flex', gap:6}}>
                      <button className="btn-industrial" style={{width:26, height:26, padding:0, background:'var(--admin-layer-3)', border:'1px solid var(--admin-border)', borderRadius:4}} onClick={()=>setForm({...EMPTY_FORM,open:true,isNew:false,type:'roi',id:r.id,name:r.name,labelPos:r.labelPos||'top',fontSize:String(r.fontSize||11),borderWidth:String(r.borderWidth||0.5),preAlarm:String(r.preAlarm),alarm:String(r.alarm),tx1:r.tx1.toFixed(4),ty1:r.ty1.toFixed(4),tx2:r.tx2.toFixed(4),ty2:r.ty2.toFixed(4)})}><Edit2 size={13}/></button>
                      <button className="btn-industrial" style={{width:26, height:26, padding:0, background:'#fee2e2', border:'1px solid #fecaca', color:'#991b1b', borderRadius:4}} onClick={()=>delRoi(r.id)}><Trash2 size={13}/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
