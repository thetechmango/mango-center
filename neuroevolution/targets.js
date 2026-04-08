import { NEAT, Genome, Connection } from './neat-engine.js';

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resize);
resize();

let fastMode = false;

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        fastMode = !fastMode;
        console.log("Fast Mode:", fastMode ? "ON" : "OFF");
    }
});

class World {
    constructor(popSize) {
        this.popSize = popSize;
        this.timer = 0;
        this.maxTime = 1000;
        this.generation = 1;
        
        // Use the engine to manage the population
        this.neat = new NEAT(popSize, 6, 2); 
        const initialGenomes = this.neat.createInitialGenomes();
        
        this.agents = initialGenomes.map(brain => 
            new Agent(window.innerWidth/2, window.innerHeight/2, brain)
        );
    }

    evolve() {
        // 1. Map agents to the format the engine expects
        const results = this.agents.map(a => {
            const d = Math.sqrt((a.x - a.target.x)**2 + (a.y - a.target.y)**2);
            return {
                genome: a.brain,
                fitness: (a.score * 1000) + (1 - d / 2000)
            };
        });

        // 2. Let the engine handle the selection and mutation
        const nextGenBrains = this.neat.evolve(results);

        // 3. Re-spawn agents with the new brains
        this.agents = nextGenBrains.map(brain => 
            new Agent(window.innerWidth/2, window.innerHeight/2, brain)
        );

        this.timer = 0;
        this.generation++;
    }

    update() {
        this.timer++;
        this.agents.forEach(a => a.update());
        if (this.timer >= this.maxTime) this.evolve();
    }
}

class Agent {
    constructor(x, y, brain) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.angle = Math.random() * Math.PI * 2;
        this.score = 0;
        this.fitness = 0;
        this.target = { x: 0, y: 0 };
        this.brain = brain;
        this.spawnTarget();
    }

    update() {
        // 1. Get current "Point of View"
        const inputs = this.getSensors(canvas);
        
        // 2. Brain decides: [thrust, steer]
        const [thrust, steer] = this.brain.activate(inputs);
    
        // 3. Move based on brain output
        // Map steer 0..1 to -0.1..0.1 radians
        const steerForce = (steer - 0.5) * 0.2;
        this.angle += steerForce;
        this.angularVel = steerForce; // Track spin for next sensor update
    
        // Apply thrust in the direction we are facing
        this.vx += Math.cos(this.angle) * thrust * 0.5;
        this.vy += Math.sin(this.angle) * thrust * 0.5;
    
        // Friction and Position Update
        this.vx *= 0.95;
        this.vy *= 0.95;
        this.x += this.vx;
        this.y += this.vy;
    
        // 4. Check for Food
        const d = Math.sqrt((this.x - this.target.x)**2 + (this.y - this.target.y)**2);
        if (d < 15) {
            this.score++;
            this.spawnTarget();
        }
    }
    

    spawnTarget() {
        const radius = 300;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius + 100; // Min distance 100, max 400
    
        this.target.x = this.x + Math.cos(angle) * dist;
        this.target.y = this.y + Math.sin(angle) * dist;
    }
    
    getSensors() {
        // 1. Vector to Target (Relative Position)
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / (dist || 1); // Unit vector to target
        const uy = dy / (dist || 1);
    
        // 2. Agent's Local Orientation Vectors
        const fwdX = Math.cos(this.angle);
        const fwdY = Math.sin(this.angle);
        const rightX = -fwdY; // Perpendicular vector
        const rightY = fwdX;
    
        // 3. Dot Products (The "Relative" View)
        const fwdDot = (ux * fwdX) + (uy * fwdY);     // Food in front/behind [-1, 1]
        const sideDot = (ux * rightX) + (uy * rightY); // Food to left/right [-1, 1]
    
        // 4. Local Velocity (Project current velocity onto local vectors)
        const vFwd = (this.vx * fwdX) + (this.vy * fwdY);
        const vSide = (this.vx * rightX) + (this.vy * rightY);
    
        // 5. Normalize everything to [-1, 1] for stable AI
        const maxDiag = Math.sqrt(canvas.width**2 + canvas.height**2);
        
        return [
            fwdDot,                // Is target in front?
            sideDot,               // Is target right?
            dist / maxDiag,        // How far is target?
            vFwd / 5,              // Forward speed (scaled)
            vSide / 5,             // Sliding speed (scaled)
            this.angularVel || 0   // Current spin speed
        ];
    }    

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = 'white';
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
    }
}

function calculateLayers(brain) { // Pass the brain in
    const layers = new Map();
    const maxDepth = new Map();

    brain.nodes.forEach(n => {
        if (n.type === 'input') maxDepth.set(n.id, 0);
        else maxDepth.set(n.id, -1);
    });

    for (let i = 0; i < brain.nodes.length; i++) {
        brain.connections.forEach(c => {
            if (!c.enabled) return;
            const fromDepth = maxDepth.get(c.from);
            if (fromDepth !== -1) {
                maxDepth.set(c.to, Math.max(maxDepth.get(c.to), fromDepth + 1));
            }
        });
    }

    let highestDepth = 0;
    brain.nodes.forEach(n => {
        if (n.type !== 'output') highestDepth = Math.max(highestDepth, maxDepth.get(n.id));
    });
    const finalColumn = highestDepth + 1;

    brain.nodes.forEach(n => {
        if (n.type === 'input') layers.set(n.id, 0);
        else if (n.type === 'output') layers.set(n.id, 1);
        else {
            const d = maxDepth.get(n.id);
            layers.set(n.id, d === -1 ? 0.5 : d / finalColumn);
        }
    });

    return layers;
}

function drawBrain(brain, ctx, x, y, width, height) {
    const nodeCoords = new Map();
    const nodeRadius = 10;
    const layers = calculateLayers(brain); // Pass it here too

    const padding = 20;
    const innerWidth = width - (padding * 2);

    const nodesByLayer = {};
    brain.nodes.forEach(n => {
        const l = layers.get(n.id);
        if (!nodesByLayer[l]) nodesByLayer[l] = [];
        nodesByLayer[l].push(n);
    });

    const sortedLayerKeys = Object.keys(nodesByLayer).sort((a, b) => a - b);
    
    sortedLayerKeys.forEach(lKey => {
        const layerX = x + padding + (parseFloat(lKey) * innerWidth);
        const layerNodes = nodesByLayer[lKey];
        layerNodes.forEach((node, i) => {
            const layerY = y + (height / (layerNodes.length + 1)) * (i + 1);
            nodeCoords.set(node.id, { x: layerX, y: layerY });
        });
    });

    // Draw Connections
    brain.connections.forEach(conn => {
        if (!conn.enabled) return;
        const from = nodeCoords.get(conn.from);
        const to = nodeCoords.get(conn.to);
        ctx.strokeStyle = conn.weight > 0 ? 'rgba(0, 255, 0, 0.6)' : 'rgba(255, 0, 0, 0.6)';
        ctx.lineWidth = Math.abs(conn.weight) * 3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    });

    // Draw Nodes
    brain.nodes.forEach(node => {
        const coords = nodeCoords.get(node.id);
        const alpha = Math.max(0.2, node.value); 
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "white";
        ctx.stroke();
    });
}

function drawStats() {
    ctx.fillStyle = "white";
    ctx.font = "16px monospace";
    ctx.fillText(`Generation: ${world.generation}`, 20, 30);
    ctx.fillText(`Timer: ${world.timer} / ${world.maxTime}`, 20, 50);
    ctx.fillText(`Fast Mode: ${fastMode ? "ON (100x)" : "OFF"}`, 20, 70);
    ctx.fillText(`Best Score: ${world.agents[0].score}`, 20, 90);
}



function render() {
    const champion = world.agents[0];
    
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.save();
    // Folow champion
    ctx.translate(window.innerWidth / 2 - champion.x, window.innerHeight / 2 - champion.y);

    // --- DRAW FAINT GRID ---
    const gridSize = 100;
    const viewLeft = champion.x - window.innerWidth / 2;
    const viewTop = champion.y - window.innerHeight / 2;
    const viewRight = champion.x + window.innerWidth / 2;
    const viewBottom = champion.y + window.innerHeight / 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; // Very faint white
    ctx.lineWidth = 1;
    ctx.beginPath();

    // Vertical lines
    for (let x = Math.floor(viewLeft / gridSize) * gridSize; x <= viewRight; x += gridSize) {
        ctx.moveTo(x, viewTop);
        ctx.lineTo(x, viewBottom);
    }

    // Horizontal lines
    for (let y = Math.floor(viewTop / gridSize) * gridSize; y <= viewBottom; y += gridSize) {
        ctx.moveTo(viewLeft, y);
        ctx.lineTo(viewRight, y);
    }
    ctx.stroke();

    // Draw everything relative to the camera
    world.agents.forEach(a => {
        const isChampion = (a === champion);
        
        // Draw target line
        ctx.strokeStyle = isChampion ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.target.x, a.target.y);
        ctx.stroke();

        // Draw individual target
        ctx.fillStyle = isChampion ? '#ff0000' : 'rgba(255, 0, 0, 0.2)';
        ctx.beginPath(); ctx.arc(a.target.x, a.target.y, 6, 0, Math.PI * 2); ctx.fill();

        // Draw Agent
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);
        ctx.fillStyle = isChampion ? '#00ff00' : 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
    });

    ctx.restore();

    if (champion && champion.brain) {
        // Draw in a box at the top-right
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(window.innerWidth - 250, 20, 225, 225);
        drawBrain(champion.brain, ctx, window.innerWidth - 250, 30, 225, 225);
        
        ctx.fillStyle = "white";
        ctx.fillText("Champion Brain", window.innerWidth - 200, 45);
    }

    drawStats();
}

const world = new World(50);

function loop() {
    const iterations = fastMode ? 100 : 1;
    
    for (let i = 0; i < iterations; i++) {
        world.update();
    }

    render();
    requestAnimationFrame(loop);
}
loop();