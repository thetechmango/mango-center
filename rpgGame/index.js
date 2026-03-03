const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

const tileMap = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 2, 2, 0, 0, 2, 2, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

const tileColors = {
  0: "#423118", // dirt
  1: "#32bd2d", // grass
  2: "#2276bb"  // water
};

function lerp(start, end, amt) {
  return start + (end - start) * amt;
}

const tileSize = 30;

let frameNum = 0;

let player = {
  x: 0,
  y: 0,
  size: tileSize
};


const camera = {
  x: 0,
  y: 0
};

function canMove(dir) {
  if (dir === "up") {

  }
  if (dir === "down") {
  
  }
  if (dir === "left") {

  }
  if (dir === "right") {

  }

  return true;
}

function update() {
  if (frameNum % 10 === 0) {
    if (keys["w"] && canMove("up")) player.y--;
    if (keys["s"] && canMove("down")) player.y++;
    if (keys["a"] && canMove("left")) player.x--;
    if (keys["d"] && canMove("right")) player.x++;
  }

  camera.x = lerp(camera.x, player.x, 0.05);
  camera.y = lerp(camera.y, player.y, 0.05);
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

  // camera move
  ctx.save();
  ctx.translate(-camera.x*tileSize + canvas.width/2, -camera.y*tileSize + canvas.height/2);

  // --- RENDER TILEMAP ---
  tileMap.forEach((row, rowIndex) => {
    row.forEach((tileId, colIndex) => {
      ctx.fillStyle = tileColors[tileId];
      // Draw the tile at its grid position
      ctx.fillRect(
        colIndex * tileSize, 
        rowIndex * tileSize, 
        tileSize, 
        tileSize
      );
    });
  });

  // player
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(player.x * tileSize, player.y * tileSize, player.size, player.size);

  ctx.restore();
}

function frame() {
  frameNum++;
  update();
  render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);