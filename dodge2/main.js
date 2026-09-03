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
    width: 25,
    height: 25,
    speed: 0.15,
    drag: 0.97
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

    player.x += player.vx;
    player.y += player.vy;
}

function render() {
    movePlayer();

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
    
    requestAnimationFrame(render);
}

requestAnimationFrame(render);
