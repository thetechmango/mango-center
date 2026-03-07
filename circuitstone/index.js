const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

let gridWidth = 60;
let gridHeight = 30;
let grid = new Array(gridWidth * gridHeight).fill(null);
let cellSize = canvas.width / gridWidth;
let dirtyBlocks = new Set();

let tickRate = 20; // 20 tps

let currentTool = "wire";
let currentRotation = 1;
const rotationNames = ["Up", "Right", "Down", "Left"];
let isDragging = false;
let dragButton = -1;
let pressedButton = null;
let lastInteractedId = null;
const keysDown = new Set();
let activeEditingComment = null;

let selection = null; // {x1, y1, x2, y2} in grid coords
let clipboard = null; // Array of {type, dx, dy, rotation, color, etc.}
let isSelecting = false;
let isDraggingUI = false;
let movePreview = null; // {dx, dy}

let mouseX = 0;
let mouseY = 0;
let mouseInCanvas = false;

let wirelessChannels = {}; 

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let isPaused = false;

const colorPicker = document.getElementById("wire-color");

function exportToJSON() {
    const data = grid.map(block => {
        if (!block) return null;
        return {
            type: block.constructor.name,
            x: block.x,
            y: block.y,
            rotation: block.rotation,
            color: block.color || null,
            lastInput: this.lastInput,
            power: block.power,
            state: block.state ?? 0,
            channel: block.channel,
            delayAmount: block.delayAmount,
            targetKey: block.targetKey,
            noteIndex: block.noteIndex,
            text: block.text,
            isCCW: block.isCCW
        };
    });

    const blob = new Blob([JSON.stringify({ gridWidth, gridHeight, data })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "circuit_design.json";
    a.click();
    URL.revokeObjectURL(url);
}

function importFromJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const parsed = JSON.parse(e.target.result);
        
        gridWidth = parsed.gridWidth || 50;
        gridHeight = parsed.gridHeight || 25;
        cellSize = canvas.width / gridWidth; // Recalculate cell size for rendering

        grid = new Array(gridWidth * gridHeight).fill(null);
        dirtyBlocks.clear();

        const constructors = { 
            Wire, Inverter, Diode, Bridge, Switch, Button, 
            PowerBlock, Lamp, Toggle, HoverSensor, Delay, 
            KeyBlock, Transmitter, Receiver, Random, Trigger,
            NoteBlock, Comment, Rotator
        };

        parsed.data.forEach((b) => {
            if (!b) return;
            
            const BlockClass = constructors[b.type];
            if (BlockClass) {
                const newBlock = new BlockClass(b.x, b.y, b.rotation);
                newBlock.power = b.power || 0;
                
                if (b.color) newBlock.color = b.color;
                if (b.state !== undefined) newBlock.state = b.state;
                if (b.channel !== undefined) newBlock.channel = b.channel;
                if (b.targetKey !== undefined) newBlock.targetKey = b.targetKey;
                if (b.delayAmount !== undefined) {
                    newBlock.delayAmount = b.delayAmount;
                    newBlock.history = new Array(b.delayAmount).fill(0);
                }

                // Place in the correct slot based on the new gridWidth
                const id = b.y * gridWidth + b.x;
                grid[id] = newBlock;
                dirtyBlocks.add(id);
            }
        });
        
        console.log("Import Complete!");
        render();
    };
    reader.readAsText(file);
}

function getNoteInfo(index) {
    const octave = Math.floor(index / 12) + 4;
    const name = NOTE_NAMES[index % 12];
    const freq = 261.63 * Math.pow(2, index / 12); // Base C4 is 261.63Hz
    return { name: `${name}${octave}`, freq };
}

function playNote(freq) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function openCommentEditor(block) {
    activeEditingComment = block;
    block.isEditing = true;

    const overlay = document.createElement('div');
    overlay.id = "comment-overlay";
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.7); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    const area = document.createElement('textarea');
    area.value = block.text;
    area.style = `
        width: 400px; height: 200px; padding: 20px; border-radius: 8px;
        background: #111; color: #4dff4d; font-family: monospace;
        font-size: 16px; border: 4px solid #114411; outline: none;
    `;

    overlay.onclick = (e) => {
        if (e.target === overlay) closeCommentEditor(area.value);
    };

    overlay.appendChild(area);
    document.body.appendChild(overlay);
    area.focus();
}

function closeCommentEditor(val) {
    if (!activeEditingComment) return;
    activeEditingComment.text = val;
    activeEditingComment.isEditing = false;

    const id = activeEditingComment.y * gridWidth + activeEditingComment.x;
    dirtyBlocks.add(id)

    activeEditingComment = null;
    document.getElementById("comment-overlay").remove();
    render();
}

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

    getNeighborPower(dir) {
        const neighbor = this.getNeighbor(dir);
        if (!neighbor) return 0;
    
        if (neighbor.color === "black" && !(this instanceof Lamp)) {
            return 0;
        }

        if (neighbor instanceof Bridge) {
            const isAtOutputA = neighbor.rotation === (dir + 2) % 4;
            if (isAtOutputA) return neighbor.powerH;
    
            const isAtOutputB = ((neighbor.rotation + 1) % 4) === (dir + 2) % 4;
            if (isAtOutputB) return neighbor.powerV;
    
            return 0;
        }
    
        return neighbor.power;
    }

    prepareNextTick() {
        this.lastPower = this.power;
    }

    render(x, y, isPreview = false) {
        ctx.save();
        if (isPreview) ctx.globalAlpha = 0.4;
        
        ctx.translate(x + cellSize / 2, y + cellSize / 2);

        this.draw(ctx, cellSize);

        ctx.restore();
    }
}

class Wire extends Block {
    constructor(x, y, rotation = 0, color = "red") {
        super(x, y, rotation);
        this.color = color;
    }
    update() {
        let visited = new Set();
        let queue = [this.y * gridWidth + this.x];
        visited.add(this.y * gridWidth + this.x);
    
        let foundPower = false;
    
        while (queue.length > 0) {
            let currentId = queue.shift();
            let currWire = grid[currentId];
            let currX = currentId % gridWidth;
            let currY = Math.floor(currentId / gridWidth);

            if (!currWire || !(currWire instanceof Wire)) continue;
            
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
    
                // If it's a wire, just add it to the search queue
                if (neighbor instanceof Wire) {
                    const connects = (
                        currWire.color === neighbor.color || 
                        currWire.color === "white" || 
                        neighbor.color === "white"
                    );
                    if (connects) {
                        visited.add(nid);
                        queue.push(nid);
                    }
                }
                else if (currWire.color !== "black") {
                    if (neighbor instanceof Bridge) {
                        // check if the wire is at the bridge's specific lane outputs:
                        
                        // Lane A Output (The block the bridge's rotation points at)
                        const isAtOutputA = neighbor.rotation === (dir + 2) % 4;
                        if (isAtOutputA && neighbor.powerH > 0) {
                            foundPower = true;
                            break;
                        }
    
                        // Lane B Output (The block 90deg clockwise from bridge's rotation)
                        const isAtOutputB = ((neighbor.rotation + 1) % 4) === (dir + 2) % 4;
                        if (isAtOutputB && neighbor.powerV > 0) {
                            foundPower = true;
                            break;
                        }
                    }
                    else if (neighbor instanceof Switch && neighbor.power > 0) {
                        foundPower = true;
                        break;
                    }
                    else if ((neighbor instanceof Switch || neighbor instanceof Button) && neighbor.power > 0) {
                        foundPower = true;
                        break;
                    } 
                    else if (neighbor instanceof Diode ||neighbor instanceof Inverter || neighbor instanceof Delay || neighbor instanceof Trigger) {
                        const pointsAtThis = neighbor.rotation === (dir + 2) % 4;
                        if (neighbor.power > 0 && pointsAtThis) {
                            foundPower = true;
                            break;
                        }
                    }
                    else if (neighbor instanceof HoverSensor && neighbor.power > 0) {
                        foundPower = true;
                        break;
                    }
                    else if (neighbor instanceof PowerBlock) {
                        // Standard color matching logic
                        const connects = (this.color === neighbor.color || 
                                        this.color === "white" || 
                                        neighbor.color === "white");
                        if (connects) {
                            foundPower = true;
                            break;
                        }
                    }
                }
            }
            if (foundPower) break;
        }
        this.power = foundPower ? 1 : 0;
    }

    draw() {
        const colorMap = {
            red: this.power ? "#ff4d4d" : "#441111",
            green: this.power ? "#4dff4d" : "#114411",
            blue: this.power ? "#4d4dff" : "#111144",
            white: this.power ? "#ffffff" : "#555555",
            black: this.power ? "#000000" : "#000000" // Subtle look for insulated
        };
        
        ctx.strokeStyle = colorMap[this.color];
        ctx.lineWidth = cellSize * 0.2;
        ctx.lineCap = "round";

        const centerX = 0;
        const centerY = 0;
    
        // Draw central dot
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
    
        const neighbors = [
            { n: this.getNeighbor(0), dx: 0, dy: -cellSize / 2 }, // Up
            { n: this.getNeighbor(1), dx: cellSize / 2, dy: 0 },  // Right
            { n: this.getNeighbor(2), dx: 0, dy: cellSize / 2 },  // Down
            { n: this.getNeighbor(3), dx: -cellSize / 2, dy: 0 }  // Left
        ];
    
        neighbors.forEach(neighbor => {
            if (!neighbor.n) return; 
    
            const isWire = neighbor.n instanceof Wire;
            const connects = isWire && (
                this.color === "white" || 
                neighbor.n.color === "white" || 
                this.color === neighbor.n.color
            );
            
            const isComponent = !isWire && (this.color !== "black"); 
            if (connects || isComponent) {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(centerX + neighbor.dx, centerY + neighbor.dy);
                ctx.stroke();
            }
        });
    }    
}


class Inverter extends Block {
    update() {
        this.power = this.getNeighborPower((this.rotation + 2) % 4) > 0 ? 0 : 1;
    }
    
    draw() {
        const baseWidth = cellSize * 0.6;
        const indicatorSize = cellSize * 0.2;
        const gap = cellSize * 0.15;
        const margin = cellSize * 0.0;
    
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        ctx.fillStyle = "#333";
        const baseL = cellSize - (margin * 2);
        ctx.beginPath();
        ctx.roundRect(-baseL/2, -baseWidth/2, baseL, baseWidth, cellSize * 0.1);
        ctx.fill();
    
        const outputColor = this.power ? "#ff4d4d" : "#441111";
        const inputColor = !this.power ? "#ff4d4d" : "#441111";
    
        // Input triangle (Back)
        ctx.fillStyle = inputColor;
        const triW = indicatorSize * 1;
        const triH = indicatorSize * 0.9;
        const triX = -baseL/2 + indicatorSize * 0.5;

        ctx.beginPath();
        ctx.moveTo(triX + triW, 0);
        ctx.lineTo(triX, -triH);
        ctx.lineTo(triX, triH);
        ctx.closePath();
        ctx.fill();

        // Output line (Front)
        ctx.strokeStyle = outputColor;
        ctx.lineWidth = indicatorSize;
        ctx.lineCap = "butt";
        
        const lineStart = triX + (indicatorSize / 2) + gap;
        const lineEnd = baseL / 2 - (indicatorSize / 2);
        
        ctx.beginPath();
        ctx.moveTo(lineStart, 0);
        ctx.lineTo(lineEnd, 0);
        ctx.stroke();
    
        ctx.restore();
    }
}

class Diode extends Block {
    update() {
        this.power = this.getNeighborPower((this.rotation + 2) % 4) > 0 ? 1 : 0;
    }

    draw() {
        const baseSize = cellSize * 0.5;
        
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(
            -cellSize/2,
            -cellSize/2,
            cellSize,
            cellSize,
            cellSize * 0.15 // corner radius
        );
        ctx.fill();
    
        // Inner Triangle (Power Indicator)
        ctx.fillStyle = this.power ? "#ff4d4d" : "#441111";
        const inner = baseSize * 0.7;
        ctx.beginPath();
        ctx.moveTo(-inner, -inner);
        ctx.lineTo(inner, 0);
        ctx.lineTo(-inner, inner);
        ctx.fill();
    
        ctx.restore();
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

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(
            -cellSize/2,
            -cellSize/2,
            cellSize,
            cellSize,
            cellSize * 0.15 // corner radius
        );
        ctx.fill();
    
        // Square Indicator
        ctx.fillStyle = this.power ? "#4dff4d" : "#114411";
        ctx.beginPath();
        ctx.fillRect(
            -cellSize/2 * 0.8,
            -cellSize/2 * 0.8,
            cellSize * 0.8,
            cellSize * 0.8
        );

        ctx.restore();
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

    draw() {
        const indicatorSize = cellSize * 0.8;
        
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile circle base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(0, 0, cellSize/2, 0, Math.PI * 2);
        ctx.fill();
    
        // Circle Indicator
        ctx.fillStyle = this.power ? "#4dff4d" : "#114411";
        ctx.beginPath();
        ctx.arc(0, 0, indicatorSize/2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class Bridge extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.powerH = 0; 
        this.powerV = 0;
        this.lastPowerH = 0;
        this.lastPowerV = 0;
    }

    prepareNextTick() {
        this.lastPowerH = this.powerH;
        this.lastPowerV = this.powerV;
        this.lastPower = (this.powerH || this.powerV) ? 1 : 0;
    }

    update() {
        const oldH = this.powerH;
        const oldV = this.powerV;
    
        // --- Lane A (Horizontal/Forward) ---
        const inputA = this.getBackNeighbor();
        if (inputA instanceof Bridge) {
            // If the neighbor is a Bridge, take its 'Forward' lane power
            this.powerH = inputA.powerH; 
        } else {
            // Otherwise, take standard power (Wires, Switches, etc.)
            this.powerH = (inputA && inputA.power > 0) ? 1 : 0;
        }
    
        // --- Lane B (Vertical/Left) ---
        const inputB = this.getLeftNeighbor();
        if (inputB instanceof Bridge) {
            // If the neighbor is a Bridge, take its 'Vertical' lane power
            this.powerV = inputB.powerV;
        } else {
            this.powerV = (inputB && inputB.power > 0) ? 1 : 0;
        }
    
        if (this.powerH !== oldH || this.powerV !== oldV) {
            this.dirtyNeighbors();
        }
    }

    draw() {
        const thick = cellSize * 0.2;
        const len = cellSize * 0.4;

        ctx.lineCap = "round";
    
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(
            -cellSize/2,
            -cellSize/2,
            cellSize,
            cellSize,
            cellSize * 0.15 // corner radius
        );
        ctx.fill();

        // Lane A (horizontal)
        ctx.strokeStyle = this.powerH ? "#ff4d4d" : "#441111";
        ctx.lineWidth = thick;
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();
    
        // Arrow for Lane A (left side)
        {
            const triW = cellSize * 0.25;
            const triH = cellSize * 0.20;
            const offset = cellSize * 0.5;
    
            ctx.fillStyle = this.powerH ? "#ff4d4d" : "#441111";
            ctx.beginPath();
            ctx.moveTo(-offset + triW, 0);
            ctx.lineTo(-offset, -triH);
            ctx.lineTo(-offset, triH);
            ctx.closePath();
            ctx.fill();
        }
    
        // Lane B (vertical)
        ctx.strokeStyle = this.powerV ? "#ff4d4d" : "#441111";
        ctx.beginPath();
        ctx.moveTo(0, -len);
        ctx.lineTo(0, len);
        ctx.stroke();
    
        // Arrow for Lane B (top side)
        {
            const triW = cellSize * 0.25;
            const triH = cellSize * 0.20;
            const offset = cellSize * 0.5;
    
            ctx.fillStyle = this.powerV ? "#ff4d4d" : "#441111";
            ctx.beginPath();
            ctx.moveTo(0, -offset + triW);
            ctx.lineTo(-triH, -offset);
            ctx.lineTo(triH, -offset);
            ctx.closePath();
            ctx.fill();
        }
    
        ctx.restore();
    }
}

class Lamp extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.color = document.getElementById("wire-color").value;
    }

    prepareNextTick() {
        this.lastPower = this.power;
    }

    update() {
        this.power = this.getNeighborPower((this.rotation + 2) % 4) > 0 ? 1 : 0;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
    }

    draw() {
        const colorMap = {
            red: this.power ? "#ff4d4d" : "#000000",
            green: this.power ? "#4dff4d" : "#000000",
            blue: this.power ? "#4d4dff" : "#000000",
            white: this.power ? "#ffffff" : "#000000",
            black: this.power ? "#444444" : "#000000"
        };
    
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Body (full cell)
        ctx.fillStyle = colorMap[this.color];
        ctx.fillRect(-cellSize/2, -cellSize/2, cellSize, cellSize);
    
        // Input indicator
        const inputColor = this.power ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
    }
}

class Toggle extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.state = 0;
        this.lastInput = 0;
    }

    prepareNextTick() {
        this.lastPower = this.power;
    }

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;

        // Rising edge: 0 → 1
        if (this.lastInput === 0 && inputPower === 1) {
            this.state = this.state ? 0 : 1; // flip
        }

        this.lastInput = inputPower;

        // Output = stored state
        this.power = this.state;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        ctx.save();
        ctx.rotate(Math.PI / 4); // Rotate 45 degrees to make it an X
        
        const barLen = cellSize * 0.35;
        const barThick = cellSize * 0.18;
        const stateColor = this.power ? "#ff4d4d" : "#441111";
        ctx.fillStyle = stateColor;
    
        // Horizontal bar of the X
        ctx.beginPath();
        ctx.roundRect(-barLen, -barThick/2, barLen*2, barThick, barThick/2);
        ctx.fill();
        // Vertical bar of the X
        ctx.beginPath();
        ctx.roundRect(-barThick/2, -barLen, barThick, barLen*2, barThick/2);
        ctx.fill();
        ctx.restore();

        // Input indicator
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
    }
}

class HoverSensor extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.power = 0;
    }

    prepareNextTick() {
        this.lastPower = this.power;
    }

    update() {
        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
            dirtyBlocks.add(this.y * gridWidth + this.x);
        }
    }

    interact() {}

    draw() {
        const ringOuter = cellSize * 0.35;
        const ringWidth = cellSize * 0.12;
    
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(
            -cellSize/2,
            -cellSize/2,
            cellSize,
            cellSize,
            cellSize * 0.15
        );
        ctx.fill();
    
        // Donut indicator ring
        ctx.strokeStyle = this.power ? "#00ff00" : "#225522";
        ctx.lineWidth = ringWidth;
        ctx.beginPath();
        ctx.arc(0, 0, ringOuter, 0, Math.PI * 2);
        ctx.stroke();
    
        ctx.restore();
    }
}

class Delay extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.delayAmount = 1;
        this.history = new Array(this.delayAmount).fill(0);
    }

    interact(e) {
        const options = [1, 2, 3, 4];
        const step = (e && e.shiftKey) ? -1 : 1;
        let idx = options.indexOf(this.delayAmount);
        this.delayAmount = options[(idx + step + options.length) % options.length];
        
        // Resize history and fill with 0s
        this.history = new Array(this.delayAmount).fill(0);
        this.dirtyNeighbors();
    }

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;
    
        // 1. Peek at what the output WILL be
        const nextOutput = this.history[this.history.length - 1];
    
        // 2. Logic: Should we stay "awake"?
        // - Stay awake if the internal history isn't uniform yet
        // - OR if the input is currently high (filling the buffer)
        // - OR if the output is about to change state (the final exit)
        const isMoving = this.history.some(state => state !== inputPower);
        const willChange = nextOutput !== this.power;
    
        // 3. Perform the shift
        this.history.unshift(inputPower);
        this.power = this.history.pop();
    
        // 4. Dirtying logic
        // We check willChange OR isMoving OR if we just changed (powerChanged)
        if (isMoving || willChange || this.power !== this.lastPower) {
            dirtyBlocks.add(this.y * gridWidth + this.x);
            this.dirtyNeighbors();
        }
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Full tile rounded base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        // --- Balanced Segment Math ---
        const gap = 3; 
        const margin = gap / 2; 
        const segWidth = (cellSize - (gap * this.delayAmount)) / this.delayAmount;
        const startX = -cellSize / 2 + margin;
    
        this.history.forEach((state, i) => {
            const xPos = startX + i * (segWidth + gap);
        
            // --- TRAPEZOID MATH ---
            // Calculate heights for the LEFT and RIGHT side of this specific segment
            const leftPct = i / this.delayAmount;
            const rightPct = (i + 1) / this.delayAmount;
            
            // Taper from 0.7 (Input side) down to 0.2 (Output side)
            const hLeft = cellSize * (0.7 - (leftPct * 0.5));
            const hRight = cellSize * (0.7 - (rightPct * 0.5));
        
            const drawSegment = () => {
                ctx.beginPath();
                // Top Left
                ctx.moveTo(xPos, -hLeft / 2);
                // Top Right
                ctx.lineTo(xPos + segWidth, -hRight / 2);
                // Bottom Right
                ctx.lineTo(xPos + segWidth, hRight / 2);
                // Bottom Left
                ctx.lineTo(xPos, hLeft / 2);
                ctx.closePath();
                ctx.fill();
            };
        
            // 1. Inactive Slot
            ctx.fillStyle = "#441111"; 
            drawSegment();
        
            // 2. Active Segment (Solid High-Contrast)
            if (state) {
                ctx.fillStyle = "#ff4d4d"; 
                drawSegment();
            }
        });            
    
        ctx.restore();
    }
}

class KeyBlock extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.targetKey = "F"; // Default to F
        this.isBinding = false; // waiting for a key press
    }

    interact() {
        // Enter "Binding Mode"
        this.isBinding = true;
        dirtyBlocks.add(this.y * gridWidth + this.x);
        
        // Listen for the NEXT key press globally
        const listener = (e) => {
            e.preventDefault();
            this.targetKey = e.key.toUpperCase();
            this.isBinding = false;
            window.removeEventListener("keydown", listener);
            dirtyBlocks.add(this.y * gridWidth + this.x);
            render();
        };
        window.addEventListener("keydown", listener);
    }

    update() {
        // Check if its specific key is currently held down in your global keys set
        const isPressed = keysDown.has(this.targetKey) || keysDown.has(this.targetKey.toLowerCase());
        this.power = isPressed ? 1 : 0;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
        
        // Keep it "awake" while binding so the UI updates
        if (this.isBinding) dirtyBlocks.add(this.y * gridWidth + this.x);
    }

    draw() {
        ctx.save();

        ctx.beginPath();
        ctx.fillStyle = this.isBinding ? "#fff" : "#333";
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        ctx.fillStyle = this.power ? "#ff4d4d" : (this.isBinding ? "#000" : "#441111");
        ctx.font = `bold ${cellSize * 0.4}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        let displayKey = this.isBinding ? "?" : (this.targetKey || "?");
        if (displayKey === " ") displayKey = "SPC";
        
        ctx.fillText(displayKey, 0, 0);
    
        ctx.restore();
    }
}

class Transmitter extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.channel = 0;
    }

    interact(e) {
        const step = (e && e.shiftKey) ? -1 : 1;
        this.channel = (this.channel + step + 100) % 100; // Cycle channels 0-99
        render();
    }

    update() {
        let locallyPowered = false;
    
        // Check all 4 neighbors for input
        for (let i = 0; i < 4; i++) {
            if (this.getNeighborPower(i) > 0) {
                locallyPowered = true;
                break;
            }
        }
    
        // For renderer only
        this.isTransmitting = locallyPowered;
    
        if (locallyPowered) {
            wirelessChannels[this.channel] = 1;
        }
        
        this.power = 0; 
    }

    draw() {
        ctx.save();
    
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        // ONLY glow if THIS specific block is powered
        const active = this.isTransmitting;
        ctx.strokeStyle = active ? "#ff4d4d" : "#441111";
        ctx.lineWidth = cellSize * 0.05;
    
        for(let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, (cellSize * 0.1) + (i * cellSize * 0.12), 0, Math.PI * 2);
            ctx.stroke();
        }
    
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${cellSize * 0.5}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.channel, 0, 0);
    
        ctx.restore();
    }
}

class Receiver extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.channel = 0;
    }

    interact(e) {
        const step = (e && e.shiftKey) ? -1 : 1;
        this.channel = (this.channel + step + 100) % 100;
        render();
    }

    update() {
        // Read from the global bus
        this.power = wirelessChannels[this.channel] || 0;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
    }

    draw() {
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        const isReceiving = wirelessChannels[this.channel] > 0;
        ctx.strokeStyle = isReceiving ? "#ff4d4d" : "#441111";
        ctx.lineWidth = cellSize * 0.05;
    
        for(let i = 1; i <= 3; i++) {
            const s = (cellSize * 0.25) + (i * cellSize * 0.15);
            ctx.globalAlpha = 1.0 - (i * 0.2);
            ctx.strokeRect(-s/2, -s/2, s, s);
        }
        ctx.globalAlpha = 1.0;
    
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${cellSize * 0.5}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.channel, 0, 0);
    }
}

class Random extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.lastInput = 0;
    }

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;

        // Trigger on rising edge
        if (this.lastInput === 0 && inputPower === 1) {
            this.power = Math.random() > 0.5 ? 1 : 0;
        }

        this.lastInput = inputPower;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
        
        // If input is high, keep it awake to detect the next pulse
        if (inputPower === 1) dirtyBlocks.add(this.y * gridWidth + this.x);
    }

    draw() {
        ctx.save();
    
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        ctx.fillStyle = this.power ? "#ff4d4d" : "#441111";
        ctx.font = `bold ${cellSize * 0.6}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", 0, 0);

        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Input indicator
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
        ctx.restore();
    }
}

class Trigger extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.lastInput = 0;
    }

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;

        // The "Rising Edge" Logic:
        // Output is 1 ONLY on the exact frame the input flips from 0 to 1
        this.power = (inputPower === 1 && this.lastInput === 0) ? 1 : 0;

        this.lastInput = inputPower;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
        }
        
        // Always stay awake for one extra tick if the input is high 
        // to reset the edge detection state
        if (inputPower === 1 || this.power === 1) {
            dirtyBlocks.add(this.y * gridWidth + this.x);
        }
    }

    draw() {
        ctx.save();
    
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        ctx.strokeStyle = this.power ? "#ff4d4d" : "#441111";
        ctx.lineWidth = cellSize * 0.1;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    
        ctx.beginPath();
        ctx.moveTo(-cellSize * 0.3, cellSize * 0.15);
        ctx.lineTo(-cellSize * 0.1, cellSize * 0.15);
        ctx.lineTo(0, -cellSize * 0.25);
        ctx.lineTo(cellSize * 0.1, cellSize * 0.15);
        ctx.lineTo(cellSize * 0.3, cellSize * 0.15);
        ctx.stroke();

        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // Input indicator
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
        ctx.restore();
    }
}

class PowerBlock extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.color = document.getElementById("wire-color").value;
        this.power = 1;
    }

    update() {}

    draw() {
        const colorMap = {
            red: this.power ? "#ff4d4d" : "#441111",
            green: this.power ? "#4dff4d" : "#114411",
            blue: this.power ? "#4d4dff" : "#111144",
            white: this.power ? "#ffffff" : "#555555",
            black: this.power ? "#000000" : "#000000"
        };

        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
        
        ctx.fillStyle = colorMap[this.color] || "ff4d4d";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        ctx.restore();
    }
}

class NoteBlock extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.noteIndex = 0;
        this.activeOsc = null;
        this.activeGain = null;
        this.lastInput = 0;
    }

    // Helper to start the sound
    startSound() {
        this.stopSound(); // Safety clear
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const info = getNoteInfo(this.noteIndex);
        this.activeOsc = audioCtx.createOscillator();
        this.activeGain = audioCtx.createGain();

        this.activeOsc.type = 'sine';
        this.activeOsc.frequency.setValueAtTime(info.freq, audioCtx.currentTime);
        
        // Instant start, but smooth 0.05s ramp to avoid "popping"
        this.activeGain.gain.setValueAtTime(0, audioCtx.currentTime);
        this.activeGain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);

        this.activeOsc.connect(this.activeGain);
        this.activeGain.connect(audioCtx.destination);
        this.activeOsc.start();
    }

    // Helper to stop with a short fade-out
    stopSound() {
        if (this.activeOsc && this.activeGain) {
            const release = 0.1; // 100ms fade out
            this.activeGain.gain.cancelScheduledValues(audioCtx.currentTime);
            this.activeGain.gain.setValueAtTime(this.activeGain.gain.value, audioCtx.currentTime);
            this.activeGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + release);
            
            const osc = this.activeOsc;
            setTimeout(() => osc.stop(), release * 1000);
            
            this.activeOsc = null;
            this.activeGain = null;
        }
    }

    interact(e) {
        const step = (e && e.shiftKey) ? -1 : 1;
        this.noteIndex = (this.noteIndex + step + 37) % 37; // 3 Octaves (0-36)
        
        // Brief preview: Play and then stop after 300ms
        this.startSound();
        setTimeout(() => this.stopSound(), 300);
        render();
    }

    onDelete() {
        this.stopSound();
    }    

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;

        // Start on Rising Edge
        if (inputPower === 1 && this.lastInput === 0) {
            this.startSound();
        } 
        // Stop on Falling Edge
        else if (inputPower === 0 && this.lastInput === 1) {
            this.stopSound();
        }

        this.lastInput = inputPower;
        this.power = inputPower;

        if (this.power !== this.lastPower) this.dirtyNeighbors();
        // Keep it "awake" while powered to ensure it can detect the shut-off
        if (inputPower === 1) dirtyBlocks.add(this.y * gridWidth + this.x);
    }

    draw() {
        // Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        // Note Name
        const info = getNoteInfo(this.noteIndex);
        ctx.fillStyle = this.power ? "#ff4d4d" : "#888";
        ctx.font = `bold ${cellSize * 0.35}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(info.name, 0, cellSize * 0.2);
    
        // Icon
        ctx.font = `${cellSize * 0.4}px serif`;
        ctx.fillText("♪", 0, -cellSize * 0.15);

        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Input indicator
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
    }
}

class Comment extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.text = ""; // Default empty
        this.isEditing = false;
        this.power = 0;
        this.lastPower = 0;
    }

    interact() {
        if (activeEditingComment) return; // Prevent multiple overlays
        openCommentEditor(this);
    }

    update() {
        const hasText = this.text && this.text.trim().length > 0;
        this.power = hasText ? 1 : 0;

        if (this.power !== this.lastPower) {
            this.dirtyNeighbors();
            
            this.lastPower = this.power;
        }
    }

    draw() {
        // Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        ctx.strokeStyle = this.power === 1 ? "#ff4d4d" : "#441111";
        ctx.lineWidth = cellSize * 0.1;
        for(let i = -1; i <= 1; i++) {
            ctx.beginPath();
            // Move to the LEFT side of center
            ctx.moveTo(-cellSize * 0.4, i * cellSize * 0.2);
            ctx.lineTo(cellSize * 0.4, i * cellSize * 0.2); 
            ctx.stroke();
        }
    }
}

class Rotator extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.isCCW = false; // Default Clockwise
        this.lastInput = 0;
    }

    interact() {
        this.isCCW = !this.isCCW;
        render();
    }

    update() {
        const input = this.getBackNeighbor();
        const inputPower = (input && input.power > 0) ? 1 : 0;

        // Trigger on Rising Edge
        if (inputPower === 1 && this.lastInput === 0) {
            this.rotateTarget();
        }

        this.lastInput = inputPower;
        this.power = inputPower; // Pass-through power

        if (this.power !== this.lastPower) this.dirtyNeighbors();
        if (inputPower === 1) dirtyBlocks.add(this.y * gridWidth + this.x);
    }

    rotateTarget() {
        // Find the block directly in front of the Rotator
        const nx = this.x + (this.rotation === 1 ? 1 : this.rotation === 3 ? -1 : 0);
        const ny = this.y + (this.rotation === 2 ? 1 : this.rotation === 0 ? -1 : 0);

        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) return;

        const target = grid[ny * gridWidth + nx];
        if (target && typeof target.rotation !== 'undefined') {
            const step = this.isCCW ? -1 : 1;
            // Standard 0-3 rotation wrap
            target.rotation = (target.rotation + step + 4) % 4;
            
            // Wake up the target and its new neighbors
            dirtyBlocks.add(ny * gridWidth + nx);
            target.dirtyNeighbors();
        }
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);
    
        // 1. Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
    
        // 2. The Arc (Offset by 45 degrees)
        ctx.strokeStyle = this.power ? "#ff4d4d" : "#441111";
        ctx.lineWidth = cellSize * 0.1;
        ctx.lineCap = "round";
        
        const startAngle = -Math.PI / 2 + Math.PI / 4;
        const endAngle = Math.PI / 2 - Math.PI / 4;
    
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 0.25, startAngle, endAngle);
        ctx.stroke();
    
        // 3. The Tip (Circle/Knob)
        ctx.fillStyle = this.power ? "#ff4d4d" : "#441111";
        
        ctx.save();
        // Position at Top end if CCW, Bottom end if CW
        const targetAngle = this.isCCW ? startAngle : endAngle;
        ctx.rotate(targetAngle);
        ctx.translate(cellSize * 0.25, 0);
    
        // Draw Circle instead of Triangle
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    
        // Input indicator
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111"; 
        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(-cellSize*0.5 + cellSize*0.2, 0);
        ctx.lineTo(-cellSize*0.5, -cellSize*0.15);
        ctx.lineTo(-cellSize*0.5, cellSize*0.15);
        ctx.fill();
    
        ctx.restore();
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
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        return;
    }

    if (e.ctrlKey && e.key === 'v' && clipboard) {
        pastingMode = true; // render() will now draw clipboard ghost at cursor
    }

    {
        const key = e.key.toUpperCase();
        if (!keysDown.has(key)) {
            keysDown.add(key);
            // wake up all keyblocks
            grid.forEach((block, id) => {
                if (block instanceof KeyBlock) dirtyBlocks.add(id);
            });
        }
    }
    const key = e.key.toLowerCase();
    if (key === 'e') { // CW
        currentRotation = (currentRotation + 1) % 4;
    } else if (key === 'q') { // CCW
        currentRotation = (currentRotation + 3) % 4; // +3 is same as -1 mod 4
    }
    if (e.code === "Space") { // Space to Play/Pause
        e.preventDefault(); // Stop page scrolling
        togglePause();
    }
    if (key === "s" || e.key === "S") { // S to Step
        step();
    }
    // Wire color hotkeys
    if (key === "1") colorPicker.value = "red";
    else if (key === "2") colorPicker.value = "green";
    else if (key === "3") colorPicker.value = "blue";
    else if (key === "4") colorPicker.value = "white";
    else if (key === "5") colorPicker.value = "black";

    document.getElementById("rot-display").innerText = rotationNames[currentRotation];
});

window.addEventListener("keyup", (e) => {
    const key = e.key.toUpperCase();
    keysDown.delete(key);
    // wake up all keyblocks
    grid.forEach((block, id) => {
        if (block instanceof KeyBlock) dirtyBlocks.add(id);
    });
});

canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragButton = e.button;

    if (e.button === 1) {
        e.preventDefault();
        isSelecting = true;
        
        const gx = Math.floor(mouseX / cellSize);
        const gy = Math.floor(mouseY / cellSize);
        
        selection = { x1: gx, y1: gy, x2: gx, y2: gy };
        render();
    }
    else if (e.button === 0) { // Left Click
        if (clipboard && isPasting) {
            // Logic for PASTE (Stamping the clipboard)
            pasteAt(gx, gy);
            isPasting = false;
        } else if (selection) {
            // Logic to CLEAR SELECTION if clicking elsewhere
            selection = null;
            showFloatingUI();
        }
        render();
    }

    if (!e.target.closest('.selection-btn')) {
        selection = null;
        showFloatingUI(); // Hide buttons
        render();
    }
    
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / gridWidth));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / gridHeight));
    const id = y * gridWidth + x;

    lastInteractedId = id; 

    if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
        if (grid[id] instanceof Button && dragButton === 0) {
            pressedButton = grid[id];
            pressedButton.press();
        } else {
            handleInteraction(e);
        }
    }
});

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    const gx = Math.floor((e.clientX - rect.left) / (rect.width / gridWidth));
    const gy = Math.floor((e.clientY - rect.top) / (rect.height / gridHeight));
    const currentId = gy * gridWidth + gx;

    if (isSelecting && (e.buttons & 4) && selection !== null) {
        selection.x2 = Math.floor(mouseX / cellSize);
        selection.y2 = Math.floor(mouseY / cellSize);
        render();
    } else if (isSelecting) {
        // If we were selecting but the button was released outside the canvas
        isSelecting = false;
        showFloatingUI(); 
        render();
    }

    // Sensor logic
    grid.forEach((block, id) => {
        if (block instanceof HoverSensor) {
            const shouldBeOn = (id === currentId);
            if (block.power !== (shouldBeOn ? 1 : 0)) {
                block.power = shouldBeOn ? 1 : 0;
                block.dirtyNeighbors();
                dirtyBlocks.add(id);
            }
        }
    });

    if (isDragging && (dragButton === 0 || dragButton === 2)) {
        // Only trigger interaction if we moved to a new tile
        if (currentId !== lastInteractedId) {
            handleInteraction(e);
        }
    }
});

canvas.addEventListener("mouseenter", () => {
    mouseInCanvas = true;
});

canvas.addEventListener("mouseleave", () => {
    mouseInCanvas = false;
    render(); // clear the ghost preview
});

window.addEventListener("mouseup", () => {
    isDragging = false;
    dragButton = -1;
    lastInteractedId = null;
    isSelecting = false;

    if (pressedButton) {
        pressedButton.release();
        pressedButton = null;
    }
});

canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    const tools = Array.from(document.querySelectorAll('.tool'));
    const currentActive = document.querySelector('.tool.active');
    let currentIndex = tools.indexOf(currentActive);

    if (e.deltaY > 0) {
        currentIndex = Math.min(currentIndex + 1, tools.length - 1);
    } else {
        currentIndex = Math.max(currentIndex - 1, 0);
    }

    const newToolBtn = tools[currentIndex];
    newToolBtn.click();
}, { passive: false });

colorPicker.addEventListener("change", () => {
    // Automatically switch to wire tool when a color is picked (disabled)
    /*
    currentTool = "wire";
    
    document.querySelectorAll('.tool').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === "wire") btn.classList.add('active');
    });
    */
});

function handleInteraction(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / gridWidth));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / gridHeight));
    
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const id = y * gridWidth + x;
    lastInteractedId = id;

    if (dragButton === 2) { // Right click: Delete
        if (!grid[id]) return;
        const blockToDie = grid[id];

        if (typeof grid[id].onDelete === 'function') {
            grid[id].onDelete();
        }

        grid[id] = null;
        blockToDie.dirtyNeighbors();
    } 
    else if (dragButton === 0) { // Left click: Interact or Place
        if (grid[id] !== null) {
            // Interact only once per click/tile-entry
            grid[id].interact(e);
        } else {
            // Place new block
            let newBlock = null;
            if (currentTool === "wire") {
                const color = document.getElementById("wire-color").value;
                newBlock = new Wire(x, y, 0, color);
            }            
            else if (currentTool === "inverter") newBlock = new Inverter(x, y, currentRotation);
            else if (currentTool === "diode") newBlock = new Diode(x, y, currentRotation);
            else if (currentTool === "bridge") newBlock = new Bridge(x, y, currentRotation);
            else if (currentTool === "switch") newBlock = new Switch(x, y);
            else if (currentTool === "button") newBlock = new Button(x, y);
            else if (currentTool === "powerBlock") newBlock = new PowerBlock(x, y, currentRotation);
            else if (currentTool === "delay") newBlock = new Delay(x, y, currentRotation);
            else if (currentTool === "hoverSensor") newBlock = new HoverSensor(x, y, currentRotation);
            else if (currentTool === "lamp") newBlock = new Lamp(x, y, currentRotation);
            else if (currentTool === "toggle") newBlock = new Toggle(x, y, currentRotation);
            else if (currentTool === "keyBlock") newBlock = new KeyBlock(x, y, currentRotation);
            else if (currentTool === "transmitter") newBlock = new Transmitter(x, y);
            else if (currentTool === "receiver") newBlock = new Receiver(x, y);
            else if (currentTool === "random") newBlock = new Random(x, y, currentRotation);
            else if (currentTool === "trigger") newBlock = new Trigger(x, y, currentRotation);
            else if (currentTool === "noteBlock") newBlock = new NoteBlock(x, y, currentRotation);
            else if (currentTool === "rotator") newBlock = new Rotator(x, y, currentRotation);
            else if (currentTool === "comment") newBlock = new Comment(x, y);

            if (newBlock) {
                grid[id] = newBlock;
                newBlock.update(); 
                newBlock.dirtyNeighbors();
                dirtyBlocks.add(id);
            }
        }
    }
}

function resizeGrid(newW, newH) {
    // Prevent shrinking to 0
    newW = Math.max(1, newW);
    newH = Math.max(1, newH);

    let newGrid = new Array(newW * newH).fill(null);
    
    grid.forEach((block) => {
        if (block && block.x < newW && block.y < newH) {
            const newId = block.y * newW + block.x;
            newGrid[newId] = block;
        }
    });

    gridWidth = newW;
    gridHeight = newH;
    grid = newGrid;
    cellSize = canvas.width / gridWidth;
    
    grid.forEach((b, i) => { if (b) dirtyBlocks.add(i); });
    
    render();
}

canvas.addEventListener("contextmenu", e => e.preventDefault());

function copySelection(isMove = false) {
    const xMin = Math.min(selection.x1, selection.x2);
    const xMax = Math.max(selection.x1, selection.x2);
    const yMin = Math.min(selection.y1, selection.y2);
    const yMax = Math.max(selection.y1, selection.y2);

    clipboard = [];
    for (let sy = yMin; sy <= yMax; sy++) {
        for (let sx = xMin; sx <= xMax; sx++) {
            const b = grid[sy * gridWidth + sx];
            if (b) {
                // Store a copy of the block data
                clipboard.push({ 
                    data: JSON.parse(JSON.stringify(b)), // Simplified deep copy
                    type: b.constructor.name,
                    dx: sx - xMin, 
                    dy: sy - yMin 
                });
                if (isMove) grid[sy * gridWidth + sx] = null;
            }
        }
    }
    selection = null; // Clear selection after action
    showFloatingUI();
    render();
}

function moveSelection() { copySelection(true); }

function showFloatingUI() {
    const ui = document.getElementById("selection-ui");
    if (!selection || isSelecting) {
        if (ui) ui.style.display = "none";
        return;
    }
    
    const xMin = Math.min(selection.x1, selection.x2);
    const yMin = Math.min(selection.y1, selection.y2);
    
    if (ui) {
        ui.style.display = "flex";
        // Position it relative to the canvas
        const rect = canvas.getBoundingClientRect();
        ui.style.left = (rect.left + xMin * cellSize) + "px";
        ui.style.top = (rect.top + yMin * cellSize - 45) + "px"; // 45px above
    }
}


function drawSelectionUI() {
    if (!selection) return;

    // Calculate bounds so dragging up/left still works
    const xMin = Math.min(selection.x1, selection.x2);
    const yMin = Math.min(selection.y1, selection.y2);
    const xMax = Math.max(selection.x1, selection.x2);
    const yMax = Math.max(selection.y1, selection.y2);

    const x = xMin * cellSize;
    const y = yMin * cellSize;
    const w = (xMax - xMin + 1) * cellSize;
    const h = (yMax - yMin + 1) * cellSize;

    // 1. Draw Dashed Selection Box
    ctx.strokeStyle = "#00ff00";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
}

function tick() {
    wirelessChannels = {};

    grid.forEach((block) => {
        if (block instanceof Transmitter) {
            block.update(); 
        }
    });

    grid.forEach((block, id) => {
        if (block instanceof Receiver) {
            dirtyBlocks.add(id);
        }
    });

    if (dirtyBlocks.size === 0) return;

    let toProcess = new Set(dirtyBlocks);
    dirtyBlocks.clear();

    // Components
    for (let id of toProcess) {
        const block = grid[id];
        if (block && !(block instanceof Wire)) {
            block.prepareNextTick();
            block.update();

            let changed = false;
            if (block instanceof Bridge) {
                changed = (block.powerH !== block.lastPowerH || block.powerV !== block.lastPowerV);
            } else {
                changed = (block.power !== block.lastPower);
            }

            if (changed) {
                block.dirtyNeighbors();
            }
        } else if (block instanceof Wire) {
            // Pass wires to Phase 2
            dirtyBlocks.add(id);
        }
    }

    // Wires
    let wireProcess = new Set(dirtyBlocks);
    for (let id of wireProcess) {
        const block = grid[id];
        if (block instanceof Wire) {
            block.prepareNextTick();
            block.update();
            if (block.power !== block.lastPower) {
                block.dirtyNeighbors();
            }
        }
    }
}

function render() {
    ctx.fillStyle = "#111"; // Background
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Grid Lines
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridWidth; i++) {
        ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(canvas.width, i * cellSize); ctx.stroke();
    }

    if (mouseInCanvas) {
        const gx = Math.floor(mouseX / cellSize);
        const gy = Math.floor(mouseY / cellSize);

        // Map your tool string (e.g., 'rotator') to the Class name
        const constructors = { 
            wire: Wire, inverter: Inverter, diode: Diode, bridge: Bridge, 
            switch: Switch, button: Button, lamp: Lamp, toggle: Toggle, 
            hoverSensor: HoverSensor, delay: Delay, keyBlock: KeyBlock, 
            transmitter: Transmitter, receiver: Receiver, random: Random, 
            trigger: Trigger, powerBlock: PowerBlock, comment: Comment,
            rotator: Rotator, noteBlock: NoteBlock
        };

        const PreviewClass = constructors[currentTool];
        if (PreviewClass) {
            // Create a fake block just for this frame
            const ghost = new PreviewClass(gx, gy, currentRotation);
            
            // Sync current UI attributes (Color, Channel, etc.)
            if (ghost.hasOwnProperty('color')) {
                ghost.color = document.getElementById("wire-color").value;
            }
            if (ghost.hasOwnProperty('rotation')) {
                ghost.rotation = currentRotation;
            }
            
            // Draw it at the mouse position with 'isPreview = true'
            ghost.render(gx * cellSize, gy * cellSize, true);
        }
    }

    // Draw blocks on top of ghost preview
    grid.forEach((block, i) => {
        if (block) {
            const bx = (i % gridWidth) * cellSize;
            const by = Math.floor(i / gridWidth) * cellSize;
            block.render(bx, by, false);
        }
    });

    // Paste preview
    if (clipboard && isPasting) {
        const gx = Math.floor(mouseX / cellSize);
        const gy = Math.floor(mouseY / cellSize);
        clipboard.forEach(entry => {
            const preview = new constructors[entry.type](gx + entry.dx, gy + entry.dy);
            Object.assign(preview, entry.data);
            preview.render((gx + entry.dx) * cellSize, (gy + entry.dy) * cellSize, true);
        });
    }

    drawSelectionUI();
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById("pause-btn").innerText = isPaused ? "Resume" : "Pause";
}

function changeTickRate() {
    tickRate = Math.max(1, Number(prompt('New tick rate:' )));
    document.getElementById('tickRateBtn').innerText = `Tick Rate: ${tickRate}`;
}

function step() {
    isPaused = true; // Ensure it's paused so it doesn't run away
    tick();
    render();
    document.getElementById("pause-btn").innerText = "Resume";
}

let lastTickTime = 0;

function frame(timestamp) {
    if (!isPaused && timestamp - lastTickTime >= 1000/tickRate) {
        tick();
        lastTickTime = timestamp;
    }

    render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);