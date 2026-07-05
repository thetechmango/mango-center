const SIZE = 4096;
const GRID_BYTES = SIZE * SIZE * 4;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const off = document.createElement("canvas");
off.width = SIZE;
off.height = SIZE;

const offCtx = off.getContext("2d");
offCtx.imageSmoothingEnabled = false;

let needsRender = true;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    needsRender = true;
}
window.addEventListener("resize", resize);
resize();

const imageData = ctx.createImageData(SIZE, SIZE);
const pixels = imageData.data;
const pixels32 = new Uint32Array(pixels.buffer);

const grid = new Uint32Array(SIZE * SIZE);

let gridBuffer = new ArrayBuffer(GRID_BYTES);
let gridView = new Uint8Array(gridBuffer);

const colors = [
    "#ffffff", "#AAAAAA", "#666666", "#222222", "#000000",
    "#ff0000", "#700000", "#ff6000", "#ff9000", "#ffff00",
    "#ffff80", "#00ff00", "#007000", "#a0f0a0", "#00ffb0",
    "#00ffff", "#00a0ff", "#acdbff", "#0000ff", "#000070",
    "#8000d0", "#cd97ef", "#ff00ff",
    "#f7e1c5", "#caaa81", "#98713e", "#5b390e", "#492403"
];

const colorPacked = colors.map(c => {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);

    return (r) | (g << 8) | (b << 16) | (255 << 24);
});

let selectedColor = 0;

const paletteDiv = document.getElementById("palette");

const selectSound = new Audio("select.mp3");
selectSound.preload = "auto";
const placeSound = new Audio("place.mp3");
selectSound.preload = "auto";

const colorButtons = [];

function selectColor(index) {
    selectedColor = index;
    for (const b of colorButtons) {
        b.classList.remove("selected");
    }
    colorButtons[index].classList.add("selected");

    const s = selectSound.cloneNode();
    s.play();

    needsRender = true;
}

colors.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.style.background = c;

    btn.onclick = () => {
        selectColor(i);
    };

    paletteDiv.appendChild(btn);
    colorButtons.push(btn);
});

// Initialize with selected
colorButtons[selectedColor].classList.add("selected");

const camera = {
    x: 0,
    y: 0,
    zoom: 8
};

camera.x = SIZE / 2 - (canvas.width / camera.zoom) / 2;
camera.y = SIZE / 2 - (canvas.height / camera.zoom) / 2;

function saveView() {
    localStorage.setItem("view", JSON.stringify({
        x: Math.max(Math.min(camera.x, SIZE * 2), -SIZE),
        y: Math.max(Math.min(camera.y, SIZE * 2), -SIZE),
        zoom: Math.max(Math.min(camera.zoom, 512), 0.1)
    }));
}

function loadView() {
    const saved = localStorage.getItem("view");
    if (!saved) return;

    try {
        const { x, y, zoom } = JSON.parse(saved);

        if (
            typeof x === "number" &&
            typeof y === "number" &&
            typeof zoom === "number"
        ) {
            camera.x = x;
            camera.y = y;
            camera.zoom = zoom;
        }
    } catch {}
}
loadView();

let lastViewSaveTime = 0;

let hoverX = -1;
let hoverY = -1;

let lastHoverX = null;
let lastHoverY = null;

const remoteHovers = [];
let onlineCount = 1;

let dragging = false;
let lastX = 0;
let lastY = 0;
let didDrag = false;

const ws = new WebSocket("wss://ws.themango.click");
ws.binaryType = "arraybuffer";
let nextAllowedTime = 0;

let isAdmin = false;

const COOLDOWN_MS = 5000;

function drawPixel(x, y, color) {
    ctx.fillStyle =
    `#${(color & 0xFFFFFF).toString(16).padStart(6, "0")}`;

    ctx.fillRect(
        x * camera.zoom + camera.x,
        y * camera.zoom + camera.y,
        camera.zoom,
        camera.zoom
    );
}

ws.onmessage = async (e) => {
    if (typeof e.data !== "string") {

        const ds = new DecompressionStream("deflate-raw");

        const stream = new Blob([e.data])
            .stream()
            .pipeThrough(ds);

        const decompressed = await new Response(stream).arrayBuffer();

        console.log("DECOMPRESSED:", decompressed.byteLength);

        const arr = new Uint32Array(decompressed);

        grid.set(arr);
        pixels32.set(grid);

        offCtx.putImageData(imageData, 0, 0);

        needsRender = true;
        document.getElementById("loader").style.display = "none";

        return;
    }

    const data = JSON.parse(e.data);

    if (data.type === "auth") {
        if (data.success) {
            isAdmin = true;
            alert("Admin mode enabled");
            document.getElementById("adminPanel").style.display = "none";
        } else if (data.reason === "too_many_attempts") {
            alert("Too many attempts");
            document.getElementById("adminPanel").style.display = "none";
        } else {
            alert("Wrong code");
        }
    }
    
    if (data.type === "count") {
        onlineCount = data.count;
        document.getElementById("onlineCount").textContent = `Online: ${data.count}`;
    }

    if (data.type === "place") {
        const { x, y, color } = data;

        const i = y * SIZE + x;
        grid[i] = color;

        const r = color & 255;
        const g = (color >> 8) & 255;
        const b = (color >> 16) & 255;

        offCtx.fillStyle = `rgb(${r},${g},${b})`;
        offCtx.fillRect(x, y, 1, 1);
    
        needsRender = true;
    }

    if (data.type === "cooldown") {
        nextAllowedTime = Date.now() + data.remaining;
    }

    if (data.type === "hovers") {
        if (onlineCount <= 1) return;
        remoteHovers.length = 0;
        remoteHovers.push(...data.hovers);
        needsRender = true;
    }
};

canvas.onpointerleave = () => {
    hoverX = -1;
    hoverY = -1;

    coordsDisplay.innerText = `(-, -)`;
};

canvas.onpointerdown = (e) => {
    dragging = true;
    didDrag = false;

    lastX = e.clientX;
    lastY = e.clientY;
};

canvas.onclick = (e) => {
    if (didDrag) return;

    const now = Date.now();
    if (!isAdmin && now < nextAllowedTime) return;

    const p = screenToGrid(e.clientX, e.clientY);

    const x = p.x;
    const y = p.y;

    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;

    const i = y * SIZE + x;

    const current = grid[i] >>> 0;
    const packed = colorPacked[selectedColor] >>> 0;

    if ((current & 0x00FFFFFF) === (packed & 0x00FFFFFF)) return;

    // play sound
    const s = placeSound.cloneNode();
    s.play();

    ws.send(JSON.stringify({
        type: "place",
        x,
        y,
        color: packed
    }));

    if (!isAdmin) {
        nextAllowedTime = Date.now() + COOLDOWN_MS;
    }
};

window.onpointerup = () => {
    if (dragging) {
        const now = Date.now();
        if (now - lastViewSaveTime > 200) {
            saveView();
            lastViewSaveTime = now;
        }
    }
    dragging = false;
};

const coordsDisplay = document.getElementById("coords");

window.addEventListener("pointermove", (e) => {
    const p = screenToGrid(e.clientX, e.clientY);
    hoverX = p.x;
    hoverY = p.y;

    if (p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE) {
        coordsDisplay.innerText = `(${p.x}, ${p.y})`;
    } else {
        coordsDisplay.innerText = `(-, -)`;
    }

    if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;

        if (dx !== 0 || dy !== 0) {
            didDrag = true;
        }

        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;

        lastX = e.clientX;
        lastY = e.clientY;
    }

    needsRender = true;
});

canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    if (e.shiftKey) {
        if (e.deltaY < 0) {
            selectColor(Math.max(0, selectedColor - 1));
        } else {
            selectColor(Math.min(colors.length - 1, selectedColor + 1));
        }

        return;
    }

    zoom(e.deltaY < 0 ? "in" : "out", e.clientX, e.clientY);
});

function zoom(dir = "in", x, y) {
    const scale = 1.1;

    const before = screenToWorld(x, y);

    if (dir === "in") camera.zoom *= scale;
    else camera.zoom /= scale;

    const after = screenToWorld(x, y);

    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    needsRender = true;

    const now = Date.now();
    if (now - lastViewSaveTime > 200) {
        saveView();
        lastViewSaveTime = now;
    }
}

document.getElementById("zoomInBtn").addEventListener("click", (e) => {
    zoom("in", canvas.width/2, canvas.height/2);
});

document.getElementById("zoomOutBtn").addEventListener("click", (e) => {
    zoom("out", canvas.width/2, canvas.height/2);
});

document.getElementById("authBtn").onclick = () => {
    const code = document.getElementById("adminCode").value;

    ws.send(JSON.stringify({
        type: "auth",
        code
    }));
};

document.getElementById("exportBtn").onclick = () => {
    const now = new Date();

    const pad = (n) => n.toString().padStart(2, "0");

    const filename =
        `grid_${now.getFullYear()}-` +
        `${pad(now.getMonth() + 1)}-` +
        `${pad(now.getDate())}_` +
        `${pad(now.getHours())}-` +
        `${pad(now.getMinutes())}-` +
        `${pad(now.getSeconds())}.png`;

    const link = document.createElement("a");
    link.download = filename;
    link.href = off.toDataURL("image/png");
    link.click();
};

function worldToScreen(x, y) {
    return {
        x: (x - camera.x) * camera.zoom,
        y: (y - camera.y) * camera.zoom
    };
}

function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: (clientX - rect.left) / camera.zoom + camera.x,
        y: (clientY - rect.top) / camera.zoom + camera.y
    };
}

function screenToGrid(clientX, clientY) {
    const p = screenToWorld(clientX, clientY);

    return {
        x: Math.floor(p.x),
        y: Math.floor(p.y)
    };
}

function render() {
    if (!needsRender) {
        requestAnimationFrame(render);
        return;
    }

    needsRender = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#222222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
        off,
        camera.x,
        camera.y,
        canvas.width / camera.zoom,
        canvas.height / camera.zoom,
        0,
        0,
        canvas.width,
        canvas.height
    );

    // hover
    if (hoverX >= 0 && hoverX < SIZE && hoverY >= 0 && hoverY < SIZE) {
        canvas.style.cursor = "crosshair";

        ctx.strokeStyle = colors[selectedColor];
        ctx.lineWidth = 2;

        ctx.strokeRect(
            (hoverX - camera.x) * camera.zoom,
            (hoverY - camera.y) * camera.zoom,
            camera.zoom,
            camera.zoom
        );
    } else {
        canvas.style.cursor = "default";
    }

    // remote hovers
    for (const h of remoteHovers) {
        if (
            h.x < 0 || h.x >= SIZE ||
            h.y < 0 || h.y >= SIZE
        ) continue;
    
        const r = h.color & 255;
        const g = (h.color >> 8) & 255;
        const b = (h.color >> 16) & 255;

        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = 2;
    
        ctx.strokeRect(
            (h.x - camera.x) * camera.zoom,
            (h.y - camera.y) * camera.zoom,
            camera.zoom,
            camera.zoom
        );
    }

    requestAnimationFrame(render);
}

const cooldownEl = document.getElementById("cooldown");

setInterval(() => {
    const remaining = Math.max(0, nextAllowedTime - Date.now());
    
    if (remaining > 0) {
        cooldownEl.innerText = `Cooldown: ${Math.ceil(remaining/1000)}s`;
        cooldownEl.style.backgroundColor = "#900000";
    } else {
        cooldownEl.innerText = "Ready";
        cooldownEl.style.backgroundColor = "#009000";
    }
}, 200);

setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (onlineCount <= 1) return;

    if (
        hoverX === lastHoverX &&
        hoverY === lastHoverY
    ) return;

    lastHoverX = hoverX;
    lastHoverY = hoverY;

    ws.send(JSON.stringify({
        type: "hover",
        x: hoverX,
        y: hoverY,
        color: colorPacked[selectedColor]
    }));
}, 200);

render();