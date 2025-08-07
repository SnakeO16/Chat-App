const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Database setup
const db = new sqlite3.Database('users.db');

// Store connected users
const connectedUsers = new Map();
const waitingUsers = [];

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Get username from query parameters
  const username = socket.handshake.query.username;
  console.log('Socket handshake query username:', username);
  socket.username = username || 'Anonymous';
  console.log('Socket username:', socket.username);

  // Add to connected users
  connectedUsers.set(socket.id, {
    id: socket.id,
    username: socket.username
  });

  // Handle user joining chat
  socket.on('join-chat', () => {
    console.log(`${socket.username} joined chat`);
    
    if (waitingUsers.length > 0) {
      // Match with waiting user
      const partner = waitingUsers.shift();
      
      // Create room for both users
      const roomId = `${socket.id}-${partner.id}`;
      socket.join(roomId);
      partner.join(roomId);
      
      // Emit match event to both users
      io.to(socket.id).emit('match', {
        room: roomId,
        partnerUsername: partner.username
      });
      
      io.to(partner.id).emit('match', {
        room: roomId,
        partnerUsername: socket.username
      });
      
      console.log(`Matched ${socket.username} with ${partner.username}`);
    } else {
      // Add to waiting list
      waitingUsers.push(socket);
      socket.emit('waiting', { message: 'Waiting for a partner...' });
    }
  });

  // Handle chat messages - updated to match client event names
  socket.on('chat message', (data) => {
    const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      socket.to(roomId).emit('chat message', {
        message: data.msg || data.message,
        username: socket.username,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle typing indicators - updated to match client event names
  socket.on('typing', (data) => {
    const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      socket.to(roomId).emit('typing', { username: socket.username });
    }
  });

  socket.on('stop typing', (data) => {
    const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      socket.to(roomId).emit('stop typing');
    }
  });

  // Handle skip partner
  socket.on('skip', () => {
    console.log(`${socket.username} skipped partner`);
    
    // Remove from any room
    const rooms = Array.from(socket.rooms);
    rooms.forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit('partner disconnected', {
          message: 'Your partner has disconnected'
        });
        socket.leave(room);
      }
    });
    
    // Re-add to waiting list
    waitingUsers.push(socket);
    socket.emit('waiting', { message: 'Finding new partner...' });
  });

  // Handle report user
  socket.on('report', (data) => {
    console.log(`User ${socket.username} reported ${data.reason}`);
    // In a real app, you'd store this in a database
    socket.emit('reported', { message: 'User reported successfully' });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove from connected users
    connectedUsers.delete(socket.id);
    
    // Remove from waiting list if present
    const waitingIndex = waitingUsers.findIndex(s => s.id === socket.id);
    if (waitingIndex !== -1) {
      waitingUsers.splice(waitingIndex, 1);
    }
    
    // Notify partner if in room
    const rooms = Array.from(socket.rooms);
    rooms.forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit('partner-disconnected', {
          message: 'Your partner has disconnected'
        });
      }
    });
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes for user authentication
app.post('/api/check-email', (req, res) => {
  const { email, username } = req.body;
  
  if (!email || !username) {
    return res.status(400).json({ error: 'Email and username are required' });
  }

  // Check if user exists in database
  const query = 'SELECT * FROM users WHERE email = ? AND username = ?';
  db.get(query, [email, username], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      res.json({ exists: true, user: row });
    } else {
      res.json({ exists: false });
    }
  });
});

// API route to create new user
app.post('/api/create-user', (req, res) => {
  const { username, email } = req.body;
  
  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email are required' });
  }

  // Check if user already exists
  const checkQuery = 'SELECT * FROM users WHERE email = ? OR username = ?';
  db.get(checkQuery, [email, username], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Insert new user
    const insertQuery = 'INSERT INTO users (username, email) VALUES (?, ?)';
    db.run(insertQuery, [username, email], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to create user' });
      }
      
      res.json({ success: true, userId: this.lastID });
    });
  });
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://192.168.1.69:${PORT}`);
});
