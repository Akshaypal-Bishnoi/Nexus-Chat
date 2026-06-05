import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRoutes.js";
import messageRouter from "./routes/messageRoutes.js";
import groupRouter from "./routes/groupRoutes.js";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

// Socket.IO
export const io = new Server(server, {
  cors: { origin: "*" }
});

export const userSocketMap = {}; // { userId: socketId }

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  console.log("User Connected", userId);

  if (userId) {
    userSocketMap[userId] = socket.id;

    // When user comes online, mark all pending "sent" messages to them as "delivered"
    (async () => {
      try {
        const { default: Message } = await import("./models/Message.js");
        const pendingMessages = await Message.find({
          receiverId: userId,
          status: "sent"
        });

        if (pendingMessages.length > 0) {
          await Message.updateMany(
            { receiverId: userId, status: "sent" },
            { status: "delivered" }
          );

          // Notify each sender that their messages were delivered
          const senderIds = [...new Set(pendingMessages.map(m => m.senderId.toString()))];
          senderIds.forEach(senderId => {
            const senderSocketId = userSocketMap[senderId];
            if (senderSocketId) {
              const messageIds = pendingMessages
                .filter(m => m.senderId.toString() === senderId)
                .map(m => m._id);
              io.to(senderSocketId).emit("messageDelivered", { messageIds });
            }
          });
        }
        // Auto-join user into their group Socket.IO rooms
        const { default: Group } = await import("./models/Group.js");
        const groups = await Group.find({ "members.user": userId });
        groups.forEach(g => socket.join(`group_${g._id}`));
      } catch (e) {
        console.log("Socket connect setup error:", e.message);
      }
    })();
  }

  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("User Disconnected", userId);
    delete userSocketMap[userId];
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

// Middleware
app.use(express.json({ limit: "4mb" }));
app.use(cors());

// Routes
app.get("/api/status", (req, res) => {
  res.send("Server is live 🚀");
});
app.use("/api/auth", userRouter);
app.use("/api/messages", messageRouter);
app.use("/api/groups", groupRouter);

// DB
await connectDB();

import User from "./models/User.js";
const seedAIUser = async () => {
    try {
        const aiExists = await User.findOne({ email: "ai@nexuschat.com" });
        if (!aiExists) {
            await User.create({
                fullName: "Nexus AI Co-Pilot",
                email: "ai@nexuschat.com",
                password: "not_a_real_password_123", // Doesn't matter, AI won't log in
                profilePic: "https://cdn-icons-png.flaticon.com/512/8649/8649595.png",
                bio: "I am your personal AI Assistant. Ask me anything!"
            });
            console.log("🤖 AI User seeded in database!");
        }
    } catch (e) {
        console.log("Error seeding AI user:", e);
    }
};
await seedAIUser();

// ✅ IMPORTANT: Always listen
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

