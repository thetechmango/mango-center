const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const width = 1000; 
const height = Math.floor(window.innerHeight / (window.innerWidth / width));

// 2. Set the canvas's INTERNAL resolution to match the sim
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
canvas.addEventListener('mousedown', (e) => activeButtons = e.buttons);
canvas.addEventListener('mouseup', () => activeButtons = 0);
canvas.addEventListener('mousemove', (e) => {
    activeButtons = e.buttons;
    const rect = canvas.getBoundingClientRect();
    mousePos.x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
    mousePos.y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
});

window.addEventListener('wheel', (e) => {
    brushSize += e.deltaY < 0 ? 1 : -1;
    brushSize = Math.max(1, Math.min(50, brushSize));
});

function handleInput() {
    if (activeButtons === 1 || activeButtons === 2) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = mousePos.x + dx;
                const y = mousePos.y + dy;
                if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                    const i = y * width + x;
                    current[i] += (activeButtons === 1) ? 1 : -1;
                }
            }
        }
    }
    if (activeButtons === 4) { // Middle click for walls
        const isEraser = isShiftDown;
        const r2 = brushSize * brushSize; // Radius squared

        for (let dy = -brushSize; dy <= brushSize; dy++) {
            for (let dx = -brushSize; dx <= brushSize; dx++) {
                // Circle check: x^2 + y^2 <= r^2
                if (dx * dx + dy * dy <= r2) {
                    const x = mousePos.x + dx;
                    const y = mousePos.y + dy;

                    if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                        const i = y * width + x;
                        
                        walls[i] = isEraser ? 0 : 1;
                        
                        // Clear water energy when placing a wall
                        if (!isEraser) {
                            current[i] = 0;
                            previous[i] = 0;
                        }
                    }
                }
            }
        }
    }
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