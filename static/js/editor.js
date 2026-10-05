"use strict";

// Map positions use image-relative percentages; all editor layout coordinates are pixels.
const DESIGN_WIDTH = 1600;
const DESIGN_HEIGHT = 900;
const state = {
    guide: null, assets: [], selectedMarkerId: null, openMarkerId: null,
    selectedItemId: null, draft: null, dirty: false, busy: false,
    drag: null, imagePurpose: null, pendingDelete: null, lastTap: null,
    numbering: null, overlayEditing: false, provisionalMarkerId: null,
};
const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const markerById = (id) => state.guide.markers.find((marker) => marker.id === id);
const itemById = (id) => state.guide.items.find((item) => item.id === id);
const categoryById = (id) => state.guide.categories.find((category) => category.id === id);
const linkedItems = (marker) => (marker?.itemIds || []).map(itemById).filter(Boolean);
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const assetUrl = (path) => path ? `/static/images/${String(path).split("/").map(encodeURIComponent).join("/")}` : "";
const floorOverlayLayout = () => state.guide?.settings?.floorOverlay;
let toastTimer;

function createPinSvg(labelValue, color) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 80 112");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(ns, "path");
    shape.setAttribute("d", "M40 0C17.9 0 0 17.9 0 40c0 28 40 72 40 72s40-44 40-72C80 17.9 62.1 0 40 0Z");
    shape.setAttribute("fill", color);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "40"); circle.setAttribute("cy", "39"); circle.setAttribute("r", "19"); circle.setAttribute("fill", "#fff");
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "40"); text.setAttribute("y", "40"); text.setAttribute("text-anchor", "middle"); text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size", String(labelValue).length > 2 ? "17" : "26"); text.setAttribute("font-weight", "900"); text.setAttribute("fill", color);
    text.textContent = labelValue;
    svg.append(shape, circle, text);
    return svg;
}
function imageElement(path, alt = "") {
    const image = document.createElement("img"); image.src = assetUrl(path); image.alt = alt; image.draggable = false; return image;
}
function toast(message, error = false) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").className = `toast visible${error ? " error" : ""}`;
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 4600);
}
function markDirty() { state.dirty = true; renderSaveState(); }
function renderSaveState() {
    $("saveState").className = `save-state${state.dirty ? "" : " saved"}`;
    $("saveState").textContent = state.busy ? "処理中…" : state.numbering ? "ピン番号を手動割り当て中" : state.draft ? "詳細情報を編集中" : state.dirty ? "未保存の変更があります" : "保存済み";
    $("saveButton").disabled = state.busy || Boolean(state.draft) || Boolean(state.numbering) || !state.guide;
    $("saveButton").title = state.numbering ? "番号の手動割り当てを完了または取り消してください" : state.draft ? "詳細情報を決定または取り消してから保存してください" : "";
}
function setBusy(busy, message = "処理しています") {
    state.busy = busy;
    $("loadingOverlay").hidden = !busy;
    $("loadingText").textContent = message;
    renderSaveState();
    updateControls();
}
function fitCanvas() {
    const scale = Math.min(innerWidth / DESIGN_WIDTH, innerHeight / DESIGN_HEIGHT);
    $("screenShell").style.width = `${DESIGN_WIDTH * scale}px`;
    $("screenShell").style.height = `${DESIGN_HEIGHT * scale}px`;
    $("editorCanvas").style.transform = `scale(${scale})`;
    fitMap();
}
function fitMap() {
    const img = $("mapImage"), area = $("mapArea");
    if (!img.naturalWidth) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    const width = Math.min(area.clientWidth, area.clientHeight * ratio);
    $("mapStage").style.width = `${width}px`;
    $("mapStage").style.height = `${width / ratio}px`;
    renderFloorOverlayEditor();
}
function updateControls() {
    const blocked = state.busy || Boolean(state.draft) || Boolean(state.numbering) || !state.guide;
    ["pinButton", "imageButton", "floorOverlayButton", "addIconButton"].forEach((id) => $(id).disabled = blocked);
    $("previewButton").disabled = blocked;
    $("renumberButton").disabled = blocked;
    const marker = state.guide && markerById(state.selectedMarkerId);
    const overlay = Boolean(state.overlayEditing && floorOverlayLayout());
    $("floorOverlayButton").classList.toggle("is-active", overlay);
    $("floorOverlayButton").setAttribute("aria-pressed", String(overlay));
    ["sizeInput", "sizeUpButton", "sizeDownButton"].forEach((id) => $(id).disabled = blocked || (!marker && !overlay));
    $("lockInput").disabled = blocked || !marker;
    $("trash").disabled = blocked || !marker;
    if ((marker || overlay) && document.activeElement !== $("sizeInput")) $("sizeInput").value = overlay ? floorOverlayLayout().width : marker.size;
    $("sizeInput").min = overlay ? "20" : "28";
    $("sizeInput").max = overlay ? "75" : "260";
    $("sizeLabel").textContent = overlay ? "幅(%)" : "サイズ";
    $("lockInput").checked = Boolean(marker?.locked);
    $("selectionName").textContent = overlay ? "フロア案内枠" : marker ? (marker.kind === "pin" ? `${categoryById(marker.categoryId)?.label || ""}・${marker.label}` : "画像") : "未選択";
    $("mapSelectionMessage").textContent = overlay ? "フロア案内枠を選択中（ドラッグで移動）" : marker ? `${marker.kind === "pin" ? `${categoryById(marker.categoryId)?.label || ""}・ピン${marker.label}` : "画像"}を選択中${marker.locked ? "（位置固定）" : ""}` : "ピン・画像・フロア案内枠を選択すると編集できます";
    $("sizeHint").textContent = overlay ? "表示幅 ／ 20〜75%" : marker ? `${marker.kind === "pin" ? `ピン ${marker.label}` : "選択中の画像"} ／ 28〜260` : "変更する対象をタップ";
    if ((marker || overlay) && !blocked) {
        const size = overlay ? floorOverlayLayout().width : marker.size;
        $("sizeUpButton").disabled = size >= (overlay ? 75 : 260);
        $("sizeDownButton").disabled = size <= (overlay ? 20 : 28);
    }
    if (state.openMarkerId) {
        const openMarker = markerById(state.openMarkerId);
        if (openMarker?.usage === "facility" && linkedItems(openMarker).length >= 1) $("addIconButton").disabled = true;
    }
    renderSaveState();
}
function updateMarkerPosition(marker, element) {
    element.style.left = `${marker.x}%`; element.style.top = `${marker.y}%`;
    element.style.setProperty("--size", `${marker.size}px`);
    element.style.setProperty("--rotation", `${marker.rotation || 0}deg`);
}
function renderFloorOverlayEditor() {
    const element = $("floorOverlayEditor");
    const layout = floorOverlayLayout();
    if (!element || !layout || !state.overlayEditing) {
        if (element) element.hidden = true;
        return;
    }
    element.hidden = false;
    element.style.left = `${layout.x}%`;
    element.style.top = `${layout.y}%`;
    element.style.width = `${layout.width}%`;
    element.classList.add("is-selected");
}
function selectFloorOverlay() {
    if (state.busy || state.draft || state.numbering) return;
    state.openMarkerId = null; state.selectedItemId = null;
    state.selectedMarkerId = null;
    state.overlayEditing = true;
    document.querySelectorAll(".map-marker").forEach((node) => node.classList.remove("is-selected"));
    renderPanel();
    renderFloorOverlayEditor();
    updateControls();
    toast("青い枠をドラッグして表示位置を調整できます。");
}

function toggleFloorOverlay() {
    if (state.busy || state.draft || state.numbering) return;
    if (!state.overlayEditing) {
        selectFloorOverlay();
        return;
    }
    state.overlayEditing = false;
    renderFloorOverlayEditor();
    updateControls();
    toast("フロア案内枠を閉じました。");
}
function beginFloorOverlayDrag(event) {
    const layout = floorOverlayLayout();
    if (!layout || state.busy || state.draft || state.numbering || event.button !== 0 || state.drag) return;
    event.preventDefault();
    selectFloorOverlay();
    const element = $("floorOverlayEditor");
    const rect = $("mapStage").getBoundingClientRect();
    const drag = {kind: "floorOverlay", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: layout.x, originalY: layout.y, rect, moved: false};
    state.drag = drag;
    element.setPointerCapture(event.pointerId);
    const move = (e) => {
        if (e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        element.classList.add("dragging");
        layout.x = Math.min(100 - layout.width, Math.max(0, drag.originalX + dx / rect.width * 100));
        layout.y = Math.min(100 - layout.width / 2, Math.max(0, drag.originalY + dy / rect.height * 100));
        renderFloorOverlayEditor();
    };
    const finish = (e, cancelled = false) => {
        if (e.pointerId !== drag.pointerId || state.drag !== drag) return;
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", end);
        element.removeEventListener("pointercancel", cancel);
        if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
        state.drag = null;
        element.classList.remove("dragging");
        if (cancelled) { layout.x = drag.originalX; layout.y = drag.originalY; }
        else if (drag.moved) { layout.x = Number(layout.x.toFixed(2)); layout.y = Number(layout.y.toFixed(2)); markDirty(); }
        renderFloorOverlayEditor();
    };
    const end = (e) => finish(e, false);
    const cancel = (e) => finish(e, true);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", cancel);
}
function renderMarkers() {
    $("mapMarkers").replaceChildren(...state.guide.markers.map((marker) => {
        const button = document.createElement("button");
        button.type = "button"; button.className = `map-marker${marker.kind === "image" ? " is-image" : ""}`;
        button.classList.toggle("is-facility", marker.usage === "facility");
        button.dataset.markerId = marker.id;
        button.classList.toggle("is-selected", marker.id === state.selectedMarkerId);
        button.classList.toggle("is-locked", Boolean(marker.locked));
        button.classList.toggle("numbering-target", Boolean(state.numbering?.pinIds.includes(marker.id)));
        button.classList.toggle("numbered", Boolean(state.numbering?.assignedIds.includes(marker.id)));
        button.style.zIndex = marker.layer + 1;
        updateMarkerPosition(marker, button);
        const category = categoryById(marker.categoryId);
        const label = marker.kind === "pin" ? `${category?.label || ""} ピン${marker.label}` : linkedItems(marker)[0]?.title || "施設画像";
        button.setAttribute("aria-label", label);
        button.title = marker.kind === "pin" ? `${label}（ダブルクリックで編集）` : label;
        button.append(marker.kind === "pin" ? createPinSvg(marker.label, marker.color) : imageElement(marker.image));
        button.addEventListener("pointerdown", (event) => beginDrag(event, marker, button));
        button.addEventListener("dblclick", (event) => { event.preventDefault(); if (!state.busy && !state.draft && !state.numbering && (marker.kind === "pin" || marker.usage === "facility")) openPin(marker.id); });
        button.addEventListener("keydown", (event) => {
            if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!state.busy && !state.draft) { selectMarker(marker.id); if (marker.kind === "pin" || marker.usage === "facility") openPin(marker.id); } }
        });
        return button;
    }));
    updateControls();
}
function selectMarker(id) {
    if (state.draft || state.busy) return;
    state.overlayEditing = false;
    state.selectedMarkerId = id;
    renderFloorOverlayEditor();
    document.querySelectorAll(".map-marker").forEach((node) => node.classList.toggle("is-selected", node.dataset.markerId === id));
    updateControls();
}
function nextPinLabel(categoryId) {
    const used = new Set(state.guide.markers.filter((marker) => marker.kind === "pin" && marker.categoryId === categoryId).map((marker) => marker.label));
    let number = 1; while (used.has(String(number))) number += 1;
    return String(number);
}
function newMarker(fields) {
    return { id: uid("marker"), itemId: null, itemIds: [], usage: "experience", kind: "pin", categoryId: "experience", label: "", color: "#e50062", image: null, x: 50, y: 50, size: 40, rotation: 0, layer: Math.min(100, Math.max(0, ...state.guide.markers.map((m) => m.layer)) + 1), locked: false, ...fields };
}
function closeCategory() { $("categoryPopover").hidden = true; $("pinButton").setAttribute("aria-expanded", "false"); }
function addPin() {
    if (state.busy || state.draft) return;
    if (state.guide.markers.length >= 800) { toast("ピン・画像は800件以内で登録してください。", true); return; }
    const category = categoryById($("categoryInput").value);
    if (!category) return;
    const usage = category.area === "facility" ? "facility" : category.id === "food" ? "stall" : "experience";
    const marker = newMarker({categoryId: category.id, color: category.color, usage, label: nextPinLabel(category.id)});
    state.guide.markers.push(marker); state.selectedMarkerId = marker.id;
    closeCategory(); renderMarkers(); markDirty();
    toast("中央にピンを配置しました。ドラッグで移動できます。");
}
function applySize(raw, finalize = false) {
    if (state.overlayEditing) {
        const layout = floorOverlayLayout();
        if (!layout || state.draft || state.busy) return;
        let width = Number(raw);
        if (String(raw).trim() === "" || !Number.isFinite(width)) { if (finalize) $("sizeInput").value = layout.width; return; }
        if (!finalize && (width < 20 || width > 75)) return;
        width = Math.round(Math.min(75, Math.max(20, width)) * 10) / 10;
        const nextX = Math.min(layout.x, 100 - width);
        const nextY = Math.min(layout.y, 100 - width / 2);
        if (width !== layout.width || nextX !== layout.x || nextY !== layout.y) { layout.width = width; layout.x = nextX; layout.y = nextY; markDirty(); }
        if (finalize) $("sizeInput").value = width;
        renderFloorOverlayEditor(); updateControls();
        return;
    }
    const marker = markerById(state.selectedMarkerId);
    if (!marker || state.draft || state.busy) return;
    let size = Number(raw);
    if (String(raw).trim() === "" || !Number.isFinite(size)) { if (finalize) $("sizeInput").value = marker.size; return; }
    if (!finalize && (size < 28 || size > 260)) return;
    size = Math.round(Math.min(260, Math.max(28, size)) * 10) / 10;
    if (size !== marker.size) { marker.size = size; markDirty(); }
    if (finalize) $("sizeInput").value = size;
    const element = document.querySelector(`[data-marker-id="${marker.id}"]`);
    if (element) updateMarkerPosition(marker, element);
    updateControls();
}
function overTrash(event) {
    const r = $("trash").getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
}
function beginDrag(event, marker, element) {
    if (state.numbering) {
        event.preventDefault();
        assignManualNumber(marker.id);
        return;
    }
    if (state.busy || state.draft || event.button !== 0 || state.drag) return;
    event.preventDefault(); selectMarker(marker.id); element.focus({preventScroll: true});
    if (marker.locked) { toast("このピン・画像は位置固定されています。位置固定を外すと移動できます。"); return; }
    const drag = { marker, element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: marker.x, originalY: marker.y, rect: $("mapStage").getBoundingClientRect(), moved: false };
    state.drag = drag; element.setPointerCapture(event.pointerId);
    const move = (e) => {
        if (e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true; element.classList.add("dragging");
        marker.x = Math.min(100, Math.max(0, drag.originalX + dx / drag.rect.width * 100));
        marker.y = Math.min(100, Math.max(0, drag.originalY + dy / drag.rect.height * 100));
        updateMarkerPosition(marker, element); $("trash").classList.toggle("is-over", overTrash(e));
    };
    const end = (e) => {
        if (e.pointerId !== drag.pointerId) return;
        element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", end); element.removeEventListener("pointercancel", cancel); element.removeEventListener("lostpointercapture", cancel);
        if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
        state.drag = null; element.classList.remove("dragging"); $("trash").classList.remove("is-over");
        if (drag.moved) {
            state.lastTap = null;
            if (overTrash(e)) {
                marker.x = drag.originalX; marker.y = drag.originalY; updateMarkerPosition(marker, element);
                requestDeleteMarker(marker.id);
            }
            else { marker.x = Number(marker.x.toFixed(3)); marker.y = Number(marker.y.toFixed(3)); markDirty(); }
        } else if (e.pointerType === "touch") {
            const now = Date.now();
            if (state.lastTap?.id === marker.id && now - state.lastTap.time < 450 && (marker.kind === "pin" || marker.usage === "facility")) { state.lastTap = null; openPin(marker.id); }
            else state.lastTap = {id: marker.id, time: now};
        }
    };
    const cancel = (e) => {
        if (e.pointerId !== drag.pointerId || state.drag !== drag) return;
        marker.x = drag.originalX; marker.y = drag.originalY; updateMarkerPosition(marker, element);
        drag.moved = false; state.lastTap = null;
        // Cancellation must not be treated as a tap or trash drop.
        end({pointerId: e.pointerId, pointerType: "cancelled"});
    };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", end); element.addEventListener("pointercancel", cancel); element.addEventListener("lostpointercapture", cancel);
}
function openPin(id) {
    if (state.draft || state.busy) return;
    const marker = markerById(id); if (!marker || (marker.kind !== "pin" && marker.usage !== "facility")) return;
    state.openMarkerId = id; state.selectedItemId = null; selectMarker(id); renderPanel();
    if (marker.usage === "facility") {
        const item = linkedItems(marker)[0];
        beginDraft(item?.image || marker.image, item || null);
    }
}
function closePanel() {
    if (state.busy) return;
    if (state.draft) { cancelDraft(); return; }
    state.openMarkerId = null; state.selectedItemId = null; renderPanel();
}
function renderPanel() {
    const marker = markerById(state.openMarkerId);
    $("sidePanel").hidden = !marker; $("workspace").classList.toggle("has-panel", Boolean(marker));
    if (marker) {
        $("sidePinVisual").replaceChildren(marker.kind === "pin" ? createPinSvg(marker.label, marker.color) : imageElement(marker.image));
        $("sideCategory").textContent = categoryById(marker.categoryId)?.label || "ピンの編集";
        $("closePanelButton").hidden = Boolean(state.draft);
        $("closePanelButton").title = "編集欄を閉じる";
        $("iconListPanel").hidden = Boolean(state.draft); $("detailForm").hidden = !state.draft;
        if (!state.draft) renderIconList();
    }
    updateControls(); fitMap();
}
function renderIconList() {
    const items = linkedItems(markerById(state.openMarkerId));
    const nodes = items.map((item) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "icon-card";
        button.classList.toggle("is-selected", item.id === state.selectedItemId); button.setAttribute("aria-pressed", String(item.id === state.selectedItemId)); button.dataset.itemId = item.id;
        button.append(imageElement(item.image)); const title = document.createElement("span"); title.textContent = item.title; button.append(title);
        button.addEventListener("click", () => { state.selectedItemId = item.id; renderIconList(); });
        button.addEventListener("dblclick", () => beginDraft(item.image, item));
        return button;
    });
    if (!nodes.length) { const empty = document.createElement("p"); empty.className = "empty-list"; empty.textContent = "このピンにはまだアイコンがありません。上の「アイコン追加」から登録できます。"; nodes.push(empty); }
    $("iconList").replaceChildren(...nodes);
    $("deleteIconButton").disabled = !state.selectedItemId || state.busy;
    $("editIconButton").disabled = !state.selectedItemId || state.busy;
    $("iconSelectionHint").textContent = state.selectedItemId ? `選択中：${itemById(state.selectedItemId)?.title || ""}` : "アイコンを選択して編集・削除できます";
}
function beginDraft(image, existing = null, initial = {}) {
    const marker = markerById(state.openMarkerId); if (!marker || state.draft || state.busy) return;
    if (!existing && state.guide.items.length >= 500) { toast("企画は500件以内で登録してください。", true); return; }
    state.draft = existing ? clone(existing) : {id: uid("item"), type: marker.usage, categoryId: marker.categoryId, title: "", image, department: "", grade: "", organization: "", building: "", floor: "", organizer: "", description: "", waitState: "none", waitMinutes: null, ...initial};
    state.draft.isNew = !existing;
    $("detailForm").reset();
    for (const field of ["title", "department", "grade", "organization", "building", "floor", "description"]) { $(`${field}Input`).value = state.draft[field] || ""; $(`${field}Input`).setCustomValidity(""); }
    $("detailImage").src = assetUrl(state.draft.image);
    $("legacyNotice").hidden = !existing || existing.detailsVersion >= (state.draft.type === "facility" ? 3 : 2);
    syncDraftForm(); syncDepartment(); syncBuilding(); closeCategory(); renderPanel();
    $("detailForm").querySelector(".detail-fields").scrollTop = 0;
    $("titleInput").focus({preventScroll: true});
}
function syncDraftForm() {
    const facility = state.draft?.type === "facility";
    $("detailForm").classList.toggle("is-facility-draft", facility);
    $("titleFieldLabel").textContent = facility ? "施設名" : "企画・展示名";
    $("titleInput").placeholder = facility ? "施設名を入力" : "企画・展示名を入力";
    $("departmentFields").hidden = facility;
    $("organizationField").hidden = facility;
    $("descriptionField").hidden = facility;
    $("departmentInput").required = !facility;
    $("descriptionInput").required = !facility;
    $("departmentInput").disabled = facility;
    $("descriptionInput").disabled = facility;
    if (facility) {
        $("departmentInput").value = ""; $("gradeInput").value = ""; $("organizationInput").value = ""; $("descriptionInput").value = "";
    }
}
function syncDepartment() {
    if (state.draft?.type === "facility") {
        $("departmentInput").disabled = true; $("gradeInput").disabled = true; $("gradeInput").required = false;
        $("organizationInput").disabled = true; $("organizationInput").required = false;
        return;
    }
    const department = $("departmentInput").value;
    const regular = Boolean(department && department !== "その他");
    $("gradeInput").disabled = !regular; $("gradeInput").required = regular;
    $("organizationInput").disabled = department !== "その他"; $("organizationInput").required = department === "その他";
    if (!regular) $("gradeInput").value = "";
    if (department !== "その他") $("organizationInput").value = "";
    $("organizationInput").setCustomValidity("");
}
function syncBuilding() {
    const needsFloor = /^[1-9]$/.test($("buildingInput").value) || $("buildingInput").value === "本館";
    $("floorInput").disabled = !needsFloor;
    $("floorInput").required = needsFloor;
    $("floorRequired").hidden = !needsFloor;
    if (!needsFloor) $("floorInput").value = "";
    $("floorInput").setCustomValidity("");
}
function confirmDraft(event) {
    event.preventDefault(); if (!state.draft || state.busy) return;
    for (const field of ["title", "organization", "description"]) {
        const input = $(`${field}Input`); input.value = input.value.trim();
        input.setCustomValidity(input.required && !input.disabled && !input.value ? "この項目を入力してください。" : "");
    }
    if (!$("detailForm").reportValidity()) return;
    const marker = markerById(state.openMarkerId); if (!marker) return;
    const item = clone(state.draft); delete item.isNew;
    for (const field of ["title", "department", "grade", "organization", "building", "floor", "description"]) item[field] = $(`${field}Input`).value.trim();
    if (item.type === "facility") {
        item.department = ""; item.grade = ""; item.organization = ""; item.organizer = ""; item.description = ""; item.detailsVersion = 3;
    } else {
        item.organizer = item.department === "その他" ? item.organization : `${item.department} ${item.grade}年`;
        item.detailsVersion = 2;
    }
    if (state.draft.isNew) { state.guide.items.push(item); marker.itemIds.push(item.id); }
    else {
        const previous = itemById(item.id);
        const locationChanged = previous && (previous.building !== item.building || previous.floor !== item.floor);
        const index = state.guide.items.findIndex((entry) => entry.id === item.id); state.guide.items[index] = item;
        if (locationChanged) state.guide.floorPlans?.forEach((plan) => { plan.markers = plan.markers.filter((entry) => entry.itemId !== item.id); });
    }
    marker.itemId = marker.itemIds[0] || null;
    if (marker.usage === "facility" && marker.kind === "image") marker.image = item.image;
    if (state.provisionalMarkerId === marker.id) state.provisionalMarkerId = null;
    state.selectedItemId = item.id; state.draft = null;
    if (item.type === "facility") { state.openMarkerId = null; state.selectedItemId = null; }
    markDirty(); renderMarkers(); renderPanel();
    toast("企画情報を決定しました。「すべて保存」で保存できます。");
}
function cancelDraft() {
    if (state.busy) return;
    const provisionalId = state.provisionalMarkerId;
    state.draft = null; state.provisionalMarkerId = null;
    if (provisionalId) {
        state.guide.markers = state.guide.markers.filter((marker) => marker.id !== provisionalId);
        state.openMarkerId = null; state.selectedMarkerId = null; state.selectedItemId = null;
        renderMarkers(); renderPanel(); toast("施設画像の追加を取り消しました。");
        return;
    }
    if (markerById(state.openMarkerId)?.usage === "facility") { state.openMarkerId = null; state.selectedItemId = null; }
    renderPanel(); toast("入力を取り消しました。");
}
function requestDeleteItem() {
    const item = itemById(state.selectedItemId); if (!item || state.busy) return;
    state.pendingDelete = {kind: "item", id: item.id};
    $("deleteTitle").textContent = "このアイコンを削除しますか？";
    $("deletePreview").replaceChildren(imageElement(item.image, item.title));
    $("deleteItemName").textContent = item.title;
    $("deleteMessage").textContent = "このピンから企画情報を削除します。元の画像素材は残ります。";
    $("deleteDialog").showModal(); $("cancelDeleteButton").focus();
}
function requestDeleteMarker(markerId = state.selectedMarkerId) {
    const marker = markerById(markerId); if (!marker || state.draft || state.busy) return;
    state.selectedMarkerId = marker.id;
    state.pendingDelete = {kind: "marker", id: marker.id};
    $("deleteTitle").textContent = "選択中のピン・画像を削除しますか？";
    $("deletePreview").replaceChildren(marker.kind === "pin" ? createPinSvg(marker.label, marker.color) : imageElement(marker.image));
    $("deleteItemName").textContent = marker.kind === "pin" ? `ピン ${marker.label}` : linkedItems(marker)[0]?.title || "施設画像";
    $("deleteMessage").textContent = marker.itemIds.length ? `この場所に登録した企画情報（${marker.itemIds.length}件）も削除します。` : "削除後は元に戻せません。";
    $("deleteDialog").showModal(); $("cancelDeleteButton").focus();
}
function confirmDelete() {
    const pending = state.pendingDelete; if (!pending) return;
    $("deleteDialog").close(); state.pendingDelete = null;
    if (pending.kind === "marker") { removeMarker(pending.id); return; }
    state.guide.items = state.guide.items.filter((item) => item.id !== pending.id);
    state.guide.markers.forEach((marker) => { marker.itemIds = marker.itemIds.filter((id) => id !== pending.id); marker.itemId = marker.itemIds[0] || null; });
    state.guide.floorPlans?.forEach((plan) => { plan.markers = plan.markers.filter((marker) => marker.itemId !== pending.id); });
    state.selectedItemId = null; markDirty(); renderPanel(); toast("アイコンを削除しました。");
}
function removeMarker(id) {
    const marker = markerById(id); if (!marker) return;
    const ids = new Set(marker.itemIds);
    state.guide.items = state.guide.items.filter((item) => !ids.has(item.id));
    state.guide.floorPlans?.forEach((plan) => { plan.markers = plan.markers.filter((marker) => !ids.has(marker.itemId)); });
    state.guide.markers = state.guide.markers.filter((entry) => entry.id !== id);
    if (state.selectedMarkerId === id) state.selectedMarkerId = null;
    if (state.openMarkerId === id) { state.openMarkerId = null; state.selectedItemId = null; }
    renderMarkers(); renderPanel(); markDirty(); toast("ピン・画像と、その場所の企画情報を削除しました。");
}
function chooseImage(kind) {
    if (state.busy || (state.draft && kind !== "replace")) return;
    if (kind === "item" && !state.openMarkerId) return;
    closeCategory(); state.imagePurpose = {kind, markerId: state.openMarkerId};
    $("imageFileInput").value = ""; $("imageFileInput").click();
}
function useImage(asset) {
    const purpose = state.imagePurpose; state.imagePurpose = null; if (!purpose) return;
    if (purpose.kind === "replace") {
        if (state.draft) { state.draft.image = asset.path; $("detailImage").src = assetUrl(asset.path); }
    } else if (purpose.kind === "item") {
        if (state.openMarkerId === purpose.markerId) beginDraft(asset.path);
    } else {
        if (state.guide.markers.length >= 800 || state.guide.items.length >= 500) { toast("登録件数の上限に達しました。", true); return; }
        const category = state.guide.categories.find((entry) => entry.area === "facility");
        const marker = newMarker({usage: "facility", kind: "image", categoryId: category.id, color: category.color, image: asset.path, size: 64, itemId: null, itemIds: []});
        state.guide.markers.push(marker); state.selectedMarkerId = marker.id; state.openMarkerId = marker.id; state.provisionalMarkerId = marker.id;
        renderMarkers();
        beginDraft(asset.path, null, {title: asset.name.slice(0, 80) || "施設案内"});
        toast("施設名と場所を入力して「決定」を押してください。");
    }
}
async function uploadImage(event) {
    const file = event.target.files[0]; if (!file || !state.imagePurpose) return;
    if (file.size > 25 * 1024 * 1024) { toast("画像は25MB以下にしてください。", true); state.imagePurpose = null; return; }
    const data = new FormData(); data.append("image", file); data.append("removeBackground", "false");
    setBusy(true, "画像を読み込んでいます");
    try {
        const response = await fetch("/api/editor/upload", {method: "POST", body: data});
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "画像を追加できませんでした。");
        state.assets.push(result.asset); setBusy(false); useImage(result.asset);
    } catch (error) { state.imagePurpose = null; setBusy(false); toast(error.message || "画像を追加できませんでした。", true); }
}
function syncRenumberDialog() {
    const categoryScope = document.querySelector('input[name="renumberScope"]:checked').value === "category";
    $("renumberCategory").disabled = !categoryScope;
    const manual = document.querySelector('input[name="renumberMode"][value="manual"]');
    manual.disabled = !categoryScope;
    $("manualModeLabel").classList.toggle("is-disabled", !categoryScope);
    if (!categoryScope && manual.checked) document.querySelector('input[name="renumberMode"][value="auto"]').checked = true;
    const mode = document.querySelector('input[name="renumberMode"]:checked').value;
    $("renumberHelp").textContent = mode === "manual" ? "対象カテゴリーのピンを、1番にしたいものから順番に押してください。" : "現在のピンの登録順に、カテゴリーごとに1から割り当てます。";
}
function openRenumberDialog() {
    if (state.busy || state.draft || state.numbering) return;
    document.querySelector('input[name="renumberScope"][value="all"]').checked = true;
    document.querySelector('input[name="renumberMode"][value="auto"]').checked = true;
    syncRenumberDialog(); $("renumberDialog").showModal();
}
function autoRenumber(categoryId = null) {
    const categoryIds = categoryId ? [categoryId] : state.guide.categories.map((category) => category.id);
    for (const id of categoryIds) {
        let number = 1;
        state.guide.markers.filter((marker) => marker.kind === "pin" && marker.categoryId === id).forEach((marker) => { marker.label = String(number++); });
    }
    renderMarkers(); if (state.openMarkerId) renderPanel(); markDirty(); toast("ピン番号をカテゴリーごとに振り直しました。");
}
function beginManualNumbering(categoryId) {
    const pins = state.guide.markers.filter((marker) => marker.kind === "pin" && marker.categoryId === categoryId);
    if (!pins.length) { toast("選択したカテゴリーにピンがありません。", true); return; }
    state.numbering = {
        categoryId,
        pinIds: pins.map((marker) => marker.id),
        assignedIds: [],
        originalLabels: Object.fromEntries(pins.map((marker) => [marker.id, marker.label])),
        next: 1,
    };
    pins.forEach((marker) => { marker.label = ""; });
    state.openMarkerId = null; state.selectedItemId = null; state.selectedMarkerId = null;
    $("workspace").classList.add("manual-numbering");
    $("defaultToolbarMessage").hidden = true; $("manualNumberingBar").hidden = false;
    updateManualNumberingStatus(); renderMarkers(); renderPanel();
    toast("1番にしたいピンから順番に押してください。");
}
function updateManualNumberingStatus() {
    if (!state.numbering) return;
    const category = categoryById(state.numbering.categoryId);
    $("manualNumberingStatus").textContent = `${category?.label || "カテゴリー"}：次は ${state.numbering.next} 番（${state.numbering.assignedIds.length}/${state.numbering.pinIds.length}）`;
    $("finishManualNumberingButton").disabled = state.numbering.assignedIds.length !== state.numbering.pinIds.length;
    renderSaveState();
}
function assignManualNumber(markerId) {
    if (!state.numbering) return;
    if (!state.numbering.pinIds.includes(markerId)) { toast("選択したカテゴリーのピンを押してください。", true); return; }
    if (state.numbering.assignedIds.includes(markerId)) { toast("このピンにはすでに番号を割り当てています。"); return; }
    markerById(markerId).label = String(state.numbering.next++);
    state.numbering.assignedIds.push(markerId); updateManualNumberingStatus(); renderMarkers();
}
function finishManualNumbering() {
    if (!state.numbering || state.numbering.assignedIds.length !== state.numbering.pinIds.length) return;
    state.numbering = null; $("workspace").classList.remove("manual-numbering");
    $("defaultToolbarMessage").hidden = false; $("manualNumberingBar").hidden = true;
    renderMarkers(); markDirty(); toast("手動でピン番号を割り当てました。");
}
function cancelManualNumbering() {
    if (!state.numbering) return;
    Object.entries(state.numbering.originalLabels).forEach(([id, label]) => { const marker = markerById(id); if (marker) marker.label = label; });
    state.numbering = null; $("workspace").classList.remove("manual-numbering");
    $("defaultToolbarMessage").hidden = false; $("manualNumberingBar").hidden = true;
    renderMarkers(); toast("番号の手動割り当てを取り消しました。");
}
function startRenumbering() {
    const categoryScope = document.querySelector('input[name="renumberScope"]:checked').value === "category";
    const mode = document.querySelector('input[name="renumberMode"]:checked').value;
    const categoryId = categoryScope ? $("renumberCategory").value : null;
    $("renumberDialog").close();
    if (mode === "manual") beginManualNumbering(categoryId); else autoRenumber(categoryId);
}
async function saveGuide() {
    if (state.busy || state.draft || !state.guide) return false;
    closeCategory(); setBusy(true, "案内マップを保存しています");
    try {
        const response = await fetch("/api/editor/save", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({expectedRevision: state.guide.revision, guide: state.guide})});
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "保存できませんでした。");
        state.guide = result.guide; state.dirty = false;
        renderMarkers(); renderPanel(); setBusy(false);
        toast("保存しました。案内画面へ約15秒以内に反映されます。"); return true;
    } catch (error) {
        setBusy(false); $("saveState").className = "save-state error"; $("saveState").textContent = "保存できませんでした";
        toast(error.message || "通信を確認して、もう一度保存してください。", true); return false;
    }
}
function bindEvents() {
    window.addEventListener("resize", fitCanvas);
    $("mapImage").addEventListener("load", fitMap);
    $("pinButton").addEventListener("click", () => { const open = $("categoryPopover").hidden; $("categoryPopover").hidden = !open; $("pinButton").setAttribute("aria-expanded", String(open)); if (open) $("categoryInput").focus(); });
    $("categoryInput").addEventListener("change", () => $("categorySwatch").style.background = categoryById($("categoryInput").value).color);
    $("cancelPinButton").addEventListener("click", closeCategory); $("addPinButton").addEventListener("click", addPin);
    document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".pin-tool")) closeCategory(); });
    $("imageButton").addEventListener("click", () => chooseImage("facility"));
    $("floorOverlayButton").addEventListener("click", toggleFloorOverlay);
    $("floorOverlayEditor").addEventListener("pointerdown", beginFloorOverlayDrag);
    $("addIconButton").addEventListener("click", () => chooseImage("item"));
    $("changeIconButton").addEventListener("click", () => chooseImage("replace"));
    $("imageFileInput").addEventListener("change", uploadImage);
    $("imageFileInput").addEventListener("cancel", () => state.imagePurpose = null);
    $("sizeInput").addEventListener("input", () => applySize($("sizeInput").value));
    $("sizeInput").addEventListener("change", () => applySize($("sizeInput").value, true));
    $("sizeUpButton").addEventListener("click", () => applySize(state.overlayEditing ? floorOverlayLayout().width + 1 : markerById(state.selectedMarkerId).size + 1, true));
    $("sizeDownButton").addEventListener("click", () => applySize(state.overlayEditing ? floorOverlayLayout().width - 1 : markerById(state.selectedMarkerId).size - 1, true));
    $("lockInput").addEventListener("change", () => { const marker = markerById(state.selectedMarkerId); if (!marker) return; marker.locked = $("lockInput").checked; renderMarkers(); markDirty(); toast(marker.locked ? "位置を固定しました。" : "位置固定を解除しました。"); });
    $("renumberButton").addEventListener("click", openRenumberDialog);
    document.querySelectorAll('input[name="renumberScope"],input[name="renumberMode"]').forEach((input) => input.addEventListener("change", syncRenumberDialog));
    $("cancelRenumberButton").addEventListener("click", () => $("renumberDialog").close());
    $("startRenumberButton").addEventListener("click", startRenumbering);
    $("finishManualNumberingButton").addEventListener("click", finishManualNumbering);
    $("cancelManualNumberingButton").addEventListener("click", cancelManualNumbering);
    $("closePanelButton").addEventListener("click", closePanel);
    $("departmentInput").addEventListener("change", syncDepartment);
    $("buildingInput").addEventListener("change", syncBuilding);
    ["title", "organization", "description"].forEach((field) => $(`${field}Input`).addEventListener("input", () => $(`${field}Input`).setCustomValidity("")));
    $("detailForm").addEventListener("submit", confirmDraft);
    $("cancelDetailButton").addEventListener("click", cancelDraft);
    $("editIconButton").addEventListener("click", () => { const item = itemById(state.selectedItemId); if (item) beginDraft(item.image, item); });
    $("deleteIconButton").addEventListener("click", requestDeleteItem);
    $("trash").addEventListener("click", () => requestDeleteMarker());
    $("cancelDeleteButton").addEventListener("click", () => { state.pendingDelete = null; $("deleteDialog").close(); });
    $("deleteDialog").addEventListener("cancel", () => state.pendingDelete = null);
    $("confirmDeleteButton").addEventListener("click", confirmDelete);
    $("saveButton").addEventListener("click", saveGuide);
    $("floorEditorButton").addEventListener("click", () => { location.href = "/floors"; });
    $("previewButton").addEventListener("click", () => { window.open("/preview", "guidePreview"); if (state.dirty) toast("保存済みの案内画面を開きました。変更の反映には「すべて保存」を押してください。"); });
    $("retryButton").addEventListener("click", () => location.reload());
    window.addEventListener("beforeunload", (event) => { if (state.dirty || state.draft || state.numbering) { event.preventDefault(); event.returnValue = ""; } });
    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveGuide(); }
        if (event.key === "Escape" && !$("deleteDialog").open && !$("renumberDialog").open) closeCategory();
    });
}
async function start() {
    fitCanvas(); bindEvents();
    $("pinToolVisual").replaceChildren(createPinSvg("1", "#ee4b43"));
    try {
        const guideResponse = await fetch("/api/editor/guide", {cache: "no-store"});
        if (!guideResponse.ok) throw new Error("編集データを読み込めませんでした。");
        state.guide = await guideResponse.json();
        state.guide.markers.forEach((marker) => { if (typeof marker.locked !== "boolean") marker.locked = false; });
        state.guide.settings.floorOverlay ||= {x: 2, y: 50, width: 42};
        $("mapImage").src = assetUrl(state.guide.settings.mapImage);
        $("categoryInput").replaceChildren(...state.guide.categories.filter((category) => category.area !== "facility").map((category) => { const option = document.createElement("option"); option.value = category.id; option.textContent = category.label; return option; }));
        $("renumberCategory").replaceChildren(...state.guide.categories.map((category) => { const option = document.createElement("option"); option.value = category.id; option.textContent = category.label; return option; }));
        $("categorySwatch").style.background = categoryById($("categoryInput").value).color;
        renderMarkers(); renderPanel(); $("loadingOverlay").hidden = true;
    } catch (error) { $("loadingText").textContent = error.message; $("retryButton").hidden = false; $("saveButton").disabled = true; $("saveState").textContent = "読み込みエラー"; }
}
start();
