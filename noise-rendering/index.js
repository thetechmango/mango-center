const main = document.getElementById("canvas");
const mask = document.getElementById("maskCanvas");

const mainCtx = main.getContext("2d", { willReadFrequently: true });
const maskCtx = mask.getContext("2d", { willReadFrequently: true });

let paused = false;

const noiseTypes = ["normal", "binary", "color", "rgb"];
const motionTypes = ["randomize", "up", "down", "left", "right"];

let noiseType = 0;
let motionType = 0;

// Resize canvases
function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    main.width = w;
    main.height = h;
    mask.width = w;
    mask.height = h;
}
window.addEventListener("resize", () => {
    resize();
    initStaticNoise();
});

// Pause toggle
window.addEventListener("keydown", (e) => {
    if (e.key === " ") paused = !paused;
});

window.addEventListener("pointerdown", (e) => {
    if (motionType < motionTypes.length - 1) {
        motionType++;
    } else {
        motionType = 0;
        noiseType = (noiseType + 1) % noiseTypes.length;
        initStaticNoise();
    }
});

// Generate a noise pixel
function getNoiseColor() {
    const noise = noiseTypes[noiseType];
    switch (noise) {
        case "normal": {
            const v = Math.random() * 255;
            return { r: v, g: v, b: v };
        }
        case "binary": {
            const v = Math.random() < 0.5 ? 0 : 255;
            return { r: v, g: v, b: v };
        }
        case "color":
            return {
                r: Math.random() * 255,
                g: Math.random() * 255,
                b: Math.random() * 255
            };
        case "rgb": {
            const v = Math.random();
            return v < 1/3 ? { r: 255, g: 0, b: 0 }
                 : v < 2/3 ? { r: 0, g: 255, b: 0 }
                           : { r: 0, g: 0, b: 255 };
        }
    }
}

// Fill entire canvas with static noise
function initStaticNoise() {
    const img = mainCtx.createImageData(main.width, main.height);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
        const { r, g, b } = getNoiseColor();
        d[i] = r;
        d[i+1] = g;
        d[i+2] = b;
        d[i+3] = 255;
    }

    mainCtx.putImageData(img, 0, 0);
}

// Apply mask to noise
function applyNoiseMask() {
    const mainData = mainCtx.getImageData(0, 0, main.width, main.height);
    const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height);

    const d = mainData.data;
    const m = maskData.data;

    const w = main.width;
    const h = main.height;

    // Copy of previous frame for motion
    const prev = new Uint8ClampedArray(d);

    for (let i = 0; i < d.length; i += 4) {

        // Only update white-mask pixels
        if (m[i] <= 128) continue;

        let src = i;

        const motion = motionTypes[motionType];

        switch (motion) {
            case "up":
                src = i + w * 4;
                break;

            case "down":
                src = i - w * 4;
                break;

            case "left":
                src = i + 4;
                break;

            case "right":
                src = i - 4;
                break;

            case "randomize":
            default: {
                const { r, g, b } = getNoiseColor();
                d[i] = r;
                d[i+1] = g;
                d[i+2] = b;
                continue;
            }
        }

        // Bounds check
        if (src < 0 || src >= d.length) {
            const { r, g, b } = getNoiseColor();
            d[i] = r;
            d[i+1] = g;
            d[i+2] = b;
            continue;
        }

        // Check if the *source pixel* is also part of the mask
        if (m[src] <= 128) {
            // Source is not part of the moving region → generate new noise
            const { r, g, b } = getNoiseColor();
            d[i] = r;
            d[i+1] = g;
            d[i+2] = b;
            continue;
        }

        // Safe to copy from previous frame
        d[i]     = prev[src];
        d[i + 1] = prev[src + 1];
        d[i + 2] = prev[src + 2];
    }

    mainCtx.putImageData(mainData, 0, 0);
}

// Draw mask
function renderMask() {
    maskCtx.fillStyle = "black";
    maskCtx.fillRect(0, 0, mask.width, mask.height);

    maskCtx.fillStyle = "white";
    maskCtx.fillRect(100, 100, 200, 200);
}

// Animation loop
function frame() {
    if (!paused) {
        renderMask();
        applyNoiseMask();
    }
    requestAnimationFrame(frame);
}

resize();
initStaticNoise();
frame();
