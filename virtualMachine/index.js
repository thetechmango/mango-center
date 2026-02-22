const memory = new Uint8Array(256);
const registers = new Uint8Array(8);
let pc = 0; // Program counter
let ZF = 0; // Zero flag
let interval;

const OPCODES = {
    LOAD:  0x10,
    LOADM: 0x11,
    STORE: 0x12,

    ADD: 0x20,
    SUB: 0x21,
    MUL: 0x22,
    DIV: 0x23,
    AND: 0x24,
    OR:  0x25,
    XOR: 0x26,
    NOT: 0x27,

    JMP: 0x30,
    JZ:  0x31,
    JNZ: 0x32,
    CMP: 0x33,

    PRINT: 0x40,
    HALT:  0xFF
};


function assemble(source) {
    const lines = source.trim().split("\n");

    const labels = {};
    const output = [];

    // Collect labels
    let pc = 0; // program counter for assembly

    for (let raw of lines) {
        let line = raw.trim();
        if (line === "" || line.startsWith(";")) continue;

        // Label definition
        if (line.endsWith(":")) {
            const name = line.slice(0, -1);
            labels[name] = pc;
            continue;
        }

        // Instruction → increase pc by instruction size
        const parts = line.split(/[\s,]+/);
        const instr = parts[0].toUpperCase();

        if (instr === "LOAD") pc += 3;
        else if (instr === "LOADM") pc += 3;
        else if (instr === "STORE") pc += 3;
        else if (["ADD","SUB","MUL","DIV","AND","OR","XOR","CMP"].includes(instr)) pc += 3;
        else if (["NOT","PRINT"].includes(instr)) pc += 2;
        else if (["JMP","JZ","JNZ"].includes(instr)) pc += 2;
        else if (instr === "HALT") pc += 1;
        else throw new Error("Unknown instruction: " + instr);
    }

    // Emit bytes
    for (let raw of lines) {
        let line = raw.trim();
        if (line === "" || line.startsWith(";")) continue;

        // Skip labels
        if (line.endsWith(":")) continue;

        const parts = line.split(/[\s,]+/);
        const instr = parts[0].toUpperCase();

        function reg(n) { return parseInt(n.substring(1)); }
        function val(x) { return isNaN(x) ? labels[x] : parseInt(x); }

        switch (instr) {
            case "LOAD":
                output.push(OPCODES.LOAD, reg(parts[1]), val(parts[2]));
                break;

            case "LOADM":
                output.push(OPCODES.LOADM, reg(parts[1]), val(parts[2]));
                break;

            case "STORE":
                output.push(OPCODES.STORE, reg(parts[1]), val(parts[2]));
                break;

            case "ADD":
            case "SUB":
            case "MUL":
            case "DIV":
            case "AND":
            case "OR":
            case "XOR":
            case "CMP":
                output.push(OPCODES[instr], reg(parts[1]), reg(parts[2]));
                break;

            case "NOT":
            case "PRINT":
                output.push(OPCODES[instr], reg(parts[1]));
                break;

            case "JMP":
            case "JZ":
            case "JNZ":
                output.push(OPCODES[instr], val(parts[1]));
                break;

            case "HALT":
                output.push(OPCODES.HALT);
                break;

            default:
                throw new Error("Unknown instruction: " + instr);
        }
    }

    return output;
}

const programText = `
LOAD R0, 1
LOAD R1, 2
LOAD R2, 256 ; Loop until R0 is 256
loop:
MUL R0, R1
PRINT R0
CMP R0, R2
JNZ loop
HALT
`;

const program = assemble(programText);

// Load into memory
for (let i = 0; i < program.length; i++) {
    memory[i] = program[i];
}

function clock() {
    const opCode = memory[pc];
    pc++;

    console.debug("PC: " + pc);

    switch (opCode) {
        case 0x00:
            break;

        case 0x10: { // LOAD r, immediate
            const r = memory[pc++];
            const value = memory[pc++];
            registers[r] = value;
            break;
        }

        case 0x11: { // LOAD r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            registers[r] = memory[addr];
            break;
        }

        case 0x12: { // STORE r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            memory[addr] = registers[r];
            break;
        }

        case 0x20: { // ADD rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] + registers[rB];
            break;
        }

        case 0x21: { // SUB rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] - registers[rB];
            break;
        }

        case 0x22: { // MUL rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] * registers[rB];
            break;
        }

        case 0x23: { // DIV rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = Math.floor(registers[rA] / registers[rB]);
            break;
        }

        case 0x24: { // AND rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] & registers[rB]
            break;
        }

        case 0x25: { // OR rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] | registers[rB];
            break;
        }

        case 0x26: { // XOR rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] ^ registers[rB];
            break;
        }

        case 0x27: { // NOT r
            const r = memory[pc++];
            registers[r] = ~registers[r];
            break;
        }

        case 0x30: { // JMP addr
            const addr = memory[pc++];
            pc = addr;
            break;
        }

        case 0x31: { // JZ addr
            const addr = memory[pc++];
            if (ZF === 1) pc = addr;
            break;
        }
        
        case 0x32: { // JNZ addr
            const addr = memory[pc++];
            if (ZF === 0) pc = addr;
            break;
        }        

        case 0x33: { // CMP rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            ZF = (registers[rA] === registers[rB]) ? 1 : 0;
            break;
        }
        
        case 0x40: { // PRINT r
            const r = memory[pc++];
            console.log(registers[r]);
            break;
        }

        case 0xFF: {
            console.log("HALT");
            clearInterval(interval);
            break;
        }

        default: {
            console.log("Unknown opcode:", opCode);
            break;
        }
    }
}

interval = setInterval(clock, 1000);