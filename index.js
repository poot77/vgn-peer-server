const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 9000;

// Simple JSON database for accounts
const dbPath = path.join(__dirname, 'users.json');

// Initialize DB if not exists
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([]));
}

const getUsers = () => JSON.parse(fs.readFileSync(dbPath));
const saveUsers = (users) => fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));

// --- Auth Routes ---
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });

    const users = getUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً' });
    }

    users.push({ username, password });
    saveUsers(users);
    res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'الرجاء إدخال البيانات' });

    const users = getUsers();
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        // In a simple app, we just return success. The frontend will save the username as the token.
        res.json({ success: true, username: user.username });
    } else {
        res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
});

app.get('/user/:username', (req, res) => {
    const { username } = req.params;
    const users = getUsers();
    const user = users.find(u => u.username === username);

    if (user) {
        res.json({ exists: true, username: user.username });
    } else {
        res.status(404).json({ exists: false, error: 'المستخدم غير موجود' });
    }
});

// --- Start Server & PeerJS ---
const server = app.listen(port, () => {
    console.log(`Server & PeerJS running on port ${port}...`);
});

const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
    console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`Client disconnected: ${client.getId()}`);
});
