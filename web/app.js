/**
 * MindMap — Vanilla HTML5 Canvas brainstorming SPA
 *
 * Everything lives in a single IIFE to avoid polluting the global scope.
 * Uses `var` throughout for broad browser compatibility (no let/const).
 * No frameworks, no build step, no external dependencies.
 *
 * Architecture overview:
 *   - IndexedDB stores: notes, connections, viewport, boards
 *   - Single <canvas> element for all rendering (immediate-mode)
 *   - Flat state objects track interaction modes (drag, resize, pan, edit, connect)
 *   - Coordinate system: world coords stored in data, screen coords for events
 *     Conversion: worldX = (screenX - panX) / zoomLevel
 */
(function () {
    "use strict";

    /* ── IndexedDB Configuration ─────────────────────────────────── */
    var DB_NAME = "mindmapdb";
    var DB_VERSION = 5;
    var NOTES_STORE = "notes";
    var CONNS_STORE = "connections";
    var VIEWPORT_STORE = "viewport";
    var BOARDS_STORE = "boards";
    var CURRENT_BOARD_KEY = "mindmap-current-board"; // localStorage key for last-used board

    /* ── Layout Constants ────────────────────────────────────────── */
    var TOOLBAR_HEIGHT = 48;  // must match #toolbar height in CSS
    var NOTE_WIDTH = 220;     // default note width (px, in world coords)
    var NOTE_HEIGHT = 180;    // default note height

    /* Color palette for notes — cycles through on creation */
    var NOTE_COLORS = [
        { fill: "#fff9b1", stroke: "#e6d935" },
        { fill: "#ffcccb", stroke: "#e67373" },
        { fill: "#b3e6b3", stroke: "#5cb85c" },
        { fill: "#b3d9ff", stroke: "#5ba3e6" },
        { fill: "#e6ccff", stroke: "#a366d9" },
        { fill: "#ffe0b3", stroke: "#e6a34d" }
    ];
    var COLOR_CYCLE = 0;      // tracks next color index; updated on load to avoid duplicates
    var MIN_NOTE_WIDTH = 120;  // minimum resizable note dimensions
    var MIN_NOTE_HEIGHT = 80;
    var MIN_ZOOM = 0.33;      // zoom range limits
    var MAX_ZOOM = 2.0;
    var ZOOM_STEP = 1.15;     // multiplicative zoom factor per scroll tick

    /* Word lists for random board name generation (adjective + noun) */
    var ADJECTIVES = [
        "Swift", "Bold", "Bright", "Calm", "Clever", "Cosmic", "Dreamy",
        "Eager", "Frosty", "Gentle", "Happy", "Keen", "Lively", "Noble",
        "Quick", "Sunny", "Vivid", "Witty", "Zesty", "Brave", "Dazzling",
        "Epic", "Golden", "Mystic", "Radiant", "Silent", "Tiny", "Vast"
    ];
    var NOUNS = [
        "Canvas", "Spark", "Storm", "Wave", "Forest", "Galaxy", "Horizon",
        "Journey", "Meadow", "Nexus", "Orbit", "Prism", "Quest", "Ridge",
        "Summit", "Tide", "Vault", "Zenith", "Atlas", "Bloom", "Drift",
        "Echo", "Flare", "Grove", "Haven", "Lumen", "Peak", "Realm"
    ];

    /* ── Runtime State ────────────────────────────────────────────── */
    var db = null;        // IndexedDB database instance (set in openDB)
    var notes = [];       // notes for current board (in-memory cache)
    var connections = []; // connections for current board
    var boards = [];      // all boards
    var currentBoardId = null;
    var canvas, ctx;
    var dpr = window.devicePixelRatio || 1;

    /* ── Interaction State Objects ────────────────────────────────── *
     * These flat objects track which interaction mode is active.
     * They are effectively mutually exclusive — mousedown handlers
     * check them in priority order.                                   */

    /** Note body dragging */
    var drag = {
        active: false,
        noteIdx: -1,
        offsetX: 0,
        offsetY: 0
    };

    /** Note corner resizing */
    var resize = {
        active: false,
        noteIdx: -1,
        startX: 0,
        startY: 0,
        startW: 0,
        startH: 0
    };

    /** Body text editing (floating textarea overlay) */
    var editState = {
        active: false,
        noteIdx: -1
    };

    /** Header/title editing (floating input overlay) */
    var headerEditState = {
        active: false,
        noteIdx: -1
    };

    /** Connection creation mode (click source, then click target) */
    var connectState = {
        active: false,
        sourceId: null
    };

    /** Context menu state — which note/connection the menu is open on */
    var contextMenuState = {
        noteIdx: -1
    };

    var connectionMenuState = {
        connIdx: -1
    };

    var contextMenuPos = { x: 0, y: 0 }; // world coords where context menu was opened

    /* ── Viewport State (pan & zoom) ─────────────────────────────── */
    var zoomLevel = 1.0;
    var panX = 0;
    var panY = 0;

    /** Canvas panning state (mousedown on empty space) */
    var pan = {
        active: false,
        startX: 0,
        startY: 0,
        startPanX: 0,
        startPanY: 0
    };

    /* ── Theme System ────────────────────────────────────────────── */
    var THEME_KEY = "mindmap-theme"; // localStorage key
    var themePreference = "system";  // "system" | "light" | "dark"
    var isDarkMode = false;

    /** Canvas render colors for light and dark themes.
     *  CSS-styled elements use [data-theme="dark"] selectors instead. */
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

    /** Detect OS dark mode preference */
    function getSystemDarkMode() {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    /** Resolve and apply the effective theme (system → computed dark/light).
     *  Sets data-theme attribute on <html> for CSS, and re-renders canvas. */
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

    /** Generate a random board name from adjective + noun lists */
    function generateBoardName() {
        var adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
        var noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        return adj + " " + noun;
    }

    /* ── IndexedDB Setup ─────────────────────────────────────────── */

    /** Open (or create/upgrade) the IndexedDB database.
     *  Handles schema migrations for versions < 5:
     *    - v3: adds default w/h to notes that lacked them
     *    - v5: adds boardId index to notes/connections, seeds "default" board,
     *          migrates viewport key from "current" to board ID
     */
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
                if (!database.objectStoreNames.contains(VIEWPORT_STORE)) {
                    database.createObjectStore(VIEWPORT_STORE, { keyPath: "id" });
                }
                if (!database.objectStoreNames.contains(BOARDS_STORE)) {
                    database.createObjectStore(BOARDS_STORE, { keyPath: "id" });
                }

                var tx = e.target.transaction;

                if (oldVersion < 3) {
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

                if (oldVersion < 5) {
                    if (tx.objectStoreNames.contains(NOTES_STORE)) {
                        var ns = tx.objectStore(NOTES_STORE);
                        if (!ns.indexNames.contains("boardId")) {
                            ns.createIndex("boardId", "boardId", { unique: false });
                        }
                        ns.openCursor().onsuccess = function (ev) {
                            var cursor = ev.target.result;
                            if (cursor) {
                                var note = cursor.value;
                                if (!note.boardId) {
                                    note.boardId = "default";
                                    cursor.update(note);
                                }
                                cursor.continue();
                            }
                        };
                    }
                    if (tx.objectStoreNames.contains(CONNS_STORE)) {
                        var cs = tx.objectStore(CONNS_STORE);
                        if (!cs.indexNames.contains("boardId")) {
                            cs.createIndex("boardId", "boardId", { unique: false });
                        }
                        cs.openCursor().onsuccess = function (ev) {
                            var cursor = ev.target.result;
                            if (cursor) {
                                var conn = cursor.value;
                                if (!conn.boardId) {
                                    conn.boardId = "default";
                                    cursor.update(conn);
                                }
                                cursor.continue();
                            }
                        };
                    }
                    if (tx.objectStoreNames.contains(BOARDS_STORE)) {
                        var bs = tx.objectStore(BOARDS_STORE);
                        var checkReq = bs.get("default");
                        checkReq.onsuccess = function () {
                            if (!checkReq.result) {
                                bs.put({
                                    id: "default",
                                    name: "My Board",
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                });
                            }
                        };
                    }
                    if (tx.objectStoreNames.contains(VIEWPORT_STORE)) {
                        var vs = tx.objectStore(VIEWPORT_STORE);
                        vs.openCursor().onsuccess = function (ev) {
                            var cursor = ev.target.result;
                            if (cursor) {
                                var vp = cursor.value;
                                if (vp.id === "current") {
                                    cursor.delete();
                                    vp.id = "default";
                                    vs.put(vp);
                                }
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

    /* ── IndexedDB CRUD Helpers ──────────────────────────────────── *
     * All return Promises for ergonomic async usage.                   */

    /** Get all records from a store */
    function dbGetAll(storeName) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readonly");
            var store = tx.objectStore(storeName);
            var req = store.getAll();
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Get a single record by key */
    function dbGet(storeName, id) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readonly");
            var store = tx.objectStore(storeName);
            var req = store.get(id);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Insert or update a record (upsert by key) */
    function dbPut(storeName, item) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readwrite");
            var store = tx.objectStore(storeName);
            var req = store.put(item);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Delete a record by key */
    function dbDelete(storeName, id) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readwrite");
            var store = tx.objectStore(storeName);
            var req = store.delete(id);
            req.onsuccess = function () { resolve(); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Query all records matching a secondary index value (e.g. all notes for a boardId) */
    function dbGetByIndex(storeName, indexName, value) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readonly");
            var store = tx.objectStore(storeName);
            var idx = store.index(indexName);
            var req = idx.getAll(value);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Delete all records matching a secondary index value (used when deleting a board) */
    function dbClearByIndex(storeName, indexName, value) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, "readwrite");
            var store = tx.objectStore(storeName);
            var idx = store.index(indexName);
            var req = idx.openCursor(value);
            req.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    /* ── Note & Connection Persistence ────────────────────────────── */

    /** Persist a note to IndexedDB (fire-and-forget) */
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

    /** Remove a note and all its connections from DB and in-memory arrays */
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

    /* ── Viewport Persistence ────────────────────────────────────── *
     * Viewport (panX, panY, zoomLevel) is stored per board in the     *
     * viewport object store, keyed by boardId.                         */

    /** Save current viewport to IndexedDB for the active board */
    function saveViewport() {
        if (!db || !currentBoardId) return;
        dbPut(VIEWPORT_STORE, { id: currentBoardId, panX: panX, panY: panY, zoomLevel: zoomLevel }).catch(function (err) { console.error("Save viewport failed:", err); });
    }

    /** Load viewport for a given board, resetting to defaults if none saved */
    function loadViewport(boardId) {
        if (!db) return Promise.resolve();
        return dbGet(VIEWPORT_STORE, boardId).then(function (vp) {
            if (vp) {
                panX = vp.panX || 0;
                panY = vp.panY || 0;
                zoomLevel = vp.zoomLevel || 1.0;
            } else {
                panX = 0;
                panY = 0;
                zoomLevel = 1.0;
            }
        });
    }

    /* ── Board Management ─────────────────────────────────────────── */

    /** Load all boards from IndexedDB into memory */
    function loadBoards() {
        return dbGetAll(BOARDS_STORE).then(function (result) {
            boards = result;
        });
    }

    /** Save a board record, updating its updatedAt timestamp */
    function saveBoard(board) {
        board.updatedAt = Date.now();
        return dbPut(BOARDS_STORE, board);
    }

    /** Create a new board with a random name, persist it, and return it */
    function createBoard(name) {
        var board = {
            id: Date.now() + "-" + Math.random().toString(36).substr(2, 6),
            name: name || generateBoardName(),
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        return saveBoard(board).then(function () {
            boards.push(board);
            return board;
        });
    }

    /** Delete a board and all associated notes, connections, and viewport */
    function deleteBoardAndData(boardId) {
        var idx = boards.findIndex(function (b) { return b.id === boardId; });
        if (idx === -1) return Promise.resolve();

        return Promise.all([
            dbClearByIndex(NOTES_STORE, "boardId", boardId),
            dbClearByIndex(CONNS_STORE, "boardId", boardId),
            dbDelete(VIEWPORT_STORE, boardId),
            dbDelete(BOARDS_STORE, boardId)
        ]).then(function () {
            boards.splice(idx, 1);
        });
    }

    /** Switch to a different board: save current viewport, load new data, re-render */
    function switchToBoard(boardId) {
        if (boardId === currentBoardId) {
            return Promise.resolve();
        }

        saveViewport();

        currentBoardId = boardId;
        try { localStorage.setItem(CURRENT_BOARD_KEY, boardId); } catch (e) { /* ignore */ }

        hideInput();
        hideHeaderInput();

        return loadBoardData(boardId).then(function () {
            render();
            updateBoardNameDisplay();
        });
    }

    /** Load notes, connections, and viewport for a given board from IndexedDB.
     *  Also resets the color cycle counter to avoid duplicating existing colors. */
    function loadBoardData(boardId) {
        return Promise.all([
            dbGetByIndex(NOTES_STORE, "boardId", boardId),
            dbGetByIndex(CONNS_STORE, "boardId", boardId),
            loadViewport(boardId)
        ]).then(function (results) {
            notes = results[0].map(function (n) {
                if (!n.w) n.w = NOTE_WIDTH;
                if (!n.h) n.h = NOTE_HEIGHT;
                return n;
            });
            connections = results[1];
            COLOR_CYCLE = 0;
            for (var i = 0; i < notes.length; i++) {
                var ci = NOTE_COLORS.findIndex(function (c) {
                    return c.fill === notes[i].color.fill;
                });
                if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
            }
        });
    }

    /* ── Note & Connection Factories ──────────────────────────────── */

    /** Create a new note object with auto-cycled color and unique ID */
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
            boardId: currentBoardId,
            id: Date.now() + "-" + Math.random().toString(36).substr(2, 6)
        };
    }

    /** Create a connection object. ID format: "fromId->toId" */
    function createConnection(fromId, toId) {
        return {
            id: fromId + "->" + toId,
            from: fromId,
            to: toId,
            boardId: currentBoardId
        };
    }

    /* ── Geometry Helpers ────────────────────────────────────────── */

    /** Look up a note by its ID (linear scan) */
    function findNoteById(id) {
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) return notes[i];
        }
        return null;
    }

    /** Calculate the point on a note's bounding rectangle edge that faces
     *  towards (targetX, targetY). Used to anchor arrow endpoints. */
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

    /* ── Canvas Drawing Functions ────────────────────────────────── */

    /** Draw a directional arrow from one note to another.
     *  Arrow starts/ends at the edge points of the bounding rectangles. */
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

    /** Draw the background dot grid. Only draws dots within the visible
     *  viewport to avoid rendering thousands of off-screen dots. */
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

    /** Word-wrap text to fit within maxWidth (canvas measureText).
     *  Returns an array of lines. */
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

    /** Draw a single note card on the canvas.
     *  Renders: rounded rect with shadow, header, separator, body text,
     *  close button (×), resize handle (triangle), and edit/connect indicators. */
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

        ctx.fillStyle = note.color.stroke;
        ctx.beginPath();
        ctx.moveTo(x + w - 10, y + h - 4);
        ctx.lineTo(x + w - 4, y + h - 10);
        ctx.lineTo(x + w - 4, y + h - 4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /* ── Main Render Loop ────────────────────────────────────────── */

    /** Full canvas redraw. Applies DPR scaling, pan/zoom transform,
     *  then draws: background → dot grid → connections → notes.
     *  Called after every state change (move, resize, edit, etc.) */
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

    /* ── Zoom & Pan Controls ─────────────────────────────────────── */

    /** Zoom around a specific screen-space point (preserves that point's world position) */
    function zoomAtPoint(cx, cy, factor) {
        var oldZoom = zoomLevel;
        var newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel * factor));
        panX = cx - (cx - panX) * (newZoom / oldZoom);
        panY = cy - (cy - panY) * (newZoom / oldZoom);
        zoomLevel = newZoom;
        saveViewport();
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
        saveViewport();
        render();
    }

    function panBy(dx, dy) {
        panX += dx;
        panY += dy;
        saveViewport();
        render();
    }

    /* ── Hit Testing ─────────────────────────────────────────────── *
     * All hit tests operate in world coordinates.                       */

    /** Return the index of the topmost note at (mx, my), or -1 */
    function hitTest(mx, my) {
        for (var i = notes.length - 1; i >= 0; i--) {
            var n = notes[i];
            if (mx >= n.x && mx <= n.x + n.w && my >= n.y && my <= n.y + n.h) {
                return i;
            }
        }
        return -1;
    }

    /** Calculate perpendicular distance from point (px,py) to line segment (x1,y1)→(x2,y2) */
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

    /** Return the index of the connection closest to (mx, my) within 8px threshold, or -1 */
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

    /** Check if (mx, my) is within the × close button region of a note */
    function isCloseBtn(mx, my, note) {
        var closeX = note.x + note.w - 24;
        var closeY = note.y + 6;
        return mx >= closeX && mx <= closeX + 20 && my >= closeY && my <= closeY + 20;
    }

    /** Move a note to the end of the array so it renders on top. Returns new index. */
    function bringToFront(idx) {
        var note = notes.splice(idx, 1)[0];
        notes.push(note);
        return notes.length - 1;
    }

    /** Resize canvas to fill the window, accounting for device pixel ratio for sharp rendering */
    function resizeCanvas() {
        dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        render();
    }

    function toggleConnectMode() {
        connectState.active = !connectState.active;
        connectState.sourceId = null;
        render();
    }

    /* ── Text Editing (floating overlays) ────────────────────────── *
     * Editing is done via real DOM elements (textarea/input)           *
     * positioned over the canvas at the note's screen coordinates.     */

    /** Show a floating textarea over a note's body area for editing */
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

    /** Write textarea value back to the note and persist */
    function commitInput(idx) {
        var el = document.getElementById("noteInput");
        if (el && notes[idx]) {
            notes[idx].text = el.value;
            saveNote(notes[idx]);
        }
        hideInput();
        render();
    }

    /** Show a floating input over a note's header area for title editing */
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

    /** Check if a point is within the header area (top 28px of the note) */
    function isHeaderArea(mx, my, note) {
        return mx >= note.x && mx <= note.x + note.w && my >= note.y && my <= note.y + 28;
    }

    /** Check if a point is within the bottom-right resize handle (12×12px) */
    function isResizeHandle(mx, my, note) {
        var handleSize = 12;
        return mx >= note.x + note.w - handleSize &&
               mx <= note.x + note.w &&
               my >= note.y + note.h - handleSize &&
               my <= note.y + note.h;
    }

    /** Convert mouse event screen coords to world coords (accounting for pan & zoom) */
    function getMousePos(e) {
        var rect = canvas.getBoundingClientRect();
        var screenX = e.clientX - rect.left;
        var screenY = e.clientY - rect.top;
        return {
            x: (screenX - panX) / zoomLevel,
            y: (screenY - panY) / zoomLevel
        };
    }

    /** Create a note at a specific world position and immediately open its editor */
    function addNoteAt(x, y) {
        var note = createNote(x - NOTE_WIDTH / 2, y - NOTE_HEIGHT / 2);
        notes.push(note);
        saveNote(note);
        render();
        showInput(notes.length - 1);
    }

    /** Create a note at a random position within the visible viewport area */
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

    /* ── Context Menus ───────────────────────────────────────────── */

    /** Hide all context menus and reset their state */
    function hideContextMenu() {
        document.getElementById("contextMenu").classList.remove("visible");
        document.getElementById("canvasMenu").classList.remove("visible");
        document.getElementById("connectionMenu").classList.remove("visible");
        contextMenuState.noteIdx = -1;
        connectionMenuState.connIdx = -1;
    }

    /** Show the canvas background context menu (right-click on empty space) */
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

    /* ── Share / Import / Export ─────────────────────────────────── */

    /** Base64-encode a JS object for URL hash sharing */
    function encodeState(data) {
        var json = JSON.stringify(data);
        return btoa(unescape(encodeURIComponent(json)));
    }

    /** Decode a base64 URL hash back to a JS object */
    function decodeState(hash) {
        var json = decodeURIComponent(escape(atob(hash)));
        return JSON.parse(json);
    }

    /** Copy text to clipboard with fallback for older browsers */
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

    /** Show a temporary toast notification at the bottom of the screen */
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

    /** Encode current board state into the URL hash and copy to clipboard.
     *  Rejects if encoded state exceeds ~65KB (URL length limits). */
    function shareState() {
        if (notes.length === 0) {
            showToast("Nothing to share — add some ideas first!");
            return;
        }

        var currentBoard = boards.find(function (b) { return b.id === currentBoardId; });
        var data = {
            boardName: currentBoard ? currentBoard.name : "Shared Board",
            notes: notes,
            connections: connections,
            viewport: { panX: panX, panY: panY, zoomLevel: zoomLevel }
        };
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

    /** Check if the URL contains shared board data (#base64...).
     *  If found, prompt the user and load it as a new board. */
    function loadSharedState() {
        var hash = window.location.hash;
        if (!hash || hash.length < 2) return;

        try {
            var encoded = hash.substring(1);
            var data = decodeState(encoded);

            if (!data.notes || !data.connections) return;

            var boardName = data.boardName || "Shared Board";

            var doLoad = confirm('Add "' + boardName + '" as a new board?');
            if (!doLoad) {
                history.replaceState(null, "", window.location.pathname);
                return;
            }

            createBoard(boardName).then(function (board) {
                currentBoardId = board.id;
                try { localStorage.setItem(CURRENT_BOARD_KEY, board.id); } catch (e) { /* ignore */ }

                notes = data.notes.map(function (n) {
                    if (!n.w) n.w = NOTE_WIDTH;
                    if (!n.h) n.h = NOTE_HEIGHT;
                    n.boardId = board.id;
                    return n;
                });
                connections = data.connections.map(function (c) {
                    c.boardId = board.id;
                    return c;
                });

                panX = 0;
                panY = 0;
                zoomLevel = 1.0;
                if (data.viewport) {
                    panX = data.viewport.panX || 0;
                    panY = data.viewport.panY || 0;
                    zoomLevel = data.viewport.zoomLevel || 1.0;
                }

                COLOR_CYCLE = 0;
                for (var i = 0; i < notes.length; i++) {
                    var ci = NOTE_COLORS.findIndex(function (c) {
                        return c.fill === notes[i].color.fill;
                    });
                    if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
                }

                var promises = [];
                for (var i = 0; i < notes.length; i++) {
                    promises.push(dbPut(NOTES_STORE, notes[i]));
                }
                for (var j = 0; j < connections.length; j++) {
                    promises.push(dbPut(CONNS_STORE, connections[j]));
                }
                promises.push(dbPut(VIEWPORT_STORE, { id: board.id, panX: panX, panY: panY, zoomLevel: zoomLevel }));

                return Promise.all(promises).then(function () {
                    history.replaceState(null, "", window.location.pathname);
                    render();
                    updateBoardNameDisplay();
                    renderBoardList();
                    showToast('Board "' + boardName + '" added!');
                });
            });
        } catch (err) {
            console.error("Failed to load shared state:", err);
            history.replaceState(null, "", window.location.pathname);
        }
    }

    /** Export current board as a downloadable JSON file */
    function exportState() {
        var currentBoard = boards.find(function (b) { return b.id === currentBoardId; });
        var boardName = currentBoard ? currentBoard.name : "MindMap";
        var data = {
            boardName: boardName,
            notes: notes,
            connections: connections,
            viewport: { panX: panX, panY: panY, zoomLevel: zoomLevel }
        };
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        var safeName = boardName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
        a.download = safeName + "-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /** Prompt user to select a JSON file and import it as a new board */
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

                    var boardName = data.boardName || "Imported Board";
                    createBoard(boardName).then(function (board) {
                        currentBoardId = board.id;
                        try { localStorage.setItem(CURRENT_BOARD_KEY, board.id); } catch (e) { /* ignore */ }

                        notes = data.notes.map(function (n) {
                            if (!n.w) n.w = NOTE_WIDTH;
                            if (!n.h) n.h = NOTE_HEIGHT;
                            n.boardId = board.id;
                            return n;
                        });
                        connections = data.connections.map(function (c) {
                            c.boardId = board.id;
                            return c;
                        });

                        panX = 0;
                        panY = 0;
                        zoomLevel = 1.0;
                        if (data.viewport) {
                            panX = data.viewport.panX || 0;
                            panY = data.viewport.panY || 0;
                            zoomLevel = data.viewport.zoomLevel || 1.0;
                        }

                        COLOR_CYCLE = 0;
                        for (var i = 0; i < notes.length; i++) {
                            var ci = NOTE_COLORS.findIndex(function (c) {
                                return c.fill === notes[i].color.fill;
                            });
                            if (ci >= COLOR_CYCLE) COLOR_CYCLE = ci + 1;
                        }

                        var promises = [];
                        for (var i = 0; i < notes.length; i++) {
                            promises.push(dbPut(NOTES_STORE, notes[i]));
                        }
                        for (var j = 0; j < connections.length; j++) {
                            promises.push(dbPut(CONNS_STORE, connections[j]));
                        }
                        promises.push(dbPut(VIEWPORT_STORE, { id: board.id, panX: panX, panY: panY, zoomLevel: zoomLevel }));

                        return Promise.all(promises).then(function () {
                            render();
                            updateBoardNameDisplay();
                            renderBoardList();
                            showToast('Board "' + boardName + '" imported!');
                        });
                    });
                } catch (err) {
                    alert("Failed to parse file: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    /** Show the note context menu (right-click on a note) */
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

    /** Show the connection context menu (right-click on a connection line) */
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

    /* ── Board Panel (slide-out sidebar) ─────────────────────────── */

    /** Open the board panel sidebar */
    function openBoardPanel() {
        document.getElementById("boardPanel").classList.add("visible");
        document.getElementById("boardPanelBackdrop").classList.add("visible");
        renderBoardList();
    }

    function closeBoardPanel() {
        document.getElementById("boardPanel").classList.remove("visible");
        document.getElementById("boardPanelBackdrop").classList.remove("visible");
    }

    /* ── About Modal ─────────────────────────────────────────────── */

    /** Open the about/info modal (triggered by clicking the "MindMap" title) */
    function openAboutModal() {
        document.getElementById("aboutModal").classList.add("visible");
        document.getElementById("aboutModalBackdrop").classList.add("visible");
    }

    function closeAboutModal() {
        document.getElementById("aboutModal").classList.remove("visible");
        document.getElementById("aboutModalBackdrop").classList.remove("visible");
    }

    /** Update the toolbar board name display and page title */
    function updateBoardNameDisplay() {
        var el = document.getElementById("currentBoardName");
        if (!el) return;
        var board = boards.find(function (b) { return b.id === currentBoardId; });
        var name = board ? board.name : "Untitled";
        el.textContent = name;
        document.title = name + " — MindMap";
    }

    /** Render the board list inside the slide-out panel.
     *  Boards are sorted by updatedAt (most recent first). */
    function renderBoardList() {
        var list = document.getElementById("boardList");
        if (!list) return;
        list.innerHTML = "";

        var sorted = boards.slice().sort(function (a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var board = sorted[i];
            var item = document.createElement("div");
            item.className = "board-item" + (board.id === currentBoardId ? " active" : "");
            item.setAttribute("data-board-id", board.id);

            var nameEl = document.createElement("span");
            nameEl.className = "board-item-name";
            nameEl.textContent = board.name;

            var actions = document.createElement("div");
            actions.className = "board-item-actions";

            var renameBtn = document.createElement("button");
            renameBtn.className = "board-action-btn";
            renameBtn.title = "Rename";
            renameBtn.textContent = "\u270E";
            renameBtn.setAttribute("data-action", "rename");
            renameBtn.setAttribute("data-board-id", board.id);

            var deleteBtn = document.createElement("button");
            deleteBtn.className = "board-action-btn danger";
            deleteBtn.title = "Delete";
            deleteBtn.textContent = "\u00D7";
            deleteBtn.setAttribute("data-action", "delete");
            deleteBtn.setAttribute("data-board-id", board.id);

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(nameEl);
            item.appendChild(actions);

            list.appendChild(item);
        }
    }

    /** Handle clicks within the board list (switch, rename, delete).
     *  Uses event delegation on the boardList container. */
    function handleBoardListClick(e) {
        var target = e.target;

        var action = target.getAttribute("data-action");
        var boardId = target.getAttribute("data-board-id");

        if (action === "rename" && boardId) {
            startRenameBoard(boardId);
            return;
        }

        if (action === "delete" && boardId) {
            if (boards.length <= 1) {
                showToast("Can't delete the only board.");
                return;
            }
            if (confirm("Delete this board and all its ideas?")) {
                var wasCurrent = boardId === currentBoardId;
                deleteBoardAndData(boardId).then(function () {
                    if (wasCurrent) {
                        return switchToBoard(boards[0].id);
                    }
                }).then(function () {
                    renderBoardList();
                    updateBoardNameDisplay();
                });
            }
            return;
        }

        var item = target.closest(".board-item");
        if (item) {
            var clickedBoardId = item.getAttribute("data-board-id");
            if (clickedBoardId && clickedBoardId !== currentBoardId) {
                switchToBoard(clickedBoardId).then(function () {
                    renderBoardList();
                });
            }
        }
    }

    /** Replace a board item's name element with an inline text input for renaming.
     *  Commits on blur/Enter, cancels on Escape. */
    function startRenameBoard(boardId) {
        var board = boards.find(function (b) { return b.id === boardId; });
        if (!board) return;

        var item = document.querySelector('.board-item[data-board-id="' + boardId + '"]');
        if (!item) return;

        var nameEl = item.querySelector(".board-item-name");
        if (!nameEl) return;

        var input = document.createElement("input");
        input.type = "text";
        input.className = "board-rename-input";
        input.value = board.name;

        nameEl.replaceWith(input);
        input.focus();
        input.select();

        function commitRename() {
            var newName = input.value.trim();
            if (newName && newName !== board.name) {
                board.name = newName;
                saveBoard(board).then(function () {
                    renderBoardList();
                    updateBoardNameDisplay();
                });
            } else {
                renderBoardList();
            }
        }

        var committed = false;
        input.addEventListener("blur", function () {
            if (!committed) {
                committed = true;
                commitRename();
            }
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                committed = true;
                commitRename();
            }
            if (e.key === "Escape") {
                e.preventDefault();
                committed = true;
                renderBoardList();
            }
        });
    }

    /* ── Initialization ──────────────────────────────────────────── *
     * Called on DOMContentLoaded. Sets up canvas, event listeners,      *
     * theme, IndexedDB, and loads the last-used board.                  */
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

        document.getElementById("boardsBtn").addEventListener("click", openBoardPanel);
        document.getElementById("closeBoardPanelBtn").addEventListener("click", closeBoardPanel);
        document.getElementById("boardPanelBackdrop").addEventListener("click", closeBoardPanel);
        document.getElementById("boardList").addEventListener("click", handleBoardListClick);
        document.getElementById("newBoardBtn").addEventListener("click", function () {
            createBoard().then(function (board) {
                return switchToBoard(board.id);
            }).then(function () {
                addNote();
                closeBoardPanel();
            });
        });

        document.getElementById("addNoteBtn").addEventListener("click", addNote);
        document.querySelector(".app-title").addEventListener("click", openAboutModal);
        document.getElementById("closeAboutModalBtn").addEventListener("click", closeAboutModal);
        document.getElementById("aboutModalBackdrop").addEventListener("click", closeAboutModal);

        document.getElementById("zoomInBtn").addEventListener("click", zoomIn);
        document.getElementById("zoomOutBtn").addEventListener("click", zoomOut);
        document.getElementById("resetZoomBtn").addEventListener("click", resetZoom);

        var PAN_STEP = 100;
        document.getElementById("panLeftBtn").addEventListener("click", function () { panBy(-PAN_STEP, 0); });
        document.getElementById("panUpBtn").addEventListener("click", function () { panBy(0, -PAN_STEP); });
        document.getElementById("panDownBtn").addEventListener("click", function () { panBy(0, PAN_STEP); });
        document.getElementById("panRightBtn").addEventListener("click", function () { panBy(PAN_STEP, 0); });

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

            if (idx === -1) {
                pan.active = true;
                pan.startX = e.clientX;
                pan.startY = e.clientY;
                pan.startPanX = panX;
                pan.startPanY = panY;
                canvas.style.cursor = "grabbing";
                return;
            }

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
            if (pan.active) {
                panX = pan.startPanX + (e.clientX - pan.startX);
                panY = pan.startPanY + (e.clientY - pan.startY);
                render();
            } else if (resize.active && notes[resize.noteIdx]) {
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
                    canvas.style.cursor = "grab";
                }
            }
        });

        canvas.addEventListener("mouseup", function () {
            if (pan.active) {
                pan.active = false;
                canvas.style.cursor = "grab";
                saveViewport();
            } else if (resize.active) {
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
            if (pan.active) {
                pan.active = false;
                canvas.style.cursor = "default";
                saveViewport();
            } else if (resize.active) {
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
            return loadBoards();
        }).then(function () {
            if (boards.length === 0) {
                return createBoard("My Board").then(function (board) {
                    return board.id;
                });
            }
            var lastBoardId = null;
            try { lastBoardId = localStorage.getItem(CURRENT_BOARD_KEY); } catch (e) { /* ignore */ }
            if (lastBoardId && boards.some(function (b) { return b.id === lastBoardId; })) {
                return lastBoardId;
            }
            return boards[0].id;
        }).then(function (boardId) {
            currentBoardId = boardId;
            try { localStorage.setItem(CURRENT_BOARD_KEY, boardId); } catch (e) { /* ignore */ }
            return loadBoardData(boardId);
        }).then(function () {
            render();
            updateBoardNameDisplay();
            console.log("MindMap initialized — " + boards.length + " board(s), current: " + notes.length + " notes, " + connections.length + " connections");
            loadSharedState();
        }).catch(function (err) {
            console.error("IndexedDB init failed:", err);
            render();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
