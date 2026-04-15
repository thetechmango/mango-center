import { ui } from '../ui.js';

const memory = new Uint8Array(65536);
const registers = new Uint32Array(16);
const SP = 15; // last register is stack pointer
registers[SP] = 0xFFFF; // Start at the end of 64k RAM
let pc = 0; // Program counter
let ZF = 0; // Zero flag
let timerId = null;
let isRunning = false;
let isTurbo = false; 

const INSTRUCTIONS = {
    LOAD:   { opcode: 0x10, args: ["reg", "val32"] }, 
    LOADM:  { opcode: 0x11, args: ["reg", "val32"] },
    STORE:  { opcode: 0x12, args: ["reg", "val32"] },
    MOV:    { opcode: 0x13, args: ["reg", "reg"] },
    LOADI:  { opcode: 0x14, args: ["reg", "reg"] },
    STOREI: { opcode: 0x15, args: ["reg", "reg"] },

    ADD: { opcode: 0x20, args: ["reg", "reg"] },
    SUB: { opcode: 0x21, args: ["reg", "reg"] },
    MUL: { opcode: 0x22, args: ["reg", "reg"] },
    DIV: { opcode: 0x23, args: ["reg", "reg"] },
    AND: { opcode: 0x24, args: ["reg", "reg"] },
    OR:  { opcode: 0x25, args: ["reg", "reg"] },
    XOR: { opcode: 0x26, args: ["reg", "reg"] },
    CMP: { opcode: 0x33, args: ["reg", "reg"] },
    SHL: { opcode: 0x2A, args: ["reg", "reg"] },
    SHR: { opcode: 0x2B, args: ["reg", "reg"] },

    NOT: { opcode: 0x27, args: ["reg"] },
    INC: { opcode: 0x28, args: ["reg"] },
    DEC: { opcode: 0x29, args: ["reg"] },

    JMP:  { opcode: 0x30, args: ["val32"] },
    JZ:   { opcode: 0x31, args: ["val32"] },
    JNZ:  { opcode: 0x32, args: ["val32"] },
    CALL: { opcode: 0x72, args: ["val32"] },

    PUSH:  { opcode: 0x70, args: ["reg"] },
    POP:   { opcode: 0x71, args: ["reg"] },
    PRINT: { opcode: 0x40, args: ["reg"] },
    RET:   { opcode: 0x73, args: [] },
    HALT:  { opcode: 0xFF, args: [] }
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

const initialProgramText = `
; Example Assembly Program
LOAD R0, 0x00000001
LOAD R1, 0x00000002
LOAD R2, 0x00000000

LOOP:
    PRINT R0
    MUL R0, R1
    CMP R0, R2
    JNZ LOOP
    HALT
`;

const program = assemble(initialProgramText);

// Load into memory
for (let i = 0; i < program.length; i++) {
    memory[i] = program[i];
}

function clock() {
    const opCode = memory[pc++];

    const read32 = () => {
        const val = (memory[pc] | (memory[pc+1] << 8) | (memory[pc+2] << 16) | (memory[pc+3] << 24)) >>> 0;
        pc += 4;
        return val;
    };

    const memRead32 = (addr) => (memory[addr] | (memory[addr+1] << 8) | (memory[addr+2] << 16) | (memory[addr+3] << 24)) >>> 0;
    
    const memWrite32 = (addr, val) => {
        memory[addr]     = val & 0xFF;
        memory[addr + 1] = (val >> 8) & 0xFF;
        memory[addr + 2] = (val >> 16) & 0xFF;
        memory[addr + 3] = (val >> 24) & 0xFF;
    };

    switch (opCode) {
        case 0x00: break;

        case INSTRUCTIONS.LOAD.opcode:
            registers[memory[pc++]] = read32();
            break;

        case INSTRUCTIONS.LOADM.opcode: {
            const r = memory[pc++];
            const addr = read32();
            registers[r] = memRead32(addr);
            break;
        }

        case INSTRUCTIONS.STORE.opcode: {
            const r = memory[pc++];
            const addr = read32();
            memWrite32(addr, registers[r]);
            break;
        }

        case INSTRUCTIONS.MOV.opcode: {
            const rDest = memory[pc++];
            const rSrc = memory[pc++];
            registers[rDest] = registers[rSrc];
            break;
        }

        case INSTRUCTIONS.LOADI.opcode: {
            const rDest = memory[pc++];
            const rPtr = memory[pc++];
            registers[rDest] = memRead32(registers[rPtr]);
            break;
        }

        case INSTRUCTIONS.STOREI.opcode: {
            const rPtr = memory[pc++];
            const rSrc = memory[pc++];
            memWrite32(registers[rPtr], registers[rSrc]);
            break;
        }

        case INSTRUCTIONS.ADD.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] + registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.SUB.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] - registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.MUL.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] * registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.DIV.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = Math.floor(registers[rA] / registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.INC.opcode: registers[memory[pc++]]++; break;
        case INSTRUCTIONS.DEC: registers[memory[pc++]]--; break;

        case INSTRUCTIONS.AND.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] & registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.OR.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] | registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.XOR.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] ^ registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.NOT.opcode: {
            const r = memory[pc++];
            registers[r] = (~registers[r]) >>> 0;
            break;
        }

        case INSTRUCTIONS.SHL.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] << registers[rB]) >>> 0;
            break;
        }

        case INSTRUCTIONS.SHR.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            registers[rA] = (registers[rA] >>> registers[rB]);
            break;
        }

        case INSTRUCTIONS.CMP.opcode: {
            const rA = memory[pc++]; const rB = memory[pc++];
            ZF = (registers[rA] === registers[rB]) ? 1 : 0;
            break;
        }

        case INSTRUCTIONS.JMP.opcode: pc = read32(); break;

        case INSTRUCTIONS.JZ.opcode: {
            const addr = read32();
            if (ZF === 1) pc = addr;
            break;
        }

        case INSTRUCTIONS.JNZ.opcode: {
            const addr = read32();
            if (ZF === 0) pc = addr;
            break;
        }

        case INSTRUCTIONS.PUSH.opcode: {
            const r = memory[pc++];
            registers[SP] -= 4;
            memWrite32(registers[SP], registers[r]);
            break;
        }

        case INSTRUCTIONS.POP.opcode: {
            const r = memory[pc++];
            registers[r] = memRead32(registers[SP]);
            registers[SP] += 4;
            break;
        }

        case INSTRUCTIONS.CALL.opcode: {
            const target = read32();
            registers[SP] -= 4;
            memWrite32(registers[SP], pc);
            pc = target;
            break;
        }
        
        case INSTRUCTIONS.RET.opcode: {
            pc = memRead32(registers[SP]);
            registers[SP] += 4;
            break;
        }

        case INSTRUCTIONS.PRINT.opcode: {
            const val = registers[memory[pc++]];
            terminal.value += val + '\n';
            terminal.el.scrollTop = terminal.el.scrollHeight;
            break;
        }

        case INSTRUCTIONS.HALT.opcode:
            stopMachine();
            terminal.value += '--- System Halted ---\n';
            break;

        default:
            console.log("Unknown opcode:", opCode);
            break;
    }
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
    { length: registers.length - 1 }, 
    (_, i) => ui.label({ text: `R${i}: 0x00`, style: { minWidth: '70px' } })
);

// Helper to chunk labels into rows so they don't overflow the screen
const regRows = [];
for (let i = 0; i < regLabels.length; i += 4) {
    regRows.push(ui.row({ style: { gap: '10px' } }, regLabels.slice(i, i + 4)));
}

const spLabel = ui.label({ text: `SP: ${registers[SP]}` });
const pcLabel = ui.label({ text: `PC: ${pc}` });

const speedSlider = ui.slider({ value: 500, min: 10, max: 1000 });

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
            memory.fill(0); // Optional: clear old memory
            for (let i = 0; i < bytes.length; i++) memory[i] = bytes[i];
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

function updateUI() {
    // Update general registers in Hex
    regLabels.forEach((label, i) => {
        label.text = `R${i}: ${toHex(registers[i])}`;
    });

    // Update Special registers (SP and PC are usually 16-bit addresses, so 4 digits)
    spLabel.text = `SP: ${toHex(registers[SP])}`;
    pcLabel.text = `PC: ${toHex(pc, 8)}`;
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
    clock();
    updateUI();
}

function resetMachine() {
    stopMachine();
    pc = 0;
    registers.fill(0);
    registers[15] = 0xFF; // SP
    ZF = 0;
    terminal.value = '--- System Reset ---\n';
    updateUI();
}

function loop() {
    if (!isRunning) return;

    if (isTurbo) {
        // Turbo mode
        let ticks = 0;
        const maxTicks = 100000;

        while (isRunning) {
            if (ticks > maxTicks) {
                terminal.value += `--- Turbo Tick Limit Reached ---\n`;
                break;
            }
            clock();
            ticks++;
        }
        stopMachine();
        updateUI();
    } else {
        // Normal Mode
        clock();
        updateUI();
        timerId = setTimeout(loop, 1010 - speedSlider.value);
    }
}

loadButton.el.click();