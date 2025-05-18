console.log('BlockWorld script loaded');

// グローバル変数
let renderer, scene, camera, raycaster, player, socket, roomId;
let chunks = new Map(), blocks = [], otherPlayers = new Map();
const chunkSize = 16, viewDistance = 1;

// グローバル関数
function showRoomSelect() {
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('room-select').style.display = 'flex';
  const date = new Date();
  document.getElementById('room-input').value = `room-${date.toISOString().replace(/T/, '-').replace(/:/g, '-')}`;
  updateServerList();
  console.log('Showing room select');
}

function backToMainMenu() {
  document.getElementById('room-select').style.display = 'none';
  document.getElementById('main-menu').style.display = 'flex';
  if (socket) socket.disconnect();
  console.log('Back to main menu');
}

function resumeGame() {
  document.getElementById('menu').style.display = 'none';
  if (renderer) renderer.domElement.requestPointerLock();
  console.log('Resuming game');
}

function returnToMenu() {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('main-menu').style.display = 'flex';
  document.getElementById('crosshair').style.display = 'none';
  if (renderer) renderer.domElement.style.display = 'none';
  if (socket) socket.disconnect();
  console.log('Returning to main menu');
}

function exitGame() {
  window.location.reload();
  console.log('Exiting game');
}

function connectSocket() {
  socket = io('/api/socket', { path: '/api/socket' });
  socket.on('connect', () => console.log('Connected to server:', socket.id));
  socket.on('roomJoined', ({ roomId: joinedRoomId, players, blocks: serverBlocks, isPublic }) => {
    roomId = joinedRoomId;
    blocks = serverBlocks;
    players.forEach(([id, data]) => {
      if (id !== socket.id) addOtherPlayer(id, data);
    });
    startGame();
    console.log(`Joined room ${roomId}, public: ${isPublic}`);
  });
  socket.on('publicRooms', (rooms) => {
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = rooms.length ? '<h3>公開サーバー</h3>' : '<p>公開サーバーがありません</p>';
    rooms.forEach(({ roomId, playerCount }) => {
      const button = document.createElement('button');
      button.textContent = `${roomId} (${playerCount}人)`;
      button.onclick = () => joinRoom(roomId, true);
      serverList.appendChild(button);
    });
    console.log('Received public rooms:', rooms);
  });
  socket.on('playerJoined', (player) => {
    addOtherPlayer(player.id, { position: player.position, yaw: player.yaw, pitch: player.pitch });
  });
  socket.on('playerMoved', ({ id, position, yaw, pitch }) => {
    updateOtherPlayer(id, { position, yaw, pitch });
  });
  socket.on('playerLeft', (id) => {
    removeOtherPlayer(id);
  });
  socket.on('blockPlaced', ({ x, y, z, type }) => {
    const chunkX = Math.floor(x / chunkSize);
    const chunkZ = Math.floor(z / chunkSize);
    const chunkKey = `${chunkX},${chunkZ}`;
    let chunk = chunks.get(chunkKey);
    if (!chunk) {
      chunk = { blocks: [], meshes: [] };
      chunks.set(chunkKey, chunk);
    }
    chunk.blocks.push({ x, y, z, type });
    blocks.push({ x, y, z, type });
    updateChunkMesh(chunkX, chunkZ);
  });
  socket.on('blockBroken', ({ x, y, z }) => {
    const chunkX = Math.floor(x / chunkSize);
    const chunkZ = Math.floor(z / chunkSize);
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunk = chunks.get(chunkKey);
    if (chunk) {
      chunk.blocks = chunk.blocks.filter(b => !(b.x === x && b.y === y && b.z === z));
      blocks = blocks.filter(b => !(b.x === x && b.y === y && b.z === z));
      updateChunkMesh(chunkX, chunkZ);
    }
  });
  socket.on('connect_error', (err) => {
    alert('サーバー接続に失敗しました: ' + err.message);
    console.error('Socket.IO connection error:', err);
  });
}

function updateServerList() {
  if (!socket) connectSocket();
  socket.emit('getPublicRooms');
}

function joinRoom(selectedRoomId = null, isPublic = false) {
  const roomCode = selectedRoomId || document.getElementById('room-input').value.trim();
  isPublic = selectedRoomId ? true : document.getElementById('public-checkbox').checked;
  if (!roomCode) {
    alert('ルームコードを入力してください');
    return;
  }
  if (!socket || !socket.connected) connectSocket();
  socket.emit('joinRoom', { roomId: roomCode, isPublic });
  console.log(`Joining room: ${roomCode}, public: ${isPublic}`);
}

function addOtherPlayer(id, { position, yaw, pitch }) {
  const geometry = new THREE.BoxGeometry(0.8, 1.8, 0.8);
  const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.fromArray(position);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  scene.add(mesh);
  otherPlayers.set(id, { mesh, position, yaw, pitch });
}

function updateOtherPlayer(id, { position, yaw, pitch }) {
  const player = otherPlayers.get(id);
  if (player) {
    player.mesh.position.fromArray(position);
    player.mesh.rotation.y = yaw;
    player.position = position;
    player.yaw = yaw;
    player.pitch = pitch;
  }
}

function removeOtherPlayer(id) {
  const player = otherPlayers.get(id);
  if (player) {
    scene.remove(player.mesh);
    otherPlayers.delete(id);
  }
}

function initGame() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    console.log('Renderer initialized');
  } catch (e) {
    document.getElementById('error').style.display = 'flex';
    console.error('WebGL initialization failed:', e);
    return;
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  raycaster = new THREE.Raycaster();
  raycaster.far = 10;

  player = {
    position: new THREE.Vector3(0, 10, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    height: 1.8,
    speed: 0.1,
    jumpPower: 0.45,
    isGrounded: false,
    isSneaking: false,
    mode: 'creative'
  };
  camera.position.copy(player.position);

  const blockTypes = [
    { name: 'dirt', color: 0x8b4513, receiveShadow: true }
  ];
  const blockMaterials = blockTypes.map(type => new THREE.MeshLambertMaterial({
    color: type.color,
    transparent: type.transparent || false,
    opacity: type.opacity || 1
  }));

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

  function updateChunkMesh(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunk = chunks.get(chunkKey);
    if (!chunk) return;

    chunk.meshes.forEach(mesh => scene.remove(mesh));
    chunk.meshes = [];

    const instanceCounts = new Array(blockTypes.length).fill(0);
    const instances = blockTypes.map(() => []);
    chunk.blocks.forEach(block => {
      const typeIndex = blockTypes.findIndex(t => t.name === block.type);
      instances[typeIndex].push(new THREE.Vector3(block.x, block.y, block.z));
      instanceCounts[typeIndex]++;
    });

    blockTypes.forEach((type, i) => {
      if (instanceCounts[i] > 0) {
        const instancedMesh = new THREE.InstancedMesh(blockGeometry, blockMaterials[i], instanceCounts[i]);
        instancedMesh.receiveShadow = type.receiveShadow || false;
        instances[i].forEach((pos, j) => {
          const matrix = new THREE.Matrix4().setPosition(pos);
          instancedMesh.setMatrixAt(j, matrix);
        });
        scene.add(instancedMesh);
        chunk.meshes.push(instancedMesh);
      }
    });
  }

  function placeBlock() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = scene.children.filter(child => child.isInstancedMesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const mesh = intersect.object;
      if (mesh.isInstancedMesh && intersect.instanceId !== undefined) {
        const instanceId = intersect.instanceId;
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(instanceId, matrix);
        const blockPos = new THREE.Vector3().setFromMatrixPosition(matrix);
        const normal = intersect.face.normal.clone();
        const newBlockPos = blockPos.clone().add(normal).floor();
        socket.emit('placeBlock', { roomId, x: newBlockPos.x, y: newBlockPos.y, z: newBlockPos.z, type: 'dirt' });
      }
    }
  }

  function breakBlock() {
    if (player.mode !== 'creative') return;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = scene.children.filter(child => child.isInstancedMesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const mesh = intersect.object;
      if (mesh.isInstancedMesh && intersect.instanceId !== undefined) {
        const instanceId = intersect.instanceId;
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(instanceId, matrix);
        const blockPos = new THREE.Vector3().setFromMatrixPosition(matrix).floor();
        socket.emit('breakBlock', { roomId, x: blockPos.x, y: blockPos.y, z: blockPos.z });
      }
    }
  }

  function generateChunk(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    if (chunks.has(chunkKey)) return;

    const chunkBlocks = [];
    for (let x = chunkX * chunkSize; x < (chunkX + 1) * chunkSize; x++) {
      for (let z = chunkZ * chunkSize; z < (chunkZ + 1) * chunkSize; z++) {
        chunkBlocks.push({ x, y: 0, z, type: 'dirt' });
      }
    }

    chunks.set(chunkKey, { blocks: chunkBlocks, meshes: [] });
    chunkBlocks.forEach(block => blocks.push(block));
    updateChunkMesh(chunkX, chunkZ);
  }

  function updateChunks() {
    const chunkX = Math.floor(player.position.x / chunkSize);
    const chunkZ = Math.floor(player.position.z / chunkSize);
    for (let x = chunkX - viewDistance; x <= chunkX + viewDistance; x++) {
      for (let z = chunkZ - viewDistance; z <= chunkZ + viewDistance; z++) {
        generateChunk(x, z);
      }
    }
  }

  const keys = {};
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Escape') {
      document.exitPointerLock();
      document.getElementById('menu').style.display = 'flex';
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && document.getElementById('menu').style.display !== 'flex' && document.getElementById('error').style.display !== 'flex') {
      renderer.domElement.requestPointerLock();
    }
  });

  function checkCollision(nextPos) {
    const playerBox = {
      min: new THREE.Vector3(nextPos.x - 0.4, nextPos.y - player.height, nextPos.z - 0.4),
      max: new THREE.Vector3(nextPos.x + 0.4, nextPos.y, nextPos.z + 0.4)
    };
    for (const block of blocks) {
      const blockBox = {
        min: new THREE.Vector3(block.x - 0.5, block.y - 0.5, block.z - 0.5),
        max: new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5)
      };
      if (
        playerBox.min.x < blockBox.max.x && playerBox.max.x > blockBox.min.x &&
        playerBox.min.y < blockBox.max.y && playerBox.max.y > blockBox.min.y &&
        playerBox.min.z < blockBox.max.z && playerBox.max.z > blockBox.min.z
      ) return true;
    }
    return false;
  }

  let yaw = 0, pitch = 0;
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) {
      yaw -= e.movementX * 0.002;
      pitch -= e.movementY * 0.002;
      pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
      socket.emit('playerMove', { roomId, position: player.position.toArray(), yaw, pitch });
    }
  });

  function animate() {
    requestAnimationFrame(animate);
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.z += 1;
    if (keys['KeyS']) move.z -= 1;
    if (keys['KeyA']) move.x -= 1;
    if (keys['KeyD']) move.x += 1;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    player.velocity.x = move.dot(right) * player.speed;
    player.velocity.z = move.dot(forward) * player.speed;
    player.velocity.y -= 0.07;

    let nextPos = player.position.clone().add(player.velocity);
    if (!checkCollision(new THREE.Vector3(nextPos.x, player.position.y, player.position.z))) {
      player.position.x = nextPos.x;
    }
    if (!checkCollision(new THREE.Vector3(player.position.x, player.position.y, nextPos.z))) {
      player.position.z = nextPos.z;
    }
    if (!checkCollision(new THREE.Vector3(player.position.x, nextPos.y, player.position.z))) {
      player.position.y = nextPos.y;
    } else if (player.velocity.y < 0) {
      player.velocity.y = 0;
      player.isGrounded = true;
    }

    socket.emit('playerMove', { roomId, position: player.position.toArray(), yaw, pitch });
    updateChunks();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    camera.quaternion.copy(quaternion);
    camera.position.copy(player.position);
    renderer.render(scene, camera);
  }

  function startGame() {
    document.getElementById('room-select').style.display = 'none';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('crosshair').style.display = 'block';
    initGame();
    renderer.domElement.style.display = 'block';
    renderer.domElement.requestPointerLock();
    document.addEventListener('mousedown', (e) => {
      if (document.getElementById('menu').style.display !== 'flex') {
        if (e.button === 2) {
          e.preventDefault();
          placeBlock();
        }
        if (e.button === 0 && document.pointerLockElement) breakBlock();
      }
    });
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (document.getElementById('menu').style.display !== 'flex') placeBlock();
    });
    animate();
  }

  window.addEventListener('resize', () => {
    if (renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  });

  // イベントリスナー登録
  document.getElementById('join-room-btn').addEventListener('click', showRoomSelect);
  document.getElementById('exit-game-btn').addEventListener('click', exitGame);
  document.getElementById('join-room-submit-btn').addEventListener('click', () => joinRoom());
  document.getElementById('back-to-main-btn').addEventListener('click', backToMainMenu);
  document.getElementById('resume-game-btn').addEventListener('click', resumeGame);
  document.getElementById('return-to-menu-btn').addEventListener('click', returnToMenu);

  // 初期化
  console.log('Initializing BlockWorld');
  updateServerList();
