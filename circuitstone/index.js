const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

const gridWidth = 25;
const gridHeight = 25;
const grid = new Array(gridWidth * gridHeight).fill(null);
const cellSize = canvas.width / gridWidth;
let dirtyBlocks = new Set();

let currentTool = "wire";
let currentRotation = 1;
const rotationNames = ["Up", "Right", "Down", "Left"];
let isDragging = false;
let dragButton = -1;
let pressedButton = null;

class Block {
    constructor(x, y, rotation = 0) {
        this.x = x;
        this.y = y;
        this.rotation = rotation; // 0: Up, 1: Right, 2: Down, 3: Left
        this.power = 0;
        this.lastPower = 0;
    }

    getNeighbor(dir) {
        let nx = this.x;
        let ny = this.y;

        if (dir === 0) ny--;
        else if (dir === 1) nx++;
        else if (dir === 2) ny++;
        else if (dir === 3) nx--;

        // Use global variables 'gridWidth' and 'gridHeight'
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) return null;

        return grid[ny * gridWidth + nx];
    }

    getBackNeighbor() { return this.getNeighbor((this.rotation + 2) % 4); }
    getForwardNeighbor() { return this.getNeighbor(this.rotation); }
    getLeftNeighbor() { return this.getNeighbor((this.rotation + 3) % 4); }
    getRightNeighbor() { return this.getNeighbor((this.rotation + 1) % 4); }

    // Placeholder: subclasses will override this
    update(neighbors) {}

    interact() {
        // Default: do nothing
    }

    dirtyNeighbors() {
        const offsets = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];
        for (let [dx, dy] of offsets) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                dirtyBlocks.add(ny * gridWidth + nx);
            }
        }
    }    

    prepareNextTick() {
        this.lastPower = this.power;
    }
}

class Wire extends Block {
    update() {
        let visited = new Set();
        let queue = [this.y * gridWidth + this.x];
        visited.add(this.y * gridWidth + this.x);
    
        let foundPower = false;
    
        while (queue.length > 0) {
            let currentId = queue.shift();
            let currX = currentId % gridWidth;
            let currY = Math.floor(currentId / gridWidth);
            
            const neighbors = [
                {nx: currX, ny: currY - 1, dir: 0}, // Up
                {nx: currX + 1, ny: currY, dir: 1}, // Right
                {nx: currX, ny: currY + 1, dir: 2}, // Down
                {nx: currX - 1, ny: currY, dir: 3}  // Left
            ];
    
            for (let {nx, ny, dir} of neighbors) {
                if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
                let nid = ny * gridWidth + nx;
                let neighbor = grid[nid];
                
                if (!neighbor || visited.has(nid)) continue;
    
                // 1. If it's a wire, just add it to the search queue
                if (neighbor instanceof Wire) {
                    visited.add(nid);
                    queue.push(nid);
                } 
                // 2. ONLY these blocks can actually RETURN "true" for power
                else if (neighbor instanceof Switch && neighbor.power > 0) {
                    foundPower = true;
                    break;
                } 
                else if (neighbor instanceof Diode ||neighbor instanceof Inverter) {
                    const pointsAtThis = neighbor.rotation === (dir + 2) % 4;
                    if (neighbor.power > 0 && pointsAtThis) {
                        foundPower = true;
                        break;
                    }
                }
            }
            if (foundPower) break;
        }
        this.power = foundPower ? 1 : 0;
    }    
}


class Inverter extends Block {
    update() {
        const input = this.getBackNeighbor();
        this.power = (input && input.power > 0) ? 0 : 1;
    }
}

class Diode extends Block {
    update() {
        const input = this.getBackNeighbor();
        this.power = (input && input.power > 0) ? 1 : 0;
    }
}

class Switch extends Block {
    // only changes with a click
    update() {} 

    interact() {
        this.toggle();
    }
    toggle() {
        this.power = this.power === 1 ? 0 : 1;
        dirtyBlocks.add(this.y * gridWidth + this.x);
        this.dirtyNeighbors();
    }
}

class Button extends Block {
    update() {} // only changes via mouse

    press() {
        this.power = 1;
        this.dirtyNeighbors();
        dirtyBlocks.add(this.y * gridWidth + this.x);
    }

    release() {
        this.power = 0;
        this.dirtyNeighbors();
        dirtyBlocks.add(this.y * gridWidth + this.x);
    }
}


// Tool Selection
document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelector('.tool.active').classList.remove('active');
        btn.classList.add('active');
        currentTool = btn.dataset.type;
    });
});

// Hotkeys for Rotation
window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === 'r' || key === 'e') { // CW
        currentRotation = (currentRotation + 1) % 4;
    } else if (key === 'q') { // CCW
        currentRotation = (currentRotation + 3) % 4; // +3 is same as -1 mod 4
    }
    document.getElementById("rot-display").innerText = rotationNames[currentRotation];
});

canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragButton = e.button;
    
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / gridWidth));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / gridHeight));
    const id = y * gridWidth + x;

    // Special logic for Button press
    if (grid[id] instanceof Button && dragButton === 0) {
        pressedButton = grid[id];
        pressedButton.press();
    } else {
        handleInteraction(e);
    }
});

window.addEventListener("mousemove", (e) => {
    if (isDragging) {
        // Drag wire to place OR drag right-click to delete
        if ((dragButton === 0 && currentTool === "wire") || dragButton === 2) {
            handleInteraction(e);
        }
    }
});

window.addEventListener("mouseup", () => {
    isDragging = false;
    dragButton = -1;

    // Release the button if we were holding one
    if (pressedButton) {
        pressedButton.release();
        pressedButton = null;
    }
});
function handleInteraction(e) {
    const rect = canvas.getBoundingClientRect();
    // Use rect.width/height to account for CSS scaling
    const x = Math.floor((e.clientX - rect.left) / (rect.width / gridWidth));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / gridHeight));
    
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const id = y * gridWidth + x;

    if (dragButton === 2) { // Right click: Always Delete
        if (!grid[id]) return;
        const blockToDie = grid[id]; 
        grid[id] = null;
        blockToDie.dirtyNeighbors();
    } 
    else if (dragButton === 0) { // Left click: Interact OR Place
        if (grid[id] !== null) {
            // Only interact on the initial click (don't toggle 60 times a second while dragging)
            if (!isDragging || (isDragging && currentTool !== "wire")) {
                grid[id].interact();
            }
        } else {
            // Place new block
            let newBlock;
            if (currentTool === "wire") newBlock = new Wire(x, y);
            if (currentTool === "inverter") newBlock = new Inverter(x, y, currentRotation);
            if (currentTool === "diode") newBlock = new Diode(x, y, currentRotation);
            if (currentTool === "switch") newBlock = new Switch(x, y);
            if (currentTool === "button") newBlock = new Button(x, y);

            if (newBlock) {
                grid[id] = newBlock;
                newBlock.update(); 
                newBlock.dirtyNeighbors();
                dirtyBlocks.add(id);
            }
        }
    }
}

canvas.addEventListener("contextmenu", e => e.preventDefault());


function tick() {
    if (dirtyBlocks.size === 0) return;

    // These only update once per tick to create the necessary delay for clocks.
    let initialDirty = new Set(dirtyBlocks);
    dirtyBlocks.clear();

    for (let id of initialDirty) {
        const block = grid[id];
        if (block && !(block instanceof Wire)) {
            block.prepareNextTick();
            block.update();
            if (block.power !== block.lastPower) {
                block.dirtyNeighbors();
            }
        } else if (block instanceof Wire) {
            dirtyBlocks.add(id);
        }
    }

    // Wires loop until they stabilize
    let wiresChanged = true;
    let limit = 100; 

    while (wiresChanged && limit-- > 0) {
        wiresChanged = false;
        let wireQueue = new Set(dirtyBlocks);
        dirtyBlocks.clear();

        for (let id of wireQueue) {
            const block = grid[id];
            if (block instanceof Wire) {
                block.prepareNextTick();
                block.update();
                if (block.power !== block.lastPower) {
                    block.dirtyNeighbors();
                    wiresChanged = true;
                }
            } else if (block instanceof Inverter) {
                dirtyBlocks.add(id);
            }
        }
    }
}

function render() {
    ctx.fillStyle = "#1a1a1a"; // Background
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Grid Lines (optional but helpful)
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridWidth; i++) {
        ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(canvas.width, i * cellSize); ctx.stroke();
    }

    grid.forEach((block, i) => {
        if (!block) return;
        const x = block.x * cellSize;
        const y = block.y * cellSize;

        if (block instanceof Wire) {
            ctx.strokeStyle = block.power ? "#ff4d4d" : "#441111";
            ctx.lineWidth = cellSize * 0.2;
            ctx.lineCap = "round";
        
            const centerX = x + cellSize / 2;
            const centerY = y + cellSize / 2;
        
            // Draw central dot
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        
            // Check 4 neighbors and draw lines to them if they are wires or components
            const neighbors = [
                { n: block.getNeighbor(0), dx: 0, dy: -cellSize / 2 }, // Up
                { n: block.getNeighbor(1), dx: cellSize / 2, dy: 0 },  // Right
                { n: block.getNeighbor(2), dx: 0, dy: cellSize / 2 },  // Down
                { n: block.getNeighbor(3), dx: -cellSize / 2, dy: 0 }  // Left
            ];
        
            neighbors.forEach(neighbor => {
                if (neighbor.n) {
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(centerX + neighbor.dx, centerY + neighbor.dy);
                    ctx.stroke();
                }
            });
        } else if (block instanceof Inverter) {
            const center = cellSize / 2;
            const baseWidth = cellSize * 0.5;
            const indicatorSize = cellSize * 0.2;
            const gap = cellSize * 0.1;
            const margin = cellSize * 0.05;
        
            ctx.save();
            ctx.translate(x + center, y + center);
            ctx.rotate((block.rotation - 1) * Math.PI / 2);
        
            ctx.fillStyle = "#333";
            const baseL = cellSize - (margin * 2);
            ctx.beginPath();
            ctx.roundRect(-baseL/2, -baseWidth/2, baseL, baseWidth, cellSize * 0.1);
            ctx.fill();
        
            const outputColor = block.power ? "#ff4d4d" : "#441111";
            const inputColor = !block.power ? "#ff4d4d" : "#441111";
        
            // The Input Circle (Back) - Shows what it's "seeing"
            ctx.fillStyle = inputColor;
            const circleX = -baseL/2 + (indicatorSize);
            ctx.beginPath();
            ctx.arc(circleX, 0, indicatorSize / 2, 0, Math.PI * 2);
            ctx.fill();
        
            // The Output Line (Front) - Shows what it's "sending"
            ctx.strokeStyle = outputColor;
            ctx.lineWidth = indicatorSize;
            ctx.lineCap = "butt";
            
            const lineStart = circleX + (indicatorSize / 2) + gap;
            const lineEnd = baseL / 2 - (indicatorSize / 2);
            
            ctx.beginPath();
            ctx.moveTo(lineStart, 0);
            ctx.lineTo(lineEnd, 0);
            ctx.stroke();
        
            ctx.restore();
        } else if (block instanceof Diode) {
            const center = cellSize / 2;
            const baseSize = cellSize * 0.3;
            
            ctx.save();
            ctx.translate(x + center, y + center);
            ctx.rotate((block.rotation - 1) * Math.PI / 2);
        
            // Outer Triangle (Base)
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.moveTo(-baseSize, -baseSize); 
            ctx.lineTo(baseSize, 0);          
            ctx.lineTo(-baseSize, baseSize);  
            ctx.fill();
        
            // Inner Triangle (Power Indicator)
            ctx.fillStyle = block.power ? "#ff4d4d" : "#441111";
            const inner = baseSize * 0.6;
            ctx.beginPath();
            ctx.moveTo(-inner, -inner); 
            ctx.lineTo(inner, 0);          
            ctx.lineTo(-inner, inner);  
            ctx.fill();
        
            ctx.restore();
        } else if (block instanceof Switch) {
            const pad = cellSize * 0.15;
            const border = cellSize * 0.1;
            
            // Square Base
            ctx.fillStyle = "#333";
            ctx.fillRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2);
        
            // Square Indicator (Offset by border)
            ctx.fillStyle = block.power ? "#00ff00" : "#225522";
            const innerPad = pad + border;
            ctx.fillRect(x + innerPad, y + innerPad, cellSize - innerPad * 2, cellSize - innerPad * 2);
        } else if (block instanceof Button) {
            const center = cellSize / 2;
            const baseRadius = cellSize * 0.4;
            const border = cellSize * 0.1;
        
            // Circle Base
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.arc(x + center, y + center, baseRadius, 0, Math.PI * 2);
            ctx.fill();
        
            ctx.fillStyle = block.power ? "#00ff00" : "#225522";
            const indicatorRadius = (baseRadius - border);
            
            ctx.beginPath();
            ctx.arc(x + center, y + center, indicatorRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

let lastTickTime = 0;
const tickRate = 100; // 10 tps

function frame(timestamp) {
    if (timestamp - lastTickTime >= tickRate) {
        tick();
        lastTickTime = timestamp;
    }

    render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);