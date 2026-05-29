# Refactor PD Region Management to Modular Hook & Components

## Goal Description

Replace the monolithic PD region handling in `DeviceManagementPage.tsx` with the newly created hook `usePdRegion`, and UI components `PdCanvasOverlay`, `PdList`, and `PdModal`. The refactor will eliminate localStorage usage, switch from SVG overlay to canvas overlay for performance, and provide a clean CRUD interface backed by the `pdApi` service.

## User Review Required

- Confirm that the UI layout (camera selector, canvas, region list) should remain visually similar to the current implementation.
- Approve removal of all PD‑related state variables and functions (`pdRegions`, `pdDraft*`, `isDrawingPdRegion`, etc.) from this page.
- Approve that the new `PdModal` will be used for both creating and editing regions.

## Open Questions

> [!IMPORTANT] 
> Do you want any additional fields (e.g., region description) in the modal beyond name, warning and alarm thresholds?

> [!WARNING] 
> Existing PD region data is stored in `localStorage`. After migration, the data will be persisted via the backend API. Confirm that you are okay with discarding any locally stored regions that have not been saved to the backend.

## Proposed Changes

---
### DeviceManagementPage.tsx

- **Import Statements**: Add imports for `usePdRegion`, `PdCanvasOverlay`, `PdList`, `PdModal`.
- **Remove PD State Variables**: Delete the following state declarations and related setters:
  - `pdRegions`, `pdDraftVertices`, `isDrawingPdRegion`, `pdEditingRegion`, `pdDraftName`, `pdDraftWarn`, `pdDraftAlarm`.
- **Initialize Hook**: Call `usePdRegion(pdSelectedCamera?.id ?? null)` and destructure needed values & actions.
- **Modal Management**: Add local state `isPdModalOpen` and `modalInitial` to control `PdModal`.
- **Replace Handlers**: Rewrite `selectPdCamera`, `handlePdImageClick`, `startDrawingPdRegion`, `closePdRegionDrawing`, `savePdRegion`, `deletePdRegion`, `editPdRegion` to delegate to the hook methods (`startDrawing`, `addVertex`, `finishDrawing`, `save`, `remove`, `edit`).
- **Replace SVG Overlay**: Swap the existing `<div>` with manual SVG drawing for PD with `<PdCanvasOverlay>` component, passing required props (`imageRef`, `onClick`, `regions`, `draftVertices`, `isDrawing`).
- **Replace Region List**: Replace the PD list UI block with `<PdList>` component, providing `regions`, `onEdit`, `onDelete` callbacks.
- **Integrate PdModal**: Render `<PdModal isOpen={isPdModalOpen} onClose={() => setIsPdModalOpen(false)} onSubmit={handleModalSubmit} initial={modalInitial} />`.
- **Cleanup**: Remove all functions related to local storage persistence (`loadPdRegions`, `savePdRegionsToLocal`).

---
### PdCanvasOverlay.tsx (existing)

- Ensure it accepts props: `imageRef`, `onClick`, `regions`, `draftVertices`, `isDrawing`.
- Update internal drawing logic to use `regions` and `draftVertices` from hook.

---
### PdList.tsx (existing)

- Ensure it accepts `regions`, `onEdit(region)`, `onDelete(regionId)` props and renders list accordingly.

---
### PdModal.tsx (existing)

- Already created; ensure its `onSubmit` updates hook draft fields and triggers save.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure TypeScript compiles without errors.
- Execute unit tests (if any) for `usePdRegion` and components.

### Manual Verification
- Launch the app (`npm run dev`).
- Navigate to Device Management page, switch to "Vẽ vùng Camera PD" tab.
- Verify camera selector works, canvas displays live stream.
- Draw a new region, ensure modal appears, fill fields, save and see region appear in list.
- Edit an existing region via list, modal opens with pre‑filled data, update and save.
- Delete a region and confirm removal.
- Refresh page; regions should persist via backend API (mocked for now).
- Confirm no console errors and UI remains responsive.

---
