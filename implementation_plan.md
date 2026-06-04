# Refactor PD Region Handling

## Goal
- Move all PD‑region logic out of `DeviceManagementPage.tsx` into dedicated services, hooks, and UI components.
- Replace the SVG overlay with a Canvas‑based overlay for smoother rendering.
- Reduce video stream load (lower FPS / JPEG quality) via backend constants (to be adjusted separately).

## New Files
1. **src/services/pdApi.ts** – CRUD API for PD boundaries.
2. **src/hooks/usePdRegion.ts** – State & logic for loading, drawing, saving PD regions.
3. **src/components/pd/PdCanvasOverlay.tsx** – Video element + Canvas overlay (draws regions & draft polygon).
4. **src/components/pd/PdList.tsx** – Sidebar list of regions with edit/delete actions.
5. **src/components/pd/PdModal.tsx** – Modal for entering region name and thresholds.

## Modifications to Existing Files
- **DeviceManagementPage.tsx**
  - Remove all PD‑related `useState` variables and helper functions (load/save from `localStorage`).
  - Import the new hook and components.
  - Add a call to the hook (`usePdRegion(pdSelectedCamera?.id ?? null)`).
  - Replace the old SVG overlay with `<PdCanvasOverlay />`.
  - Render `<PdList />` and `<PdModal />` in the PD tab sidebar.
  - Adjust UI actions (start drawing, edit, delete) to call hook methods.

## Backend (optional for performance)
- Reduce `TARGET_FPS` from 15 fps to 12 fps (or 10 fps) and JPEG quality from 65 to 45 in the PD detection script (`test_cam153_boundaries.py`).
- Optionally switch to a lower‑resolution RTSP channel (`Channels/102`).

## Verification
1. Run `npm run build` – ensure no TypeScript errors.
2. Launch the app, open the PD tab, draw a region, save and verify it appears on the canvas.
3. Confirm that drawing is smooth (no noticeable lag) and that regions persist after page reload.
4. Test edit/delete actions.
5. (If backend changes applied) Verify reduced CPU usage and smoother video.

## Open Questions
- Do you want the backend FPS/quality changes applied now, or only the front‑end refactor?
- Preferred default values for global warning/alarm thresholds?

---
*Please review the plan. If approved, I will proceed with creating the files and updating `DeviceManagementPage.tsx`.*
