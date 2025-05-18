const { Server } = require('socket.io');
const http = require('http');

module.exports = (req, res) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/api/socket',
    pingTimeout: 20000,
    pingInterval: 25000
  });

  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('getPublicRooms', () => {
      const publicRooms = Array.from(rooms.entries())
        .filter(([_, room]) => room.isPublic)
        .map(([roomId, room]) => ({
          roomId,
          playerCount: room.players.size
        }));
      socket.emit('publicRooms', publicRooms);
      console.log(`Sent public rooms to ${socket.id}:`, publicRooms);
    });

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

      socket.emit('roomJoined', {
        roomId,
        players: Array.from(room.players.entries()),
        blocks: room.blocks,
        isPublic
      });

      socket.to(roomId).emit('playerJoined', {
        id: socket.id,
        position: [0, 10, 0],
        yaw: 0,
        pitch: 0
      });

      console.log(`Player ${socket.id} joined room ${roomId}, public: ${isPublic}`);
    });

    socket.on('playerMove', ({ roomId, position, yaw, pitch }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.players.set(socket.id, { position, yaw, pitch });
        socket.to(roomId).emit('playerMoved', { id: socket.id, position, yaw, pitch });
      }
    });

    socket.on('placeBlock', ({ roomId, x, y, z, type }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.blocks.push({ x, y, z, type });
        io.to(roomId).emit('blockPlaced', { x, y, z, type });
        console.log(`Block placed in ${roomId}: ${x},${y},${z}, type: ${type}`);
      }
    });

    socket.on('breakBlock', ({ roomId, x, y, z }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.blocks = room.blocks.filter(b => !(b.x === x && b.y === y && b.z === z));
        io.to(roomId).emit('blockBroken', { x, y, z });
        console.log(`Block broken in ${roomId}: ${x},${y},${z}`);
      }
    });

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

  httpServer.once('request', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Socket.IO server');
  });

  httpServer.emit('request', req, res);
};
