(function () {
    "use strict";

    var DB_NAME = "mindmapdb";
    var DB_VERSION = 2;
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

    var editState = {
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

    var contextMenuPos = { x: 0, y: 0 };

    var zoomLevel = 1.0;
    var panX = 0;
    var panY = 0;

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var database = e.target.result;
                if (!database.objectStoreNames.contains(NOTES_STORE)) {
                    database.createObjectStore(NOTES_STORE, { keyPath: "id" });
                }
                if (!database.objectStoreNames.contains(CONNS_STORE)) {
                    database.createObjectStore(CONNS_STORE, { keyPath: "id" });
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

        ctx.strokeStyle = "#555";
        ctx.fillStyle = "#555";
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
        ctx.fillStyle = "#c8c8c8";
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
            ctx.strokeStyle = "#e74c3c";
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.setLineDash([]);
        }

        ctx.fillStyle = note.color.stroke;
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("IDEA", x + 12, y + 10);

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
            if (!note.text) ctx.fillStyle = "#999";
            var maxW = w - 24;
            var lines = wrapText(text, maxW);
            var lineH = 20;
            var ty = y + 36;
            var maxLines = Math.floor((h - 48) / lineH);
            for (var li = 0; li < Math.min(lines.length, maxLines); li++) {
                ctx.fillText(lines[li], x + 12, ty + li * lineH);
            }
            if (lines.length > maxLines) {
                ctx.fillStyle = "#999";
                ctx.fillText("...", x + 12, ty + maxLines * lineH);
            }
        }

        if (editState.active && editState.noteIdx === idx) {
            ctx.strokeStyle = "#2c3e50";
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    function render() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

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
        input.style.background = "rgba(255,255,255,0.6)";
        input.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        input.style.fontSize = (14 * zoomLevel) + "px";
        input.style.color = "#333";
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
        contextMenuState.noteIdx = -1;
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
                    notes = data.notes;
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

    function init() {
        canvas = document.getElementById("canvas");
        ctx = canvas.getContext("2d");
        resizeCanvas();

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
                    setConnectHint("Click a source idea...");
                    render();
                }
                return;
            }

            if (idx === -1) return;

            if (isCloseBtn(pos.x, pos.y, notes[idx])) {
                var deletedId = notes[idx].id;
                deleteConnectionsForNote(deletedId);
                notes.splice(idx, 1);
                deleteNote(deletedId);
                render();
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
            if (drag.active && notes[drag.noteIdx]) {
                notes[drag.noteIdx].x = pos.x - drag.offsetX;
                notes[drag.noteIdx].y = pos.y - drag.offsetY;
                render();
            } else {
                var idx = hitTest(pos.x, pos.y);
                if (connectState.active) {
                    canvas.style.cursor = idx >= 0 ? "crosshair" : "default";
                } else {
                    canvas.style.cursor = idx >= 0 ? "grab" : "default";
                }
            }
        });

        canvas.addEventListener("mouseup", function () {
            if (drag.active) {
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
            }
        });

        canvas.addEventListener("mouseleave", function () {
            if (drag.active) {
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
                showCanvasMenu(e);
            }
        });

        document.addEventListener("click", function (e) {
            var menu = document.getElementById("contextMenu");
            var canvasMenu = document.getElementById("canvasMenu");
            if (!menu.contains(e.target) && !canvasMenu.contains(e.target)) {
                hideContextMenu();
            }
        });

        document.getElementById("contextMenu").addEventListener("click", function (e) {
            var target = e.target;

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

            hideContextMenu();
        });

        openDB().then(function () {
            return Promise.all([dbGetAll(NOTES_STORE), dbGetAll(CONNS_STORE)]);
        }).then(function (results) {
            notes = results[0];
            connections = results[1];
            for (var i = 0; i < notes.length; i++) {
                var ci = NOTE_COLORS.findIndex(function (c) {
                    return c.fill === notes[i].color.fill;
                });
                if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
            }
            render();
            console.log("MindMap initialized — " + notes.length + " notes, " + connections.length + " connections");
        }).catch(function (err) {
            console.error("IndexedDB init failed:", err);
            render();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
