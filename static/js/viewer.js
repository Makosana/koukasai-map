"use strict";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const MAP_BASE_WIDTH = 80;

const state = {
    guide: null,
    selectedCategory: "all",
    selectedItemId: null,
    selectedPinId: null,
    detailReturnPinId: null,
    detailReturnCategory: "all",
    zoom: 1,
};

const elements = {
    screenShell: document.getElementById("screenShell"),
    kioskCanvas: document.getElementById("kioskCanvas"),
    brandTitle: document.getElementById("brandTitle"),
    brandSubtitle: document.getElementById("brandSubtitle"),
    instructionText: document.getElementById("instructionText"),
    schoolQr: document.getElementById("schoolQr"),
    instagramQr: document.getElementById("instagramQr"),
    categoryButtons: document.getElementById("categoryButtons"),
    detailPanel: document.getElementById("detailPanel"),
    detailContent: document.getElementById("detailContent"),
    qrFooter: document.getElementById("qrFooter"),
    topBand: document.getElementById("topBand"),
    topBandTitle: document.getElementById("topBandTitle"),
    topEvents: document.getElementById("topEvents"),
    lowerLeftBand: document.getElementById("lowerLeftBand"),
    lowerLeftTitle: document.getElementById("lowerLeftTitle"),
    lowerLeftEvents: document.getElementById("lowerLeftEvents"),
    lowerRightBand: document.getElementById("lowerRightBand"),
    lowerRightTitle: document.getElementById("lowerRightTitle"),
    lowerRightEvents: document.getElementById("lowerRightEvents"),
    facilityEvents: document.getElementById("facilityEvents"),
    campusMap: document.getElementById("campusMap"),
    mapMarkers: document.getElementById("mapMarkers"),
    mapStage: document.getElementById("mapStage"),
    mapViewport: document.getElementById("mapViewport"),
    floorOverlay: document.getElementById("floorOverlay"),
    floorOverlayTitle: document.getElementById("floorOverlayTitle"),
    floorOverlayStage: document.getElementById("floorOverlayStage"),
    floorOverlayImage: document.getElementById("floorOverlayImage"),
    floorOverlayMarkers: document.getElementById("floorOverlayMarkers"),
    activeFilterDot: document.getElementById("activeFilterDot"),
    activeFilterLabel: document.getElementById("activeFilterLabel"),
    zoomInButton: document.getElementById("zoomInButton"),
    zoomOutButton: document.getElementById("zoomOutButton"),
    zoomResetButton: document.getElementById("zoomResetButton"),
    resetAllButton: document.getElementById("resetAllButton"),
    loading: document.getElementById("loading"),
    errorScreen: document.getElementById("errorScreen"),
    eventIconTemplate: document.getElementById("eventIconTemplate"),
    facilityTemplate: document.getElementById("facilityButtonTemplate"),
};

const STATIC_IMAGE_BASE = window.KOUKA_STATIC_BASE ?? "/static/images/";
const GUIDE_URL = window.KOUKA_GUIDE_URL ?? "/api/guide";

function assetUrl(path) {
    if (!path) return "";
    return `${STATIC_IMAGE_BASE}${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

function fitCanvas() {
    const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
    elements.screenShell.style.width = `${DESIGN_WIDTH * scale}px`;
    elements.screenShell.style.height = `${DESIGN_HEIGHT * scale}px`;
    elements.kioskCanvas.style.transform = `scale(${scale})`;
    fitMapStage();
}

function fitMapStage() {
    const image = elements.campusMap;
    if (!image.naturalWidth) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = Math.min(elements.mapViewport.clientWidth * .9, (elements.mapViewport.clientHeight - 8) * ratio);
    elements.mapStage.style.width = `${width * state.zoom}px`;
    elements.mapStage.style.aspectRatio = String(ratio);
    requestAnimationFrame(fitFloorOverlay);
}

function fitFloorOverlay() {
    if (elements.floorOverlay.hidden) return;
    const layout = state.guide.settings.floorOverlay || {x:2,y:50,width:42};
    const stage = elements.mapStage;
    const ratio = elements.floorOverlayImage.naturalWidth / elements.floorOverlayImage.naturalHeight || 2;
    const width = Math.min(stage.clientWidth * layout.width / 100, (stage.clientHeight - 12) * ratio);
    elements.floorOverlay.style.width = `${width}px`;
    elements.floorOverlay.style.left = `${Math.max(0, Math.min(stage.clientWidth * layout.x / 100, stage.clientWidth - elements.floorOverlay.offsetWidth))}px`;
    elements.floorOverlay.style.top = `${Math.max(0, Math.min(stage.clientHeight * layout.y / 100, stage.clientHeight - elements.floorOverlay.offsetHeight))}px`;
}
elements.campusMap.addEventListener("load", fitMapStage);

function categoryById(categoryId) {
    return state.guide.categories.find((category) => category.id === categoryId);
}

function itemById(itemId) {
    return state.guide.items.find((item) => item.id === itemId);
}

function markerForItem(itemId) {
    return state.guide.markers.find((marker) => (marker.itemIds || [marker.itemId]).includes(itemId));
}

function floorPlanForItem(item) {
    return state.guide.floorPlans?.find((plan) => plan.building === item?.building && plan.floor === item?.floor) || null;
}

function itemsForMarker(marker) {
    return (marker.itemIds || [marker.itemId]).map(itemById).filter(Boolean);
}

function itemsByCategory(categoryId) {
    return state.guide.items.filter((item) => item.categoryId === categoryId);
}

function categoriesByArea(area) {
    return state.guide.categories.filter((category) => category.area === area);
}

function facilityTypeKey(item) {
    const title = String(item?.title || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
    return title || String(item?.image || item?.id || "");
}

function uniqueFacilities(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = facilityTypeKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function createPinSvg(labelValue, color) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.classList.add("map-marker-svg");
    svg.setAttribute("viewBox", "0 0 80 112");
    svg.setAttribute("aria-hidden", "true");
    svg.style.color = color || "#e4473f";

    const pin = document.createElementNS(namespace, "path");
    pin.setAttribute("d", "M40 0C17.9 0 0 17.9 0 40c0 28 40 72 40 72s40-44 40-72C80 17.9 62.1 0 40 0Z");
    pin.setAttribute("fill", "currentColor");
    const center = document.createElementNS(namespace, "circle");
    center.setAttribute("cx", "40");
    center.setAttribute("cy", "39");
    center.setAttribute("r", "19");
    center.setAttribute("fill", "#fff");
    const label = document.createElementNS(namespace, "text");
    const text = String(labelValue || "1");
    label.setAttribute("x", "40");
    label.setAttribute("y", "40");
    label.setAttribute("fill", "currentColor");
    label.setAttribute("font-size", Array.from(text).length > 2 ? "17" : Array.from(text).length > 1 ? "21" : "26");
    label.setAttribute("font-weight", "900");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = text;
    svg.append(pin, center, label);
    return svg;
}

function createItemVisual(item, className = "") {
    const marker = markerForItem(item.id);
    const wrapper = document.createElement("span");
    wrapper.className = className;
    const path = item.image || marker?.image;
    if (path) {
        const image = document.createElement("img");
        image.src = assetUrl(path);
        image.alt = "";
        image.addEventListener("error", () => image.remove());
        wrapper.append(image);
    } else if (marker?.kind === "pin") {
        wrapper.classList.add("mini-pin");
        wrapper.style.setProperty("--pin-color", marker.color);
        wrapper.append(createPinSvg(marker.label, marker.color));
    } else {
        wrapper.textContent = "画像なし";
    }
    return wrapper;
}

function renderSettings() {
    const settings = state.guide.settings;
    document.title = `${settings.title} キャンパスガイド`;
    elements.brandTitle.textContent = settings.title;
    elements.brandSubtitle.textContent = settings.subtitle;
    elements.instructionText.textContent = settings.instruction;
    elements.campusMap.src = assetUrl(settings.mapImage);
    elements.schoolQr.src = assetUrl(settings.schoolQr);
    elements.instagramQr.src = assetUrl(settings.instagramQr);
    elements.kioskCanvas.style.setProperty("--ui-background", `url("${assetUrl(settings.backgroundImage)}")`);
}

function renderCategories() {
    elements.categoryButtons.replaceChildren();
    const categories = [{ id: "all", label: "すべて", color: "#7c4b36" }, ...state.guide.categories];
    categories.forEach((category) => {
        const count = category.id === "all" ? state.guide.items.length : itemsByCategory(category.id).length;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-button";
        button.style.setProperty("--category-color", category.color);
        button.classList.toggle("active", state.selectedCategory === category.id);
        button.setAttribute("aria-pressed", String(state.selectedCategory === category.id));
        const label = document.createElement("strong");
        label.textContent = category.label;
        const counter = document.createElement("small");
        counter.textContent = `${count}件`;
        button.append(label, counter);
        button.addEventListener("click", () => selectCategory(category.id));
        elements.categoryButtons.append(button);
    });
}

function createEventIcon(item) {
    const category = categoryById(item.categoryId);
    const marker = markerForItem(item.id);
    const button = elements.eventIconTemplate.content.firstElementChild.cloneNode(true);
    button.style.setProperty("--category-color", category?.color || "#7c4b36");
    button.classList.toggle("is-selected", state.selectedItemId === item.id);
    button.setAttribute("aria-label", `${item.title}の案内を表示`);
    const visualHost = button.querySelector(".event-visual");
    visualHost.replaceWith(createItemVisual(item, "event-visual"));
    const badge = button.querySelector(".location-badge");
    if (marker?.kind === "pin") badge.textContent = marker.label;
    else badge.hidden = true;
    button.querySelector(".event-title").textContent = item.title;
    button.addEventListener("click", () => selectItem(item.id, "all"));
    return button;
}

function fillEventArea(area, section, titleElement, grid, emptyLabel) {
    const categories = categoriesByArea(area);
    const categoryIds = new Set(categories.map((category) => category.id));
    const items = state.guide.items.filter((item) => categoryIds.has(item.categoryId));
    const color = categories[0]?.color || "#b8a99e";
    section.style.setProperty("--band-color", color);
    titleElement.textContent = categories.map((category) => category.label).join("・") || emptyLabel;
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "event-grid-empty";
        empty.textContent = "編集画面から企画を追加できます";
        grid.replaceChildren(empty);
        return;
    }
    grid.replaceChildren(...items.map(createEventIcon));
}

function renderEventBands() {
    fillEventArea("top", elements.topBand, elements.topBandTitle, elements.topEvents, "ものづくり");
    fillEventArea("bottom-left", elements.lowerLeftBand, elements.lowerLeftTitle, elements.lowerLeftEvents, "紅華祭");
    fillEventArea("bottom-right", elements.lowerRightBand, elements.lowerRightTitle, elements.lowerRightEvents, "食べもの");
}

function renderFacilities() {
    const categoryIds = new Set(categoriesByArea("facility").map((category) => category.id));
    const facilities = state.guide.items.filter((item) => item.type === "facility" || categoryIds.has(item.categoryId));
    if (!facilities.length) {
        const empty = document.createElement("span");
        empty.className = "facility-empty";
        empty.textContent = "設備はまだ登録されていません";
        elements.facilityEvents.replaceChildren(empty);
        return;
    }
    elements.facilityEvents.replaceChildren(...uniqueFacilities(facilities).map((item) => {
        const button = elements.facilityTemplate.content.firstElementChild.cloneNode(true);
        const selectedItem = state.selectedItemId ? itemById(state.selectedItemId) : null;
        button.classList.toggle("is-selected", Boolean(selectedItem && facilityTypeKey(selectedItem) === facilityTypeKey(item)));
        button.querySelector(".facility-visual").replaceWith(createItemVisual(item, "facility-visual"));
        button.querySelector(".facility-title").textContent = item.title;
        button.addEventListener("click", () => selectItem(item.id, "all"));
        return button;
    }));
}

function renderMarkers() {
    elements.mapMarkers.replaceChildren();
    state.guide.markers.slice().sort((a, b) => a.layer - b.layer).forEach((marker) => {
        const linked = itemsForMarker(marker);
        const item = linked[0];
        const interactive = marker.usage !== "decoration" && (marker.kind === "pin" || linked.length > 0);
        const element = document.createElement(interactive ? "button" : "div");
        if (interactive) element.type = "button";
        element.className = "map-marker";
        element.style.left = `${marker.x}%`;
        element.style.top = `${marker.y}%`;
        element.style.zIndex = String(marker.layer + 1);
        element.style.setProperty("--marker-size", `${marker.size}px`);
        element.style.setProperty("--marker-rotation", `${marker.rotation}deg`);
        if (marker.kind === "pin") {
            element.style.setProperty("--marker-color", marker.color);
            element.append(createPinSvg(marker.label, marker.color));
        } else {
            element.classList.add("is-image");
            element.classList.toggle("is-facility", marker.usage === "facility");
            const image = document.createElement("img");
            image.className = "map-marker-image";
            image.src = assetUrl(marker.image);
            image.alt = item?.title || "";
            image.draggable = false;
            element.append(image);
        }
        if (!interactive) element.classList.add("is-decoration");

        const selectedItem = state.selectedItemId ? itemById(state.selectedItemId) : null;
        const selectedPin = state.selectedPinId ? state.guide.markers.find((entry) => entry.id === state.selectedPinId) : null;
        const activeCategoryId = selectedItem?.categoryId || selectedPin?.categoryId || (state.selectedCategory !== "all" ? state.selectedCategory : null);
        const categoryMuted = activeCategoryId && marker.categoryId !== activeCategoryId;
        const containsSelected = Boolean(state.selectedItemId && linked.some((entry) => entry.id === state.selectedItemId));
        if (marker.usage !== "decoration") element.classList.toggle("is-muted", Boolean(categoryMuted));
        element.classList.toggle("is-selected", containsSelected || state.selectedPinId === marker.id);
        element.dataset.markerId = marker.id;
        if (interactive) {
            element.setAttribute("aria-label", marker.kind === "pin" ? `ピン${marker.label}の企画を表示` : `${item.title}の案内を表示`);
            element.addEventListener("click", () => {
                if (marker.kind === "pin") selectPin(marker.id, selectionOriginCategory());
                else selectItem(item.id, selectionOriginCategory());
            });
        }
        elements.mapMarkers.append(element);
    });
}

function renderFloorOverlay() {
    const selectedItem = state.selectedItemId ? itemById(state.selectedItemId) : null;
    const plan = floorPlanForItem(selectedItem);
    if (!selectedItem || !plan) {
        elements.floorOverlay.hidden = true;
        elements.floorOverlayMarkers.replaceChildren();
        return;
    }
    elements.floorOverlay.hidden = false;
    const layout = state.guide.settings.floorOverlay || {x: 2, y: 50, width: 42};
    elements.floorOverlay.style.left = `${layout.x}%`;
    elements.floorOverlay.style.top = `${layout.y}%`;
    elements.floorOverlay.style.width = `${layout.width}%`;
    elements.floorOverlayTitle.textContent = plan.label;
    elements.floorOverlayImage.alt = `${plan.label}のフロア図`;
    elements.floorOverlayImage.onload = () => {
        if (elements.floorOverlayImage.naturalWidth && elements.floorOverlayImage.naturalHeight) {
            elements.floorOverlayStage.style.aspectRatio = `${elements.floorOverlayImage.naturalWidth}/${elements.floorOverlayImage.naturalHeight}`;
            fitFloorOverlay();
        }
    };
    elements.floorOverlayImage.src = assetUrl(plan.image);
    const nodes = (plan.markers || []).slice().sort((a, b) => a.layer - b.layer).map((marker) => {
        const element = document.createElement("span");
        element.className = `floor-overlay-marker is-${marker.kind}`;
        element.classList.toggle("is-selected", marker.kind === "item" && marker.itemId === selectedItem.id);
        element.style.left = `${marker.x}%`;
        element.style.top = `${marker.y}%`;
        element.style.zIndex = String(marker.layer + 1);
        element.style.setProperty("--floor-size", `${Math.max(18, marker.size * .58)}px`);
        element.style.setProperty("--floor-color", marker.color || "#3274b6");
        element.style.setProperty("--floor-rotation", `${marker.rotation || 0}deg`);
        if (marker.kind === "item") {
            const item = itemById(marker.itemId);
            if (!item) return null;
            const title = document.createElement("strong"); title.textContent = item.title;
            const image = document.createElement("img"); image.src = assetUrl(item.image); image.alt = "";
            element.append(title, image);
        } else if (marker.kind === "facility") {
            const item = itemById(marker.itemId);
            if (!item) return null;
            const image = document.createElement("img"); image.src = assetUrl(item.image); image.alt = item.title;
            element.append(image);
        } else if (marker.kind === "image") {
            const image = document.createElement("img"); image.src = assetUrl(marker.image); image.alt = marker.text || "";
            element.append(image);
        } else {
            element.textContent = marker.text;
        }
        return element;
    }).filter(Boolean);
    elements.floorOverlayMarkers.replaceChildren(...nodes);
    requestAnimationFrame(fitFloorOverlay);
}

function renderFilterStatus() {
    const selectedItem = state.selectedItemId ? itemById(state.selectedItemId) : null;
    const selectedMarker = selectedItem ? markerForItem(selectedItem.id) : state.selectedPinId ? state.guide.markers.find((entry) => entry.id === state.selectedPinId) : null;
    const category = state.selectedCategory === "all" ? null : categoryById(state.selectedCategory);
    elements.activeFilterDot.style.background = selectedItem
        ? categoryById(selectedItem.categoryId)?.color || "#7c4b36"
        : category?.color || "#7c4b36";
    elements.activeFilterLabel.textContent = selectedItem
        ? `選択中：${selectedMarker?.kind === "pin" ? `ピン${selectedMarker.label}・` : ""}${selectedItem.title}`
        : selectedMarker
            ? `選択中：${category?.label || "案内"}・ピン${selectedMarker.label}`
        : category
            ? `${category.label}を表示`
            : "すべて表示";
}

function renderOfficialInfo() {
    const shouldShow = state.selectedCategory === "all" && !state.selectedItemId && !state.selectedPinId;
    elements.qrFooter.hidden = !shouldShow;
    elements.detailPanel.classList.toggle("is-official-hidden", !shouldShow);
}

function renderAllControls() {
    renderSettings();
    renderCategories();
    renderEventBands();
    renderFacilities();
    renderMarkers();
    renderFilterStatus();
    renderFloorOverlay();
    renderOfficialInfo();
}

function renderWelcome() {
    const itemCount = state.guide.items.length;
    elements.detailContent.innerHTML = `
        <div class="detail-welcome">
            <div class="welcome-visual"><div><b>${escapeHtml(state.guide.settings.title)}</b><span>${itemCount ? "画像やマップのピンを<br>タッチしてください" : "企画情報はまだ<br>登録されていません"}</span></div></div>
            <div class="welcome-copy"><h3>${itemCount ? "会場をご案内します" : "編集画面から作成できます"}</h3><p>${itemCount ? "企画画像を押すと、内容や場所が表示されます。" : "UI作成プログラムで画像と内容を登録すると、この画面へ反映されます。"}</p></div>
        </div>`;
    elements.detailContent.scrollTop = 0;
}

function renderCategoryIntro(categoryId) {
    const category = categoryById(categoryId);
    const items = itemsByCategory(categoryId);
    const shownItems = category.area === "facility" || items.every((item) => item.type === "facility")
        ? uniqueFacilities(items)
        : items;
    elements.detailContent.innerHTML = `
        <section class="category-intro" style="--category-color:${category.color}">
            <div class="category-intro-banner"><small>選択中のカテゴリー</small><h3>${escapeHtml(category.label)}</h3></div>
            <p>${escapeHtml(category.description || "企画画像またはマップのアイコンをタッチしてください。")}</p>
            <div class="category-event-heading"><strong>企画を選ぶ</strong><span>${items.length}件</span></div>
            <div class="pin-event-groups"></div>
        </section>`;
    const groupHost = elements.detailContent.querySelector(".pin-event-groups");
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "venue-empty";
        empty.textContent = "このカテゴリーにはまだ企画がありません。";
        groupHost.replaceChildren(empty);
    } else {
        const grouped = new Map();
        shownItems.forEach((item) => {
            const marker = markerForItem(item.id);
            const key = marker?.id || `item-${item.id}`;
            if (!grouped.has(key)) grouped.set(key, {marker, items: []});
            grouped.get(key).items.push(item);
        });
        const groups = Array.from(grouped.values()).sort((a, b) => {
            const aNumber = a.marker?.kind === "pin" ? Number(a.marker.label) : Number.MAX_SAFE_INTEGER;
            const bNumber = b.marker?.kind === "pin" ? Number(b.marker.label) : Number.MAX_SAFE_INTEGER;
            return aNumber - bNumber;
        });
        groups.forEach(({marker, items: groupedItems}) => {
            const section = document.createElement("section");
            section.className = "pin-event-group";
            const header = document.createElement("header");
            const heading = document.createElement("strong");
            heading.textContent = marker?.kind === "pin" ? `ピン ${marker.label}` : groupedItems[0]?.title || "施設案内";
            const count = document.createElement("span");
            count.textContent = `${groupedItems.length}件`;
            header.append(heading, count);
            const grid = document.createElement("div");
            grid.className = "category-event-grid";
            groupedItems.forEach((item) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "category-event-button";
                button.style.setProperty("--category-color", category.color);
                const visual = createItemVisual(item, "category-event-visual");
                const title = document.createElement("strong");
                title.textContent = item.title;
                button.append(visual, title);
                button.addEventListener("click", () => selectItem(item.id, categoryId));
                grid.append(button);
            });
            section.append(header, grid);
            groupHost.append(section);
        });
    }
    elements.detailContent.scrollTop = 0;
}

function waitText(item) {
    const labels = {
        none: "待ち時間なし",
        preparing: "準備中",
        closed: "受付終了",
        soldout: "売り切れ",
    };
    return item.waitState === "minutes" ? `待ち時間 約${item.waitMinutes}分` : labels[item.waitState] || "";
}

function locationText(item) {
    const building = /^\d+$/.test(item.building || "") ? `${item.building}号棟` : item.building || "";
    const floor = item.floor && item.floor !== "無し" ? `${item.floor}階` : "";
    return [building, floor].filter(Boolean).join(" ");
}

function renderPinIntro(marker) {
    const category = categoryById(marker.categoryId);
    const items = itemsForMarker(marker);
    elements.detailContent.innerHTML = `
        <section class="category-intro" style="--category-color:${category?.color || marker.color}">
            <div class="category-intro-banner"><small>${escapeHtml(category?.label || "会場案内")}</small><h3>ピン ${escapeHtml(marker.label)} の企画</h3></div>
            <p>この場所の企画を選んでください。</p>
            <div class="category-event-heading"><strong>企画を選ぶ</strong><span>${items.length}件</span></div>
            <div class="category-event-grid"></div>
            <div class="detail-back-row"><button class="detail-back-button" type="button" data-pin-back>戻る</button></div>
        </section>`;
    const grid = elements.detailContent.querySelector(".category-event-grid");
    if (!items.length) {
        const empty = document.createElement("p"); empty.className = "venue-empty"; empty.textContent = "このピンの企画は準備中です。"; grid.append(empty);
    }
    items.forEach((item) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "category-event-button";
        button.style.setProperty("--category-color", category?.color || marker.color);
        const title = document.createElement("strong"); title.textContent = item.title;
        button.append(createItemVisual(item, "category-event-visual"), title);
        button.addEventListener("click", () => selectItem(item.id, state.detailReturnCategory, marker.id));
        grid.append(button);
    });
    elements.detailContent.querySelector("[data-pin-back]").addEventListener("click", () => selectCategory(state.detailReturnCategory));
    elements.detailContent.scrollTop = 0;
}

function selectPin(markerId, returnCategory = "all") {
    const marker = state.guide.markers.find((entry) => entry.id === markerId);
    if (!marker) return;
    state.selectedPinId = markerId;
    state.selectedItemId = null;
    state.selectedCategory = marker.categoryId;
    state.detailReturnCategory = returnCategory;
    state.detailReturnPinId = null;
    renderAllControls(); renderPinIntro(marker);
}

function renderItemDetail(item) {
    const category = categoryById(item.categoryId);
    const marker = markerForItem(item.id);
    const wait = ["stall", "facility"].includes(item.type) ? "" : waitText(item);
    const description = item.type === "facility" ? "" : item.description || "詳しい案内は会場でご確認ください。";
    elements.detailContent.innerHTML = `
        <article class="detail-event" style="--category-color:${category?.color || "#7c4b36"}">
            <div class="detail-image" id="detailImageHost"></div>
            <span class="detail-category">${escapeHtml(category?.label || "ご案内")}</span>
            <h3>${escapeHtml(item.title)}</h3>
            <div class="detail-meta-row">
                ${marker?.kind === "pin" ? `<div class="detail-location"><b>${escapeHtml(marker.label)}</b><span>マップのピンをご確認ください</span></div>` : ""}
                ${item.organizer ? `<div class="detail-organizer"><b>担当</b><span>${escapeHtml(item.organizer)}</span></div>` : ""}
                ${locationText(item) ? `<div class="detail-organizer"><b>場所</b><span>${escapeHtml(locationText(item))}</span></div>` : ""}
                ${wait ? `<div class="detail-wait ${["closed", "soldout"].includes(item.waitState) ? "is-closed" : ""}"><b>状況</b><span>${escapeHtml(wait)}</span></div>` : ""}
            </div>
            ${description ? `<p class="detail-description">${escapeHtml(description)}</p>` : ""}
            <div class="detail-back-row"><button class="detail-back-button" type="button" data-detail-back>戻る</button></div>
        </article>`;
    const imageHost = elements.detailContent.querySelector("#detailImageHost");
    if (item.image || marker?.image) {
        const image = document.createElement("img");
        image.src = assetUrl(item.image || marker.image);
        image.alt = `${item.title}の画像`;
        imageHost.append(image);
    } else if (marker?.kind === "pin") {
        const preview = document.createElement("span");
        preview.className = "detail-pin-preview";
        preview.style.setProperty("--pin-color", marker.color);
        preview.append(createPinSvg(marker.label, marker.color));
        imageHost.append(preview);
    }
    elements.detailContent.querySelector("[data-detail-back]").addEventListener("click", () => {
        if (state.detailReturnPinId && state.guide.markers.some((entry) => entry.id === state.detailReturnPinId)) selectPin(state.detailReturnPinId, state.detailReturnCategory);
        else selectCategory(state.detailReturnCategory || "all");
    });
    elements.detailContent.scrollTop = 0;
}

function selectionOriginCategory() {
    return state.selectedItemId || state.selectedPinId ? state.detailReturnCategory : state.selectedCategory;
}

function selectCategory(categoryId) {
    if (categoryId !== "all" && !categoryById(categoryId)) return;
    state.selectedCategory = categoryId;
    state.selectedItemId = null;
    state.selectedPinId = null;
    state.detailReturnPinId = null;
    state.detailReturnCategory = categoryId;
    renderAllControls();
    if (categoryId === "all") renderWelcome();
    else renderCategoryIntro(categoryId);
}

function selectItem(itemId, returnCategory = "all", returnPinId = null) {
    const item = itemById(itemId);
    if (!item) return;
    state.selectedCategory = item.categoryId;
    state.selectedItemId = item.id;
    state.selectedPinId = null;
    state.detailReturnPinId = returnPinId;
    state.detailReturnCategory = returnCategory;
    renderAllControls();
    renderItemDetail(item);
}

function setZoom(nextZoom) {
    const oldMaxX = Math.max(1, elements.mapStage.scrollWidth - elements.mapViewport.clientWidth);
    const oldMaxY = Math.max(1, elements.mapStage.scrollHeight - elements.mapViewport.clientHeight);
    const ratioX = elements.mapViewport.scrollLeft / oldMaxX;
    const ratioY = elements.mapViewport.scrollTop / oldMaxY;
    state.zoom = Math.min(1.75, Math.max(1, nextZoom));
    fitMapStage();
    elements.zoomOutButton.disabled = state.zoom <= 1;
    elements.zoomInButton.disabled = state.zoom >= 1.75;
    requestAnimationFrame(() => {
        const newMaxX = Math.max(0, elements.mapStage.scrollWidth - elements.mapViewport.clientWidth);
        const newMaxY = Math.max(0, elements.mapStage.scrollHeight - elements.mapViewport.clientHeight);
        elements.mapViewport.scrollTo({ left: newMaxX * ratioX, top: newMaxY * ratioY });
    });
}

function resetAll() {
    state.selectedCategory = "all";
    state.selectedItemId = null;
    state.selectedPinId = null;
    state.detailReturnPinId = null;
    state.detailReturnCategory = "all";
    setZoom(1);
    elements.mapViewport.scrollTo({ left: 0, top: 0 });
    renderAllControls();
    renderWelcome();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function refreshGuide() {
    try {
        const response = await fetch(GUIDE_URL, { cache: "no-store" });
        if (!response.ok) return;
        const guide = await response.json();
        if (!state.guide || guide.revision !== state.guide.revision) {
            const selectedItemId = state.selectedItemId;
            const selectedPinId = state.selectedPinId;
            state.guide = guide;
            if (selectedItemId && itemById(selectedItemId)) {
                renderAllControls();
                renderItemDetail(itemById(selectedItemId));
            } else if (selectedPinId && guide.markers.some((entry) => entry.id === selectedPinId)) {
                selectPin(selectedPinId, state.detailReturnCategory);
            } else {
                resetAll();
            }
        }
    } catch {
        // 一時的に更新できない場合は、現在表示中の案内を維持します。
    }
}

function bindEvents() {
    window.addEventListener("resize", fitCanvas);
    elements.zoomInButton.addEventListener("click", () => setZoom(state.zoom + 0.25));
    elements.zoomOutButton.addEventListener("click", () => setZoom(state.zoom - 0.25));
    elements.zoomResetButton.addEventListener("click", () => setZoom(1));
    elements.resetAllButton.addEventListener("click", resetAll);
    elements.mapViewport.addEventListener("click", (event) => {
        if (event.target.closest(".map-marker")) return;
        selectCategory("all");
    });
}

async function start() {
    fitCanvas();
    bindEvents();
    try {
        const response = await fetch(GUIDE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.guide = await response.json();
        resetAll();
        elements.loading.classList.add("is-hidden");
        window.setTimeout(() => elements.loading.remove(), 250);
        window.setInterval(refreshGuide, 15000);
    } catch (error) {
        console.error("案内データの読み込みに失敗しました。", error);
        elements.loading.remove();
        elements.errorScreen.hidden = false;
    }
}

start();
