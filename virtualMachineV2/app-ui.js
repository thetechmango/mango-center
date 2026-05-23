import { ui } from '../ui.js';

export function createUI(cpu, ctrl) {

    Object.assign(ui.defaults.global, {
        accentColor: '#5f5',
        transition: 'all 0.05s ease-out'
    });

    Object.assign(ui.defaults.divider, {
        backgroundColor: ui.defaults.global.accentColor
    });

    ui.defaults.panel = {
        background: '#2e2e2e',
        borderRadius: '14px',
        border: '2px solid #555',
        gap: '10px',
        padding: '10px'
    };

    Object.assign(ui.defaults.label, {
        color: '#fff'
    });

    Object.assign(ui.defaults.button, {
        backgroundColor: ui.defaults.global.accentColor,
        hover: {
            filter: 'brightness(1.5)',
            transform: 'scale(1.02)'
        },
        active: {
            filter: 'brightness(0.8)',
            transform: 'scale(0.98)'
        },
        flex: '1'
    });

    const regLabels = Array.from(
        { length: cpu.registers.length },
        (_, i) => ui.label({ text: `R${i}: 0x00`, style: { minWidth: '70px' } })
    );

    const regRows = [];
    for (let i = 0; i < regLabels.length; i += 4) {
        regRows.push(ui.row({ style: { gap: '10px' } }, regLabels.slice(i, i + 4)));
    }

    const spLabel = ui.label({ text: `SP: 0x${cpu.registers[cpu.SP].toString(16).toUpperCase()}` });
    const pcLabel = ui.label({ text: `PC: 0x${cpu.pc.toString(16).toUpperCase()}` });

    const speedSlider = ui.slider({ value: 900, min: 10, max: 1000 });

    const runningLabel = ui.label({ text: 'Stopped' });

    const turboButton = ui.button({
        text: 'Turbo Mode: off',
        onclick: () => {
            ctrl.setTurbo(!ctrl.isTurbo());
            turboButton.text = 'Turbo Mode: ' + (ctrl.isTurbo() ? 'on' : 'off');
        }
    });

    const dashboard = ui.panel({}, [
        ui.label({ text: 'Registers' }),
        ...regRows,
        ui.row({}, [spLabel, pcLabel]),
        ui.divider(),
        ui.row({}, [runningLabel]),
        ui.row({}, [
            ui.button({ text: 'Resume', onclick: () => ctrl.startMachine() }),
            ui.button({ text: 'Halt', onclick: () => ctrl.stopMachine() }),
            ui.button({ text: 'Step', onclick: () => ctrl.stepMachine() }),
            ui.button({ text: 'Reset', onclick: () => ctrl.resetMachine() })
        ]),
        ui.row({}, [turboButton]),
        ui.label({ text: 'Clock speed' }),
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
            color: '#0f0'
        },
        disabled: true
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
        value: localStorage.getItem('cpu_program') || '',
        oninput: () => {
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
        spellcheck: false
    });

    const loadButton = ui.button({
        text: 'Assemble & Load',
        onclick: () => {
            try {
                const bytes = ctrl.assemble(programEditor.value);

                cpu.memory.fill(0);
                cpu.memory.set(bytes);

                ctrl.resetMachine();

                ctrl.getTerminal().value +=
                    `Assembly successful: ${bytes.length} bytes loaded.\n`;
            } catch (e) {
                ctrl.getTerminal().value += `Error: ${e.message}\n`;
            }
        }
    });

    const exportBtn = ui.button({
        text: 'Export .asm',
        onclick: () => {
            const blob = new Blob([programEditor.value], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            const link = ui.el('a', {
                href: url,
                download: 'program.asm'
            });

            link.el.click();
            URL.revokeObjectURL(url);
        }
    });

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
        onclick: () => filePicker.el.click()
    });

    const programPanel = ui.panel({ style: { width: '500px', height: '90%' } }, [
        ui.label({ text: "Program Editor", style: { fontWeight: 'bold' } }),
        programEditor,
        ui.row({}, [
            loadButton,
            exportBtn,
            importBtn,
            ui.button({
                text: 'Clear',
                onclick: () => {
                    if (confirm("Clear editor?")) programEditor.value = '';
                }
            })
        ])
    ]);

    programPanel.position('right', 10, 50);
    ui.mount(programPanel, document.body);

    function updateUI() {
        regLabels.forEach((label, i) => {
            const hex = (v) =>
                "0x" + v.toString(16).toUpperCase().padStart(8, "0");
            label.text = `R${i}: ${hex(cpu.registers[i])}`;
        });

        spLabel.text = `SP: 0x${cpu.registers[cpu.SP].toString(16).toUpperCase()}`;
        pcLabel.text = `PC: 0x${cpu.pc.toString(16).toUpperCase()}`;
    }

    return {
        updateUI,
        terminal,
        speedSlider,
        runningLabel
    };
}