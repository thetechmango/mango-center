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
            lastInput: block.lastInput,
            power: block.power,
            state: block.state ?? 0,
            channel: block.channel,
            delayAmount: block.delayAmount,
            targetKey: block.targetKey,
            noteIndex: block.noteIndex,
            text: block.text,
            isCCW: block.isCCW,
            reverse: block.reverse
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
            NoteBlock, Comment, Rotator, Actuator, Repulsor,
            Detector, Duplicator
        };

        parsed.data.forEach((b) => {
            if (!b) return;
            
            const BlockClass = constructors[b.type];
            if (BlockClass) {
                const newBlock = new BlockClass(b.x, b.y, b.rotation);
                newBlock.power = b.power || 0;
                newBlock.lastInput = b.lastInput || 0;
                
                if (b.color) newBlock.color = b.color;
                if (b.state !== undefined) newBlock.state = b.state;
                if (b.channel !== undefined) newBlock.channel = b.channel;
                if (b.targetKey !== undefined) newBlock.targetKey = b.targetKey;
                if (b.delayAmount !== undefined) {
                    newBlock.delayAmount = b.delayAmount;
                    newBlock.history = new Array(b.delayAmount).fill(0);
                }
                if (b.noteIndex !== undefined) newBlock.noteIndex = b.noteIndex;
                
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
    const octave = Math.floor(index / 12) + 3;
    const name = NOTE_NAMES[index % 12];
    const freq = 261.63 * Math.pow(2, (index - 12) / 12); // Base C3
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