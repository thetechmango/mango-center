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
        
        this.neat = new NEAT(popSize, 8, 1); 
        const initialGenomes = this.neat.createInitialGenomes();
        
        this.agents = initialGenomes.map(brain => new Agent(brain));
    }

    evolve() {
        // Map agents to the format the engine expects
        const results = this.agents.map(a => {
            return {
                genome: a.brain,
                fitness: a.fitness // Use the fitness calculated in Agent.update()
            };
        });
    
        const nextGenBrains = this.neat.evolve(results);
        this.agents = nextGenBrains.map(brain => new Agent(brain));
    
        this.timer = 0;
        this.generation++;
    }    

    update() {
        this.timer++;
        this.agents.forEach(a => a.update());
        if (this.timer >= this.maxTime) this.evolve();
    }
}


export class Agent {
    constructor(brain) {
        this.brain = brain;
        this.reset();
    }

    reset() {
        this.x = window.innerWidth / 2;
        this.vx = 0;
        // Start both segments facing DOWN (Math.PI)
        this.th1 = Math.PI; 
        this.v1 = 0;
        this.th2 = Math.PI;
        this.v2 = 0;
        
        this.fitness = 0;
        this.consecutiveFramesUp = 0;
        this.dead = false;

        // Constants (Adjust for "feel")
        this.L1 = 60; this.L2 = 60; // Segment lengths
        this.m1 = 1.0; this.m2 = 1.0; // Masses
        this.g = -0.5; // Gravity
    }

    update() {
        if (this.dead) return;

        // 1. SENSORS: [th1, v1, th2, v2, x_rel, vx]
        // Using sin/cos for angles is better for "wrap-around" logic
        const inputs = [
            Math.sin(this.th1), Math.cos(this.th1), this.v1,
            Math.sin(this.th2), Math.cos(this.th2), this.v2,
            (this.x / window.innerWidth) - 0.5,
            this.vx / 10
        ];

        // 2. BRAIN: 1 Output for Cart Acceleration
        const [out] = this.brain.activate(inputs);
        const accel = (out - 0.5) * 2.0; // Map 0..1 to -1..1 force

        // 3. PHYSICS (Lagrangian acceleration)
        this.calculatePhysics(accel);

        const currentHeight = -(this.L1 * Math.cos(this.th1) + this.L2 * Math.cos(this.th2));
        const threshold = (this.L1 + this.L2) * 0.85;
        
        if (currentHeight < threshold) {
            this.consecutiveFramesUp++;
            
            // Reward scales with how LONG they stay there
            // This makes 'holding' worth way more than 'spinning'
            this.fitness += 100 + (this.consecutiveFramesUp * 100);
        
            // ADD A STABILITY BONUS: Reward low velocity while at the top
            const speed = Math.abs(this.v1) + Math.abs(this.v2);
            this.fitness += 10.0 / (1.0 + speed);
        } else {
            this.consecutiveFramesUp = 0; // Reset if they fall or spin out
            this.fitness += 0.01;
        }
    }

    calculatePhysics(brainOutputAccel) {
        let effectiveAccel = brainOutputAccel;
    
        // 1. Check if the cart is blocked by a wall
        const padding = 50;
        const leftWall = padding;
        const rightWall = window.innerWidth - padding;
    
        if (this.x <= leftWall && effectiveAccel < 0) {
            // Pushing LEFT into the LEFT wall
            this.x = leftWall;
            this.vx = 0;
            effectiveAccel = 0; // The wall pushes back, net acceleration is 0
        } else if (this.x >= rightWall && effectiveAccel > 0) {
            // Pushing RIGHT into the RIGHT wall
            this.x = rightWall;
            this.vx = 0;
            effectiveAccel = 0; // The wall pushes back, net acceleration is 0
        }
    
        // 2. NOW use effectiveAccel for the rest of the math
        const { g, m1, m2, L1, L2, th1, th2, v1, v2 } = this;
        const delta = th1 - th2;
    
        const M11 = (m1 + m2) * L1;
        const M12 = m2 * L2 * Math.cos(delta);
        const M21 = L1 * Math.cos(delta);
        const M22 = L2;
    
        // Use effectiveAccel here instead of the raw brainOutputAccel
        const rhs1 = -m2 * L2 * v2 * v2 * Math.sin(delta) - (m1 + m2) * g * Math.sin(th1) - (m1 + m2) * effectiveAccel * Math.cos(th1);
        const rhs2 = L1 * v1 * v1 * Math.sin(delta) - g * Math.sin(th2) - effectiveAccel * Math.cos(th2);
    
        const det = M11 * M22 - M12 * M21;
        if (Math.abs(det) < 0.001) return;
    
        const a1 = (rhs1 * M22 - rhs2 * M12) / det;
        const a2 = (M11 * rhs2 - M21 * rhs1) / det;
    
        // 3. Apply updates
        this.v1 += a1;
        this.v2 += a2;
        this.th1 += this.v1;
        this.th2 += this.v2;
    
        this.vx += effectiveAccel;
        this.x += this.vx;
    
        // Damping
        this.v1 *= 0.99;
        this.v2 *= 0.99;
        this.vx *= 0.95;
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

function drawAgent(a) {
    const cartY = window.innerHeight / 2;
    const isChampion = (a === world.agents[0]);
    
    // Draw Cart
    ctx.fillStyle = isChampion ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath(); ctx.arc(a.x, cartY, 20, 0, 7); ctx.fill();

    // Calculate Joint 1
    const x1 = a.x + Math.sin(a.th1) * a.L1;
    const y1 = cartY - Math.cos(a.th1) * a.L1;

    // Calculate Tip (Joint 2)
    const x2 = x1 + Math.sin(a.th2) * a.L2;
    const y2 = y1 - Math.cos(a.th2) * a.L2;

    // Draw Arms
    ctx.strokeStyle = isChampion ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, cartY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    // Draw Bobs
    ctx.fillStyle = isChampion ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 3, 0, 7); ctx.fill();
}

function render() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight); 

    world.agents.forEach(a => {
        if (a.dead) return;
        drawAgent(a);
    });

    const champion = world.agents[0];
    if (champion) {
        drawBrain(champion.brain, ctx, window.innerWidth - 220, 40, 160, 160);
    }
    drawStats();
}


const world = new World(100);

function loop() {
    const iterations = fastMode ? 100 : 1;
    
    for (let i = 0; i < iterations; i++) {
        world.update();
    }

    render();
    requestAnimationFrame(loop);
}
loop();