const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let player = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    vx: 0,
    vy: 0,
    width: 20,
    height: 20,
    speed: 1.5,
    drag: 0.9
};

const keys = {};
window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
});
window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
});

function movePlayer(dt) {
    if (keys["w"]) player.vy -= player.speed;
    if (keys["s"]) player.vy += player.speed;
    if (keys["a"]) player.vx -= player.speed;
    if (keys["d"]) player.vx += player.speed;

    player.vx *= player.drag;
    player.vy *= player.drag;

    collidePlayer();

    player.x += player.vx;
    player.y += player.vy;
}

function collidePlayer() {
    if (player.x - player.width / 2 < 0) {
        player.x = player.width / 2;
        player.vx *= -1
    }
    
    if (player.x + player.width / 2 > canvas.width) {
        player.x = canvas.width - player.width / 2;
        player.vx *= -1
    }

    if (player.y - player.height / 2 < 0) {
        player.y = player.height / 2;
        player.vy *= -1
    }
    
    if (player.y + player.height / 2 > canvas.height) {
        player.y = canvas.height - player.height / 2;
        player.vy *= -1
    }
}

function update() {
    movePlayer();
}

function render() {
    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw player
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(
        player.x - player.width / 2, 
        player.y - player.height / 2, 
        player.width, 
        player.height
    );
}

let lastTime = 0;
let accumulator = 0;
const FIXED_DELTA_TIME = 1 / 60;

function frame() {
    const currentTime = performance.now();
    if (!lastTime) {
        lastTime = currentTime;
    }

    let frameTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    accumulator += frameTime;

    // Cap the maximum frame time to prevent endless catch-up loops
    if (frameTime > 0.25) {
        frameTime = 0.25;
    }

    while (accumulator >= FIXED_DELTA_TIME) {
        update(FIXED_DELTA_TIME);
        accumulator -= FIXED_DELTA_TIME;
    }
    
    render();
    
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);