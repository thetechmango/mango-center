const connectBtn = document.getElementById('connectBtn');
const clearBtn = document.getElementById('clearBtn');
const consoleDiv = document.getElementById('console');
const serialInput = document.getElementById('serialInput');
const baudRateSelect = document.getElementById('baudRate');
const immediateModeCheck = document.getElementById('immediateMode');
const autoReconnectCheck = document.getElementById('autoReconnect');

let port = null;
let reader = null;
let outputStream = null;
let textDecoderStream = null;
let readableStreamClosed = null;
let keepReading = true;
let isManuallyDisconnecting = false;
let autoReconnectInterval = null;
let lastSelectedBaud = 115200;


function resetUI() {
    connectBtn.textContent = "Connect to device";
    connectBtn.style.background = ""; // Reset inline color modifications
    connectBtn.classList.remove('connected');
    serialInput.disabled = true;
    baudRateSelect.disabled = false;
    serialInput.value = '';
}

resetUI();

// Connect/Disconnect
connectBtn.addEventListener('click', async () => {
    if (port) {
        await disconnect();
        return;
    }

    if (!('serial' in navigator)) {
        alert('Web Serial API is not supported in this browser. Please use Chrome or Edge.');
        return;
    }

    try {
        port = await navigator.serial.requestPort();
        
        const selectedBaud = parseInt(baudRateSelect.value, 10);
        lastSelectedBaud = selectedBaud;
        isManuallyDisconnecting = false; 
        clearInterval(autoReconnectInterval);
        autoReconnectInterval = null;
        
        try {
            await port.open({ baudRate: selectedBaud });
        } catch (openError) {
            if (openError.name === 'NetworkError') {
                alert('Connection Failed: This port is already open in another program. Close that program and try again.');
            } else {
                alert('Could not open serial port: ' + openError.message);
            }
            port = null; // Unbind the failed instance
            resetUI();
            return;
        }
        
        // Update UI state
        connectBtn.textContent = "Disconnect";
        connectBtn.classList.add('connected');
        serialInput.disabled = false;
        baudRateSelect.disabled = true;
        serialInput.focus();

        outputStream = port.writable.getWriter();

        keepReading = true;
        textDecoderStream = new TextDecoderStream();
        readableStreamClosed = port.readable.pipeTo(textDecoderStream.writable);
        reader = textDecoderStream.readable.getReader();

        try {
            while (keepReading) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                if (value) {
                    consoleDiv.innerText += value;
                    consoleDiv.scrollTop = consoleDiv.scrollHeight;
                }
            }
        } catch (readError) {
            console.warn("Live reading stream closed due to hardware detachment.");
        }
        
    } catch (error) {
        console.error('Serial error:', error);
        await disconnect();
    }
});

async function disconnect() {
    isManuallyDisconnecting = true;

    clearInterval(autoReconnectInterval);
    autoReconnectInterval = null;

    keepReading = false;

    if (reader) {
        try { await reader.cancel(); } catch(e){}
        try { reader.releaseLock(); } catch(e){}
        reader = null;
    }

    if (readableStreamClosed) {
        try { await readableStreamClosed.catch(() => {}); } catch(e){}
        readableStreamClosed = null;
    }

    if (textDecoderStream) {
        try { await textDecoderStream.writable.abort(); } catch(e){}
        try { await textDecoderStream.readable.cancel(); } catch(e){}
        textDecoderStream = null;
    }

    if (outputStream) {
        try { outputStream.releaseLock(); } catch(e){}
        outputStream = null;
    }

    if (port) {
        try { await port.close(); } catch(e){}
        port = null;
    }

    resetUI();
}

// Send Input Text handler (Supports both Line mode and Immediate mode)
serialInput.addEventListener('keydown', async (event) => {
    if (!port || !outputStream) return;

    const isImmediate = immediateModeCheck.checked;

    if (isImmediate) {
        // Ignore isolated modifier keys on their own
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
            return;
        }

        // Prevent default browser behavior ONLY after ensuring it's not a global system shortcut
        if (event.metaKey && event.key !== 'c' && event.key !== 'v') return; 
        event.preventDefault();

        const encoder = new TextEncoder();
        let encodedData;

        // Process Ctrl combinations (ASCII Control Characters)
        if (event.ctrlKey) {
            const code = event.key.toUpperCase().charCodeAt(0);
            if (code >= 65 && code <= 90) { // A-Z
                const controlByte = code - 64; // Maps A->1, B->2, C->3, etc.
                encodedData = new Uint8Array([controlByte]);
            } else {
                return; // Ignore unsupported Ctrl combos
            }
        } 
        // Handle individual action keys
        else if (event.key === 'Enter') {
            encodedData = encoder.encode('\n');
        } else if (event.key === 'Backspace') {
            encodedData = new Uint8Array([0x08]); // Standard ASCII Backspace
        } else if (event.key === 'Delete') {
            encodedData = new Uint8Array([0x7F]); // Standard ASCII Delete
        } else if (event.key === 'ArrowUp') {
            encodedData = encoder.encode('\x1b[A'); // ANSI Escape sequences for arrows
        } else if (event.key === 'ArrowDown') {
            encodedData = encoder.encode('\x1b[B');
        } else if (event.key === 'ArrowRight') {
            encodedData = encoder.encode('\x1b[C');
        } else if (event.key === 'ArrowLeft') {
            encodedData = encoder.encode('\x1b[D');
        } 
        // Handle all standard printable characters (Length 1 ensures safety)
        else if (event.key.length === 1) {
            encodedData = encoder.encode(event.key);
        } else {
            return; // Ignore dead keys, function keys (F1-F12), etc.
        }

        try {
            await outputStream.write(encodedData);
        } catch (error) {
            console.error('Failed to send character:', error);
        }

    } else {
        // Standard Line Mode operation
        if (event.key === 'Enter') {
            const dataToSend = serialInput.value;
            if (dataToSend.length === 0) return;

            try {
                const encoder = new TextEncoder();
                const encodedData = encoder.encode(dataToSend + '\n');
                await outputStream.write(encodedData);
                
                serialInput.value = '';
            } catch (error) {
                console.error('Failed to send line data:', error);
            }
        }
    }
});


// Watchdog listener for unexpected physical hardware drops
navigator.serial.addEventListener('disconnect', async (event) => {
    // If the dropped port matches our active connection and we didn't press Disconnect
    if (port && event.target === port && !isManuallyDisconnecting) {
        
        // Check if the user turned off the auto-reconnect feature
        if (!autoReconnectCheck.checked) {
            console.warn('Hardware link lost. Auto-reconnect is disabled by user.');
            await disconnect(); // Cleanly revert directly back to a base disconnected UI state
            return;
        }

        console.warn('Hardware link lost unexpectedly! Initiating auto-reconnect loop...');
        
        // Clean up internal stream state without wiping port selection parameters
        keepReading = false;
        if (reader) { try { reader.releaseLock(); } catch(e){} reader = null; }
        if (outputStream) { try { outputStream.releaseLock(); } catch(e){} outputStream = null; }
        try { await port.close(); } catch(e){}
        
        // Visual indicator that system is searching for the hardware link
        connectBtn.textContent = "Reconnecting...";
        connectBtn.style.background = "#d4af37"; // Amber color
        serialInput.disabled = true;

        // Poll every 1 second until the exact device re-appears on the USB bus
        autoReconnectInterval = setInterval(async () => {
            try {
                // Fetch a fresh array of authorized devices from the browser cache
                const allowedPorts = await navigator.serial.getPorts();
                if (allowedPorts.length === 0) return;
                const freshPort = allowedPorts[0]; 
                await freshPort.open({ baudRate: lastSelectedBaud });

                port = freshPort;

                clearInterval(autoReconnectInterval);
                autoReconnectInterval = null;
                
                connectBtn.textContent = "Disconnect";
                connectBtn.style.background = "";
                serialInput.disabled = false;
                serialInput.focus();

                outputStream = port.writable.getWriter();
                keepReading = true;
                textDecoderStream = new TextDecoderStream();
                port.readable.pipeTo(textDecoderStream.writable);
                reader = textDecoderStream.readable.getReader();

                // Re-launch background read loop
                while (keepReading) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        consoleDiv.innerText += value;
                        consoleDiv.scrollTop = consoleDiv.scrollHeight;
                    }
                }
            } catch (err) {
                // Device is still physically unplugged or locked by the system; keep waiting
                console.log('Searching for device port...');
            }
        }, 1000);
    }
});

// Clear display box helper
clearBtn.addEventListener('click', () => {
    consoleDiv.innerText = '';
});

function loadSavedSettings() {
    const savedBaud = localStorage.getItem('webSerial_baudRate');
    if (savedBaud) baudRateSelect.value = savedBaud;

    const savedImmediate = localStorage.getItem('webSerial_immediateMode');
    if (savedImmediate !== null) {
        immediateModeCheck.checked = (savedImmediate === 'true');
    }

    const savedAutoReconnect = localStorage.getItem('webSerial_autoReconnect');
    if (savedAutoReconnect !== null) {
        autoReconnectCheck.checked = (savedAutoReconnect === 'true');
    }
}

// Bind change event listeners to update local storage instantly
baudRateSelect.addEventListener('change', () => {
    localStorage.setItem('webSerial_baudRate', baudRateSelect.value);
});

immediateModeCheck.addEventListener('change', () => {
    localStorage.setItem('webSerial_immediateMode', immediateModeCheck.checked);
});

autoReconnectCheck.addEventListener('change', () => {
    localStorage.setItem('webSerial_autoReconnect', autoReconnectCheck.checked);
});

loadSavedSettings();