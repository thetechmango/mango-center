const SIZE = 1024;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const camera = {
    x: 0,
    y: 0,
    zoom: 8
};

camera.x = SIZE / 2 - (canvas.width / camera.zoom) / 2;
camera.y = SIZE / 2 - (canvas.height / camera.zoom) / 2;

let hoverX = -1;
let hoverY = -1;

let dragging = false;
let lastX = 0;
let lastY = 0;
let didDrag = false;

const grid = new Uint8Array(SIZE * SIZE);

const ws = new WebSocket("wss://ws.themango.click");
let nextAllowedTime = 0;

let isAdmin = false;

const COOLDOWN_MS = 5000;

const colors = [
    "#000000", "#ffffff", "#ff0000", "#00ff00",
    "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
    "#AAAAAA", "#222222", "#ff9000", "#8000d0",
    "#D2B48C", "#492403"
];

let selectedColor = 0;

const paletteDiv = document.getElementById("palette");

colors.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.style.background = c;
    btn.onclick = () => selectedColor = i;
    paletteDiv.appendChild(btn);
});

function drawPixel(x, y, color) {
    ctx.fillStyle = colors[color];

    ctx.fillRect(
        x * camera.zoom + camera.x,
        y * camera.zoom + camera.y,
        camera.zoom,
        camera.zoom
    );
}

ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === "init") {
        grid.set(data.grid);
    }

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
        document.getElementById("onlineCount").textContent = `Online: ${data.count}`;
    }

    if (data.type === "place") {
        const { x, y, color } = data;
        grid[y * SIZE + x] = color;
        drawPixel(x, y, color);
    }

    if (data.type === "cooldown") {
        nextAllowedTime = Date.now() + data.remaining;
    }
};

canvas.onmousemove = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);
    hoverX = p.x;
    hoverY = p.y;
};

canvas.onmouseleave = () => {
    hoverX = -1;
    hoverY = -1;
};

canvas.onmousedown = (e) => {
    dragging = true;
    didDrag = false;

    lastX = e.clientX;
    lastY = e.clientY;
};

canvas.onclick = (e) => {
    if (didDrag) return;

    const now = Date.now();
    if (!isAdmin && now < nextAllowedTime) return;

    const p = screenToWorld(e.clientX, e.clientY);

    const x = p.x;
    const y = p.y;

    const color = selectedColor;

    ws.send(JSON.stringify({
        type: "place",
        x, y, color
    }));

    if (!isAdmin) {
        nextAllowedTime = Date.now() + COOLDOWN_MS;
    }
};

window.onmouseup = () => {
    dragging = false;
};

window.onmousemove = (e) => {
    if (!dragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    if (dx !== 0 || dy !== 0) {
        didDrag = true;
    }

    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;

    lastX = e.clientX;
    lastY = e.clientY;
};

canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    const scale = 1.1;

    const before = screenToWorld(e.clientX, e.clientY);

    if (e.deltaY < 0) camera.zoom *= scale;
    else camera.zoom /= scale;

    const after = screenToWorld(e.clientX, e.clientY);

    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
});

document.getElementById("authBtn").onclick = () => {
    const code = document.getElementById("adminCode").value;

    ws.send(JSON.stringify({
        type: "auth",
        code
    }));
};

function worldToScreen(x, y) {
    return {
        x: (x - camera.x) * camera.zoom,
        y: (y - camera.y) * camera.zoom
    };
}

function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();

    const x = (clientX - rect.left) / camera.zoom + camera.x;
    const y = (clientY - rect.top) / camera.zoom + camera.y;

    return {
        x: Math.floor(x),
        y: Math.floor(y)
    };
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#222222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startX = Math.floor(camera.x);
    const startY = Math.floor(camera.y);
    const endX = Math.ceil(camera.x + canvas.width / camera.zoom);
    const endY = Math.ceil(camera.y + canvas.height / camera.zoom);

    for (let y = startY; y < endY; y++) {
        if (y < 0 || y >= SIZE) continue;

        for (let x = startX; x < endX; x++) {
            if (x < 0 || x >= SIZE) continue;

            ctx.fillStyle = colors[grid[y * SIZE + x]];

            const sx = Math.floor((x - camera.x) * camera.zoom);
            const sy = Math.floor((y - camera.y) * camera.zoom);
            const sz = Math.ceil(camera.zoom);

            ctx.fillRect(sx, sy, sz, sz);
        }
    }

    if (hoverX >= 0 && hoverY >= 0) {
        ctx.strokeStyle = colors[selectedColor];
        ctx.lineWidth = 2;

        ctx.strokeRect(
            (hoverX - camera.x) * camera.zoom,
            (hoverY - camera.y) * camera.zoom,
            camera.zoom,
            camera.zoom
        );
    }

    requestAnimationFrame(render);
}

setInterval(() => {
    const remaining = Math.max(0, nextAllowedTime - Date.now());
    document.getElementById("cooldown").innerText = remaining > 0
        ? `Cooldown: ${Math.ceil(remaining/1000)}s`
        : "Ready";
}, 200);

render();