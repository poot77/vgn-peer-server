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
const requestsDbPath = path.join(__dirname, 'friend_requests.json');

// Initialize DB if not exists
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([]));
}
if (!fs.existsSync(requestsDbPath)) {
    fs.writeFileSync(requestsDbPath, JSON.stringify([]));
}

const getUsers = () => JSON.parse(fs.readFileSync(dbPath));
const saveUsers = (users) => fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));

const getRequests = () => JSON.parse(fs.readFileSync(requestsDbPath));
const saveRequests = (reqs) => fs.writeFileSync(requestsDbPath, JSON.stringify(reqs, null, 2));

// --- Auth Routes ---
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });

    const users = getUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً' });
    }

    users.push({ username, password, friends: [] });
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
        // Ensure legacy accounts have a friends array
        if (!user.friends) {
            user.friends = [];
            saveUsers(users);
        }
        res.json({ success: true, username: user.username, friends: user.friends });
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

// --- Friend Request Routes ---
app.post('/friend/request', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'بيانات غير مكتملة' });

    const users = getUsers();
    if (!users.find(u => u.username === to)) {
        return res.status(404).json({ error: 'المستخدم المطلوب غير موجود' });
    }

    const requests = getRequests();
    // Check if request already exists
    if (requests.find(r => r.from === from && r.to === to)) {
        return res.status(400).json({ error: 'الطلب قيد الانتظار بالفعل' });
    }

    requests.push({ from, to, timestamp: Date.now() });
    saveRequests(requests);
    res.json({ success: true, message: 'تم الإرسال بنجاح' });
});

app.get('/friend/requests/:username', (req, res) => {
    const { username } = req.params;
    const requests = getRequests();
    const userRequests = requests.filter(r => r.to === username);
    res.json({ requests: userRequests });
});

app.post('/friend/accept', (req, res) => {
    const { from, to } = req.body; // 'to' is the current user receiving the request
    if (!from || !to) return res.status(400).json({ error: 'بيانات غير مكتملة' });

    let requests = getRequests();
    const reqIndex = requests.findIndex(r => r.from === from && r.to === to);

    if (reqIndex === -1) {
        return res.status(404).json({ error: 'طلب الصداقة غير موجود' });
    }

    // Remove request
    requests.splice(reqIndex, 1);
    saveRequests(requests);

    // Save friends
    let users = getUsers();
    const userTo = users.find(u => u.username === to);
    const userFrom = users.find(u => u.username === from);

    if (userTo && userFrom) {
        if (!userTo.friends) userTo.friends = [];
        if (!userFrom.friends) userFrom.friends = [];

        if (!userTo.friends.includes(from)) userTo.friends.push(from);
        if (!userFrom.friends.includes(to)) userFrom.friends.push(to);

        saveUsers(users);
    }

    res.json({ success: true, message: 'تم قبول الطلب', friends: userTo ? userTo.friends : [] });
});

app.post('/friend/reject', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'بيانات غير مكتملة' });

    let requests = getRequests();
    requests = requests.filter(r => !(r.from === from && r.to === to));
    saveRequests(requests);

    res.json({ success: true, message: 'تم رفض الطلب' });
});

app.post('/friend/remove', (req, res) => {
    const { myUsername, friendUsername } = req.body;

    let users = getUsers();
    const me = users.find(u => u.username === myUsername);
    const friend = users.find(u => u.username === friendUsername);

    if (me && me.friends) {
        me.friends = me.friends.filter(f => f !== friendUsername);
    }
    if (friend && friend.friends) {
        friend.friends = friend.friends.filter(f => f !== myUsername);
    }

    saveUsers(users);
    res.json({ success: true, message: 'تم حذف الصديق' });
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
