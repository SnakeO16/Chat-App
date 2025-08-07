const io = require('socket.io-client');

const serverUrl = 'http://localhost:4000';

function createClient(username) {
  const socket = io(serverUrl, { query: { username } });

  socket.on('connect', () => {
    console.log(`${username} connected`);
    socket.emit('join-chat');
  });

  socket.on('match', (data) => {
    console.log(`${username} matched with ${data.partnerUsername} in room ${data.room}`);
    if (username === 'client1') {
      socket.emit('chat-message', { message: 'Hello from client1' });
    }
  });

  socket.on('chat-message', (data) => {
    console.log(`${username} received message: ${data.message} from ${data.username}`);
    socket.disconnect();
  });

  socket.on('disconnect', () => {
    console.log(`${username} disconnected`);
  });
}

createClient('client1');
createClient('client2');
