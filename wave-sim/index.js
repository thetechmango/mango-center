const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const width = 1000; 
const height = Math.floor(window.innerHeight / (window.innerWidth / width));

canvas.width = width;
canvas.height = height;

const imgData = ctx.createImageData(width, height);
let current = new Float32Array(width * height);
let previous = new Float32Array(width * height);
const damping = 1;

let walls = new Uint8Array(width * height);
let brushSize = 10;

let isMouseDown = false;
let isShiftDown = false;
let mousePos = { x: 0, y: 0 };
let lastMouse = { x: 0, y: 0 };
let activeButtons = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
    if (e.key === "Shift") isShiftDown = true;
    if (e.key === "r") {
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let i = y * width + x;
                current[i] = 0;
                previous[i] = 0;
            }
        }
    }
});
window.addEventListener('keyup', (e) => { if (e.key === "Shift") isShiftDown = false; });
canvas.addEventListener('pointerdown', (e) => activeButtons = e.buttons);
canvas.addEventListener('pointerup', () => activeButtons = 0);
canvas.addEventListener('pointermove', (e) => {
    activeButtons = e.buttons;
    const rect = canvas.getBoundingClientRect();
    mousePos.x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
    mousePos.y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
});

window.addEventListener('wheel', (e) => {
    brushSize += e.deltaY < 0 ? 1 : -1;
    brushSize = Math.max(1, Math.min(50, brushSize));
});

// Helper to apply the circle brush at a specific coordinate
function applyBrush(targetX, targetY) {
    const isEraser = isShiftDown;
    const i = targetY * width + targetX;

    if (activeButtons === 1) {
        current[i] += 1; 
    } else if (activeButtons === 2) {
        current[i] -= 1;
    }

    if (activeButtons === 4) { 
        const r2 = brushSize * brushSize;
        for (let dy = -brushSize; dy <= brushSize; dy++) {
            for (let dx = -brushSize; dx <= brushSize; dx++) {
                if (dx * dx + dy * dy <= r2) {
                    const x = targetX + dx;
                    const y = targetY + dy;
                    if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                        const index = y * width + x;
                        walls[index] = isEraser ? 0 : 1;
                        if (!isEraser) { current[index] = 0; previous[index] = 0; }
                    }
                }
            }
        }
    }
}

function handleInput() {
    if (activeButtons > 0) {
        let x0 = lastMouse.x;
        let y0 = lastMouse.y;
        let x1 = mousePos.x;
        let y1 = mousePos.y;

        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = (dx > dy ? dx : -dy) / 2, e2;

        // If the mouse hasn't moved at all, just apply once and return
        if (x0 === x1 && y0 === y1) {
            applyBrush(x1, y1);
        } else {
            // Bresenham loop
            while (x0 !== x1 || y0 !== y1) {
                e2 = err;
                if (e2 > -dx) { err -= dy; x0 += sx; }
                if (e2 < dy) { err += dx; y0 += sy; }
                
                applyBrush(x0, y0); // This now only hits new pixels
            }
        }
    }
    lastMouse.x = mousePos.x;
    lastMouse.y = mousePos.y;
}

function update() {
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let i = y * width + x;

            if (walls[i] === 1) continue; 
            
            // The Wave Equation: (Sum of neighbors / 2) - previous
            let val = (
                current[i - 1] + current[i + 1] + 
                current[i - width] + current[i + width]
            ) * 0.5 - previous[i];

            val *= damping;
            previous[i] = val; // Store result in 'previous' to swap later
        }
    }

    // Swap buffers
    [current, previous] = [previous, current];
}

function render() {
    for (let i = 0; i < current.length; i++) {
        let p = i * 4;
        
        if (walls[i] === 1) {
            // Draw walls as dark gray
            imgData.data[p] = imgData.data[p+1] = imgData.data[p+2] = 50;
        } else {
            let val = current[i] * 256 + 128;
            imgData.data[p] = imgData.data[p+1] = imgData.data[p+2] = val;
        }
        imgData.data[p+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
}

function loop() {
    handleInput();
    update();
    render();

    requestAnimationFrame(loop);
}

loop()