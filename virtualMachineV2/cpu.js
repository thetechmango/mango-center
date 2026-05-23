import { ISA } from "./isa.js";
export class CPU {
    constructor() {
        this.memory = new Uint8Array(65536);
        this.registers = new Uint32Array(32);
        this.pc = 0;

        this.ZF = 0;
        this.SF = 0;
        this.OF = 0;

        this.SP = 31;
        this.registers[this.SP] = 0xFFFF;

        this.print = (v) => {
            if (this.onPrint) this.onPrint(v);
        };
    }

    clock() {
        const raw = this.fetch();
        const instr = this.decode(raw);
        return this.execute(instr);
    }

    fetch() {
        const base = this.pc;
    
        const bytes = [
            this.memory[base],
            this.memory[base + 1],
            this.memory[base + 2],
            this.memory[base + 3],
            this.memory[base + 4],
        ];
    
        this.pc += 5;
        return bytes;
    }

    decode(bytes) {
        return {
            opcode: bytes[0],
            rd: bytes[1],
            r1: bytes[2],
            r2: bytes[3],
            imm: bytes[4],
        };
    }

    execute(instr) {
        return ISA[instr.opcode]?.(this, instr);
    }

    load(program) {
        this.memory.set(program);
        this.pc = 0;
    }

    reset() {
        this.pc = 0;
        this.registers.fill(0);
        this.registers[this.SP] = 0xFFFF;
        this.ZF, this.SF, this.OF = 0;
    }
}

/* Old V1 ISA gonna delete this later but keeping for reference
const INSTRUCTIONS = {
    LOAD:   { opcode: 0x10, args: ["reg", "val32"] }, // Load immediate
    LOADM:  { opcode: 0x11, args: ["reg", "val32"] }, // Load from memory
    STORE:  { opcode: 0x12, args: ["reg", "val32"] }, // Store to memory
    MOV:    { opcode: 0x13, args: ["reg", "reg"] },   // Copy from one register to another
    LOADI:  { opcode: 0x14, args: ["reg", "reg"] },   // Load from the memory address in a register
    LOADIB: { opcode: 0x16, args: ["reg", "reg"] },   // LOADI but load only one byte
    STOREI: { opcode: 0x15, args: ["reg", "reg"] },   // Store to a memory address in a register

    ADD: { opcode: 0x20, args: ["reg", "reg"] }, // Adds reg2 to reg1
    SUB: { opcode: 0x21, args: ["reg", "reg"] }, // Same as ADD but subtraction
    MUL: { opcode: 0x22, args: ["reg", "reg"] }, // ...
    DIV: { opcode: 0x23, args: ["reg", "reg"] },
    MOD: { opcode: 0x2C, args: ["reg", "reg"] },
    AND: { opcode: 0x24, args: ["reg", "reg"] }, // reg1 = reg1 AND (bitwise) reg2
    OR:  { opcode: 0x25, args: ["reg", "reg"] }, // ...
    XOR: { opcode: 0x26, args: ["reg", "reg"] },
    NOT: { opcode: 0x27, args: ["reg"] },
    NEG: { opcode: 0x2D, args: ["reg"] }, // Negation (two's compliment)
    INC: { opcode: 0x28, args: ["reg"] },        // Increments reg by 1
    DEC: { opcode: 0x29, args: ["reg"] },        // Decrements reg by 1
    SHL: { opcode: 0x2A, args: ["reg", "reg"] }, // Shifts bits of reg1 to the left by reg2 amount
    SHR: { opcode: 0x2B, args: ["reg", "reg"] }, // Same but to the right

    JMP: { opcode: 0x30, args: ["val32"] },      // Jump to a memory address (immediate)
    JMPR: { opcode: 0x38, args: ["reg"] },       // Jump to a memory address in a register
    JZ:  { opcode: 0x31, args: ["val32"] },      // Jump to a memory address if the zero flag is true
    JNZ: { opcode: 0x32, args: ["val32"] },      // Same but only if zero flag is false
    CMP: { opcode: 0x33, args: ["reg", "reg"] }, // Sets the zero flag (ZF), sign flag (SF), and overflow flag (OF). Use this before the comparison jumps
    JG:  { opcode: 0x34, args: ["val32"] },      // Jump if CMP reg1 was greater than reg2
    JL:  { opcode: 0x35, args: ["val32"] },      // Jump if CPM reg1 was less than reg2
    JGE: { opcode: 0x36, args: ["val32"] },      // Same but greater than or equal to
    JLE: { opcode: 0x37, args: ["val32"] },      // Same but less than or equal to

    PUSH:  { opcode: 0x70, args: ["reg"] },  // Decrement SP by 4, then write reg value to [SP]
    POP:   { opcode: 0x71, args: ["reg"] },  // Read value at [SP] into reg, then increment SP by 4
    CALL: { opcode: 0x72, args: ["val32"] }, // PUSH current Program Counter (PC), then JMP to val32 in memory
    RET:   { opcode: 0x73, args: [] },       // POP value from stack into PC (returns to after the CALL)

    RAND: { opcode: 0x80, args: ["reg"] }, // Sets reg to a random unsigned 32 bit integer

    PRINT: { opcode: 0x40, args: ["reg"] }, // Prints the value of reg to the terminal in decimal
    HALT:  { opcode: 0xFF, args: [] },      // Halts the program until the user resumes
    NOP: { opcode: 0x00, args: [] }         // Does nothing (no operation)
};
*/