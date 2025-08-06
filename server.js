const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = 4000;


app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to username.html
app.get('/', (req, res) => {
  res.redirect('/username.html');
});

let waitingUser = null;
const userRooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  const matchUser = () => {
    if (waitingUser && waitingUser.id !== socket.id) {
      const room = `${waitingUser.id}#${socket.id}`;
      socket.join(room);
      waitingUser.join(room);

      userRooms.set(socket.id, room);
      userRooms.set(waitingUser.id, room);

      socket.emit('match', { room });
      waitingUser.emit('match', { room });

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit('waiting');
    }
  };

  matchUser();

  socket.on('chat message', ({ room, msg }) => {
    socket.to(room).emit('chat message', msg);
  });

  socket.on('skip', () => {
    const room = userRooms.get(socket.id);
    if (room) {
      io.to(room).emit('partner disconnected');
      io.in(room).socketsLeave(room);
      for (const [id, r] of userRooms) {
        if (r === room) userRooms.delete(id);
      }
    }
    matchUser();
  });

  socket.on('disconnect', () => {
    if (waitingUser === socket) {
      waitingUser = null;
    }
    const room = userRooms.get(socket.id);
    if (room) {
      socket.to(room).emit('partner disconnected');
      io.in(room).socketsLeave(room);
      for (const [id, r] of userRooms) {
        if (r === room) userRooms.delete(id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:4000`);
});