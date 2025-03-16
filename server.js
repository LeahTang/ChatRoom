const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Object to track room participants.
// Each roomId maps to an array of participant objects: { id, name, muted }
const rooms = {};

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('A user connected:', socket.id);

  // Now expects an object: { roomId, name }
  socket.on('join-room', data => {
    const { roomId, name } = data;
    socket.join(roomId);

    // Initialize room if it doesn't exist, then add the participant object
    if (!rooms[roomId]) {
      rooms[roomId] = [];
      console.log(`New room created: ${roomId}`);
    }
    rooms[roomId].push({ id: socket.id, name, muted: false });
    console.log(`Room ${roomId} participants: `, rooms[roomId]);

    // Emit the full participant list to everyone in the room
    io.in(roomId).emit('update-participants', rooms[roomId]);
    
    // Notify others that a new user has connected (for signaling)
    socket.to(roomId).emit('user-connected', socket.id);
  });

  // When a participant changes their mute status
  socket.on('mute-status-changed', data => {
    // data: { roomId, muted }
    const { roomId, muted } = data;
    if (rooms[roomId]) {
      // Update the participant's mute status
      rooms[roomId] = rooms[roomId].map(participant => {
        if (participant.id === socket.id) {
          return { ...participant, muted };
        }
        return participant;
      });
      // Broadcast the updated participant list
      io.in(roomId).emit('update-participants', rooms[roomId]);
    }
  });

  // Relay signaling messages between peers
  socket.on('signal', data => {
    io.to(data.target).emit('signal', {
      caller: data.caller,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    // Remove the disconnected user from any rooms
    for (const roomId in rooms) {
      if (rooms[roomId].some(participant => participant.id === socket.id)) {
        rooms[roomId] = rooms[roomId].filter(participant => participant.id !== socket.id);
        io.in(roomId).emit('update-participants', rooms[roomId]);
        io.in(roomId).emit('user-disconnected', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));