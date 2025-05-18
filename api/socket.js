const { Server } = require('socket.io');
const http = require('http');

// Vercelサーバーレス関数
module.exports = (req, res) => {
  // HTTPサーバーを作成
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/api/socket'
  });

  const rooms = new Map(); // ルームごとの状態 { roomId: { players, blocks, isPublic } }

  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // ルーム参加
    socket.on('joinRoom', ({ roomId, isPublic }) => {
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          players: new Map(),
          blocks: [],
          isPublic
        });
      }
      const room = rooms.get(roomId);
      socket.join(roomId);
      room.players.set(socket.id, { position: [0, 10, 0], yaw: 0, pitch: 0 });

      // ルーム情報を送信
      socket.emit('roomJoined', {
        roomId,
        players: Array.from(room.players.entries()),
        blocks: room.blocks,
        isPublic
      });

      // 他のプレイヤーに通知
      socket.to(roomId).emit('playerJoined', {
        id: socket.id,
        position: [0, 10, 0],
        yaw: 0,
        pitch: 0
      });

      console.log(`Player ${socket.id} joined room ${roomId}, public: ${isPublic}`);
    });

    // プレイヤー移動
    socket.on('playerMove', ({ roomId, position, yaw, pitch }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.players.set(socket.id, { position, yaw, pitch });
        socket.to(roomId).emit('playerMoved', { id: socket.id, position, yaw, pitch });
      }
    });

    // ブロック配置
    socket.on('placeBlock', ({ roomId, x, y, z, type }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.blocks.push({ x, y, z, type });
        io.to(roomId).emit('blockPlaced', { x, y, z, type });
        console.log(`Block placed in ${roomId}: ${x},${y},${z}, type: ${type}`);
      }
    });

    // ブロック破壊
    socket.on('breakBlock', ({ roomId, x, y, z }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.blocks = room.blocks.filter(b => !(b.x === x && b.y === y && b.z === z));
        io.to(roomId).emit('blockBroken', { x, y, z });
        console.log(`Block broken in ${roomId}: ${x},${y},${z}`);
      }
    });

    // 切断処理
    socket.on('disconnect', () => {
      rooms.forEach((room, roomId) => {
        if (room.players.has(socket.id)) {
          room.players.delete(socket.id);
          socket.to(roomId).emit('playerLeft', socket.id);
          if (room.players.size === 0) {
            rooms.delete(roomId);
          }
          console.log(`Player ${socket.id} disconnected from ${roomId}`);
        }
      });
    });
  });

  // Vercelのレスポンス
  httpServer.once('request', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Socket.IO server');
  });

  httpServer.emit('request', req, res);
};
