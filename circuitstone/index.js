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
            else if (currentTool === "actuator") newBlock = new Actuator(x, y, currentRotation);
            else if (currentTool === "repulsor") newBlock = new Repulsor(x, y, currentRotation);
            else if (currentTool === "detector") newBlock = new Detector(x, y, currentRotation);
            else if (currentTool === "duplicator") newBlock = new Duplicator(x, y, currentRotation);
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

canvas.addEventListener("contextmenu", e => e.preventDefault());

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