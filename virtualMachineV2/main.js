import { createUI } from "./app-ui.js";
import { CPU } from "./cpu.js";
import { OPCODES } from "./isa.js";

let cpu = new CPU();

let isRunning = false;
let isTurbo = false;
let timerId = null;

/* ---------------- ASSEMBLER ---------------- */

function assemble(source) {
    const lines = source.trim().split("\n");
    const labels = {};
    const output = [];

    const reg = (n) => {
        if (!n) return 0;
        return parseInt(n.substring(1));
    };

    const val = (x) => {
        if (!x) return 0;
        if (labels[x] !== undefined) return labels[x];

        const s = x.toLowerCase();
        if (s.startsWith("0x")) return parseInt(s.slice(2), 16);
        if (s.startsWith("$")) return parseInt(s.slice(1), 16);
        return parseInt(x);
    };

    // PASS 1
    let pc = 0;
    for (let raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith(";")) continue;

        if (line.endsWith(":")) {
            labels[line.slice(0, -1)] = pc;
            continue;
        }

        pc += 5;
    }

    // PASS 2
    for (let raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith(";") || line.endsWith(":")) continue;

        const parts = line.split(/[\s,]+/);
        const mnemonic = parts[0].toUpperCase();

        const opcode = OPCODES[mnemonic];
        if (opcode === undefined) {
            throw new Error(`Unknown instruction: ${mnemonic}`);
        }

        let rd = 0, r1 = 0, r2 = 0, imm = 0;

        const args = parts.slice(1);

        // collect registers and immediates in order
        const regs = args.filter(a => a.toUpperCase().startsWith("R"));
        const imms = args.filter(a => !a.toUpperCase().startsWith("R"));

        // assign registers in order
        if (regs[0]) rd = parseReg(regs[0]);
        if (regs[1]) r1 = parseReg(regs[1]);
        if (regs[2]) r2 = parseReg(regs[2]);

        // assign first immediate (you only have one anyway)
        if (imms[0]) imm = parseVal(imms[0]);
        output.push(opcode, rd, r1, r2, imm);
    }

    console.log(output);
    return output;
}

function parseReg(x) {
    if (!x) return 0;
    if (!x.startsWith("R")) throw new Error(`Expected register, got ${x}`);
    return parseInt(x.slice(1));
}

function parseVal(x) {
    if (!x) return 0;

    const s = x.toLowerCase();
    if (s.startsWith("0x")) return parseInt(s.slice(2), 16);
    if (s.startsWith("$")) return parseInt(s.slice(1), 16);
    return parseInt(x);
}

/* ---------------- CONTROL API ---------------- */

const ctrl = {
    assemble,

    startMachine,
    stopMachine,
    stepMachine,
    resetMachine,

    isTurbo: () => isTurbo,
    setTurbo: (v) => (isTurbo = v),

    getTerminal: () => ui.terminal
};

/* ---------------- EXECUTION ---------------- */

function startMachine() {
    if (isRunning) return;
    isRunning = true;

    if (ui.runningLabel) {
        ui.runningLabel.text = "Running";
    }

    if (timerId) clearTimeout(timerId);
    loop();
}

function stopMachine() {
    isRunning = false;
    if (timerId) clearTimeout(timerId);
    timerId = null;

    if (ui.runningLabel) {
        ui.runningLabel.text = "Stopped";
    }
}

function stepMachine() {
    stopMachine();
    stepCPU();
    updateUI();
}

function resetMachine() {
    stopMachine();
    cpu.reset();

    if (ui.terminal) {
        ui.terminal.value = "--- System Reset ---\n";
    }

    updateUI();
}

function stepCPU() {
    const res = cpu.clock();

    if (res?.type === "PRINT") {
        ui.terminal.value += res.value + "\n";
    }

    return res;
}

function runNormal() {
    const res = stepCPU();

    if (res?.type === "HALT") {
        isRunning = false;
        return;
    }

    timerId = setTimeout(loop, Math.max(0, 1010 - (ui.speedSlider?.value ?? 900)));
}

function runTurbo() {
    let ticks = 0;
    const maxTicks = 100000;

    while (isRunning && ticks++ < maxTicks) {
        const res = stepCPU();

        if (res?.type === "HALT") {
            isRunning = false;
            break;
        }
    }

    if (ticks >= maxTicks) {
        ui.terminal.value += "--- Turbo Tick Limit Reached ---\n";
    }
}

function loop() {
    if (!isRunning) return;

    if (isTurbo) {
        runTurbo();
        updateUI();
        return;
    }

    runNormal();
    updateUI();
}

function updateUI() {
    if (ui.updateUI) ui.updateUI();
}

const ui = createUI(cpu, ctrl);