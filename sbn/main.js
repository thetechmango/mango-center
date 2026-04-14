let nodeCounter = 0;

class Network {
	constructor(numInputs, numOutputs, numCases) {
		this.bufferSize = Math.ceil(numCases / 8);
		this.inputs = Array.from({length: numInputs}, (_, i) => new Node(`in_${i}`, 'IN', this.bufferSize));
		// Create permanent OR gates as outputs
		this.outputs = Array.from({length: numOutputs}, (_, i) => new Node(`out_${i}`, 'OR', this.bufferSize));
		this.gates = [];
	}

	tick() {
		for (const gate of this.gates) gate.compute();
		for (const out of this.outputs) out.compute();

		let stable = true;
		for (const gate of this.gates) if (gate.commit()) stable = false;
		for (const out of this.outputs) if (out.commit()) stable = false;
		return stable;
	}

	run() {
		const maxTicks = Math.max(16, Math.ceil(this.gates.length * 1.2));

		for (let t = 0; t < maxTicks; t++) {
			if (this.tick()) return { stable: true, ticks: t };
		}
		return { stable: false, ticks: maxTicks };
	}

    calculateFitness(task, runResult) {
        if (this.outputs.length === 0) return 0;
    
        let correctBits = 0;
        const totalBits = task.numOutputs * task.numCases;
        let allOutputsConnected = true;
    
        this.outputs.forEach((node, i) => {
            // Track if any output is still orphaned
            if (node.inputs.length === 0) allOutputsConnected = false;
    
            const target = task.targets[i];
            for (let j = 0; j < node.buffer.length; j++) {
                let matches = ~(node.buffer[j] ^ target[j]) & 0xFF;
                const bitsRemaining = task.numCases - (j * 8);
                if (bitsRemaining < 8) {
                    const mask = (1 << bitsRemaining) - 1;
                    matches &= mask;
                }
                correctBits += countSetBits(matches);
            }
        });
    
        this.rawAccuracy = correctBits / totalBits;
        
        // If an output is disconnected, penalize the fitness heavily
        let fitness = allOutputsConnected ? this.rawAccuracy : this.rawAccuracy * 0.5;

		if (runResult.stable) {
			// Tiny bonus for finishing early
			const speedBonus = (32 - runResult.ticks) * 0.001;
			fitness += speedBonus;
		} else {
			fitness *= 0.1; // 90% penalty for being unstable
		}

		const gatePenalty = Math.max(0, (this.gates.length - 20) * 0.00001); 
		fitness *= (1 - gatePenalty);

		
        // Square it to make the difference between 90% and 100% huge
        return Math.pow(fitness, 2);
    }    

    setOutputs(gateIndices) {
		this.outputs = gateIndices.map(idx => this.gates[idx]);
	}

    clone() {
		const child = new Network(this.inputs.length, this.outputs.length, this.bufferSize * 8);
		const nodeMap = new Map();

		this.inputs.forEach((inp, i) => nodeMap.set(inp, child.inputs[i]));
		this.outputs.forEach((out, i) => nodeMap.set(out, child.outputs[i]));

		this.gates.forEach(gate => {
			const clonedGate = new Node(gate.id, gate.type, this.bufferSize);
			child.gates.push(clonedGate);
			nodeMap.set(gate, clonedGate);
		});

		[...this.gates, ...this.outputs].forEach(gate => {
			const clonedGate = nodeMap.get(gate);
			gate.inputs.forEach(origInp => {
				const newInp = nodeMap.get(origInp);
				if (newInp) clonedGate.inputs.push(newInp);
			});
		});

		return child;
	}

    mutateAddNode(availableTypes) {
        const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
        const newNode = new Node(`g_${nodeCounter++}`, type, this.bufferSize);
    
        // Pick ANY node that already has an input (Gates OR Outputs)
        const targets = [...this.gates, ...this.outputs].filter(n => n.inputs.length > 0);
        
        if (targets.length === 0) {
            // If nothing is connected yet, connect new node to a random input
            newNode.inputs.push(this.inputs[Math.floor(Math.random() * this.inputs.length)]);
            // And wire an output to THIS new node so it's not useless
            this.outputs[0].inputs = [newNode];
        } else {
            const target = targets[Math.floor(Math.random() * targets.length)];
            const inputIdx = Math.floor(Math.random() * target.inputs.length);
            
            // Insert newNode between the target and its old input
            newNode.inputs.push(target.inputs[inputIdx]);
            target.inputs[inputIdx] = newNode;
        }
        
        this.gates.push(newNode);
    }    

    mutateRemoveNode() {
		if (this.gates.length === 0) return;
		const gateIdx = Math.floor(Math.random() * this.gates.length);
		const gateToRemove = this.gates[gateIdx];

		// Find every gate that was using the removed gate as an input
		const allNodes = [...this.gates, ...this.outputs];
		for (const node of allNodes) {
			for (let i = 0; i < node.inputs.length; i++) {
				if (node.inputs[i] === gateToRemove) {
					// Replace the removed gate with one of ITS inputs (or a random input)
					node.inputs[i] = gateToRemove.inputs[0] || this.inputs[0];
				}
			}
		}
		this.gates.splice(gateIdx, 1);
	}

    mutateAddConnection() {
		const targets = [...this.gates, ...this.outputs];
		if (targets.length === 0) return;
		
		const target = targets[Math.floor(Math.random() * targets.length)];
		
		// Check against the constant instead of '2'
		if (target.inputs.length < maxGateInputs) {
			const sources = [...this.inputs, ...this.gates];
			const newIn = sources[Math.floor(Math.random() * sources.length)];
			
			// Added "!target.inputs.includes(newIn)" to prevent duplicate wires
			if (newIn !== target && !target.inputs.includes(newIn)) {
				target.inputs.push(newIn);
			}
		}
	}

    mutateRemoveConnection() {
		// Pick a gate that actually has inputs to remove
		const eligibleGates = [...this.gates, ...this.outputs].filter(g => g.inputs.length > 0);
		if (eligibleGates.length === 0) return;

		const gate = eligibleGates[Math.floor(Math.random() * eligibleGates.length)];
		
		// Remove a random input connection
		const inputIdx = Math.floor(Math.random() * gate.inputs.length);
		gate.inputs.splice(inputIdx, 1);
	}

    mutateChangeType(availableTypes) {
		if (this.gates.length === 0) return;
		const gate = this.gates[Math.floor(Math.random() * this.gates.length)];
		gate.type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
	}
}
  
class Node {
	constructor(id, type, bufferSize) {
		this.id = id;
		this.type = type; // 'AND', 'OR', 'XOR', 'NOR', 'BUF'
	    this.inputs = []; // Array of Node references
		this.buffer = new Uint8Array(bufferSize);
		this.next = new Uint8Array(bufferSize);
	}

    compute() {
		const size = this.buffer.length;
		
		// 1. Handle the "No Inputs" case (Constants)
		if (this.inputs.length === 0) {
			const val = (this.type === 'NOR') ? 0xFF : 0x00;
			this.next.fill(val);
			return;
		}
	
		// AND needs to start with 1s so it can be 'shaved down' by 0s
		// OR/XOR start with 0s so they can be 'built up' by 1s
		if (this.type === 'AND') {
			this.next.fill(0xFF);
		} else {
			this.next.fill(0x00);
		}
	
		for (const inputNode of this.inputs) {
			const b = inputNode.buffer;
			switch (this.type) {
				case 'AND':
					for (let i = 0; i < size; i++) this.next[i] &= b[i];
					break;
				case 'OR':
				case 'NOR': // Process NOR as OR first, flip at the end
					for (let i = 0; i < size; i++) this.next[i] |= b[i];
					break;
				case 'XOR':
					for (let i = 0; i < size; i++) this.next[i] ^= b[i];
					break;
			}
		}

		if (this.type === 'NOR') {
			for (let i = 0; i < size; i++) this.next[i] = (~this.next[i]) & 0xFF;
		}
	}

	commit() {
		let changed = false;
		for (let i = 0; i < this.buffer.length; i++) {
			if (this.buffer[i] !== this.next[i]) {
				this.buffer[i] = this.next[i];
				changed = true;
			}
		}
		return changed;
	}
}

class Task {
	constructor(logicFunction, numInputs, numOutputs) {
		this.logicFunction = logicFunction;
		this.numInputs = numInputs;
		this.numOutputs = numOutputs;
		this.numCases = Math.pow(2, numInputs);
		this.bufferSize = Math.ceil(this.numCases / 8);
		this.targets = this.generateTargets();
	}

	generateTargets() {
		const targets = Array.from({ length: this.numOutputs }, () => new Uint8Array(this.bufferSize));

		for (let i = 0; i < this.numCases; i++) {
			// Get the expected output array from your modular function
			const expected = this.logicFunction(i); 
			
			const byteIdx = Math.floor(i / 8);
			const bitIdx = i % 8;

			for (let outIdx = 0; outIdx < this.numOutputs; outIdx++) {
				if (expected[outIdx]) {
					targets[outIdx][byteIdx] |= (1 << bitIdx);
				}
			}
		}
		return targets;
	}
}


function seedInputs(inputs) {
    const size = inputs[0].buffer.length;
    inputs.forEach((node, inputIdx) => {   
        for (let byteIdx = 0; byteIdx < size; byteIdx++) {
            let byte = 0;
                for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
                    const caseIdx = byteIdx * 8 + bitIdx;
                    if ((caseIdx >> inputIdx) & 1) {
                        byte |= (1 << bitIdx);
                    }
                }
        node.buffer[byteIdx] = byte;
        }
    });
}

function countSetBits(n) {
	n = n - ((n >> 1) & 0x55);
	n = (n & 0x33) + ((n >> 2) & 0x33);
	return (((n + (n >> 4)) & 0x0F) * 0x01);
}

// Environment

const halfAdderLogic = (bits) => {
	const a = bits & 1;
	const b = (bits >> 1) & 1;
	return [a ^ b, a & b]; // XOR for Sum, AND for Carry
};

const fullAdderLogic = (bits) => {
    const a = bits & 1;
    const b = (bits >> 1) & 1;
    const cin = (bits >> 2) & 1;

    const sum = a ^ b ^ cin;
    const cout = (a & b) | (cin & (a ^ b));
    
    return [sum, cout];
};

const threeBitAdderLogic = (bits) => {
    const a = bits & 0b111;       // First 3 bits (0-7)
    const b = (bits >> 3) & 0b111; // Next 3 bits (0-7)
    const sum = a + b;            // Result (0-14)

    return [
        (sum >> 0) & 1, // S0
        (sum >> 1) & 1, // S1
        (sum >> 2) & 1, // S2
        (sum >> 3) & 1  // Cout
    ];
};

const multiplier2BitLogic = (bits) => {
    const a = bits & 0b0011;      // First 2 bits (0-3)
    const b = (bits >> 2) & 0b0011; // Next 2 bits (0-3)
    const product = a * b;

    return [
        (product >> 0) & 1, // P0
        (product >> 1) & 1, // P1
        (product >> 2) & 1, // P2
        (product >> 3) & 1  // P3
    ];
};

const task = new Task(threeBitAdderLogic, 6, 4);
console.log(`Task created: ${task.numCases} cases, buffer size: ${task.bufferSize} bytes`);

const net = new Network(task.numInputs, task.numOutputs, task.numCases);
seedInputs(net.inputs);

const gateTypes = ['AND', 'OR', 'XOR', 'NOR'];
const maxGateInputs = 2;

const populationSize = 1000;
const generationCount = 1000;
const survivorCount = Math.ceil(populationSize * 0.4);
const maxSimultaneousMutations = 10;

const mutationRarity = {
    addNode: 30,
    addConnection: 30,
    removeNode: 10,
    removeConnection: 10,
    changeType: 30,
	skip: 10
};

let population = Array.from({length: populationSize}, () => {
	const n = new Network(task.numInputs, task.numOutputs, task.numCases);
	// Start with a gate per output
	for(let i=0; i<task.numOutputs; i++) n.mutateAddNode(gateTypes);
	return n;
});

console.log("Starting evolution...");

for (let gen = 0; gen < generationCount; gen++) {
    population.forEach(net => {
        seedInputs(net.inputs);
        const result = net.run();
        net.fitness = net.calculateFitness(task, result);
    });

    population.sort((a, b) => b.fitness - a.fitness);
	
    console.log(`Gen ${gen}: Best Fitness: ${(population[0].rawAccuracy * 100).toFixed(2)}%`);

	if (population[0].rawAccuracy >= 1.0) {
        console.log("Perfect");
        break;
    }

    // Keep the best networks exactly as they are (Elitism)
    let nextGeneration = population.slice(0, survivorCount).map(s => s.clone());
    
    // Fill the rest of the population with mutated offspring
    while (nextGeneration.length < populationSize) {
        const parent = population[Math.floor(Math.random() * survivorCount)];
        const child = parent.clone();

		// Mutate multiple times at once per child
		const mutationCount = Math.floor(Math.random() * maxSimultaneousMutations) + 1; 

		for (let i = 0; i < mutationCount; i++) {
			const totalWeight = Object.values(mutationRarity).reduce((a, b) => a + b, 0);
			let r = Math.random() * totalWeight;
			let cumulative = 0;
	
			if (r < (cumulative += mutationRarity.addNode)) child.mutateAddNode(gateTypes);
			else if (r < (cumulative += mutationRarity.addConnection)) child.mutateAddConnection();
			else if (r < (cumulative += mutationRarity.removeNode)) child.mutateRemoveNode();
			else if (r < (cumulative += mutationRarity.removeConnection)) child.mutateRemoveConnection();
			else if (r < (cumulative += mutationRarity.changeType)) child.mutateChangeType(gateTypes);
			// Skip does nothing
		}
			
		nextGeneration.push(child);
    }
    
    population = nextGeneration;
}

console.log("Final Gate List:");
const best = population[0]; // The actual winner
best.gates.forEach(g => {
	console.log(`- ${g.id} (${g.type}) inputs: ${g.inputs.map(i => i.id).join(", ")}`);
});
best.outputs.forEach(o => {
	console.log(`- ${o.id} (${o.type}) inputs: ${o.inputs.map(i => i.id).join(", ")}`);
});
