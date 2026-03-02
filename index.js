const { PeerServer } = require('peer');

const port = process.env.PORT || 9000;

const peerServer = PeerServer({
    port: port,
    path: '/'
});

console.log(`PeerJS Server started on port ${port}...`);

peerServer.on('connection', (client) => {
    console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`Client disconnected: ${client.getId()}`);
});
