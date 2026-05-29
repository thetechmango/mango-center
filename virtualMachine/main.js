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
        this.needsPresent = false;
        this.keyState = new Uint8Array(256);

        this.sleepUntil = 0;
        this.waitingForKey = -1;

        this.audioCtx = null;

        this._boundKeyDown = null;
        this._boundKeyUp = null;

        this.ops = new Array(256);
        this.initOps();
    }

    readArg() {
        const type = this.memory[this.pc++];
    
        if (type === 0) { // register
            const r = this.memory[this.pc++];
            return this.registers[r];
        } else { // immediate
            return this.read32();
        }
    }
    
    readArgRaw() {
        const type = this.memory[this.pc++];
    
        if (type === 0) { // register
            return this.memory[this.pc++]; // return register index
        } else {
            // immediate cannot be a destination
            throw new Error("Immediate not allowed as destination");
        }
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
    
        // --- Basic ---
        this.ops[I.NOP.opcode] = () => {};
    
        // --- Data / Memory ---
        this.ops[I.MOV.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.readArg());
        };
    
        this.ops[I.LOAD.opcode] = () => {
            const r = this.readArgRaw();
            const addr = this.readArg();
            this.writeReg(r, this.memRead32(addr));
        };
    
        this.ops[I.LOADB.opcode] = () => {
            const r = this.readArgRaw();
            const addr = this.readArg();
            this.writeReg(r, this.memory[addr] >>> 0);
        };
    
        this.ops[I.STORE.opcode] = () => {
            const addr = this.readArg();
            const val  = this.readArg();
            this.memWrite32(addr, val);
        };
    
        // --- Arithmetic ---
        this.ops[I.ADD.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] + this.readArg());
        };
    
        this.ops[I.SUB.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] - this.readArg());
        };
    
        this.ops[I.MUL.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] * this.readArg());
        };
    
        this.ops[I.DIV.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, Math.floor(this.registers[r] / this.readArg()));
        };
    
        this.ops[I.MOD.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] % this.readArg());
        };
    
        this.ops[I.AND.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] & this.readArg());
        };
    
        this.ops[I.OR.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] | this.readArg());
        };
    
        this.ops[I.XOR.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] ^ this.readArg());
        };
    
        this.ops[I.NOT.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, ~this.registers[r]);
        };
    
        this.ops[I.NEG.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, -this.registers[r]);
        };
    
        this.ops[I.INC.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] + 1);
        };
    
        this.ops[I.DEC.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] - 1);
        };
    
        this.ops[I.SHL.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] << this.readArg());
        };
    
        this.ops[I.SHR.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.registers[r] >>> this.readArg());
        };
    
        // --- Compare ---
        this.ops[I.CMP.opcode] = () => {
            const a = this.readArg() | 0;
            const b = this.readArg() | 0;
            const res = (a - b) | 0;
    
            this.ZF = res === 0 ? 1 : 0;
            this.SF = res < 0 ? 1 : 0;
            this.OF = ((a ^ res) & (b ^ a) & 0x80000000) ? 1 : 0;
        };
    
        // --- Jumps ---
        this.ops[I.JMP.opcode] = () => {
            this.pc = this.readArg();
        };
    
        this.ops[I.JZ.opcode] = () => {
            const t = this.readArg();
            if (this.ZF) this.pc = t;
        };
    
        this.ops[I.JNZ.opcode] = () => {
            const t = this.readArg();
            if (!this.ZF) this.pc = t;
        };
    
        this.ops[I.JG.opcode] = () => {
            const t = this.readArg();
            if (!this.ZF && this.SF === this.OF) this.pc = t;
        };
    
        this.ops[I.JL.opcode] = () => {
            const t = this.readArg();
            if (this.SF !== this.OF) this.pc = t;
        };
    
        this.ops[I.JGE.opcode] = () => {
            const t = this.readArg();
            if (this.SF === this.OF) this.pc = t;
        };
    
        this.ops[I.JLE.opcode] = () => {
            const t = this.readArg();
            if (this.ZF || this.SF !== this.OF) this.pc = t;
        };
    
        // --- Stack ---
        this.ops[I.PUSH.opcode] = () => {
            const v = this.readArg();
            this.registers[this.SP] -= 4;
            this.memWrite32(this.registers[this.SP], v);
        };
    
        this.ops[I.POP.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, this.memRead32(this.registers[this.SP]));
            this.registers[this.SP] += 4;
        };
    
        this.ops[I.CALL.opcode] = () => {
            const t = this.readArg();
            this.registers[this.SP] -= 4;
            this.memWrite32(this.registers[this.SP], this.pc);
            this.pc = t;
        };
    
        this.ops[I.RET.opcode] = () => {
            this.pc = this.memRead32(this.registers[this.SP]);
            this.registers[this.SP] += 4;
        };
    
        // --- Misc ---
        this.ops[I.RAND.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, (Math.random() * 0x100000000) >>> 0);
        };
    
        this.ops[I.PRINT.opcode] = () => {
            const v = this.readArg();
            terminal.value += v + '\n';
            terminal.el.scrollTop = terminal.el.scrollHeight;
        };
    
        this.ops[I.SLEEP.opcode] = () => {
            const ms = this.readArg();
            this.sleepUntil = performance.now() + ms;
        };

        this.ops[I.WAITKEY.opcode] = () => {
            const key = this.readArg() & 0xFF;
        
            if (this.keyState[key]) return;
        
            // Otherwise enter wait state
            this.waitingForKey = key;
        };

        this.ops[I.BEEP.opcode] = () => {
            const freq = this.readArg();
            const duration = this.readArg();
        
            if (freq > 0 && duration > 0) {
                this.beep(freq, duration);
            }
        };
    
        this.ops[I.READKEY.opcode] = () => {
            const r = this.readArgRaw();
            const key = this.readArg() & 0xFF;
            this.writeReg(r, this.keyState[key] ?? 0);
        };

        this.ops[I.TIME.opcode] = () => {
            const r = this.readArgRaw();
            this.writeReg(r, performance.now() | 0);
        };

        this.ops[I.CLIPWRITE.opcode] = () => {
            const v = this.readArg();
            navigator.clipboard.writeText(String(v));
        };

        this.ops[I.STORELOCAL.opcode] = () => {
            const k = this.readArg();
            const v = this.readArg();
            localStorage.setItem(String(k), String(v));
        };
        
        this.ops[I.LOADLOCAL.opcode] = () => {
            const r = this.readArgRaw();
            const k = this.readArg();
            const v = localStorage.getItem(String(k));
            this.writeReg(r, v ? parseInt(v) : 0);
        };

        this.ops[I.DUMP.opcode] = () => {
            const addr = this.readArg();
            const size = this.readArg();
        
            const end = Math.min(addr + size, this.memory.length);
            const bytes = this.memory.slice(addr, end);
        
            const blob = new Blob([bytes], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);
        
            const a = document.createElement("a");
            a.href = url;
            a.download = `mem_${addr}_${size}.bin`;
            a.click();
        
            URL.revokeObjectURL(url);
        };
    
        // --- Graphics ---
        this.ops[I.SETPIX.opcode] = () => {
            const x = this.readArg();
            const y = this.readArg();
            const c = this.readArg();
    
            if (x < WIDTH && y < HEIGHT) {
                this.framebuffer[y * WIDTH + x] = c & 0xFF;
            }
        };
    
        this.ops[I.GETPIX.opcode] = () => {
            const r = this.readArgRaw();
            const x = this.readArg();
            const y = this.readArg();
    
            if (x < WIDTH && y < HEIGHT) {
                this.writeReg(r, this.framebuffer[y * WIDTH + x]);
            } else {
                this.writeReg(r, 0);
            }
        };
    
        this.ops[I.PRESENT.opcode] = () => {
            this.needsPresent = true;
        };
    
        this.ops[I.FILL.opcode] = () => {
            const c = this.readArg() & 0xFF;
            this.framebuffer.fill(c);
        };
    
        this.ops[I.RECT.opcode] = () => {
            const x = this.readArg();
            const y = this.readArg();
            const w = this.readArg();
            const h = this.readArg();
            const c = this.readArg() & 0xFF;
    
            for (let yy = 0; yy < h; yy++) {
                const py = y + yy;
                if (py >= HEIGHT) break;
    
                for (let xx = 0; xx < w; xx++) {
                    const px = x + xx;
                    if (px >= WIDTH) break;
    
                    this.framebuffer[py * WIDTH + px] = c;
                }
            }
        };
    
        this.ops[I.LINE.opcode] = () => {
            let x0 = this.readArg();
            let y0 = this.readArg();
            let x1 = this.readArg();
            let y1 = this.readArg();
            const c = this.readArg() & 0xFF;
    
            const dx = Math.abs(x1 - x0);
            const sx = x0 < x1 ? 1 : -1;
            const dy = -Math.abs(y1 - y0);
            const sy = y0 < y1 ? 1 : -1;
    
            let err = dx + dy;
    
            while (true) {
                if (x0 >= 0 && x0 < WIDTH && y0 >= 0 && y0 < HEIGHT) {
                    this.framebuffer[y0 * WIDTH + x0] = c;
                }
    
                if (x0 === x1 && y0 === y1) break;
    
                const e2 = 2 * err;
    
                if (e2 >= dy) { err += dy; x0 += sx; }
                if (e2 <= dx) { err += dx; y0 += sy; }
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

    beep(freq, duration) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    
        const ctx = this.audioCtx;
    
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
    
        osc.type = "square"; // retro feel
        osc.frequency.value = freq;
    
        gain.gain.value = 0.1; // volume
    
        osc.connect(gain);
        gain.connect(ctx.destination);
    
        const now = ctx.currentTime;
    
        osc.start(now);
        osc.stop(now + duration / 1000);
    }
}

let timerId = null;
let isRunning = false;
let isTurbo = false; 

const INSTRUCTIONS = {
    NOP: { opcode: 0x00, args: [] },

    // Data / memory
    MOV:    { opcode: 0x10, args: ["dst", "any"] },   // Rdst = value
    LOAD:   { opcode: 0x11, args: ["dst", "any"] },   // Rdst = [addr]
    LOADB:  { opcode: 0x12, args: ["dst", "any"] },   // Rdst = byte[addr]
    STORE:  { opcode: 0x13, args: ["any", "any"] },   // [addr] = value

    // Arithmetic / logic
    ADD: { opcode: 0x20, args: ["dst", "any"] },
    SUB: { opcode: 0x21, args: ["dst", "any"] },
    MUL: { opcode: 0x22, args: ["dst", "any"] },
    DIV: { opcode: 0x23, args: ["dst", "any"] },
    AND: { opcode: 0x24, args: ["dst", "any"] },
    OR:  { opcode: 0x25, args: ["dst", "any"] },
    XOR: { opcode: 0x26, args: ["dst", "any"] },
    NOT: { opcode: 0x27, args: ["dst"] },
    INC: { opcode: 0x28, args: ["dst"] },
    DEC: { opcode: 0x29, args: ["dst"] },
    SHL: { opcode: 0x2A, args: ["dst", "any"] },
    SHR: { opcode: 0x2B, args: ["dst", "any"] },
    MOD: { opcode: 0x2C, args: ["dst", "any"] },
    NEG: { opcode: 0x2D, args: ["dst"] },

    CMP: { opcode: 0x30, args: ["any", "any"] },

    JMP: { opcode: 0x31, args: ["any"] },
    JZ:  { opcode: 0x32, args: ["any"] },
    JNZ: { opcode: 0x33, args: ["any"] },
    JG:  { opcode: 0x34, args: ["any"] },
    JL:  { opcode: 0x35, args: ["any"] },
    JGE: { opcode: 0x36, args: ["any"] },
    JLE: { opcode: 0x37, args: ["any"] },

    PUSH: { opcode: 0x40, args: ["any"] },
    POP:  { opcode: 0x41, args: ["dst"] },
    CALL: { opcode: 0x42, args: ["any"] },
    RET:  { opcode: 0x43, args: [] },

    PRINT:   { opcode: 0x50, args: ["any"] },
    READKEY: { opcode: 0x51, args: ["dst", "any"] },
    WAITKEY: { opcode: 0x52, args: ["any"] },
    SLEEP:   { opcode: 0x53, args: ["any"] },
    BEEP:    { opcode: 0x54, args: ["any", "any"] }, // freq Hz, duration ms

    RAND: { opcode: 0x60, args: ["dst"] },
    TIME: { opcode: 0x62, args: ["dst"] }, // ms
    CLIPWRITE: { opcode: 0x63, args: ["any"] },
    STORELOCAL: { opcode: 0x64, args: ["any","any"] }, // key, data
    LOADLOCAL:  { opcode: 0x65, args: ["dst","any"] },
    DUMP: { opcode: 0x66, args: ["any","any"] }, // addr, size

    SETPIX: { opcode: 0x70, args: ["any", "any", "any"] },
    GETPIX: { opcode: 0x71, args: ["dst", "any", "any"] },
    PRESENT:{ opcode: 0x72, args: [] },
    FILL:   { opcode: 0x73, args: ["any"] },
    RECT:   { opcode: 0x74, args: ["any","any","any","any","any"] },
    LINE:   { opcode: 0x75, args: ["any","any","any","any","any"] },

    HALT: { opcode: 0xFF, args: [] }
};

const toHex = (val, size = 8) => '0x' + val.toString(16).toUpperCase().padStart(size, '0');

function assemble(source) {
    const lines = source.trim().split("\n");
    const labels = {};
    const output = [];

    const val = (x) => {
        if (labels[x] !== undefined) return labels[x];
        const s = x.toLowerCase();
        if (s.startsWith("0x")) return parseInt(s.slice(2), 16);
        if (s.startsWith("$")) return parseInt(s.slice(1), 16);
        return parseInt(x);
    };

    function encodeArg(p) {
        if (p.startsWith("R")) {
            return [0, parseInt(p.slice(1))];
        } else {
            const v = val(p);
            return [1, v & 0xFF, (v>>8)&0xFF, (v>>16)&0xFF, (v>>24)&0xFF];
        }
    }

    function sizeOf(parts, instr) {
        let size = 1;
        instr.args.forEach((_, i) => {
            const p = parts[i + 1];
            size += p.startsWith("R") ? 2 : 5;
        });
        return size;
    }

    // PASS 1
    let pc = 0;
    for (let raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith(";")) continue;

        if (line.endsWith(":")) {
            labels[line.slice(0, -1)] = pc;
            continue;
        }

        const parts = line.split(/[\s,]+/);
        pc += sizeOf(parts, INSTRUCTIONS[parts[0].toUpperCase()]);
    }

    // PASS 2
    for (let raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith(";") || line.endsWith(":")) continue;

        const parts = line.split(/[\s,]+/);
        const instr = INSTRUCTIONS[parts[0].toUpperCase()];

        if (!instr) throw new Error(`Unknown instruction: ${parts[0]}`);

        output.push(instr.opcode);

        instr.args.forEach((_, i) => {
            output.push(...encodeArg(parts[i + 1]));
        });
    }

    return output;
}

let cpu = new CPU(65536);
cpu.attachInput();

const defaultProgramText = `; Example Assembly Program
MOV R1, 1
LOOP:
PRINT R1
ADD R1, R1
CMP R1, 0
JNZ LOOP
HALT
`;

const hash = window.location.hash;
const saved = localStorage.getItem('cpu_program');

let initialProgramText;

if (hash.startsWith("#asm=")) {
    try {
        const encoded = hash.substring(5);
        initialProgramText = decodeURIComponent(escape(atob(encoded)));
    } catch {
        initialProgramText = defaultProgramText;
    }
} else if (saved) {
    initialProgramText = saved;
} else {
    initialProgramText = defaultProgramText;
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
    (_, i) => {
        const r = i + 1;
        const name = (r === cpu.SP) ? "SP" : `R${r}`;
        return ui.label({ text: `${name}: 0x00`, style: { minWidth: '70px' } });
    }
);

// Helper to chunk labels into rows so they don't overflow the screen
const regRows = [];
for (let i = 0; i < regLabels.length; i += 4) {
    regRows.push(ui.row({ style: { gap: '10px' } }, regLabels.slice(i, i + 4)));
}

const pcLabel = ui.label({ text: `PC: ${cpu.pc}` });

const speedSlider = ui.slider({ value: 500, min: 0, max: 1000 });

function getDelay() {
    const t = speedSlider.value / 1000;
    return 1000 * Math.pow(1 - t, 3);
}

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

    ui.divider(),

    
    ui.row({}, [pcLabel]),
    ui.row({}, [runningLabel]),

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

const outputPanel = ui.panel({ style: { width: '500px', height: '90%' } }, [
    ui.label({ text: "Terminal Output", style: { fontWeight: 'bold' } }),
    terminal,
    ui.button({
        text: 'Clear',
        onclick: () => { terminal.value = ''; }
    })
]);

outputPanel.position('left', 10, 50);
ui.mount(outputPanel, document.body);

let saveTimer;

const programEditor = ui.textarea({ 
    value: initialProgramText,
    oninput: () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            localStorage.setItem('cpu_program', programEditor.value);
        }, 200);
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
    autocomplete: 'off'
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
            localStorage.setItem('cpu_program', programEditor.value);
            filePicker.el.value = ''; 
        };
        reader.readAsText(file);
    }
});
ui.mount(filePicker, document.body);

const shareBtn = ui.button({
    text: 'Share URL',
    onclick: async () => {
        const code = programEditor.value;

        const encoded = btoa(unescape(encodeURIComponent(code)));
        const url = `${window.location.origin}${window.location.pathname}#asm=${encoded}`;

        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const w = window.open();
            if (w) {
                w.document.write(`<pre>${url}</pre>`);
                w.document.close();
            }
        }
    }
});

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
        shareBtn
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
    // Update general registers in hex
    regLabels.forEach((label, i) => {
        const r = i + 1;
        const name = (r === cpu.SP) ? "SP" : `R${r}`;
        label.text = `${name}: ${toHex(cpu.registers[r])}`;
    });

    // Update PC
    pcLabel.text = `PC: ${toHex(cpu.pc, 8)}`

    if (cpu.needsPresent) {
        drawDisplay();
        cpu.needsPresent = false;
    }
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
    cpu.ZF = cpu.SF = cpu.OF = 0;
    cpu.framebuffer.fill(0);
    cpu.waitingForKey = -1; 
    terminal.value = '--- System Reset ---\n';
    updateUI();
    drawDisplay();
}

const turboBatchSize = 10000;

function loop() {
    if (!isRunning) return;

    const now = performance.now();

    // Handle sleep first
    if (now < cpu.sleepUntil) {
        timerId = setTimeout(loop, cpu.sleepUntil - now);
        updateUI();
        return;
    }

    // Handle WAITKEY blocking
    if (cpu.waitingForKey !== -1) {
        const key = cpu.waitingForKey;

        if (!cpu.keyState[key]) {
            timerId = setTimeout(loop, isTurbo ? 0 : 1);
            updateUI();
            return;
        }

        cpu.waitingForKey = -1;
    }

    const steps = isTurbo ? turboBatchSize : 1;

    for (let i = 0; i < steps; i++) {
        // Stop conditions
        if (!isRunning) break;

        if (cpu.pc >= cpu.memory.length) {
            terminal.value += `--- End of Memory Reached ---\n`;
            stopMachine();
            break;
        }

        // Respect sleep and waitkey
        if (performance.now() < cpu.sleepUntil) break;
        if (cpu.waitingForKey !== -1) break;

        cpu.clock();
    }

    updateUI();

    // Schedule next tick
    timerId = setTimeout(
        loop,
        isTurbo ? 0 : getDelay()
    );
}

loadButton.el.click();