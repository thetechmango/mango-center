class Block {
    constructor(x, y, rotation = 0) {
        this.x = x;
        this.y = y;
        this.rotation = rotation; // 0: Up, 1: Right, 2: Down, 3: Left
        this.power = 0;
        this.lastPower = 0;
        this.isWire = false;
    }

    update(neighbors) {}

    interact() {}

    getNeighborId(dir) {
        const nx = this.x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const ny = this.y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
    
        // Out of bounds
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) {
            return null;
        }
    
        return ny * gridWidth + nx;
    }    

    getNeighborState(dir) {
        const id = this.getNeighborId(dir);
        if (id === null || !this.readSnapshot) return null;
        return this.readSnapshot[id];
    }

    getNeighborPower(dir) {
        const id = this.getNeighborId(dir);
        if (id === null) return 0;
    
        const neighbor = grid[id];
        if (!neighbor) return 0;

        if (neighbor instanceof Bridge) {
            if (this.isWire) {
                const isAtOutputA = neighbor.rotation === (dir + 2) % 4;
                if (isAtOutputA && neighbor.powerH > 0) return neighbor.powerH;
    
                const isAtOutputB = ((neighbor.rotation + 1) % 4) === (dir + 2) % 4;
                if (isAtOutputB && neighbor.powerV > 0) return neighbor.powerV;
    
                return 0;
            }

            const snap = this.readSnapshot[id];
            if (!snap) return 0;
    
            const isAtOutputA = neighbor.rotation === (dir + 2) % 4;
            if (isAtOutputA && snap.powerH > 0) return snap.powerH;
    
            const isAtOutputB = ((neighbor.rotation + 1) % 4) === (dir + 2) % 4;
            if (isAtOutputB && snap.powerV > 0) return snap.powerV;
    
            return 0;
        }

        if (this.isWire) {
            return neighbor.power;
        }
    
        return this.readSnapshot[id] ? this.readSnapshot[id].power : 0;
    }

    prepareNextTick() {
        this.lastPower = this.power;
    }

    render(x, y, isPreview = false) {
        ctx.save();
        if (isPreview) ctx.globalAlpha = 0.5;
        
        ctx.translate(x + cellSize / 2, y + cellSize / 2);

        this.draw(ctx, cellSize);

        ctx.restore();
    }
}

class Wire extends Block {
    constructor(x, y, rotation = 0, color = "red") {
        super(x, y, rotation);
        this.color = color;
        this.isWire = true;
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
                    else if ((neighbor instanceof Switch || neighbor instanceof Button || neighbor instanceof HoverSensor) && neighbor.power > 0) {
                        foundPower = true;
                        break;
                    } 
                    else if (neighbor instanceof Diode || neighbor instanceof Inverter) {
                        const pointsAtThis = neighbor.rotation === (dir + 2) % 4;
                        if (neighbor.power > 0 && pointsAtThis) {
                            foundPower = true;
                            break;
                        }
                    }
                    else if (neighbor instanceof Delay) {
                        const pointsAtThis = neighbor.rotation === (dir + 2) % 4;
                        if (neighbor.history[neighbor.history.length - 1] > 0 && pointsAtThis) {
                            foundPower = true;
                            break;
                        }
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
            { id: this.getNeighborId(0), dx: 0, dy: -cellSize / 2 }, // Up
            { id: this.getNeighborId(1), dx: cellSize / 2, dy: 0 },  // Right
            { id: this.getNeighborId(2), dx: 0, dy: cellSize / 2 },  // Down
            { id: this.getNeighborId(3), dx: -cellSize / 2, dy: 0 }  // Left
        ];
    
        neighbors.forEach(({ id, dx, dy }) => {
            if (id === null) return;
    
            const neighbor = grid[id];
            if (!neighbor) return;
    
            const isWire = neighbor instanceof Wire;
            const connects = isWire && (
                this.color === "white" ||
                neighbor.color === "white" ||
                this.color === neighbor.color
            );
    
            const isComponent = !isWire && (this.color !== "black");
    
            if (connects || isComponent) {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(centerX + dx, centerY + dy);
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
    interact() {
        this.power = this.power === 1 ? 0 : 1;
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
    press() {
        this.power = 1;
    }

    release() {
        this.power = 0;
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
        const backDir = (this.rotation + 2) % 4;  // Lane A input
        const leftDir = (this.rotation + 3) % 4;  // Lane B input
    
        this.powerH = this.getNeighborPower(backDir);
        this.powerV = this.getNeighborPower(leftDir);
    }    

    draw() {
        const thick = cellSize * 0.2;
        const len = cellSize * 0.4;

        ctx.lineCap = "round";
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Base
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

        // Lane A
        ctx.strokeStyle = this.powerH ? "#ff4d4d" : "#441111";
        ctx.lineWidth = thick;
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();

        // Lane A arrow
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

        // Lane B
        ctx.strokeStyle = this.powerV ? "#ff4d4d" : "#441111";
        ctx.beginPath();
        ctx.moveTo(0, -len);
        ctx.lineTo(0, len);
        ctx.stroke();

        // Lane B arrow
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

    update() {
        this.power = this.getNeighborPower((this.rotation + 2) % 4) > 0 ? 1 : 0;
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
        this.input = 0;     // Current tick input
        this.lastInput = 0; // Previous tick input
    }

    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;

        if (this.lastInput === 0 && this.input === 1) {
            this.state = this.state ? 0 : 1;
        }

        this.power = this.state ? 100 : 0;
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

    update() {}

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
    
        // Indicator ring
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
    }

    update() {
        const inputDir = (this.rotation + 2) % 4;
        this.inputPower = this.getNeighborPower(inputDir);

        this.history.unshift(this.inputPower);
        this.power = this.history.pop();
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
        
        // Listen for the next key press
        const listener = (e) => {
            e.preventDefault();
            this.targetKey = e.key.toUpperCase();
            this.isBinding = false;
            window.removeEventListener("keydown", listener);
            render();
        };
        window.addEventListener("keydown", listener);
    }

    update() {
        // Check if its specific key is currently held down in your global keys set
        const isPressed = keysDown.has(this.targetKey) || keysDown.has(this.targetKey.toLowerCase());
        this.power = isPressed ? 1 : 0;
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
    update() {
        this.power = 0;
        for (let dir = 0; dir < 4; dir++) {
            if (this.getNeighborPower(dir) === 1) {
                this.power = 1;
                break;
            }
        }
    }

    draw() {
        ctx.save();
    
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        ctx.strokeStyle = this.power ? "#ff4d4d" : "#441111";
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
        this.power = wirelessChannels[this.channel] || 0;
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
        // Trigger on rising edge
        if (this.lastInput === 0 && this.inputPower === 1) {
            this.power = Math.random() > 0.5 ? 1 : 0;
        }
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
        this.input = 0;
        this.lastInput = 0;
    }

    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;

        if (this.input === 1 && this.lastInput === 0) {
            this.power = 1;
        } else {
            this.power = 0;
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
        
        ctx.fillStyle = colorMap[this.color] || "ff4d4d";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();
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
        this.noteIndex = (this.noteIndex + step + 49) % 49; // 4 octaves (0–48)
        
        // Brief preview: Play and then stop after 300ms
        this.startSound();
        setTimeout(() => this.stopSound(), 300);
        render();
    }

    onDelete() {
        this.stopSound();
    }    

    update() {
        const backDir = (this.rotation + 2) % 4;
        const currentInput = this.getNeighborPower(backDir) > 0 ? 1 : 0;
    
        if (currentInput === 1 && this.lastInput === 0) {
            this.startSound();
        } 
        else if (currentInput === 0 && this.lastInput === 1) {
            this.stopSound();
        }
    
        this.power = currentInput ? 100 : 0;
        this.input = currentInput;
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
        this.isCCW = false; 
        this.input = 0;
        this.lastInput = 0;
        this.triggered = false; // Flag for Phase 5
    }

    interact() {
        this.isCCW = !this.isCCW;
    }

    // Phase 3: Logic Update
    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;

        // Detect Rising Edge
        if (this.input === 1 && this.lastInput === 0) {
            this.triggered = true;
        }

        this.power = this.input ? 1 : 0;
    }

    applyRotation() {
        if (this.triggered) {
            // Find the block directly in front of the Rotator in the live grid
            const id = this.getNeighborId(this.rotation);
            const target = id !== null ? grid[id] : null;
            
            if (target && typeof target.rotation !== 'undefined') {
                const step = this.isCCW ? -1 : 1;
                // Rotate the live block
                target.rotation = (target.rotation + step + 4) % 4;
            }
            this.triggered = false; // Reset
        }
        
        // Update lastInput for the next tick's edge detection
        this.lastInput = this.input;
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

class Actuator extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.reverse = false;
        this.input = 0;
        this.lastInput = 0;
        this.triggered = false;
    }

    interact() {
        this.reverse = !this.reverse;
    }

    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;

        if (this.input === 1 && this.lastInput === 0) {
            this.triggered = true;
        }

        this.power = this.input;
    }

    applyActuation() {
        if (this.triggered) {
            const id = this.getNeighborId(this.rotation);
            const target = id !== null ? grid[id] : null;
            if (target && typeof target.interact === "function") {
                target.interact({ shiftKey: this.reverse });
            }
            this.triggered = false; // Reset
        }
        
        this.lastInput = this.input;
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        if (this.reverse) {
            ctx.strokeStyle = this.power ? "#4d4dff" : "#111144";
        } else {
            ctx.strokeStyle = this.power ? "#4dff4d" : "#114411";
        }
        
        ctx.lineWidth = cellSize * 0.1;
        ctx.lineCap = "round";
        
        const startAngle = -Math.PI / 2 + Math.PI / 4;
        const endAngle = Math.PI / 2 - Math.PI / 4;
    
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 0.25, startAngle, endAngle);
        ctx.stroke();

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

class Repulsor extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.input = 0;
        this.lastInput = 0;
    }

    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;
        this.power = this.input;
    }

    applyRepulsion() {
        if (this.input === 1 && this.lastInput === 0) {
            this.executePush();
        }

        this.lastInput = this.input;
    }

    executePush() {
        const dx = (this.rotation === 1 ? 1 : this.rotation === 3 ? -1 : 0);
        const dy = (this.rotation === 2 ? 1 : this.rotation === 0 ? -1 : 0);

        let chain = [];
        let cx = this.x + dx;
        let cy = this.y + dy;

        while (cx >= 0 && cx < gridWidth && cy >= 0 && cy < gridHeight) {
            const idx = cy * gridWidth + cx;
            const block = grid[idx];
            if (!block) break; // Found empty space
            chain.push({ block, x: cx, y: cy });
            cx += dx;
            cy += dy;
        }

        // If the space at the end of the chain is out of bounds or occupied, abort
        if (cx < 0 || cx >= gridWidth || cy < 0 || cy >= gridHeight || grid[cy * gridWidth + cx]) return;

        for (let i = chain.length - 1; i >= 0; i--) {
            const { block, x, y } = chain[i];
            const newX = x + dx;
            const newY = y + dy;

            grid[y * gridWidth + x] = null; // Clear old spot
            grid[newY * gridWidth + newX] = block; // Occupy new spot
            
            block.x = newX;
            block.y = newY;
        }
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        // Arrow
        ctx.fillStyle = this.power ? "#4d4dff" : "#111144";
        ctx.beginPath();
        ctx.moveTo(cellSize * 0.2, 0);
        ctx.lineTo(-cellSize * 0.1, -cellSize * 0.22);
        ctx.lineTo(-cellSize * 0.1, cellSize * 0.22);
        ctx.fill();

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

class Detector extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
    }

    update() {
        const target = this.getNeighborState(this.rotation);
        const hasBlock = target ? 1 : 0;

        this.power = hasBlock;
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        // Sensor icon (eyes)
        ctx.fillStyle = this.power ? "#ffff4d" : "#444411";
        ctx.beginPath();
        ctx.arc(cellSize * 0.2, cellSize * 0.2, cellSize * 0.15, 0, Math.PI * 2);
        ctx.arc(cellSize * 0.2, cellSize * -0.2, cellSize * 0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class Duplicator extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.input = 0;
        this.lastInput = 0;
        this.triggered = false;
    }

    update() {
        // Read from Snapshot for consistent timing
        const leftPower = this.getNeighborPower((this.rotation + 3) % 4);
        const rightPower = this.getNeighborPower((this.rotation + 1) % 4);
        
        this.input = (leftPower > 0 || rightPower > 0) ? 1 : 0;

        // Detect Rising Edge
        if (this.input === 1 && this.lastInput === 0) {
            this.triggered = true;
        }

        this.power = this.input ? 100 : 0;
    }

    applyDuplication() {
        if (this.triggered) {
            this.executeDuplicate();
            this.triggered = false; // Reset
        }
        
        // Update lastInput for the next tick's edge detection
        this.lastInput = this.input;
    }

    executeDuplicate() {
        const dx = (this.rotation === 1 ? 1 : this.rotation === 3 ? -1 : 0);
        const dy = (this.rotation === 2 ? 1 : this.rotation === 0 ? -1 : 0);

        // Back (Source) and Front (Destination)
        const bx = this.x - dx, by = this.y - dy;
        const fx = this.x + dx, fy = this.y + dy;

        // Bounds Check
        if (bx < 0 || bx >= gridWidth || by < 0 || by >= gridHeight) return;
        if (fx < 0 || fx >= gridWidth || fy < 0 || fy >= gridHeight) return;

        const source = grid[by * gridWidth + bx];
        const frontIdx = fy * gridWidth + fx;

        // 1. If no block behind → delete the block in front
        if (!source) {
            grid[frontIdx] = null;
            return;
        }

        // 2. Clone the source block (Direct Live Creation)
        const newBlock = new source.constructor(fx, fy, source.rotation);

        // Copy properties (Primitives and deep clones where possible)
        for (let key of Object.keys(source)) {
            if (key === "x" || key === "y") continue;
            try {
                newBlock[key] = structuredClone(source[key]);
            } catch {
                newBlock[key] = source[key];
            }
        }

        // 3. Place into the LIVE grid
        grid[frontIdx] = newBlock;
    }

    draw() {
        ctx.save();
        ctx.rotate((this.rotation - 1) * Math.PI / 2);

        // Base
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.roundRect(-cellSize/2, -cellSize/2, cellSize, cellSize, cellSize * 0.15);
        ctx.fill();

        
        ctx.fillStyle = this.power ? "#4d4dff" : "#111144";

        // Back square
        ctx.beginPath();
        ctx.roundRect(-cellSize*0.35, -cellSize*0.15, cellSize*0.3, cellSize*0.3, cellSize*0.05);
        ctx.fill();

        // Front square rotated 45°
        ctx.save();
        ctx.translate(cellSize*0.2, 0);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.roundRect(-cellSize*0.12, -cellSize*0.12, cellSize*0.24, cellSize*0.24, cellSize*0.04);
        ctx.fill();
        ctx.restore();

        // Side input indicators
        const inputColor = this.lastInput ? "#ff4d4d" : "#441111";
        ctx.fillStyle = inputColor;

        ctx.fillStyle = inputColor;
        ctx.beginPath();
        ctx.moveTo(0, -cellSize*0.5 + cellSize*0.2);   // tip
        ctx.lineTo(-cellSize*0.15, -cellSize*0.5);     // top-left
        ctx.lineTo(cellSize*0.15, -cellSize*0.5);      // top-right
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, cellSize*0.5 - cellSize*0.2);    // tip
        ctx.lineTo(-cellSize*0.15, cellSize*0.5);      // bottom-left
        ctx.lineTo(cellSize*0.15, cellSize*0.5);       // bottom-right
        ctx.fill();

        ctx.restore();
    }
}

class Extender extends Block {
    constructor(x, y, rotation = 0) {
        super(x, y, rotation);
        this.input = 0;
        this.tail = 0;
    }

    update() {
        const backDir = (this.rotation + 2) % 4;
        this.input = this.getNeighborPower(backDir) > 0 ? 1 : 0;

        if (this.input === 1) {
            // Input ON → reset to full 2-tick extension
            this.tail = 2;
        } else if (this.tail > 0) {
            // Input OFF → decay
            this.tail--;
        }

        this.power = (this.input === 1 || this.tail > 0) ? 1 : 0;
    }

    draw() {
        const baseSize = cellSize * 0.5;

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
    
        ctx.save();
        ctx.rotate(Math.PI / 4); // rotate 45 degrees

        // Diamond indicator
        const inner = baseSize * 0.55;
        ctx.fillStyle = this.power ? "#ff4d4d" : "#441111";
    
        ctx.beginPath();
        ctx.rect(-inner, -inner, inner * 2, inner * 2);
        ctx.fill();
    
        ctx.restore();

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