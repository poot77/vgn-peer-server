require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const User = require('./models/User');
const FriendRequest = require('./models/FriendRequest');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

const port = process.env.PORT || 9000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const { MongoMemoryServer } = require('mongodb-memory-server');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("Connected to MongoDB!");
    } catch (err) {
        console.log("Local MongoDB not found, starting Memory DB instead...");
        const mongoServer = await MongoMemoryServer.create({ instance: { port: 27017 } });
        const uri = mongoServer.getUri();
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log(`Connected to Memory MongoDB at ${uri}`);
    }
};
connectDB();

// Auth Middleware
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح للوصول' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = await User.findById(decoded.id);
        if (!req.user) throw new Error();
        next();
    } catch (e) {
        res.status(401).json({ error: 'التوكن غير صالح أو منتهي الصلاحية' });
    }
};

// --- Upload Config ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl, type: req.file.mimetype.startsWith('image/') ? 'image' : 'file' });
});

// --- Auth Routes ---
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });

        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً' });

        const user = new User({ username, password });
        await user.save();
        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username }).populate('friends', 'username');
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        const friendUsernames = user.friends.map(f => f.username);

        res.json({ success: true, username: user.username, token, friends: friendUsernames });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
});

app.get('/user/:username', authMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (user) {
            res.json({ exists: true, username: user.username, id: user._id });
        } else {
            res.status(404).json({ exists: false, error: 'المستخدم غير موجود' });
        }
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

// --- Friend Request Routes ---
app.post('/friend/request', authMiddleware, async (req, res) => {
    try {
        const { from, to } = req.body; // 'to' is target username, 'from' is current username
        const targetUser = await User.findOne({ username: to });
        if (!targetUser) return res.status(404).json({ error: 'المستخدم المطلوب غير موجود' });

        // Ensure they aren't already friends
        if (req.user.friends.includes(targetUser._id)) {
            return res.status(400).json({ error: 'المستخدم في قائمة أصدقائك بالفعل' });
        }

        const existingReq = await FriendRequest.findOne({ from: req.user._id, to: targetUser._id, status: 'pending' });
        if (existingReq) return res.status(400).json({ error: 'الطلب قيد الانتظار بالفعل' });

        await FriendRequest.create({ from: req.user._id, to: targetUser._id });
        res.json({ success: true, message: 'تم الإرسال بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/friend/requests/:username', authMiddleware, async (req, res) => {
    try {
        const requests = await FriendRequest.find({ to: req.user._id, status: 'pending' }).populate('from', 'username');
        const formatted = requests.map(r => ({ from: r.from.username, timestamp: r.createdAt, id: r._id }));
        res.json({ requests: formatted });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

app.post('/friend/accept', authMiddleware, async (req, res) => {
    try {
        const { from } = req.body; // from username
        const fromUser = await User.findOne({ username: from });
        if (!fromUser) return res.status(404).json({ error: 'مستخدم غير موجود' });

        const request = await FriendRequest.findOne({ from: fromUser._id, to: req.user._id, status: 'pending' });
        if (!request) return res.status(404).json({ error: 'طلب الصداقة غير موجود' });

        request.status = 'accepted';
        await request.save();

        if (!req.user.friends.includes(fromUser._id)) req.user.friends.push(fromUser._id);
        if (!fromUser.friends.includes(req.user._id)) fromUser.friends.push(req.user._id);

        await req.user.save();
        await fromUser.save();

        const populatedMe = await User.findById(req.user._id).populate('friends', 'username');
        res.json({ success: true, message: 'تم قبول الطلب', friends: populatedMe.friends.map(f => f.username) });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

app.post('/friend/reject', authMiddleware, async (req, res) => {
    try {
        const { from } = req.body;
        const fromUser = await User.findOne({ username: from });
        if (!fromUser) return res.status(404).json({ error: 'مستخدم غير موجود' });

        const request = await FriendRequest.findOne({ from: fromUser._id, to: req.user._id, status: 'pending' });
        if (request) {
            request.status = 'rejected';
            await request.save();
        }
        res.json({ success: true, message: 'تم رفض الطلب' });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

app.post('/friend/remove', authMiddleware, async (req, res) => {
    try {
        const { friendUsername } = req.body;
        const friend = await User.findOne({ username: friendUsername });
        if (!friend) return res.status(404).json({ error: 'مستخدم غير موجود' });

        req.user.friends.pull(friend._id);
        friend.friends.pull(req.user._id);

        await req.user.save();
        await friend.save();

        res.json({ success: true, message: 'تم حذف الصديق' });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

// --- Messaging Routes ---
app.post('/messages', authMiddleware, async (req, res) => {
    try {
        const { to, text, mediaUrl, type } = req.body;
        const targetUser = await User.findOne({ username: to });
        if (!targetUser) return res.status(404).json({ error: 'مستخدم غير موجود' });

        const message = new Message({
            from: req.user._id,
            to: targetUser._id,
            text,
            mediaUrl,
            type
        });
        await message.save();
        res.json({ success: true, message });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

app.get('/messages/:friendUsername', authMiddleware, async (req, res) => {
    try {
        const friend = await User.findOne({ username: req.params.friendUsername });
        if (!friend) return res.status(404).json({ error: 'مستخدم غير موجود' });

        const messages = await Message.find({
            $or: [
                { from: req.user._id, to: friend._id },
                { from: friend._id, to: req.user._id }
            ]
        }).sort({ createdAt: 1 }).populate('from', 'username');

        // Mark as read if from friend
        await Message.updateMany({ from: friend._id, to: req.user._id, isRead: false }, { isRead: true });

        const formatted = messages.map(m => ({
            id: m._id,
            sender: m.from._id.equals(req.user._id) ? 'me' : 'friend',
            text: m.text,
            mediaUrl: m.mediaUrl,
            type: m.type,
            timestamp: m.createdAt,
            isRead: m.isRead
        }));

        res.json({ messages: formatted });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

app.get('/messages/sync', authMiddleware, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { from: req.user._id },
                { to: req.user._id }
            ]
        }).sort({ createdAt: 1 }).populate('from', 'username').populate('to', 'username');

        const grouped = {};
        messages.forEach(m => {
            const isMeSender = m.from._id.equals(req.user._id);
            const friendUsername = isMeSender ? m.to.username : m.from.username;

            if (!grouped[friendUsername]) grouped[friendUsername] = [];
            grouped[friendUsername].push({
                id: m._id,
                sender: isMeSender ? 'me' : 'friend',
                text: m.text,
                mediaUrl: m.mediaUrl,
                type: m.type,
                timestamp: m.createdAt,
                isRead: m.isRead
            });
        });

        res.json({ success: true, chats: grouped });
    } catch (err) {
        console.error("Sync error", err);
        res.status(500).json({ error: 'حدث خطأ في المزامنة' });
    }
});

app.post('/messages/read', authMiddleware, async (req, res) => {
    try {
        const { friendUsername } = req.body;
        const friend = await User.findOne({ username: friendUsername });
        if (friend) {
            await Message.updateMany({ from: friend._id, to: req.user._id, isRead: false }, { isRead: true });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ' });
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
