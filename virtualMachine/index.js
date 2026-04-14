import { ui } from '../ui.js';

const memory = new Uint8Array(65536);
const registers = new Uint8Array(8);
const SP = 7; // last register is stack pointer
registers[SP] = 0xFF; // stack starts at top of RAM
let pc = 0; // Program counter
let ZF = 0; // Zero flag
let timerId = null;
let isRunning = false;
let isTurbo = false; 

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

    PUSH: 0x70,
    POP:  0x71,
    CALL: 0x72,
    RET:  0x73,

    MOV: 0x13,

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
        else if (instr === "MOV") pc += 3;
        else if (["ADD","SUB","MUL","DIV","AND","OR","XOR","CMP"].includes(instr)) pc += 3;
        else if (["NOT","PRINT"].includes(instr)) pc += 2;
        else if (["JMP","JZ","JNZ"].includes(instr)) pc += 2;
        else if (["PUSH","POP","CALL"].includes(instr)) pc += 2;
        else if (instr === "RET") pc += 1;
        else if (instr === "HALT") pc += 1;
        else throw new Error("Unknown instruction: " + instr);
    }

    console.log("LABELS:", labels);

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

            case "PUSH":
            case "POP":
                output.push(OPCODES[instr], reg(parts[1]));
                break;
            
            case "CALL":
                output.push(OPCODES.CALL, val(parts[1]));
                break;
            
            case "RET":
                output.push(OPCODES.RET);
                break;

            case "MOV":
                output.push(OPCODES.MOV, reg(parts[1]), reg(parts[2]));
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

const initialProgramText = `
LOAD R0, 1
CALL A
HALT

A:
    LOAD R0, 2
    PUSH R0      ; Save R0 (which is 2) onto the stack
    CALL B
    POP R0       ; Restore R0 from the stack after B returns
    PRINT R0     ; Print 2 from the restored register
    RET

B:
    LOAD R0, 3
    PRINT R0     ; Prints 3
    RET
`;

const program = assemble(initialProgramText);

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

        case OPCODES.LOAD: { // LOAD r, immediate
            const r = memory[pc++];
            const value = memory[pc++];
            registers[r] = value;
            break;
        }

        case OPCODES.LOADM: { // LDR r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            registers[r] = memory[addr];
            break;
        }

        case OPCODES.STORE: { // STR r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            memory[addr] = registers[r];
            break;
        }

        case OPCODES.ADD: { // ADD rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] + registers[rB];
            break;
        }

        case OPCODES.SUB: { // SUB rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] - registers[rB];
            break;
        }

        case OPCODES.MUL: { // MUL rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] * registers[rB];
            break;
        }

        case OPCODES.DIV: { // DIV rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = Math.floor(registers[rA] / registers[rB]);
            break;
        }

        case OPCODES.AND: { // AND rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] & registers[rB]
            break;
        }

        case OPCODES.OR: { // OR rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] | registers[rB];
            break;
        }

        case OPCODES.XOR: { // XOR rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            registers[rA] = registers[rA] ^ registers[rB];
            break;
        }

        case OPCODES.NOT: {
            const r = memory[pc++];
            registers[r] = (~registers[r]) & 0xFF; // Keep it 8-bit
            break;
        }

        case OPCODES.JMP: { // JMP addr
            const addr = memory[pc++];
            pc = addr;
            break;
        }

        case OPCODES.JZ: { // JZ addr
            const addr = memory[pc++];
            if (ZF === 1) pc = addr;
            break;
        }
        
        case OPCODES.JNZ: { // JNZ addr
            const addr = memory[pc++];
            if (ZF === 0) pc = addr;
            break;
        }        

        case OPCODES.CMP: { // CMP rA, rB
            const rA = memory[pc++];
            const rB = memory[pc++];
            ZF = (registers[rA] === registers[rB]) ? 1 : 0;
            break;
        }
        
        case OPCODES.PRINT: { // PRINT r
            const r = memory[pc++];
            const value = registers[r];

            console.log(registers[r]);
            // Append to the UI Textarea
            terminal.value += value + '\n';
            
            // Scroll to the bottom
            terminal.el.scrollTop = terminal.el.scrollHeight;
            break;
        }

        case OPCODES.PUSH: {
            const r = memory[pc++];      // which register to push
            registers[SP]--;             // move stack pointer down
            memory[registers[SP]] = registers[r];  // store value
            break;
        }
        
        case OPCODES.POP: {
            const r = memory[pc++]; // which register to pop into
            registers[r] = memory[registers[SP]];
            registers[SP]++; // move stack pointer up
            break;
        }

        case OPCODES.CALL: {
            const addr = memory[pc++]; // function address
        
            // push return address
            registers[SP]--;
            memory[registers[SP]] = pc;
        
            // jump to function
            pc = addr;
            break;
        }

        case OPCODES.RET: {
            pc = memory[registers[SP]];
            registers[SP]++;
            break;
        }

        case OPCODES.MOV: { // MOV rDest, rSrc
            const rDest = memory[pc++];
            const rSrc = memory[pc++];
            registers[rDest] = registers[rSrc];
            break;
        }        
        
        case OPCODES.HALT: {
            stopMachine();
            terminal.value += '--- System Halted ---\n';
            console.log("HALT");
            break;
        }

        default: {
            console.log("Unknown opcode:", opCode);
            break;
        }
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

const regLabels = Array.from({length: 7}, (_, i) => ui.label({ text: `R${i}: 0` }));
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
    ui.row({}, regLabels),
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
        height: '600px',
        width: '100%',
        padding: '10px',
        fontFamily: 'monospace',
        color: '#eee',
        backgroundColor: '#1e1e1e',
        wrap: 'off',
        whiteSpace: 'pre'
    } 
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

const programPanel = ui.panel({ style: { width: '500px'} }, [
    ui.label({ text: "Program Editor", style: { fontWeight: 'bold' } }),
    programEditor,
    ui.row({}, [
        loadButton,
        exportBtn,
        importBtn,
        ui.button({ text: '🗑️ Clear', onclick: () => {
            if(confirm("Clear editor?")) programEditor.value = '';
        }})
    ])
]);

programPanel.position('right', 10, 50);
ui.mount(programPanel, document.body);

function updateUI() {
    // Update the numbered registers
    regLabels.forEach((label, i) => {
        label.el.innerText = `R${i}: ${registers[i]}`;
    });

    // Update the special labels
    spLabel.el.innerText = `SP: ${registers[SP]}`;
    pcLabel.el.innerText = `PC: ${pc}`;
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
    registers[7] = 0xFF; // SP
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