(function () {
    "use strict";

    var DB_NAME = "mindmapdb";
    var DB_VERSION = 3;
    var NOTES_STORE = "notes";
    var CONNS_STORE = "connections";
    var TOOLBAR_HEIGHT = 48;
    var NOTE_WIDTH = 220;
    var NOTE_HEIGHT = 180;
    var NOTE_COLORS = [
        { fill: "#fff9b1", stroke: "#e6d935" },
        { fill: "#ffcccb", stroke: "#e67373" },
        { fill: "#b3e6b3", stroke: "#5cb85c" },
        { fill: "#b3d9ff", stroke: "#5ba3e6" },
        { fill: "#e6ccff", stroke: "#a366d9" },
        { fill: "#ffe0b3", stroke: "#e6a34d" }
    ];
    var COLOR_CYCLE = 0;
    var MIN_NOTE_WIDTH = 120;
    var MIN_NOTE_HEIGHT = 80;
    var MIN_ZOOM = 0.33;
    var MAX_ZOOM = 2.0;
    var ZOOM_STEP = 1.15;

    var db = null;
    var notes = [];
    var connections = [];
    var canvas, ctx;
    var dpr = window.devicePixelRatio || 1;

    var drag = {
        active: false,
        noteIdx: -1,
        offsetX: 0,
        offsetY: 0
    };

    var resize = {
        active: false,
        noteIdx: -1,
        startX: 0,
        startY: 0,
        startW: 0,
        startH: 0
    };

    var editState = {
        active: false,
        noteIdx: -1
    };

    var headerEditState = {
        active: false,
        noteIdx: -1
    };

    var connectState = {
        active: false,
        sourceId: null
    };

    var contextMenuState = {
        noteIdx: -1
    };

    var connectionMenuState = {
        connIdx: -1
    };

    var contextMenuPos = { x: 0, y: 0 };

    var zoomLevel = 1.0;
    var panX = 0;
    var panY = 0;

    var THEME_KEY = "mindmap-theme";
    var themePreference = "system";
    var isDarkMode = false;

    var THEME_COLORS = {
        light: {
            background: "#e8e8e8",
            gridDot: "#c8c8c8",
            arrowStroke: "#555",
            arrowFill: "#555",
            noteText: "#333",
            notePlaceholder: "#999",
            editBorder: "#2c3e50",
            connectBorder: "#e74c3c"
        },
        dark: {
            background: "#1a1a2e",
            gridDot: "#333355",
            arrowStroke: "#aaa",
            arrowFill: "#aaa",
            noteText: "#333",
            notePlaceholder: "#999",
            editBorder: "#6c8ebf",
            connectBorder: "#e74c3c"
        }
    };

    function getSystemDarkMode() {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function applyTheme() {
        if (themePreference === "system") {
            isDarkMode = getSystemDarkMode();
        } else {
            isDarkMode = themePreference === "dark";
        }
        document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
        updateThemeOptionActive();
        if (ctx) render();
    }

    function setTheme(preference) {
        themePreference = preference;
        try {
            localStorage.setItem(THEME_KEY, preference);
        } catch (e) { /* ignore */ }
        applyTheme();
    }

    function loadTheme() {
        try {
            var saved = localStorage.getItem(THEME_KEY);
            if (saved === "system" || saved === "light" || saved === "dark") {
                themePreference = saved;
            }
        } catch (e) { /* ignore */ }
    }

    function getThemeColors() {
        return isDarkMode ? THEME_COLORS.dark : THEME_COLORS.light;
    }

    function updateThemeOptionActive() {
        var options = document.querySelectorAll(".context-theme-option");
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (opt.getAttribute("data-theme") === themePreference) {
                opt.classList.add("active");
            } else {
                opt.classList.remove("active");
            }
        }
    }

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var database = e.target.result;
                var oldVersion = e.oldVersion;
                if (!database.objectStoreNames.contains(NOTES_STORE)) {
                    database.createObjectStore(NOTES_STORE, { keyPath: "id" });
                }
                if (!database.objectStoreNames.contains(CONNS_STORE)) {
                    database.createObjectStore(CONNS_STORE, { keyPath: "id" });
                }
                if (oldVersion < 3) {
                    var tx = e.target.transaction;
                    if (tx.objectStoreNames.contains(NOTES_STORE)) {
                        var noteStore = tx.objectStore(NOTES_STORE);
                        noteStore.openCursor().onsuccess = function (ev) {
                            var cursor = ev.target.result;
                            if (cursor) {
                                var note = cursor.value;
                                if (!note.w) note.w = NOTE_WIDTH;
                                if (!note.h) note.h = NOTE_HEIGHT;
                                cursor.update(note);
                                cursor.continue();
                            }
                        };
                    }
                }
            };
            req.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };
            req.onerror = function (e) {
                reject(e.target.error);
            };
        });
    }

    function dbGetAll(storeName) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readonly");
            var store = tx.objectStore(storeName);
            var req = store.getAll();
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbPut(storeName, item) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readwrite");
            var store = tx.objectStore(storeName);
            var req = store.put(item);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbDelete(storeName, id) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readwrite");
            var store = tx.objectStore(storeName);
            var req = store.delete(id);
            req.onsuccess = function () { resolve(); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function saveNote(note) {
        if (db) dbPut(NOTES_STORE, note).catch(function (err) { console.error("Save note failed:", err); });
    }

    function deleteNote(id) {
        if (db) dbDelete(NOTES_STORE, id).catch(function (err) { console.error("Delete note failed:", err); });
    }

    function saveConnection(conn) {
        if (db) dbPut(CONNS_STORE, conn).catch(function (err) { console.error("Save conn failed:", err); });
    }

    function deleteConnection(id) {
        if (db) dbDelete(CONNS_STORE, id).catch(function (err) { console.error("Delete conn failed:", err); });
    }

    function deleteConnectionsForNote(noteId) {
        var toRemove = connections.filter(function (c) {
            return c.from === noteId || c.to === noteId;
        });
        toRemove.forEach(function (c) {
            deleteConnection(c.id);
        });
        connections = connections.filter(function (c) {
            return c.from !== noteId && c.to !== noteId;
        });
    }

    function createNote(x, y) {
        var color = NOTE_COLORS[COLOR_CYCLE % NOTE_COLORS.length];
        COLOR_CYCLE++;
        return {
            x: x,
            y: y,
            w: NOTE_WIDTH,
            h: NOTE_HEIGHT,
            header: "Idea",
            text: "",
            color: color,
            id: Date.now() + "-" + Math.random().toString(36).substr(2, 6)
        };
    }

    function createConnection(fromId, toId) {
        return {
            id: fromId + "->" + toId,
            from: fromId,
            to: toId
        };
    }

    function findNoteById(id) {
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) return notes[i];
        }
        return null;
    }

    function getEdgePoint(note, targetX, targetY) {
        var cx = note.x + note.w / 2;
        var cy = note.y + note.h / 2;
        var dx = targetX - cx;
        var dy = targetY - cy;
        var hw = note.w / 2;
        var hh = note.h / 2;

        if (dx === 0 && dy === 0) return { x: cx, y: cy };

        var absDx = Math.abs(dx);
        var absDy = Math.abs(dy);
        var scale;

        if (absDx * hh > absDy * hw) {
            scale = hw / absDx;
        } else {
            scale = hh / absDy;
        }

        return {
            x: cx + dx * scale,
            y: cy + dy * scale
        };
    }

    function drawArrow(fromNote, toNote) {
        var fromCx = fromNote.x + fromNote.w / 2;
        var fromCy = fromNote.y + fromNote.h / 2;
        var toCx = toNote.x + toNote.w / 2;
        var toCy = toNote.y + toNote.h / 2;

        var start = getEdgePoint(fromNote, toCx, toCy);
        var end = getEdgePoint(toNote, fromCx, fromCy);

        var angle = Math.atan2(end.y - start.y, end.x - start.x);
        var headLen = 14;

        ctx.save();

        var colors = getThemeColors();

        ctx.strokeStyle = colors.arrowStroke;
        ctx.fillStyle = colors.arrowFill;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 7), end.y - headLen * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 7), end.y - headLen * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function drawDotGrid() {
        var spacing = 30;
        var screenW = canvas.width / dpr;
        var screenH = canvas.height / dpr;
        var worldLeft = -panX / zoomLevel;
        var worldTop = -panY / zoomLevel;
        var worldRight = (screenW - panX) / zoomLevel;
        var worldBottom = (screenH - panY) / zoomLevel;
        var startX = Math.floor(worldLeft / spacing) * spacing;
        var startY = Math.floor(worldTop / spacing) * spacing;
        var endX = Math.ceil(worldRight / spacing) * spacing;
        var endY = Math.ceil(worldBottom / spacing) * spacing;
        var colors = getThemeColors();
        ctx.fillStyle = colors.gridDot;
        for (var gx = startX; gx <= endX; gx += spacing) {
            for (var gy = startY; gy <= endY; gy += spacing) {
                ctx.beginPath();
                ctx.arc(gx, gy, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function wrapText(text, maxWidth) {
        var words = text.split(" ");
        var lines = [];
        var line = "";
        for (var i = 0; i < words.length; i++) {
            var test = line + (line ? " " : "") + words[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = words[i];
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    function drawNote(note, idx) {
        var x = note.x;
        var y = note.y;
        var w = note.w;
        var h = note.h;
        var colors = getThemeColors();

        ctx.save();

        ctx.shadowColor = "rgba(0,0,0,0.15)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 4;

        ctx.fillStyle = note.color.fill;
        ctx.strokeStyle = note.color.stroke;
        ctx.lineWidth = 2;

        var r = 6;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowColor = "transparent";

        if (connectState.active && connectState.sourceId === note.id) {
            ctx.strokeStyle = colors.connectBorder;
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.setLineDash([]);
        }

        ctx.fillStyle = note.color.stroke;
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText((note.header || "Idea").toUpperCase(), x + 12, y + 10);

        var closeX = x + w - 24;
        var closeY = y + 6;
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.font = "bold 14px sans-serif";
        ctx.fillText("\u00D7", closeX, closeY);

        ctx.strokeStyle = note.color.stroke;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 28);
        ctx.lineTo(x + w - 10, y + 28);
        ctx.stroke();

        ctx.fillStyle = "#333";
        ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        if (!(editState.active && editState.noteIdx === idx)) {
            var text = note.text || "Click to edit...";
            ctx.fillStyle = note.text ? colors.noteText : colors.notePlaceholder;
            var maxW = w - 24;
            var lines = wrapText(text, maxW);
            var lineH = 20;
            var ty = y + 36;
            var maxLines = Math.floor((h - 48) / lineH);
            for (var li = 0; li < Math.min(lines.length, maxLines); li++) {
                ctx.fillText(lines[li], x + 12, ty + li * lineH);
            }
            if (lines.length > maxLines) {
                ctx.fillStyle = colors.notePlaceholder;
                ctx.fillText("...", x + 12, ty + maxLines * lineH);
            }
        }

        if (editState.active && editState.noteIdx === idx) {
            ctx.strokeStyle = colors.editBorder;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.setLineDash([]);
        }

        // Resize handle
        ctx.fillStyle = note.color.stroke;
        ctx.beginPath();
        ctx.moveTo(x + w - 10, y + h - 4);
        ctx.lineTo(x + w - 4, y + h - 10);
        ctx.lineTo(x + w - 4, y + h - 4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function render() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var colors = getThemeColors();
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        ctx.translate(panX, panY);
        ctx.scale(zoomLevel, zoomLevel);

        drawDotGrid();

        for (var ci = 0; ci < connections.length; ci++) {
            var from = findNoteById(connections[ci].from);
            var to = findNoteById(connections[ci].to);
            if (from && to) drawArrow(from, to);
        }

        for (var i = 0; i < notes.length; i++) {
            drawNote(notes[i], i);
        }

        ctx.restore();

        updateZoomLabel();
    }

    function updateZoomLabel() {
        var label = document.getElementById("zoomLabel");
        if (label) label.textContent = Math.round(zoomLevel * 100) + "%";
    }

    function zoomAtPoint(cx, cy, factor) {
        var oldZoom = zoomLevel;
        var newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel * factor));
        panX = cx - (cx - panX) * (newZoom / oldZoom);
        panY = cy - (cy - panY) * (newZoom / oldZoom);
        zoomLevel = newZoom;
        render();
    }

    function zoomIn() {
        var cx = (canvas.width / dpr) / 2;
        var cy = (canvas.height / dpr) / 2;
        zoomAtPoint(cx, cy, ZOOM_STEP);
    }

    function zoomOut() {
        var cx = (canvas.width / dpr) / 2;
        var cy = (canvas.height / dpr) / 2;
        zoomAtPoint(cx, cy, 1 / ZOOM_STEP);
    }

    function resetZoom() {
        zoomLevel = 1.0;
        panX = 0;
        panY = 0;
        render();
    }

    function hitTest(mx, my) {
        for (var i = notes.length - 1; i >= 0; i--) {
            var n = notes[i];
            if (mx >= n.x && mx <= n.x + n.w && my >= n.y && my <= n.y + n.h) {
                return i;
            }
        }
        return -1;
    }

    function pointToSegmentDist(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        var t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        var projX = x1 + t * dx;
        var projY = y1 + t * dy;
        return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
    }

    function hitTestConnection(mx, my) {
        var threshold = 8;
        for (var i = connections.length - 1; i >= 0; i--) {
            var fromNote = findNoteById(connections[i].from);
            var toNote = findNoteById(connections[i].to);
            if (!fromNote || !toNote) continue;
            var toCx = toNote.x + toNote.w / 2;
            var toCy = toNote.y + toNote.h / 2;
            var fromCx = fromNote.x + fromNote.w / 2;
            var fromCy = fromNote.y + fromNote.h / 2;
            var start = getEdgePoint(fromNote, toCx, toCy);
            var end = getEdgePoint(toNote, fromCx, fromCy);
            if (pointToSegmentDist(mx, my, start.x, start.y, end.x, end.y) < threshold) {
                return i;
            }
        }
        return -1;
    }

    function isCloseBtn(mx, my, note) {
        var closeX = note.x + note.w - 24;
        var closeY = note.y + 6;
        return mx >= closeX && mx <= closeX + 20 && my >= closeY && my <= closeY + 20;
    }

    function bringToFront(idx) {
        var note = notes.splice(idx, 1)[0];
        notes.push(note);
        return notes.length - 1;
    }

    function resizeCanvas() {
        dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        render();
    }

    function setConnectHint(text) {
        document.getElementById("connectHint").textContent = text;
    }

    function toggleConnectMode() {
        connectState.active = !connectState.active;
        connectState.sourceId = null;
        var btn = document.getElementById("connectBtn");
        if (connectState.active) {
            btn.classList.add("active");
            setConnectHint("Click a source idea...");
        } else {
            btn.classList.remove("active");
            setConnectHint("");
        }
        render();
    }

    function showInput(noteIdx) {
        hideInput();
        var note = notes[noteIdx];
        var input = document.createElement("textarea");
        input.id = "noteInput";
        input.style.position = "fixed";
        var sx = note.x * zoomLevel + panX;
        var sy = note.y * zoomLevel + panY;
        input.style.left = (sx + 10 * zoomLevel) + "px";
        input.style.top = (sy + 34 * zoomLevel) + "px";
        input.style.width = ((note.w - 22) * zoomLevel) + "px";
        input.style.height = ((note.h - 48) * zoomLevel) + "px";
        input.style.border = "none";
        input.style.outline = "none";
        input.style.background = isDarkMode ? "rgba(40,40,60,0.8)" : "rgba(255,255,255,0.6)";
        input.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        input.style.fontSize = (14 * zoomLevel) + "px";
        input.style.color = isDarkMode ? "#ddd" : "#333";
        input.style.resize = "none";
        input.style.padding = (4 * zoomLevel) + "px";
        input.style.zIndex = "20";
        input.style.borderRadius = (4 * zoomLevel) + "px";
        input.value = note.text;

        var idx = noteIdx;
        input.addEventListener("blur", function () {
            commitInput(idx);
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                input.blur();
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                input.blur();
            }
        });

        document.body.appendChild(input);
        input.focus();
        editState.active = true;
        editState.noteIdx = idx;
        render();
    }

    function hideInput() {
        var el = document.getElementById("noteInput");
        if (el) el.remove();
        editState.active = false;
        editState.noteIdx = -1;
    }

    function commitInput(idx) {
        var el = document.getElementById("noteInput");
        if (el && notes[idx]) {
            notes[idx].text = el.value;
            saveNote(notes[idx]);
        }
        hideInput();
        render();
    }

    function showHeaderInput(noteIdx) {
        hideHeaderInput();
        var note = notes[noteIdx];
        var input = document.createElement("input");
        input.type = "text";
        input.id = "headerInput";
        input.style.position = "fixed";
        var sx = note.x * zoomLevel + panX;
        var sy = note.y * zoomLevel + panY;
        input.style.left = (sx + 10 * zoomLevel) + "px";
        input.style.top = (sy + 5 * zoomLevel) + "px";
        input.style.width = ((note.w - 50) * zoomLevel) + "px";
        input.style.height = (20 * zoomLevel) + "px";
        input.style.border = "none";
        input.style.outline = "none";
        input.style.background = isDarkMode ? "rgba(40,40,60,0.8)" : "rgba(255,255,255,0.6)";
        input.style.fontFamily = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        input.style.fontSize = (11 * zoomLevel) + "px";
        input.style.color = isDarkMode ? "#ddd" : "#333";
        input.style.padding = (2 * zoomLevel) + "px " + (2 * zoomLevel) + "px";
        input.style.zIndex = "20";
        input.style.borderRadius = (3 * zoomLevel) + "px";
        input.value = note.header || "Idea";

        var idx = noteIdx;
        input.addEventListener("blur", function () {
            commitHeaderInput(idx);
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault();
                input.blur();
            }
        });

        document.body.appendChild(input);
        input.focus();
        input.select();
        headerEditState.active = true;
        headerEditState.noteIdx = idx;
    }

    function hideHeaderInput() {
        var el = document.getElementById("headerInput");
        if (el) el.remove();
        headerEditState.active = false;
        headerEditState.noteIdx = -1;
    }

    function commitHeaderInput(idx) {
        var el = document.getElementById("headerInput");
        if (el && notes[idx]) {
            var val = el.value.trim();
            if (val) {
                notes[idx].header = val;
            } else {
                notes[idx].header = "Idea";
            }
            saveNote(notes[idx]);
        }
        hideHeaderInput();
        render();
    }

    function isHeaderArea(mx, my, note) {
        return mx >= note.x && mx <= note.x + note.w && my >= note.y && my <= note.y + 28;
    }

    function isResizeHandle(mx, my, note) {
        var handleSize = 12;
        return mx >= note.x + note.w - handleSize &&
               mx <= note.x + note.w &&
               my >= note.y + note.h - handleSize &&
               my <= note.y + note.h;
    }

    function getMousePos(e) {
        var rect = canvas.getBoundingClientRect();
        var screenX = e.clientX - rect.left;
        var screenY = e.clientY - rect.top;
        return {
            x: (screenX - panX) / zoomLevel,
            y: (screenY - panY) / zoomLevel
        };
    }

    function addNoteAt(x, y) {
        var note = createNote(x - NOTE_WIDTH / 2, y - NOTE_HEIGHT / 2);
        notes.push(note);
        saveNote(note);
        render();
        showInput(notes.length - 1);
    }

    function addNote() {
        var screenW = canvas.width / dpr;
        var screenH = canvas.height / dpr;
        var margin = 60;
        var visL = (margin - panX) / zoomLevel;
        var visT = (TOOLBAR_HEIGHT + 20 - panY) / zoomLevel;
        var visR = (screenW - margin - panX) / zoomLevel;
        var visB = (screenH - margin - panY) / zoomLevel;
        var minX = visL;
        var maxX = visR - NOTE_WIDTH;
        var minY = visT;
        var maxY = visB - NOTE_HEIGHT;
        var rx, ry;
        if (maxX <= minX) {
            rx = minX;
        } else {
            rx = minX + Math.random() * (maxX - minX);
        }
        if (maxY <= minY) {
            ry = minY;
        } else {
            ry = minY + Math.random() * (maxY - minY);
        }
        var note = createNote(rx, ry);
        notes.push(note);
        saveNote(note);
        render();
        showInput(notes.length - 1);
    }

    function hideContextMenu() {
        document.getElementById("contextMenu").classList.remove("visible");
        document.getElementById("canvasMenu").classList.remove("visible");
        document.getElementById("connectionMenu").classList.remove("visible");
        contextMenuState.noteIdx = -1;
        connectionMenuState.connIdx = -1;
    }

    function showCanvasMenu(e) {
        e.preventDefault();
        hideContextMenu();
        var pos = getMousePos(e);
        contextMenuPos.x = pos.x;
        contextMenuPos.y = pos.y;
        var menu = document.getElementById("canvasMenu");
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";
        menu.classList.add("visible");

        requestAnimationFrame(function () {
            var rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (e.clientX - rect.width) + "px";
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (e.clientY - rect.height) + "px";
            }
        });
    }

    function encodeState(data) {
        var json = JSON.stringify(data);
        return btoa(unescape(encodeURIComponent(json)));
    }

    function decodeState(hash) {
        var json = decodeURIComponent(escape(atob(hash)));
        return JSON.parse(json);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand("copy");
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                document.body.removeChild(textarea);
            }
        });
    }

    function showToast(message) {
        var existing = document.getElementById("toast");
        if (existing) existing.remove();

        var toast = document.createElement("div");
        toast.id = "toast";
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(function () {
            toast.classList.add("visible");
        });

        setTimeout(function () {
            toast.classList.remove("visible");
            setTimeout(function () { toast.remove(); }, 300);
        }, 3000);
    }

    function shareState() {
        if (notes.length === 0) {
            showToast("Nothing to share — add some ideas first!");
            return;
        }

        var data = { notes: notes, connections: connections };
        var encoded = encodeState(data);

        if (encoded.length > 65000) {
            showToast("Board is too large to share via link. Use Export instead.");
            return;
        }

        window.location.hash = encoded;
        var url = window.location.href;

        copyToClipboard(url).then(function () {
            showToast("Link copied to clipboard!");
        }).catch(function () {
            showToast("Link ready! Copy the URL from the address bar.");
        });
    }

    function loadSharedState() {
        var hash = window.location.hash;
        if (!hash || hash.length < 2) return;

        try {
            var encoded = hash.substring(1);
            var data = decodeState(encoded);

            if (!data.notes || !data.connections) return;

            var hasExisting = notes.length > 0 || connections.length > 0;

            if (hasExisting) {
                var doLoad = confirm("This link contains a mindmap board. Replace your current board with it?");
                if (!doLoad) {
                    history.replaceState(null, "", window.location.pathname);
                    return;
                }
            }

            notes = data.notes.map(function (n) {
                if (!n.w) n.w = NOTE_WIDTH;
                if (!n.h) n.h = NOTE_HEIGHT;
                return n;
            });
            connections = data.connections;

            COLOR_CYCLE = 0;
            for (var i = 0; i < notes.length; i++) {
                var ci = NOTE_COLORS.findIndex(function (c) {
                    return c.fill === notes[i].color.fill;
                });
                if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
            }

            var clearNotes = db.transaction(NOTES_STORE, "readwrite").objectStore(NOTES_STORE).clear();
            var clearConns = db.transaction(CONNS_STORE, "readwrite").objectStore(CONNS_STORE).clear();
            clearNotes.onsuccess = function () {
                for (var i = 0; i < notes.length; i++) saveNote(notes[i]);
            };
            clearConns.onsuccess = function () {
                for (var i = 0; i < connections.length; i++) saveConnection(connections[i]);
            };

            history.replaceState(null, "", window.location.pathname);
            render();
            showToast("Board loaded from shared link!");
        } catch (err) {
            console.error("Failed to load shared state:", err);
            history.replaceState(null, "", window.location.pathname);
        }
    }

    function exportState() {
        var data = {
            notes: notes,
            connections: connections
        };
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "mindmap-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importState() {
        var input = document.getElementById("importInput");
        input.value = "";
        input.onchange = function () {
            var file = input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    var data = JSON.parse(ev.target.result);
                    if (!data.notes || !data.connections) {
                        alert("Invalid mindmap file.");
                        return;
                    }
                    notes = data.notes.map(function (n) {
                        if (!n.w) n.w = NOTE_WIDTH;
                        if (!n.h) n.h = NOTE_HEIGHT;
                        return n;
                    });
                    connections = data.connections;
                    COLOR_CYCLE = 0;
                    for (var i = 0; i < notes.length; i++) {
                        var ci = NOTE_COLORS.findIndex(function (c) {
                            return c.fill === notes[i].color.fill;
                        });
                        if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
                    }
                    var clearNotes = db.transaction(NOTES_STORE, "readwrite").objectStore(NOTES_STORE).clear();
                    var clearConns = db.transaction(CONNS_STORE, "readwrite").objectStore(CONNS_STORE).clear();
                    clearNotes.onsuccess = function () {
                        for (var i = 0; i < notes.length; i++) saveNote(notes[i]);
                    };
                    clearConns.onsuccess = function () {
                        for (var i = 0; i < connections.length; i++) saveConnection(connections[i]);
                    };
                    render();
                } catch (err) {
                    alert("Failed to parse file: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function showContextMenu(e, noteIdx) {
        e.preventDefault();
        var pos = getMousePos(e);
        contextMenuPos.x = pos.x;
        contextMenuPos.y = pos.y;
        var menu = document.getElementById("contextMenu");
        contextMenuState.noteIdx = noteIdx;
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";
        menu.classList.add("visible");

        requestAnimationFrame(function () {
            var rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (e.clientX - rect.width) + "px";
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (e.clientY - rect.height) + "px";
            }
        });
    }

    function showConnectionMenu(e, connIdx) {
        e.preventDefault();
        hideContextMenu();
        connectionMenuState.connIdx = connIdx;
        var menu = document.getElementById("connectionMenu");
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";
        menu.classList.add("visible");

        requestAnimationFrame(function () {
            var rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (e.clientX - rect.width) + "px";
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (e.clientY - rect.height) + "px";
            }
        });
    }

    function init() {
        loadTheme();

        canvas = document.getElementById("canvas");
        ctx = canvas.getContext("2d");
        resizeCanvas();

        applyTheme();

        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
            if (themePreference === "system") {
                applyTheme();
            }
        });

        window.addEventListener("resize", resizeCanvas);

        document.getElementById("addNoteBtn").addEventListener("click", addNote);
        document.getElementById("connectBtn").addEventListener("click", toggleConnectMode);

        document.getElementById("zoomInBtn").addEventListener("click", zoomIn);
        document.getElementById("zoomOutBtn").addEventListener("click", zoomOut);
        document.getElementById("resetZoomBtn").addEventListener("click", resetZoom);

        canvas.addEventListener("wheel", function (e) {
            e.preventDefault();
            var rect = canvas.getBoundingClientRect();
            var cx = e.clientX - rect.left;
            var cy = e.clientY - rect.top;
            var factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            zoomAtPoint(cx, cy, factor);
        }, { passive: false });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && connectState.active) {
                toggleConnectMode();
            }
        });

        canvas.addEventListener("mousedown", function (e) {
            if (editState.active) {
                var pos = getMousePos(e);
                var cur = notes[editState.noteIdx];
                if (cur && pos.x >= cur.x && pos.x <= cur.x + cur.w && pos.y >= cur.y && pos.y <= cur.y + cur.h) {
                    return;
                }
                hideInput();
                render();
            }

            if (headerEditState.active) {
                hideHeaderInput();
                render();
            }

            var pos = getMousePos(e);
            var idx = hitTest(pos.x, pos.y);

            if (connectState.active) {
                if (idx === -1) return;
                var clickedNote = notes[idx];
                if (!connectState.sourceId) {
                    connectState.sourceId = clickedNote.id;
                    setConnectHint("Now click a target idea...");
                    render();
                } else {
                    if (clickedNote.id !== connectState.sourceId) {
                        var existing = connections.some(function (c) {
                            return c.from === connectState.sourceId && c.to === clickedNote.id;
                        });
                        if (!existing) {
                            var conn = createConnection(connectState.sourceId, clickedNote.id);
                            connections.push(conn);
                            saveConnection(conn);
                        }
                    }
                    connectState.sourceId = null;
                    toggleConnectMode();
                    render();
                }
                return;
            }

            if (idx === -1) return;

            if (isResizeHandle(pos.x, pos.y, notes[idx])) {
                e.preventDefault();
                idx = bringToFront(idx);
                resize.active = true;
                resize.noteIdx = idx;
                resize.startX = pos.x;
                resize.startY = pos.y;
                resize.startW = notes[idx].w;
                resize.startH = notes[idx].h;
                canvas.style.cursor = "nwse-resize";
                render();
                return;
            }

            if (isCloseBtn(pos.x, pos.y, notes[idx])) {
                var deletedId = notes[idx].id;
                deleteConnectionsForNote(deletedId);
                notes.splice(idx, 1);
                deleteNote(deletedId);
                render();
                return;
            }

            if (isHeaderArea(pos.x, pos.y, notes[idx])) {
                e.preventDefault();
                idx = bringToFront(idx);
                var hdrIdx = idx;
                setTimeout(function () {
                    showHeaderInput(hdrIdx);
                }, 0);
                return;
            }

            idx = bringToFront(idx);

            drag.active = true;
            drag.noteIdx = idx;
            drag.offsetX = pos.x - notes[idx].x;
            drag.offsetY = pos.y - notes[idx].y;
            canvas.style.cursor = "grabbing";
            render();
        });

        canvas.addEventListener("mousemove", function (e) {
            var pos = getMousePos(e);
            if (resize.active && notes[resize.noteIdx]) {
                var note = notes[resize.noteIdx];
                var newW = resize.startW + (pos.x - resize.startX);
                var newH = resize.startH + (pos.y - resize.startY);
                note.w = Math.max(MIN_NOTE_WIDTH, newW);
                note.h = Math.max(MIN_NOTE_HEIGHT, newH);
                render();
            } else if (drag.active && notes[drag.noteIdx]) {
                notes[drag.noteIdx].x = pos.x - drag.offsetX;
                notes[drag.noteIdx].y = pos.y - drag.offsetY;
                render();
            } else {
                var idx = hitTest(pos.x, pos.y);
                if (idx >= 0 && isResizeHandle(pos.x, pos.y, notes[idx])) {
                    canvas.style.cursor = "nwse-resize";
                } else if (connectState.active) {
                    canvas.style.cursor = idx >= 0 ? "crosshair" : "default";
                } else if (idx >= 0) {
                    canvas.style.cursor = "grab";
                } else if (hitTestConnection(pos.x, pos.y) >= 0) {
                    canvas.style.cursor = "pointer";
                } else {
                    canvas.style.cursor = "default";
                }
            }
        });

        canvas.addEventListener("mouseup", function () {
            if (resize.active) {
                saveNote(notes[resize.noteIdx]);
                resize.active = false;
                canvas.style.cursor = "default";
            } else if (drag.active) {
                saveNote(notes[drag.noteIdx]);
                drag.active = false;
                canvas.style.cursor = connectState.active ? "crosshair" : "default";
            }
        });

        canvas.addEventListener("dblclick", function (e) {
            if (connectState.active) return;
            var pos = getMousePos(e);
            var idx = hitTest(pos.x, pos.y);
            if (idx >= 0) {
                showInput(idx);
            } else {
                addNoteAt(pos.x, pos.y);
            }
        });

        canvas.addEventListener("mouseleave", function () {
            if (resize.active) {
                saveNote(notes[resize.noteIdx]);
                resize.active = false;
                canvas.style.cursor = "default";
            } else if (drag.active) {
                saveNote(notes[drag.noteIdx]);
                drag.active = false;
                canvas.style.cursor = "default";
            }
        });

        canvas.addEventListener("contextmenu", function (e) {
            var pos = getMousePos(e);
            var idx = hitTest(pos.x, pos.y);
            if (idx >= 0) {
                showContextMenu(e, idx);
            } else {
                var connIdx = hitTestConnection(pos.x, pos.y);
                if (connIdx >= 0) {
                    showConnectionMenu(e, connIdx);
                } else {
                    showCanvasMenu(e);
                }
            }
        });

        document.addEventListener("click", function (e) {
            var menu = document.getElementById("contextMenu");
            var canvasMenu = document.getElementById("canvasMenu");
            var connMenu = document.getElementById("connectionMenu");
            if (!menu.contains(e.target) && !canvasMenu.contains(e.target) && !connMenu.contains(e.target)) {
                hideContextMenu();
            }
        });

        document.getElementById("contextMenu").addEventListener("click", function (e) {
            var target = e.target;

            var themeOpt = target.closest(".context-theme-option");
            if (themeOpt) {
                setTheme(themeOpt.getAttribute("data-theme"));
                return;
            }

            var colorOpt = target.closest(".context-color-option");
            if (colorOpt) {
                var colorIdx = parseInt(colorOpt.getAttribute("data-color"), 10);
                if (contextMenuState.noteIdx >= 0 && notes[contextMenuState.noteIdx]) {
                    notes[contextMenuState.noteIdx].color = NOTE_COLORS[colorIdx];
                    saveNote(notes[contextMenuState.noteIdx]);
                    render();
                }
                hideContextMenu();
                return;
            }

            var item = target.closest(".context-menu-item");
            if (!item) return;
            var action = item.getAttribute("data-action");

            if (action === "add-idea") {
                addNoteAt(contextMenuPos.x, contextMenuPos.y);
            }

            if (action === "connect" && contextMenuState.noteIdx >= 0) {
                if (!connectState.active) {
                    toggleConnectMode();
                }
                connectState.sourceId = notes[contextMenuState.noteIdx].id;
                setConnectHint("Now click a target idea...");
                render();
            }

            if (action === "delete" && contextMenuState.noteIdx >= 0) {
                var delIdx = contextMenuState.noteIdx;
                var deletedId = notes[delIdx].id;
                deleteConnectionsForNote(deletedId);
                notes.splice(delIdx, 1);
                deleteNote(deletedId);
                render();
            }

            hideContextMenu();
        });

        document.getElementById("canvasMenu").addEventListener("click", function (e) {
            var target = e.target;

            var themeOpt = target.closest(".context-theme-option");
            if (themeOpt) {
                setTheme(themeOpt.getAttribute("data-theme"));
                return;
            }

            var item = e.target.closest(".context-menu-item");
            if (!item) return;
            var action = item.getAttribute("data-action");

            if (action === "add-idea") {
                addNoteAt(contextMenuPos.x, contextMenuPos.y);
            }

            if (action === "export") {
                exportState();
            }

            if (action === "import") {
                importState();
            }

            if (action === "share") {
                shareState();
            }

            hideContextMenu();
        });

        document.getElementById("connectionMenu").addEventListener("click", function (e) {
            var item = e.target.closest(".context-menu-item");
            if (!item) return;
            var action = item.getAttribute("data-action");

            if (action === "delete-connection" && connectionMenuState.connIdx >= 0) {
                var conn = connections[connectionMenuState.connIdx];
                if (conn) {
                    deleteConnection(conn.id);
                    connections.splice(connectionMenuState.connIdx, 1);
                    render();
                }
            }

            hideContextMenu();
        });

        openDB().then(function () {
            return Promise.all([dbGetAll(NOTES_STORE), dbGetAll(CONNS_STORE)]);
        }).then(function (results) {
            notes = results[0].map(function (n) {
                if (!n.w) n.w = NOTE_WIDTH;
                if (!n.h) n.h = NOTE_HEIGHT;
                return n;
            });
            connections = results[1];
            for (var i = 0; i < notes.length; i++) {
                var ci = NOTE_COLORS.findIndex(function (c) {
                    return c.fill === notes[i].color.fill;
                });
                if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
            }
            render();
            console.log("MindMap initialized — " + notes.length + " notes, " + connections.length + " connections");
            loadSharedState();
        }).catch(function (err) {
            console.error("IndexedDB init failed:", err);
            render();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
