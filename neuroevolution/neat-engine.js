
export class Connection {
    constructor(from, to, weight) {
        this.from = from;
        this.to = to;
        this.weight = weight;
        this.enabled = true;
    }
}

export class Genome {
    constructor(inputCount, outputCount) {
        this.inputCount = inputCount;
        this.outputCount = outputCount;
        this.nodes = [];
        this.connections = [];

        // 1. Create Nodes
        for (let i = 0; i < inputCount; i++) this.nodes.push({ id: i, type: 'input', value: 0 });
        for (let i = 0; i < outputCount; i++) this.nodes.push({ id: i + inputCount, type: 'output', value: 0 });

        // 2. Initial Random Wiring (Input -> Output)
        this.nodes.filter(n => n.type === 'input').forEach(inp => {
            this.nodes.filter(n => n.type === 'output').forEach(out => {
                this.connections.push(new Connection(inp.id, out.id, Math.random() * 2 - 1));
            });
        });
    }

    activate(inputs) {
        this.nodes.forEach(n => n.value = 0);
        inputs.forEach((val, i) => this.nodes[i].value = val);
    
        // Loop through connections 2-3 times to allow signal to flow through hidden nodes
        for(let i = 0; i < 2; i++) { 
            this.connections.forEach(c => {
                if (!c.enabled) return;
                const from = this.nodes.find(n => n.id === c.from);
                const to = this.nodes.find(n => n.id === c.to);
                to.value += from.value * c.weight;
            });
        }
    
        return this.nodes.filter(n => n.type === 'output')
                         .map(n => 1 / (1 + Math.exp(-n.value)));
    }    

    mutate() {
        this.connections.forEach(c => {
            if (Math.random() < 0.8) c.weight += (Math.random() * 2 - 1) * 0.1;
        });
    
        if (Math.random() < 0.1) { // 10% chance to add node
            this.addNodeMutation();
        }
        if (Math.random() < 0.1) { // 10% chance to add a new connection
            this.addConnectionMutation();
        }
    }
    
    addNodeMutation() {
        if (this.connections.length === 0) return;
    
        // 1. Pick a random ENABLED connection to split
        const enabledConns = this.connections.filter(c => c.enabled);
        if (enabledConns.length === 0) return;
        const oldConn = enabledConns[Math.floor(Math.random() * enabledConns.length)];
        oldConn.enabled = false;
    
        // 2. Create a new Hidden Node
        const newNodeId = this.nodes.length;
        this.nodes.push({ id: newNodeId, type: 'hidden', value: 0 });
    
        // 3. Add two new connections to bridge the gap
        // Connection A: From start to new node (Weight 1.0 so behavior doesn't break)
        this.connections.push(new Connection(oldConn.from, newNodeId, 1.0));
        
        // Connection B: From new node to end (Weight = old connection's weight)
        this.connections.push(new Connection(newNodeId, oldConn.to, oldConn.weight));
    }  
    
    addConnectionMutation() {
        let nodeA = this.nodes[Math.floor(Math.random() * this.nodes.length)];
        let nodeB = this.nodes[Math.floor(Math.random() * this.nodes.length)];
    
        // Don't connect to self, and don't connect output back to input
        if (nodeA.id === nodeB.id || nodeA.type === 'output' || nodeB.type === 'input') return;
    
        // Check if connection already exists
        if (this.connections.find(c => c.from === nodeA.id && c.to === nodeB.id)) return;
    
        this.connections.push(new Connection(nodeA.id, nodeB.id, Math.random() * 2 - 1));
    }    

    clone() {
        // 1. Create a blank genome with the same counts
        const copy = new Genome(this.inputCount, this.outputCount);
        
        // 2. Overwrite the nodes to preserve any 'hidden' nodes from the parent
        // This ensures hidden nodes carry over and IDs match connections
        copy.nodes = this.nodes.map(n => ({...n}));
        
        // 3. Clear and copy the specific connections
        copy.connections = this.connections.map(c => {
            let conn = new Connection(c.from, c.to, c.weight);
            conn.enabled = c.enabled; // Important to preserve disabled links
            return conn;
        });
        
        return copy;
    }    
}

export class NEAT {
    constructor(popSize, inputCount, outputCount) {
        this.popSize = popSize;
        this.inputs = inputCount;
        this.outputs = outputCount;
    }

    // EXPOSED: Create the first generation of brains
    createInitialGenomes() {
        return Array.from({ length: this.popSize }, () => new Genome(this.inputs, this.outputs));
    }

    // EXPOSED: Turn a list of {genome, fitness} into a new generation of genomes
    evolve(results) {
        // results = [{genome: Genome, fitness: number}, ...]
        results.sort((a, b) => b.fitness - a.fitness);

        const elites = results.slice(0, Math.floor(this.popSize * 0.2));
        const nextGen = [];

        // Keep Elites
        elites.forEach(e => nextGen.push(e.genome.clone()));

        // Fill rest with mutated clones
        while (nextGen.length < this.popSize) {
            const parent = elites[Math.floor(Math.random() * elites.length)];
            const child = parent.genome.clone();
            child.mutate();
            nextGen.push(child);
        }

        return nextGen;
    }
}