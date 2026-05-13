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

// Run it manually once on page initialization
resetUI();

// Connect/Disconnect Toggle Action
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
        
        // Trap port acquisition failures cleanly
        try {
            await port.open({ baudRate: selectedBaud });
        } catch (openError) {
            if (openError.name === 'NetworkError') {
                alert('Connection Failed: This port is already open in another program (like the Arduino IDE or another tab). Close that program and try again.');
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

        // Isolated Try-Catch: Prevents a sudden hardware drop from triggering a manual disconnect cascade
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

    // 1. Stop reader
    if (reader) {
        try { await reader.cancel(); } catch(e){}
        try { reader.releaseLock(); } catch(e){}
        reader = null;
    }

    // 2. Abort the pipeTo() promise
    if (readableStreamClosed) {
        try { await readableStreamClosed.catch(() => {}); } catch(e){}
        readableStreamClosed = null;
    }

    // 3. Abort TextDecoderStream
    if (textDecoderStream) {
        try { await textDecoderStream.writable.abort(); } catch(e){}
        try { await textDecoderStream.readable.cancel(); } catch(e){}
        textDecoderStream = null;
    }

    // 4. Release writer
    if (outputStream) {
        try { outputStream.releaseLock(); } catch(e){}
        outputStream = null;
    }

    // 5. Close the port
    if (port) {
        try { await port.close(); } catch(e){}
        port = null;
    }

    // 6. Reset UI
    resetUI();
}

// Send Input Text handler (Supports both Line mode and Immediate mode)
serialInput.addEventListener('keydown', async (event) => {
    if (!port || !outputStream) return;

    const isImmediate = immediateModeCheck.checked;

    if (isImmediate) {
        // Prevent default actions for immediate mode typing
        event.preventDefault();

        // Ignore utility/modifier key signals (Shift, Control, CapsLock, Arrows, etc.)
        if (event.key.length > 1 && event.key !== 'Enter' && event.key !== 'Backspace') {
            return;
        }

        let charToSend = event.key;
        
        // Map native action naming keys to standard ASCII equivalents
        if (charToSend === 'Enter') charToSend = '\n';
        if (charToSend === 'Backspace') charToSend = '\b'; // Sends ASCII Backspace character

        try {
            const encoder = new TextEncoder();
            const encodedData = encoder.encode(charToSend);
            await outputStream.write(encodedData);
        } catch (error) {
            console.error('Failed to send character:', error);
        }
    } else {
        // Standard Line Mode operation (Sends whole string upon pressing Enter)
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
                // 1. Fetch a fresh array of authorized devices from the browser cache
                const allowedPorts = await navigator.serial.getPorts();
                if (allowedPorts.length === 0) return;

                // 2. Extract the fresh, active hardware pointer instance
                const freshPort = allowedPorts[0]; 

                // 3. Open the fresh port instance directly
                await freshPort.open({ baudRate: lastSelectedBaud });
                
                // 4. Update your global variable to match the working reference
                port = freshPort; 
                
                // Success! Re-establish functional code pipelines
                clearInterval(autoReconnectInterval);
                autoReconnectInterval = null;
                
                connectBtn.textContent = "Disconnect";
                connectBtn.style.background = ""; // Revert to your CSS default
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

// Run settings loader on script startup
loadSavedSettings();