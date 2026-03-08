// Tool Selection
document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelector('.tool.active').classList.remove('active');
        btn.classList.add('active');
        currentTool = btn.dataset.type;
    });
});

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
    else if (e.button === 0) {
        if (clipboard && isPasting) {
            // paste
            pasteAt(gx, gy);
            isPasting = false;
        } else if (selection) {
            // clear selection
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

    if (e.deltaY > 0) {
        currentRotation = (currentRotation + 1) % 4;
    } else {
        currentRotation = (currentRotation + 3) % 4;
    }
}, { passive: false });

function createBlockFromTool(tool, x, y) {
    const rot = currentRotation;
    switch (tool) {
        case "wire": return new Wire(x, y, 0, document.getElementById("wire-color").value);
        case "inverter": return new Inverter(x, y, rot);
        case "diode":    return new Diode(x, y, rot);
        case "bridge":   return new Bridge(x, y, rot);
        case "switch":   return new Switch(x, y);
        case "button":   return new Button(x, y);
        case "powerBlock": return new PowerBlock(x, y, rot);
        case "delay":    return new Delay(x, y, rot);
        case "hoverSensor": return new HoverSensor(x, y, rot);
        case "lamp":     return new Lamp(x, y, rot);
        case "toggle":   return new Toggle(x, y, rot);
        case "keyBlock": return new KeyBlock(x, y, rot);
        case "transmitter": return new Transmitter(x, y);
        case "receiver": return new Receiver(x, y);
        case "random":   return new Random(x, y, rot);
        case "trigger":  return new Trigger(x, y, rot);
        case "noteBlock": return new NoteBlock(x, y, rot);
        case "rotator":  return new Rotator(x, y, rot);
        case "actuator": return new Actuator(x, y, rot);
        case "repulsor": return new Repulsor(x, y, rot);
        case "detector": return new Detector(x, y, rot);
        case "duplicator": return new Duplicator(x, y, rot);
        case "comment":  return new Comment(x, y);
        default: return null;
    }
}

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

        if (typeof blockToDie.onDelete === 'function') {
            blockToDie.onDelete();
        }

        grid[id] = null;
        blockToDie.dirtyNeighbors();
    } 
    else if (dragButton === 0) { // Left click
        if (grid[id] !== null) {
            grid[id].interact(e);
        } else {
            // Placement Logic
            let newBlock = createBlockFromTool(currentTool, x, y);

            if (newBlock) {
                grid[id] = newBlock;
                // Important: Don't call update() manually here if it relies on snapshots.
                // Instead, ensure the next tick processes it.
                newBlock.dirtyNeighbors();
                dirtyBlocks.add(id);
            }
        }
    }
}

canvas.addEventListener("contextmenu", e => e.preventDefault());

function tick() {
    // 1. Reset volatile states
    wirelessChannels = {};

    // 1. Snapshot the state for Logic blocks (Gates, Delayers, etc.)
    const stateSnapshot = grid.map(b => b ? { power: b.power, rotation: b.rotation } : null);

    // 2. Logic Phase: Only non-wire blocks update based on the snapshot
    for (let block of grid) {
        if (!block || block.isWire) continue; // Skip wires for now
        block.readSnapshot = stateSnapshot;
        block.update(); 
    }

    // 3. Wire Propagation Phase: Wires update LIVE to allow instant travel
    // We run this multiple times per tick so power can travel across the whole grid
    let changed = true;
    let limit = 100; // Prevent infinite loops if you have a feedback bug
    while (changed && limit-- > 0) {
        changed = false;
        for (let block of grid) {
            if (block && block.isWire) {
                const oldPower = block.power;
                block.update(); // Wires read from live grid, not snapshot
                if (block.power !== oldPower) changed = true;
            }
        }
    }

    // 4. Commit Phase (Logic Cleanup)
    for (let block of grid) {
        if (!block) continue;
        block.lastPower = block.power;
        block.lastPowerH = block.powerH;
        block.lastPowerV = block.powerV;
        block.lastInput = block.input; // Corrected: Live input becomes lastInput
    }

    // 5. Physics/Movement Phase (Double Buffered Grid)
    let nextGrid = new Array(gridWidth * gridHeight).fill(null);
    for (let i = 0; i < grid.length; i++) {
        const block = grid[i];
        if (!block) continue;

        // Movement logic writes to 'nextGrid' to prevent double-processing
        if (block instanceof Rotator) block.applyRotation(nextGrid);
        else if (block instanceof Actuator) block.applyActuation(nextGrid);
        else if (block instanceof Duplicator) block.applyDuplication(nextGrid);
        else if (block instanceof Repulsor) block.applyRepulsion(nextGrid);
        else {
            // Keep block in place if no movement occurred
            if (!nextGrid[i]) nextGrid[i] = block;
        }
    }
    
    grid = nextGrid; // Finalize world state
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

        // Map tool string to the Class name
        const constructors = { 
            wire: Wire, inverter: Inverter, diode: Diode, bridge: Bridge, 
            switch: Switch, button: Button, lamp: Lamp, toggle: Toggle, 
            hoverSensor: HoverSensor, delay: Delay, keyBlock: KeyBlock, 
            transmitter: Transmitter, receiver: Receiver, random: Random, 
            trigger: Trigger, powerBlock: PowerBlock, comment: Comment,
            rotator: Rotator, noteBlock: NoteBlock, actuator: Actuator,
            repulsor: Repulsor, detector: Detector, duplicator: Duplicator
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
            // Show powered lamp to see the color before placing
            if (ghost.hasOwnProperty('power') && ghost instanceof Lamp) {
                ghost.power = 1;
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

let lastTickTime = 0;

function frame(timestamp) {
    while (!isPaused && timestamp - lastTickTime >= 1000/tickRate) {
        tick();
        lastTickTime = timestamp;
    }

    render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);