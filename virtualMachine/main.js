import { ui } from '../ui.js';

class CPU {
    constructor(memorySize = 65536) {
        this.memory = new Uint8Array(memorySize);
        this.registers = new Uint32Array(16);

        this.SP = 15;
        this.registers[this.SP] = memorySize;

        this.pc = 0;

        this.ZF = 0;
        this.SF = 0;
        this.OF = 0;

        this.framebuffer = new Uint8Array(128 * 64);
        this.keyState = new Uint8Array(256);

        this._boundKeyDown = null;
        this._boundKeyUp = null;

        this.ops = new Array(256);
        this.initOps();
    }

    read32() {
        const m = this.memory;
        const pc = this.pc;
        const val = (m[pc] | (m[pc+1] << 8) | (m[pc+2] << 16) | (m[pc+3] << 24)) >>> 0;
        this.pc += 4;
        return val;
    }

    writeReg(r, val) {
        if (r !== 0) this.registers[r] = val >>> 0;
    }
    
    memRead32(addr) {
        const m = this.memory;
        return (m[addr] | (m[addr+1] << 8) | (m[addr+2] << 16) | (m[addr+3] << 24)) >>> 0;
    }
    
    memWrite32(addr, val) {
        const m = this.memory;
        m[addr]     = val & 0xFF;
        m[addr + 1] = (val >> 8) & 0xFF;
        m[addr + 2] = (val >> 16) & 0xFF;
        m[addr + 3] = (val >> 24) & 0xFF;
    }

    initOps() {
        const I = INSTRUCTIONS;

        const invalid = () => {
            const bad = this.memory[this.pc - 1];
        
            terminal.value += `Unknown opcode: 0x${
                bad !== undefined ? bad.toString(16).padStart(2, "0") : "??"
            }\n`;
        
            stopMachine?.();
        };

        this.ops.fill(invalid);

        this.ops[I.NOP.opcode] = () => {};

        this.ops[I.LOAD.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, this.read32());
        };

        this.ops[I.LOADM.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            const addr = this.read32();
            this.writeReg(r, this.memRead32(addr));
        };

        this.ops[I.STORE.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            const addr = this.read32();
            this.memWrite32(addr, this.registers[r]);
        };

        this.ops[I.MOV.opcode] = () => {
            const mem = this.memory;
            const rDest = mem[this.pc++];
            const rSrc = mem[this.pc++];
            this.writeReg(rDest, this.registers[rSrc]);
        };

        this.ops[I.LOADI.opcode] = () => {
            const mem = this.memory;
            const rDest = mem[this.pc++];
            const rPtr = mem[this.pc++];
            this.writeReg(rDest, this.memRead32(this.registers[rPtr]));
        };

        this.ops[I.LOADIB.opcode] = () => {
            const mem = this.memory;
            const rDest = mem[this.pc++];
            const rPtr = mem[this.pc++];
            this.writeReg(rDest, this.memory[this.registers[rPtr]] >>> 0);
        };

        this.ops[I.STOREI.opcode] = () => {
            const mem = this.memory;
            const rPtr = mem[this.pc++];
            const rSrc = mem[this.pc++];
            this.memWrite32(this.registers[rPtr], this.registers[rSrc]);
        };

        this.ops[I.ADD.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] + this.registers[rB]);
        };

        this.ops[I.SUB.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] - this.registers[rB]);
        };

        this.ops[I.MUL.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] * this.registers[rB]);
        };

        this.ops[I.DIV.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, Math.floor(this.registers[rA] / this.registers[rB]));
        };

        this.ops[I.MOD.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] % this.registers[rB]);
        };

        this.ops[I.INC.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, this.registers[r] + 1);
        };

        this.ops[I.DEC.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, this.registers[r] - 1);
        };

        this.ops[I.AND.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] & this.registers[rB]);
        };

        this.ops[I.OR.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] | this.registers[rB]);
        };

        this.ops[I.XOR.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] ^ this.registers[rB]);
        };

        this.ops[I.NOT.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, ~this.registers[r]);
        };

        this.ops[I.NEG.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, -this.registers[r]);
        };

        this.ops[I.SHL.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] << this.registers[rB]);
        };

        this.ops[I.SHR.opcode] = () => {
            const mem = this.memory;
            const rA = mem[this.pc++], rB = mem[this.pc++];
            this.writeReg(rA, this.registers[rA] >>> this.registers[rB]);
        };

        this.ops[I.CMP.opcode] = () => {
            const mem = this.memory;
            const rA = this.registers[mem[this.pc++]] | 0;
            const rB = this.registers[mem[this.pc++]] | 0;
            const res = (rA - rB) | 0;

            this.ZF = (res === 0) ? 1 : 0;
            this.SF = (res < 0) ? 1 : 0;
            this.OF = ((rA ^ res) & (rB ^ rA) & 0x80000000) ? 1 : 0;
        };

        this.ops[I.JMP.opcode] = () => { this.pc = this.read32(); };

        this.ops[I.JMPR.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.pc = this.registers[r] >>> 0;
        };

        this.ops[I.JZ.opcode] = () => {
            const addr = this.read32();
            if (this.ZF === 1) this.pc = addr;
        };

        this.ops[I.JNZ.opcode] = () => {
            const addr = this.read32();
            if (this.ZF === 0) this.pc = addr;
        };

        this.ops[I.JG.opcode] = () => {
            const addr = this.read32();
            if (this.ZF === 0 && this.SF === this.OF) this.pc = addr;
        };

        this.ops[I.JL.opcode] = () => {
            const addr = this.read32();
            if (this.SF !== this.OF) this.pc = addr;
        };

        this.ops[I.JGE.opcode] = () => {
            const addr = this.read32();
            if (this.SF === this.OF) this.pc = addr;
        };

        this.ops[I.JLE.opcode] = () => {
            const addr = this.read32();
            if (this.ZF === 1 || this.SF !== this.OF) this.pc = addr;
        };

        this.ops[I.PUSH.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.registers[this.SP] -= 4;
            this.memWrite32(this.registers[this.SP], this.registers[r]);
        };

        this.ops[I.POP.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, this.memRead32(this.registers[this.SP]));
            this.registers[this.SP] += 4;
        };

        this.ops[I.CALL.opcode] = () => {
            const target = this.read32();
            this.registers[this.SP] -= 4;
            this.memWrite32(this.registers[this.SP], this.pc);
            this.pc = target;
        };

        this.ops[I.RET.opcode] = () => {
            this.pc = this.memRead32(this.registers[this.SP]);
            this.registers[this.SP] += 4;
        };

        this.ops[I.RAND.opcode] = () => {
            const mem = this.memory;
            const r = mem[this.pc++];
            this.writeReg(r, (Math.random() * 0x100000000) >>> 0);
        };

        this.ops[I.PRINT.opcode] = () => {
            const mem = this.memory;
            const val = this.registers[mem[this.pc++]];
            terminal.value += val + '\n';
            terminal.el.scrollTop = terminal.el.scrollHeight;
        };

        this.ops[I.READKEY.opcode] = () => {
            const mem = this.memory;
        
            const rDest = mem[this.pc++];
            const keyCode = this.read32() & 0xFF;
        
            const state = this.keyState?.[keyCode] ?? 0;
            this.writeReg(rDest, state);
        };

        this.ops[I.SETPIX.opcode] = () => {
            const mem = this.memory;
        
            const x = this.registers[mem[this.pc++]];
            const y = this.registers[mem[this.pc++]];
            const c = this.registers[mem[this.pc++]];
        
            if (x < WIDTH && y < HEIGHT) {
                this.framebuffer[y * WIDTH + x] = c & 0xFF;
            }
        };

        this.ops[I.GETPIX.opcode] = () => {
            const mem = this.memory;
        
            const rDest = mem[this.pc++];
            const x = this.registers[mem[this.pc++]];
            const y = this.registers[mem[this.pc++]];
        
            if (x < WIDTH && y < HEIGHT) {
                this.writeReg(rDest, this.framebuffer[y * WIDTH + x]);
            } else {
                this.writeReg(rDest, 0);
            }
        };

        this.ops[I.FILL.opcode] = () => {
            const mem = this.memory;
            const c = this.registers[mem[this.pc++]] & 0xFF;
        
            this.framebuffer.fill(c);
        };

        this.ops[I.RECT.opcode] = () => {
            const mem = this.memory;
        
            const x = this.registers[mem[this.pc++]];
            const y = this.registers[mem[this.pc++]];
            const w = this.registers[mem[this.pc++]];
            const h = this.registers[mem[this.pc++]];
            const c = this.registers[mem[this.pc++]] & 0xFF;
        
            const fb = this.framebuffer;
        
            for (let yy = 0; yy < h; yy++) {
                const py = y + yy;
                if (py >= HEIGHT) break;
        
                for (let xx = 0; xx < w; xx++) {
                    const px = x + xx;
                    if (px >= WIDTH) break;
        
                    fb[py * WIDTH + px] = c;
                }
            }
        };

        this.ops[I.LINE.opcode] = () => {
            const mem = this.memory;
        
            let x0 = this.registers[mem[this.pc++]];
            let y0 = this.registers[mem[this.pc++]];
            let x1 = this.registers[mem[this.pc++]];
            let y1 = this.registers[mem[this.pc++]];
            const c = this.registers[mem[this.pc++]] & 0xFF;
        
            const dx = Math.abs(x1 - x0);
            const sx = x0 < x1 ? 1 : -1;
            const dy = -Math.abs(y1 - y0);
            const sy = y0 < y1 ? 1 : -1;
        
            let err = dx + dy;
        
            const fb = this.framebuffer;
        
            while (true) {
                if (x0 >= 0 && x0 < WIDTH && y0 >= 0 && y0 < HEIGHT) {
                    fb[y0 * WIDTH + x0] = c;
                }
        
                if (x0 === x1 && y0 === y1) break;
        
                const e2 = 2 * err;
        
                if (e2 >= dy) {
                    err += dy;
                    x0 += sx;
                }
        
                if (e2 <= dx) {
                    err += dx;
                    y0 += sy;
                }
            }
        };

        this.ops[I.HALT.opcode] = () => {
            stopMachine();
            terminal.value += '--- System Halted ---\n';
        };
    }

    clock() {
        const mem = this.memory;
        const opCode = mem[this.pc++];
    
        const op = this.ops[opCode];
    
        if (!op) {
            terminal.value += `Unknown opcode: 0x${opCode.toString(16).padStart(2, "0")}\n`;
            return;
        }
    
        op();
    }

    attachInput() {
        this._boundKeyDown = (e) => {
            if (e.keyCode < 256) this.keyState[e.keyCode] = 1;
        };

        this._boundKeyUp = (e) => {
            if (e.keyCode < 256) this.keyState[e.keyCode] = 0;
        };

        window.addEventListener("keydown", this._boundKeyDown);
        window.addEventListener("keyup", this._boundKeyUp);
    }

    detachInput() {
        window.removeEventListener("keydown", this._boundKeyDown);
        window.removeEventListener("keyup", this._boundKeyUp);
    }
}

let timerId = null;
let isRunning = false;
let isTurbo = false; 

const INSTRUCTIONS = {
    NOP: { opcode: 0x00, args: [] },         // Does nothing (no operation)

    LOAD:   { opcode: 0x10, args: ["reg", "val32"] }, // Load immediate
    LOADM:  { opcode: 0x11, args: ["reg", "val32"] }, // Load from memory
    STORE:  { opcode: 0x12, args: ["reg", "val32"] }, // Store to memory
    MOV:    { opcode: 0x13, args: ["reg", "reg"] },   // Copy from one register to another
    LOADI:  { opcode: 0x14, args: ["reg", "reg"] },   // Load from the memory address in a register
    LOADIB: { opcode: 0x15, args: ["reg", "reg"] },   // LOADI but load only one byte
    STOREI: { opcode: 0x16, args: ["reg", "reg"] },   // Store to a memory address in a register

    ADD: { opcode: 0x20, args: ["reg", "reg"] }, // Adds reg2 to reg1
    SUB: { opcode: 0x21, args: ["reg", "reg"] }, // Same as ADD but subtraction
    MUL: { opcode: 0x22, args: ["reg", "reg"] }, // ...
    DIV: { opcode: 0x23, args: ["reg", "reg"] },
    AND: { opcode: 0x24, args: ["reg", "reg"] }, // reg1 = reg1 AND (bitwise) reg2
    OR:  { opcode: 0x25, args: ["reg", "reg"] }, // ...
    XOR: { opcode: 0x26, args: ["reg", "reg"] },
    NOT: { opcode: 0x27, args: ["reg"] },
    INC: { opcode: 0x28, args: ["reg"] },        // Increments reg by 1
    DEC: { opcode: 0x29, args: ["reg"] },        // Decrements reg by 1
    SHL: { opcode: 0x2A, args: ["reg", "reg"] }, // Shifts bits of reg1 to the left by reg2 amount
    SHR: { opcode: 0x2B, args: ["reg", "reg"] }, // Same but to the right
    MOD: { opcode: 0x2C, args: ["reg", "reg"] },
    NEG: { opcode: 0x2D, args: ["reg"] },        // Negation (two's compliment)

    JMP: { opcode: 0x30, args: ["val32"] },      // Jump to a memory address (immediate)
    JMPR: { opcode: 0x31, args: ["reg"] },       // Jump to a memory address in a register
    JZ:  { opcode: 0x32, args: ["val32"] },      // Jump to a memory address if the zero flag is true
    JNZ: { opcode: 0x33, args: ["val32"] },      // Same but only if zero flag is false
    CMP: { opcode: 0x34, args: ["reg", "reg"] }, // Sets the zero flag (ZF), sign flag (SF), and overflow flag (OF). Use this before the comparison jumps
    JG:  { opcode: 0x35, args: ["val32"] },      // Jump if CMP reg1 was greater than reg2
    JL:  { opcode: 0x36, args: ["val32"] },      // Jump if CPM reg1 was less than reg2
    JGE: { opcode: 0x37, args: ["val32"] },      // Same but greater than or equal to
    JLE: { opcode: 0x38, args: ["val32"] },      // Same but less than or equal to

    PRINT: { opcode: 0x40, args: ["reg"] },  // Prints the value of reg to the terminal in decimal
    READKEY: { opcode: 0x41, args: ["reg", "val32"] }, // Gets the current state of the key with that keycode and puts either a 1 or 0 in reg

    PUSH:  { opcode: 0x70, args: ["reg"] },  // Decrement SP by 4, then write reg value to [SP]
    POP:   { opcode: 0x71, args: ["reg"] },  // Read value at [SP] into reg, then increment SP by 4
    CALL: { opcode: 0x72, args: ["val32"] }, // PUSH current Program Counter (PC), then JMP to val32 in memory
    RET:   { opcode: 0x73, args: [] },       // POP value from stack into PC (returns to after the CALL)

    RAND: { opcode: 0x80, args: ["reg"] },   // Sets reg to a random unsigned 32 bit integer

    SETPIX: { opcode: 0x90, args: ["reg", "reg", "reg"] }, // x, y, color 0-255
    GETPIX: { opcode: 0x91, args: ["reg", "reg", "reg"] }, // rDest, rX, rY
    FILL: { opcode: 0x92, args: ["reg"] },                 // color
    RECT: { opcode: 0x93, args: ["reg", "reg", "reg", "reg", "reg"] }, // x, y, width, height, color
    LINE: { opcode: 0x94, args: ["reg","reg","reg","reg","reg"] }, // x1, y1, x2, y2, color

    HALT:  { opcode: 0xFF, args: [] }      // Halts the program until the user resumes
};

const toHex = (val, size = 8) => '0x' + val.toString(16).toUpperCase().padStart(size, '0');

function assemble(source) {
    const lines = source.trim().split("\n");
    const labels = {};
    const output = [];

    const reg = (n) => parseInt(n.substring(1));
    const val = (x) => {
        if (labels[x] !== undefined) return labels[x];
        const s = x.toString().toLowerCase();
        if (s.startsWith("0x")) return parseInt(s.slice(2), 16);
        if (s.startsWith("$")) return parseInt(s.slice(1), 16);
        return parseInt(x);
    };

    // Helper to calculate byte size of an instruction
    const getInstrSize = (instr) => {
        return 1 + instr.args.reduce((acc, arg) => acc + (arg === "reg" ? 1 : 4), 0);
    };

    // PASS 1: Labels
    let pc = 0;
    for (let raw of lines) {
        let line = raw.trim();
        if (line === "" || line.startsWith(";")) continue;
        if (line.endsWith(":")) {
            labels[line.slice(0, -1)] = pc;
            continue;
        }
        const mnemonic = line.split(/[\s,]+/)[0].toUpperCase();
        pc += getInstrSize(INSTRUCTIONS[mnemonic]);
    }

    // PASS 2: Emission
    for (let raw of lines) {
        let line = raw.trim();
        if (line === "" || line.startsWith(";") || line.endsWith(":")) continue;

        const parts = line.split(/[\s,]+/);
        const mnemonic = parts[0].toUpperCase();
        const instr = INSTRUCTIONS[mnemonic];

        output.push(instr.opcode);

        instr.args.forEach((argType, i) => {
            const param = parts[i + 1];
            if (argType === "reg") {
                output.push(reg(param));
            } else if (argType === "val32") {
                const v = val(param);
                output.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF);
            }
        });
    }

    return output;
}

let cpu = new CPU(65536);
cpu.attachInput();

const initialProgramText = `; Example Assembly Program
INC R1
LOOP:
PRINT R1
ADD R1, R1
CMP R1, R2
JNZ LOOP
HALT
`;

const program = assemble(initialProgramText);

// Load into memory
for (let i = 0; i < program.length; i++) {
    cpu.memory[i] = program[i];
}


// UI

Object.assign(ui.defaults.global, {
    accentColor: '#5f5',
    transition: 'all 0.05s ease-out'
})

Object.assign(ui.defaults.divider, {
    backgroundColor: ui.defaults.global.accentColor
})

ui.defaults.panel = {
    background: '#2e2e2e',
    borderRadius: '14px',
    border: '2px solid #555',
    gap: '10px',
    padding: '10px'
};

Object.assign(ui.defaults.label, {
    color: '#fff'
})

Object.assign(ui.defaults.button, {
    backgroundColor: ui.defaults.global.accentColor,
    hover: {
        filter: 'brightness(1.5)', transform: 'scale(1.02)'
    },
    active: {
        filter: 'brightness(0.8)', transform: 'scale(0.98)'
    },
    flex: '1'
})

const regLabels = Array.from(
    { length: cpu.registers.length - 1 }, 
    (_, i) => ui.label({ text: `R${i}: 0x00`, style: { minWidth: '70px' } })
);

// Helper to chunk labels into rows so they don't overflow the screen
const regRows = [];
for (let i = 0; i < regLabels.length; i += 4) {
    regRows.push(ui.row({ style: { gap: '10px' } }, regLabels.slice(i, i + 4)));
}

const spLabel = ui.label({ text: `SP: ${cpu.registers[cpu.SP]}` });
const pcLabel = ui.label({ text: `PC: ${cpu.pc}` });

const speedSlider = ui.slider({ value: 900, min: 0, max: 999 });

const runningLabel = ui.label({ text: 'Stopped' });
const turboButton = ui.button({
    text: 'Turbo Mode: off',
    onclick: () => {
        isTurbo = !isTurbo;
        turboButton.text = 'Turbo Mode: ' + (isTurbo ? 'on' : 'off');
    }
})

const dashboard = ui.panel({}, [
    ui.label({ text: 'Registers'}),
    ...regRows,
    ui.row({}, [spLabel, pcLabel]),

    ui.divider(),

    ui.row({}, [
        runningLabel
    ]),

    ui.row({}, [
        ui.button({ text: 'Resume', onclick: () => {
            if (!isRunning ) terminal.value += '--- System Started ---\n';
            startMachine();
        }}),
        ui.button({ text: 'Halt', onclick: () => {
            if (isRunning ) terminal.value += '--- System Halted ---\n';
            stopMachine();
        }}),
        ui.button({ text: 'Step', onclick: () => {
            stepMachine();
        }}),
        ui.button({ text: 'Reset', onclick: () => {
            resetMachine();
        }})
    ]),

    ui.row({}, [
        turboButton
    ]),
    
    ui.label({ text: 'Clock speed'}),
    speedSlider
]);

dashboard.position('top', 10, 50);
ui.mount(dashboard, document.body);

const terminal = ui.textarea({ 
    value: '', 
    style: { 
        width: '100%', 
        height: '100%', 
        fontFamily: 'monospace',
        backgroundColor: '#1e1e1e',
        color: '#0f0', // Classic green-on-black terminal
        width: '100%'
    },
    disabled: 'true'
});

const outputPanel = ui.panel({ style: { width: '300px', height: '90%' } }, [
    ui.label({ text: "Terminal Output", style: { fontWeight: 'bold' } }),
    terminal,
    ui.button({
        text: 'Clear',
        onclick: () => { terminal.value = ''; }
    })
]);

outputPanel.position('left', 10, 50);
ui.mount(outputPanel, document.body);

const programEditor = ui.textarea({ 
    value: localStorage.getItem('cpu_program') || initialProgramText,
    oninput: (e) => {
        localStorage.setItem('cpu_program', programEditor.value);
    },
    style: {
        height: '100%',
        width: '100%',
        padding: '10px',
        fontFamily: 'monospace',
        color: '#eee',
        backgroundColor: '#1e1e1e',
        whiteSpace: 'pre'
    },
    wrap: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    autocomete: 'off'
});

const loadButton = ui.button({
    text: 'Assemble & Load',
    onclick: () => {
        try {
            const bytes = assemble(programEditor.value);
            cpu.memory.fill(0);
            for (let i = 0; i < bytes.length; i++) cpu.memory[i] = bytes[i];
            resetMachine();
            terminal.value += "Assembly successful: " + bytes.length + " bytes loaded.\n";
        } catch (e) {
            terminal.value += "Error: " + e.message + "\n";
        }
    }
});

const exportBtn = ui.button({
    text: 'Export .asm',
    onclick: () => {
        const text = programEditor.value;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        // Use your library to create a temporary anchor
        const link = ui.el('a', { 
            href: url, 
            download: 'program.asm' 
        });
        
        link.el.click(); // Trigger the native download dialog
        URL.revokeObjectURL(url); // Clean up memory
    }
});

// Hidden file picker
const filePicker = ui.el('input', { 
    type: 'file', 
    style: { display: 'none' },
    onchange: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            programEditor.value = event.target.result;
            filePicker.el.value = ''; 
        };
        reader.readAsText(file);
    }
});
ui.mount(filePicker, document.body);

const importBtn = ui.button({
    text: 'Import .asm',
    onclick: () => filePicker.el.click() // Open the file dialog secretly
});

const programPanel = ui.panel({ style: { width: '500px', height: '90%' } }, [
    ui.label({ text: "Program Editor", style: { fontWeight: 'bold' } }),
    programEditor,
    ui.row({}, [
        loadButton,
        exportBtn,
        importBtn,
        ui.button({ text: 'Clear', onclick: () => {
            if(confirm("Clear editor?")) programEditor.value = '';
        }})
    ])
]);

programPanel.position('right', 10, 50);
ui.mount(programPanel, document.body);

const WIDTH = 128;
const HEIGHT = 64;

const display = ui.el('canvas', {
    style: { width: '512px', height: '256px' }
});

display.el.width = WIDTH;   // 128
display.el.height = HEIGHT; // 64

const ctx = display.el.getContext("2d");
ctx.imageSmoothingEnabled = false;
display.el.style.imageRendering = 'pixelated';

display.el.addEventListener("click", async () => {
    if (!document.fullscreenElement) {
        await display.el.requestFullscreen();
    } else {
        await document.exitFullscreen();
    }
});

const displayPanel = ui.panel({ style: { gap: "1px" } }, [
    ui.label({ text: '128x64', style: { fontSize: '10px', color: '#666'}}),
    display
]);

displayPanel.position('bottom', 10, 50);
ui.mount(displayPanel, document.body);

const img = ctx.createImageData(WIDTH, HEIGHT);

function drawDisplay() {
    const fb = cpu.framebuffer;
    const data = img.data;

    for (let i = 0; i < fb.length; i++) {
        const v = fb[i];
        const idx = i * 4;

        data[idx]     = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
}

function updateUI() {
    // Update general registers in Hex
    regLabels.forEach((label, i) => {
        label.text = `R${i}: ${toHex(cpu.registers[i])}`;
    });

    // Update Special registers (SP and PC are usually 16-bit addresses, so 4 digits)
    spLabel.text = `SP: ${toHex(cpu.registers[cpu.SP])}`;
    pcLabel.text = `PC: ${toHex(cpu.pc, 8)}`;

    drawDisplay();
}

function startMachine() {
    if (isRunning) return;
    isRunning = true;
    runningLabel.text = 'Running';
    
    // Clear any pending timeout before starting
    if (timerId) clearTimeout(timerId);
    
    // Start the recursive loop
    loop();
}

function stopMachine() {
    isRunning = false;
    runningLabel.text = 'Stopped';
    if (timerId) {
        clearTimeout(timerId);
        timerId = null;
    }
}

function stepMachine() {
    stopMachine();
    cpu.clock();
    updateUI();
}

function resetMachine() {
    stopMachine();
    cpu.pc = 0;
    cpu.registers.fill(0);
    cpu.registers[15] = 0xFFFF; 
    cpu.ZF, cpu.SF, cpu.OF = 0;
    cpu.framebuffer.fill(0);
    terminal.value = '--- System Reset ---\n';
    updateUI();
}

const turboBatchSize = 1000;

function loop() {
    if (!isRunning) return;

    if (cpu.pc >= cpu.memory.length) {
        terminal.value += `--- End of Memory Reached ---\n`;
        stopMachine();
        return;
    }

    if (isTurbo) {
        for (let i = 0; i < turboBatchSize; i++) {
            if (cpu.pc >= cpu.memory.length) {
                terminal.value += `--- End of Memory Reached ---\n`;
                stopMachine();
                break;
            }
            if (!isRunning) {
                stopMachine();
                break;
            }
            cpu.clock();
        }
    } else {
        cpu.clock();
    }

    updateUI();
    timerId = setTimeout(loop, isTurbo ? 0 : 1000 - speedSlider.value);
}

loadButton.el.click();