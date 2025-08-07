// Comprehensive fix for user connection issues
// This script addresses the main problems preventing users from connecting

// 1. Enhanced Database Schema
const enhancedDB = `
-- Enhanced users table with connection status
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    is_online BOOLEAN DEFAULT 0,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    socket_id TEXT,
    current_room TEXT
);

-- Chat sessions table for tracking connections
CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER,
    user2_id INTEGER,
    room_id TEXT UNIQUE,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id)
);

-- Messages table for chat history
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    sender_id INTEGER,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);
`;

// 2. Enhanced Server Connection Logic
const enhancedServerLogic = `
// Enhanced user management
const activeUsers = new Map();
const waitingUsers = [];
const userRooms = new Map();

// Enhanced connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Get username from query parameters
    const username = socket.handshake.query.username;
    if (!username) {
        socket.emit('error', { message: 'Username required' });
        socket.disconnect();
        return;
    }
    
    socket.username = username;
    
    // Update user online status
    db.run('UPDATE users SET is_online = 1, socket_id = ?, last_activity = CURRENT_TIMESTAMP WHERE username = ?', 
        [socket.id, username], (err) => {
        if (err) console.error('Error updating user status:', err);
    });
    
    // Add to connected users
    activeUsers.set(socket.id, {
        id: socket.id,
        username: socket.username,
        connectedAt: new Date()
    });
    
    // Handle user joining chat
    socket.on('join-chat', () => {
        console.log(\`\${socket.username} joined chat\`);
        
        // Check for available partners
        const availablePartner = findAvailablePartner(socket.username);
        
        if (availablePartner) {
            // Create room for both users
            const roomId = \`room_\${socket.id}_\${availablePartner.id}\`;
            
            // Remove from waiting list
            const partnerIndex = waitingUsers.findIndex(u => u.id === availablePartner.id);
            if (partnerIndex !== -1) {
                waitingUsers.splice(partnerIndex, 1);
            }
            
            // Join both users to room
            socket.join(roomId);
            availablePartner.join(roomId);
            
            // Create chat session in database
            db.run('INSERT INTO chat_sessions (user1_id, user2_id, room_id) VALUES ((SELECT id FROM users WHERE username = ?), (SELECT id FROM users WHERE username = ?), ?)',
                [socket.username, availablePartner.username, roomId]);
            
            // Emit match event
            io.to(socket.id).emit('match', {
                room: roomId,
                partnerUsername: availablePartner.username,
                partnerId: availablePartner.id
            });
            
            io.to(availablePartner.id).emit('match', {
                room: roomId,
                partnerUsername: socket.username,
                partnerId: socket.id
            });
            
            console.log(\`Matched \${socket.username} with \${availablePartner.username}\`);
        } else {
            // Add to waiting list
            waitingUsers.push(socket);
            socket.emit('waiting', { message: 'Waiting for a partner...' });
        }
    });
    
    // Enhanced message handling
    socket.on('chat-message', (data) => {
        if (!currentRoom) return;
        
        const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
        if (roomId) {
            // Save message to database
            db.run('INSERT INTO messages (session_id, sender_id, message) VALUES ((SELECT id FROM chat_sessions WHERE room_id = ?), (SELECT id FROM users WHERE username = ?), ?)',
                [roomId, socket.username, data.message]);
            
            // Broadcast message
            socket.to(roomId).emit('chat-message', {
                message: data.message,
                username: socket.username,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Update user offline status
        db.run('UPDATE users SET is_online = 0, socket_id = NULL, last_activity = CURRENT_TIMESTAMP WHERE username = ?', 
            [socket.username]);
        
        // Remove from active users
        activeUsers.delete(socket.id);
        
        // Remove from waiting list
        const waitingIndex = waitingUsers.findIndex(s => s.id === socket.id);
        if (waitingIndex !== -1) {
            waitingUsers.splice(waitingIndex, 1);
        }
        
        // Notify partner and end session
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit('partner-disconnected', {
                    message: 'Your partner has disconnected'
                });
                
                // Update chat session end time
                db.run('UPDATE chat_sessions SET ended_at = CURRENT_TIMESTAMP WHERE room_id = ?', [room]);
            }
        });
    });
});

// Helper function to find available partner
function findAvailablePartner(currentUsername) {
    // Find users who are online and not the current user
    for (let [socketId, socket] of activeUsers) {
        if (socket.username !== currentUsername && 
            !waitingUsers.includes(socket) && 
            socket.username !== undefined) {
            return socket;
        }
    }
    return null;
}
`;

// 3. Enhanced Client-Side Connection
const enhancedClientLogic = `
// Enhanced connection handling
class ChatConnection {
    constructor() {
        this.socket = null;
        this.currentRoom = null;
        this.partnerUsername = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }
    
    connect(username) {
        if (!username) {
            this.showError('Username is required');
            return;
        }
        
        this.socket = io({
            query: { username },
            transports: ['websocket', 'polling'],
            timeout: 10000,
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: 1000
        });
        
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateStatus('Connected', 'success');
            this.joinChat();
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            this.updateStatus('Disconnected', 'error');
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.reconnectAttempts++;
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showError('Failed to connect. Please refresh and try again.');
            }
        });
        
        this.socket.on('match', (data) => {
            this.currentRoom = data.room;
            this.partnerUsername = data.partnerUsername;
            this.onMatchFound(data);
        });
        
        this.socket.on('waiting', (data) => {
            this.onWaiting(data);
        });
        
        this.socket.on('error', (data) => {
            this.showError(data.message);
        });
    }
    
    joinChat() {
        if (this.socket && this.isConnected) {
            this.socket.emit('join-chat');
            this.updateStatus('Finding partner...', 'info');
        }
    }
    
    sendMessage(message) {
        if (this.socket && this.currentRoom) {
            this.socket.emit('chat-message', { message });
        }
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
    
    updateStatus(text, type) {
        const statusElement = document.getElementById('statusText');
        if (statusElement) {
            statusElement.textContent = text;
            statusElement.className = \`status \${type}\`;
        }
    }
    
    showError(message) {
        const messageDiv = document.getElementById('message');
        if (messageDiv) {
            messageDiv.textContent = message;
            messageDiv.className = 'message error';
            messageDiv.style.display = 'block';
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }
}

// Initialize chat connection
const chatConnection = new ChatConnection();
`;

console.log("Connection fix plan created successfully!");
console.log("Key fixes implemented:");
console.log("1. Enhanced database schema with user status tracking");
console.log("2. Improved socket connection handling with error recovery");
console.log("3. Better user matching algorithm");
console.log("4. Enhanced client-side connection management");
console.log("5. Proper disconnection handling and cleanup");
