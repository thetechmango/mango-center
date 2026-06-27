const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const width = 200; 
const height = Math.floor(window.innerHeight / (window.innerWidth / width));

canvas.width = width;
canvas.height = height;

const imgData = ctx.createImageData(width, height);

let vx = new Float32Array(width * height);
let vy = new Float32Array(width * height);
let vx_prev = new Float32Array(width * height);
let vy_prev = new Float32Array(width * height);

let densR = new Float32Array(width * height);
let densG = new Float32Array(width * height);
let densB = new Float32Array(width * height);

let densR_prev = new Float32Array(width * height);
let densG_prev = new Float32Array(width * height);
let densB_prev = new Float32Array(width * height);

let p = new Float32Array(width * height);
let div = new Float32Array(width * height);

let lastMouse = { x: 0, y: 0 };
let mousePos = { x: 0, y: 0 };
const idx = (x, y) => y * width + x;

const friction = 0.99;
const fade = 0.99;

canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
    
    if (e.buttons === 1) {
        const dx_m = x - lastMouse.x;
        const dy_m = y - lastMouse.y;

        drawBresenhamLine(x, y, (px, py) => {
            // Apply to a small circle so it's not just a 1-pixel line
            const radius = 2; 
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const ix = px + dx;
                    const iy = py + dy;
                    if (ix > 0 && ix < width - 1 && iy > 0 && iy < height - 1 && (dx*dx + dy*dy <= radius*radius)) {
                        const i = idx(ix, iy);
                        
                        // Force (Velocity)
                        vx_prev[i] += dx_m * 0.1;
                        vy_prev[i] += dy_m * 0.1;

                        // Dye (Density) - Fixed amount for bold colors
                        const amt = 0.8; 
                        if (dx_m > 0) densR_prev[i] += amt; // Right -> Red
                        if (dx_m < 0) densG_prev[i] += amt; // Left -> Green
                        if (dy_m < 0) densB_prev[i] += amt; // Up -> Blue
                        if (dy_m > 0) { // Down -> Yellow
                            densR_prev[i] += amt;
                            densG_prev[i] += amt;
                        }
                    }
                }
            }
        });
    }
    lastMouse.x = x;
    lastMouse.y = y;
});

function drawBresenhamLine(x1, y1, callback) {
    let x0 = lastMouse.x;
    let y0 = lastMouse.y;
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = (dx > dy ? dx : -dy) / 2;

    while (true) {
        callback(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        let e2 = err;
        if (e2 > -dx) { err -= dy; x0 += sx; }
        if (e2 < dy) { err += dx; y0 += sy; }
    }
}

function set_bnd(b, x_array) {
    for (let i = 1; i < height - 1; i++) {
        // Left and Right edges
        x_array[idx(0, i)] = b === 1 ? -x_array[idx(1, i)] : x_array[idx(1, i)];
        x_array[idx(width - 1, i)] = b === 1 ? -x_array[idx(width - 2, i)] : x_array[idx(width - 2, i)];
    }
    for (let i = 1; i < width - 1; i++) {
        // Top and Bottom edges
        x_array[idx(i, 0)] = b === 2 ? -x_array[idx(i, 1)] : x_array[idx(i, 1)];
        x_array[idx(i, height - 1)] = b === 2 ? -x_array[idx(i, height - 2)] : x_array[idx(i, height - 2)];
    }
    // Corners
    x_array[idx(0, 0)] = 0.5 * (x_array[idx(1, 0)] + x_array[idx(0, 1)]);
    x_array[idx(0, height - 1)] = 0.5 * (x_array[idx(1, height - 1)] + x_array[idx(0, height - 2)]);
    x_array[idx(width - 1, 0)] = 0.5 * (x_array[idx(width - 2, 0)] + x_array[idx(width - 1, 1)]);
    x_array[idx(width - 1, height - 1)] = 0.5 * (x_array[idx(width - 2, height - 1)] + x_array[idx(width - 1, height - 2)]);
}

function advect(field, field_prev, vX, vY) {
    // dt = 1.0 means one pixel per 'velocity unit'
    const dt = 1.0; 
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = idx(x, y);
            let oldX = x - dt * vX[i];
            let oldY = y - dt * vY[i];

            // Bound clamping
            if (oldX < 0.5) oldX = 0.5; if (oldX > width - 1.5) oldX = width - 1.5;
            if (oldY < 0.5) oldY = 0.5; if (oldY > height - 1.5) oldY = height - 1.5;

            const i0 = oldX | 0; // Bitwise truncate is faster
            const i1 = i0 + 1;
            const j0 = oldY | 0;
            const j1 = j0 + 1;

            const s1 = oldX - i0;
            const s0 = 1.0 - s1;
            const t1 = oldY - j0;
            const t0 = 1.0 - t1;

            field[i] = s0 * (t0 * field_prev[idx(i0, j0)] + t1 * field_prev[idx(i0, j1)]) +
                       s1 * (t0 * field_prev[idx(i1, j0)] + t1 * field_prev[idx(i1, j1)]);
        }
    }
}

function project(vX, vY, p, div) {
    // Math scale fix: Removing 'h' multiplier makes swirls more aggressive
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            div[idx(x, y)] = -0.5 * (
                vX[idx(x + 1, y)] - vX[idx(x - 1, y)] +
                vY[idx(x, y + 1)] - vY[idx(x, y - 1)]
            );
            p[idx(x, y)] = 0;
        }
    }

    // Increased iterations to 40 for much stronger vortices
    for (let k = 0; k < 40; k++) {
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                p[idx(x, y)] = (div[idx(x, y)] + p[idx(x - 1, y)] + p[idx(x + 1, y)] + p[idx(x, y - 1)] + p[idx(x, y + 1)]) / 4;
            }
        }
        set_bnd(0, p);
    }

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            vX[idx(x, y)] -= 0.5 * (p[idx(x + 1, y)] - p[idx(x - 1, y)]);
            vY[idx(x, y)] -= 0.5 * (p[idx(x, y + 1)] - p[idx(x, y - 1)]);
        }
    }
}

function update() {
    advect(vx, vx_prev, vx_prev, vy_prev);
    advect(vy, vy_prev, vx_prev, vy_prev);
    set_bnd(1, vx); set_bnd(2, vy);
    project(vx, vy, p, div);

    // Move the Dyes
    advect(densR, densR_prev, vx, vy);
    advect(densG, densG_prev, vx, vy);
    advect(densB, densB_prev, vx, vy);
    set_bnd(0, densR); set_bnd(0, densG); set_bnd(0, densB);

    for (let i = 0; i < vx.length; i++) {
        vx[i] *= friction; vy[i] *= friction;
        densR[i] *= fade; densG[i] *= fade; densB[i] *= fade; // Fade
    }

    [vx, vx_prev] = [vx_prev, vx]; [vy, vy_prev] = [vy_prev, vy];
    [densR, densR_prev] = [densR_prev, densR];
    [densG, densG_prev] = [densG_prev, densG];
    [densB, densB_prev] = [densB_prev, densB];
}

function render() {
    for (let i = 0; i < vx.length; i++) {
        let p = i * 4;
        
        // Scale the density values for display
        let r = densR[i] * 255;
        let g = densG[i] * 255;
        let b = densB[i] * 255;

        imgData.data[p]     = r > 255 ? 255 : r; // Red
        imgData.data[p + 1] = g > 255 ? 255 : g; // Green
        imgData.data[p + 2] = b > 255 ? 255 : b; // Blue
        imgData.data[p + 3] = 255;               // Alpha
    }
    ctx.putImageData(imgData, 0, 0);
}


function loop() {
    update();
    render();
    requestAnimationFrame(loop);
}

loop();