const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const pixelSize = 2;
function resize() {
    canvas.width = Math.floor(window.innerWidth / pixelSize);
    canvas.height = Math.floor(window.innerHeight / pixelSize);
}
window.addEventListener('resize', resize);
resize();

const width = canvas.width;
const height = canvas.height;

const imageData = ctx.createImageData(width, height);
const screenBuffer = new Uint32Array(imageData.data.buffer);
const cells = new Uint8Array(width * height);
const modified = new Uint8Array(width * height);

const holdingCoords = { x: -1, y: -1 };
const lastCoords = { x: -1, y: -1 };
let holdingButton = -1;

let flip = false;

const hexColors = new Uint32Array([
	0xFF000000, // 0: Black
	0xFF888888, // 1: Wall
	0xFF00FFFF, // 2: Sand
	0xFFFF0000  // 3: Water
]);

function render() {
	// Linear loop: 10x faster than nested loops with scaling
	for (let i = 0; i < cells.length; i++) {
		screenBuffer[i] = hexColors[cells[i]];
	}
	ctx.putImageData(imageData, 0, 0);
}

function swap(a, b) {
	const temp = cells[a];
	cells[a] = cells[b];
	cells[b] = temp;
	modified[a] = 1;
	modified[b] = 1;
}

function update() {
	for (let y = height - 1; y >= 0; y--) {
		for (let i = 0; i < width; i++) {
            const x = flip ? i : (width - 1 - i);
			const idx = y * width + x;
			const cell = cells[idx];

			if (cell === 0 || modified[idx]) continue;

			if (cell === 2) { // Sand logic
				if (y < height - 1) {
					const below = (y + 1) * width + x;
					const belowL = (y + 1) * width + (x - 1);
					const belowR = (y + 1) * width + (x + 1);

					// Helper to check if sand can enter a cell (Air or Water)
					const canGo = (i) => cells[i] === 0 || cells[i] === 3;

					if (canGo(below)) {
						cells[below] === 3 ? swap(idx, below) : move(idx, below);
					} else if (x > 0 && canGo(belowL)) {
						cells[belowL] === 3 ? swap(idx, belowL) : move(idx, belowL);
					} else if (x < width - 1 && canGo(belowR)) {
						cells[belowR] === 3 ? swap(idx, belowR) : move(idx, belowR);
					}
				}
			} else if (cell === 3) { // Water logic
                if (y < height - 1) {
                    const below = (y + 1) * width + x;

                    if (cells[below] === 0) {
                        move(idx, below);
                        continue;
                    }

                    const dDir = Math.random() > 0.5 ? 1 : -1;
                    const diag1 = (y + 1) * width + (x + dDir);
                    const diag2 = (y + 1) * width + (x - dDir);
            
                    if (x + dDir >= 0 && x + dDir < width && cells[diag1] === 0) {
                        move(idx, diag1);
                        continue;
                    } else if (x - dDir >= 0 && x - dDir < width && cells[diag2] === 0) {
                        move(idx, diag2);
                        continue;
                    }
                }

                const hDir = Math.random() > 0.5 ? 1 : -1;
                const side1 = y * width + (x + hDir);
                const side2 = y * width + (x - hDir);
            
                if (x + hDir >= 0 && x + hDir < width && cells[side1] === 0) {
                    move(idx, side1);
                } else if (x - hDir >= 0 && x - hDir < width && cells[side2] === 0) {
                    move(idx, side2);
                }
            }
		}
	}
	modified.fill(0);
    flip = !flip;
}

function move(from, to) {
	cells[to] = cells[from];
	cells[from] = 0;
	modified[to] = 1;
}

function swap(a, b) {
	const temp = cells[a];
	cells[a] = cells[b];
	cells[b] = temp;
	modified[a] = 1;
	modified[b] = 1;
}

canvas.addEventListener('mousedown', (e) => {
	// Simple coordinate math because canvas internal size = simulation size
	const rect = canvas.getBoundingClientRect();
	const scaleX = canvas.width / rect.width;
	const scaleY = canvas.height / rect.height;
	const x = Math.floor((e.clientX - rect.left) * scaleX);
	const y = Math.floor((e.clientY - rect.top) * scaleY);

	if (x >= 0 && x < width && y >= 0 && y < height) {
		cells[y * width + x] = 2;
	}
});


function loop() {
    update();
    render();
    requestAnimationFrame(loop);
}

function handleInput(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    

    // Fill line using Bresenham's algorithm between lastCoords and holdingCoords for smoother drawing
    
    if (holdingCoords.x !== -1) {
        const dx = Math.abs(x - lastCoords.x);
        const dy = Math.abs(y - lastCoords.y);
        const sx = lastCoords.x < x ? 1 : -1;
        const sy = lastCoords.y < y ? 1 : -1;
        let err = dx - dy;

        let currentX = lastCoords.x;
        let currentY = lastCoords.y;

        while (true) {
            if (currentX >= 0 && currentX < width && currentY >= 0 && currentY < height) {
                const idx = currentY * width + currentX;
                // Place the cell based on the holdingButton
                switch (holdingButton) {
                    case 0:
                        cells[idx] = 2; // Sand
                        break;
                    case 1:
                        cells[idx] = 1; // Wall
                        break;
                    case 2:
                        cells[idx] = 3; // Water
                        break;
                }
            }

            if (currentX === x && currentY === y) break;
            const err2 = err * 2;
            if (err2 > -dy) {
                err -= dy;
                currentX += sx;
            }
            if (err2 < dx) {
                err += dx;
                currentY += sy;
            }
        }
    } else if (e.button === 0) { // Place sand on click
        cells[y * width + x] = 2; // Sand
    }

    holdingCoords.x = x;
    holdingCoords.y = y;
    lastCoords.x = x;
    lastCoords.y = y;
}

canvas.addEventListener('mousedown', (e) => {
    holdingButton = e.button;
    handleInput(e);
});

canvas.addEventListener('mousemove', (e) => {
    if (holdingCoords.x === -1) return; // Not holding
    handleInput(e);
});

canvas.addEventListener('mouseup', () => {
    holdingCoords.x = -1;
    holdingCoords.y = -1;
    holdingButton = -1;
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

loop();