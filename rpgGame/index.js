const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

const tileSize = 30;

let frameNum = 0;

let player = {
  x: 0,
  y: 0
};

function update() {
  if (frameNum % 10 === 0) {
    if (keys["w"]) player.y -= tileSize;
    if (keys["s"]) player.y += tileSize;
    if (keys["a"]) player.x -= tileSize;
    if (keys["d"]) player.x += tileSize;
  }
}

const keys = {};

document.addEventListener('keydown', function(event) {
  keys[event.key] = true;
});

document.addEventListener('keyup', function(event) {
  keys[event.key] = false;
});


function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#00ff00";
  ctx.fillRect(player.x, player.y, tileSize, tileSize);
}

function frame() {
  frameNum++;
  update();
  render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);