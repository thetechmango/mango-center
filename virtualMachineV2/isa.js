export const OPCODES = {
    NOP:    0x00,
    MOV:    0x01,
    LOAD:   0x10,
    LOADI:  0x13,
    STORE:  0x11,
    STOREI: 0x12,
    ADD:    0x20,
    PRINT:  0x40,
    HALT:   0xFF
};

export const ISA = {
    [OPCODES.NOP]:  () => {},

    [OPCODES.MOV]:  (cpu, i) => {
        cpu.registers[i.rd] = cpu.registers[i.r1];
    },

    [OPCODES.LOAD]: (cpu, i) => {
        const addr = (cpu.registers[i.r1] + i.imm) & 0xFFFF;
        cpu.registers[i.rd] = cpu.memory[addr];
    },

    [OPCODES.LOADI]: (cpu, i) => {
        cpu.registers[i.rd] = i.imm;
    },

    // mem[base + imm] = value
    [OPCODES.STORE]: (cpu, i) => {
        const addr = (cpu.registers[i.rd] + i.imm) & 0xFFFF;
        cpu.memory[addr] = cpu.registers[i.r1] & 0xFF;
    },

    // mem[imm] = value
    [OPCODES.STOREI]: (cpu, i) => {
        const addr = i.imm & 0xFFFF;
        cpu.memory[addr] = cpu.registers[i.rd] & 0xFF;
    },

    [OPCODES.ADD]:  (cpu, i) => {
        cpu.registers[i.rd] =
            cpu.registers[i.r1] + cpu.registers[i.r2];
    },

    [OPCODES.PRINT]: (cpu, i) => {
        return { type: "PRINT", value: cpu.registers[i.rd] };
    },

    [OPCODES.HALT]: () => {
        return { type: "HALT" };
    }
};
