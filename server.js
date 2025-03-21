const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Tracks room participants: each roomId maps to an array of participant objects { id, name, muted }
const rooms = {};

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('A user connected:', socket.id);

  socket.on('join-room', data => {
    const { roomId, name } = data;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = [];
      console.log(`New room created: ${roomId}`);
    }
    rooms[roomId].push({ id: socket.id, name, muted: false });
    console.log(`Room ${roomId} participants: `, rooms[roomId]);

    // Emit the participant list along with the roomId
    io.in(roomId).emit('update-participants', { roomId, participants: rooms[roomId] });
    
    // Notify others in the room that a new user has connected (include team info)
    socket.to(roomId).emit('user-connected', { teamId: roomId, userId: socket.id });
  });

  socket.on('mute-status-changed', data => {
    const { roomId, muted } = data;
    if (rooms[roomId]) {
      rooms[roomId] = rooms[roomId].map(participant => {
        if (participant.id === socket.id) {
          return { ...participant, muted };
        }
        return participant;
      });
      io.in(roomId).emit('update-participants', { roomId, participants: rooms[roomId] });
    }
  });

  // Relay signaling messages between peers, including team info
  socket.on('signal', data => {
    const { teamId, target, caller, signal } = data;
    io.to(target).emit('signal', { teamId, caller, signal });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].some(participant => participant.id === socket.id)) {
        rooms[roomId] = rooms[roomId].filter(participant => participant.id !== socket.id);
        io.in(roomId).emit('update-participants', { roomId, participants: rooms[roomId] });
        io.in(roomId).emit('user-disconnected', { teamId: roomId, userId: socket.id });
      }
    }
  });

  socket.on('leave-room', roomId => {
    if (rooms[roomId].some(participant => participant.id === socket.id)) {
      rooms[roomId] = rooms[roomId].filter(participant => participant.id !== socket.id);
      io.in(roomId).emit('update-participants', { roomId, participants: rooms[roomId] });
      io.in(roomId).emit('user-disconnected', { teamId: roomId, userId: socket.id });
    }
    
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
