import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRoutes.js";
import messageRouter from "./routes/messageRoutes.js";
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

  if (userId) userSocketMap[userId] = socket.id;
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

// ❌ Remove this for Render
// export default server;



