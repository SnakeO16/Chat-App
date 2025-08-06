const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');

const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
app.use(express.json());

// API route to check if email exists
app.post('/api/check-email', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ exists: false });
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ exists: false });
    res.json({ exists: !!row });
  });
});

// API endpoint to register a new user
app.post('/api/register', async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ success: false, error: 'Username and email required.' });
  }
  // Simple email validation
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format.' });
  }
  try {
    // Check if email already exists
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Database error.' });
      }
      if (row) {
        return res.status(409).json({ success: false, error: 'Email already registered.' });
      }
      // Insert new user
      db.run('INSERT INTO users (username, email) VALUES (?, ?)', [username, email], function(err) {
        if (err) {
          return res.status(500).json({ success: false, error: 'Database error.' });
        }
        return res.json({ success: true });
      });
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
});


const PORT = 4000;


// Redirect root to username.html (must be before static middleware)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'username.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

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