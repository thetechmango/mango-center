const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const pixelSize = 4; 
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

let currentType = 2; 
let brushSize = 3;
let isHolding = false;
let holdingButton = -1;
let mousePos = { x: -1, y: -1 };
let lastPos = { x: -1, y: -1 };
let frameMultipler = 1; // Number of updates per frame for faster simulation

let flip = false;

const hexColors = new Uint32Array([
	0xFF000000, // 0: Black
	0xFF666666, // 1: Wall
	0xFF00FFFF, // 2: Sand
	0xFFFF0000, // 3: Water
    0xFFBBBBBB, // 4: Smoke
    0xFFBBAA99, // 5: Metal
	0xFF00FF00  // 6: Acid
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
					const canGo = (i) => cells[i] === 0 || cells[i] === 3 || cells[i] === 4 || cells[i] === 6;

					if (canGo(below)) {
						if (cells[below] === 6) { 
							cells[idx] = Math.random() < 0.1 ? 4 : 0; // Dissolve into acid
						} else if (cells[below] !== 0) { 
							swap(idx, below); 
						} else { 
							move(idx, below); 
						}
					} else {
						const dDir = Math.random() > 0.5 ? 1 : -1;
						const diag = (y + 1) * width + (x + dDir);
						const side = y * width + (x + dDir);
						if (x + dDir >= 0 && x + dDir < width && canGo(diag) && cells[side] !== 1 && cells[side] !== 5) {
							if (cells[diag] === 6) { 
								cells[idx] = Math.random() < 0.1 ? 4 : 0; // Dissolve into acid
							} else if (cells[diag] !== 0) { 
								swap(idx, diag); 
							} else { 
								move(idx, diag); 
							}
						}
					}
				}
			} else if (cell === 3) { // Water logic
				if (y < height - 1) {
					const below = (y + 1) * width + x;
					const canGo = (i) => cells[i] === 0 || cells[i] === 4 || cells[i] === 6;

					if (canGo(below)) {
						if (cells[below] === 6) { 
							cells[idx] = Math.random() < 0.1 ? 4 : 0; // Bubble
						} else if (cells[below] === 4) { 3
							swap(idx, below); 
						} else { 
							move(idx, below); 
						}
					} else {
						const dDir = Math.random() > 0.5 ? 1 : -1;
						const diag = (y + 1) * width + (x + dDir);
						const side = y * width + (x + dDir);
						if (x + dDir >= 0 && x + dDir < width && canGo(diag) && cells[side] !== 1 && cells[side] !== 5) {
							if (cells[diag] === 6) { 
								cells[idx] = Math.random() < 0.1 ? 4 : 0; 
							} else if (cells[diag] === 4) { 
								swap(idx, diag); 
							} else { 
								move(idx, diag); 
							}
						} else {
							// Horizontal flow
							const hDir = Math.random() > 0.5 ? 1 : -1;
							const sIdx = y * width + (x + hDir);
							if (x + hDir >= 0 && x + hDir < width && cells[sIdx] === 0) move(idx, sIdx);
						}
					}
				}
			} else if (cell === 4) { // Smoke logic
				if (y > 0) {
					const above = (y - 1) * width + x;
					const drift = Math.random() > 0.8;
					
					// Rise/Drift check
					if ((cells[above] === 0 || cells[above] === 6) && !drift) {
						if (cells[above] === 6) { 
							cells[idx] = 0; // Smoke disappears into acid
						} else { 
							move(idx, above); 
						}
					} else {
						const dDir = Math.random() > 0.5 ? 1 : -1;
						const diag = (y - 1) * width + (x + dDir);
						const side = y * width + (x + dDir);
						// Diagonal rise with overhang check
						if (x + dDir >= 0 && x + dDir < width && (cells[diag] === 0 || cells[diag] === 6) && (cells[side] === 0 || cells[side] === 6)) {
							if (cells[diag] === 6) { 
								cells[idx] = 0; 
							} else { 
								move(idx, diag); 
							}
						} else if (x + dDir >= 0 && x + dDir < width && cells[side] === 0) {
							move(idx, side);
						}
					}
				}
			} else if (cell === 6) { // Acid logic
                if (y < height - 1) {
                    const below = (y + 1) * width + x;
                    // Acid proof: Metal (5) and Acid itself (6)
                    const canAcidEat = (i) => cells[i] !== 5 && cells[i] !== 6;
            
                    if (canAcidEat(below)) {
                        move(idx, below); // Overwrites whatever was there
                        
                    } else {
                        const dDir = Math.random() > 0.5 ? 1 : -1;
                        const diag1 = (y + 1) * width + (x + dDir);
                        const side1 = y * width + (x + dDir);
                        const diag2 = (y + 1) * width + (x - dDir);
                        const side2 = y * width + (x - dDir);
            
                        if (x + dDir >= 0 && x + dDir < width && canAcidEat(diag1) && canAcidEat(side1)) {
                            move(idx, diag1);
                        } else if (x - dDir >= 0 && x - dDir < width && canAcidEat(diag2) && canAcidEat(side2)) {
                            move(idx, diag2);
                        } else {
                            // Horizontal flow (spreading)
                            const hDir = Math.random() > 0.5 ? 1 : -1;
                            const s1 = y * width + (x + hDir);
                            const s2 = y * width + (x - hDir);
                            if (x + hDir >= 0 && x + hDir < width && canAcidEat(s1)) {
                                move(idx, s1);
                            } else if (x - hDir >= 0 && x - hDir < width && canAcidEat(s2)) {
                                move(idx, s2);
                            }
                        }
                    }
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

function loop() {
    for (let i = 0; i < frameMultipler; i++) {
        applyBrush();
        update();
    }
    render();
    requestAnimationFrame(loop);
}

function applyBrush() {
	if (!isHolding || mousePos.x === -1) return;

	const typeToPlace = holdingButton === 2 ? 0 : currentType;
	
	// If it's the first frame of clicking, set lastPos to current
	let startX = lastPos.x === -1 ? mousePos.x : lastPos.x;
	let startY = lastPos.y === -1 ? mousePos.y : lastPos.y;

	const dx = Math.abs(mousePos.x - startX);
	const dy = Math.abs(mousePos.y - startY);
	const sx = startX < mousePos.x ? 1 : -1;
	const sy = startY < mousePos.y ? 1 : -1;
	let err = dx - dy;

	while (true) {
		// Calculate the adjusted radius for the circle math
        const r = brushSize - 1; 
        const rSq = r * r;

        for (let dbY = -r; dbY <= r; dbY++) {
            for (let dbX = -r; dbX <= r; dbX++) {
                // If radius is 0 (brushSize 1), this only runs for (0,0)
                if (r === 0 || dbX * dbX + dbY * dbY <= rSq) {
                    const nx = startX + dbX;
                    const ny = startY + dbY;
                    
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const idx = ny * width + nx;
                        if (holdingButton === 2) { 
                            // Only erase if the cell matches the current tool
                            if (cells[idx] === currentType) {
                                cells[idx] = 0;
                            }
                        } else {
                            // Don't overwrite wall or metal with other types
                            if (cells[idx] !== 1 && cells[idx] !== 5) {
                                cells[idx] = currentType;
                            }
                        }
                    }
                }
            }
        }

		if (startX === mousePos.x && startY === mousePos.y) break;
		const err2 = err * 2;
		if (err2 > -dy) { err -= dy; startX += sx; }
		if (err2 < dx) { err += dx; startY += sy; }
	}

	lastPos.x = mousePos.x;
	lastPos.y = mousePos.y;
}

window.addEventListener('keydown', (e) => {
	if (e.key === '1') currentType = 2; // Sand
	if (e.key === '2') currentType = 3; // Water
	if (e.key === '3') currentType = 1; // Wall
    if (e.key === '4') currentType = 4; // Smoke
    if (e.key === '5') currentType = 5; // Metal
	if (e.key === '6') currentType = 6; // Acid
});

canvas.addEventListener('wheel', (e) => {
	brushSize = Math.max(1, brushSize + (e.deltaY < 0 ? 1 : -1));
});

canvas.addEventListener('mousedown', (e) => {
	isHolding = true;
	holdingButton = e.button;
});

window.addEventListener('mouseup', () => {
	isHolding = false;
	holdingButton = -1;
	lastPos = { x: -1, y: -1 };
});

canvas.addEventListener('mousemove', (e) => {
	const rect = canvas.getBoundingClientRect();
	const scaleX = canvas.width / rect.width;
	const scaleY = canvas.height / rect.height;
	mousePos.x = Math.floor((e.clientX - rect.left) * scaleX);
	mousePos.y = Math.floor((e.clientY - rect.top) * scaleY);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());


loop();