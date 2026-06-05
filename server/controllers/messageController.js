import Message from "../models/Message.js";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js"
import { io, userSocketMap } from "../server.js";


// Get all users except the logged in user
export const getUsersForSidebar = async (req, res)=>{
    try {
        const userId = req.user._id;
        const filteredUsers = await User.find({_id: {$ne: userId}}).select("-password");

        // Count number of messages not seen
        const unseenMessages = {}
        const promises = filteredUsers.map(async (user)=>{
            const messages = await Message.find({
                senderId: user._id,
                receiverId: userId,
                status: { $ne: "read" },
                deletedForEveryone: { $ne: true }
            })
            if(messages.length > 0){
                unseenMessages[user._id] = messages.length;
            }
        })
        await Promise.all(promises);
        res.json({success: true, users: filteredUsers, unseenMessages})
    } catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

// Get all messages for selected user
export const getMessages = async (req, res) =>{
    try {
        const { id: selectedUserId } = req.params;
        const myId = req.user._id;

        const messages = await Message.find({
            $or: [
                {senderId: myId, receiverId: selectedUserId},
                {senderId: selectedUserId, receiverId: myId},
            ]
        }).sort({ createdAt: 1 });

        // Mark all unread messages from the other user as "read"
        const unreadMessages = await Message.find({
            senderId: selectedUserId,
            receiverId: myId,
            status: { $in: ["sent", "delivered"] }
        });

        if (unreadMessages.length > 0) {
            await Message.updateMany(
                { senderId: selectedUserId, receiverId: myId, status: { $in: ["sent", "delivered"] } },
                { status: "read" }
            );

            // Notify the sender that their messages have been read
            const senderSocketId = userSocketMap[selectedUserId];
            if (senderSocketId) {
                const messageIds = unreadMessages.map(m => m._id);
                io.to(senderSocketId).emit("messageRead", { messageIds, readBy: myId });
            }
        }

        res.json({success: true, messages})

    } catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

// api to mark message as seen using message id
export const markMessageAsSeen = async (req, res)=>{
    try {
        const { id } = req.params;
        const message = await Message.findById(id);
        
        if (message && message.status !== "read") {
            message.status = "read";
            await message.save();
            
            // Notify the sender that their message was read
            const senderSocketId = userSocketMap[message.senderId.toString()];
            if (senderSocketId) {
                io.to(senderSocketId).emit("messageRead", { messageIds: [id], readBy: req.user._id });
            }
        }
        res.json({success: true})
    } catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

// Delete message for everyone
export const deleteForEveryone = async (req, res) => {
    try {
        const { id: messageId } = req.params;
        const message = await Message.findById(messageId);

        if (!message) {
            return res.json({ success: false, message: "Message not found" });
        }

        // Only the sender can delete their own message in DMs
        if (message.senderId.toString() !== req.user._id.toString()) {
            return res.json({ success: false, message: "You can only delete your own messages" });
        }

        message.text = null;
        message.image = null;
        message.deletedForEveryone = true;
        await message.save();

        // Notify the receiver via Socket.IO
        if (message.receiverId) {
            const receiverSocketId = userSocketMap[message.receiverId];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("messageDeleted", { messageId: message._id });
            }
        }

        // Also notify sender's other devices
        const senderSocketId = userSocketMap[message.senderId];
        if (senderSocketId) {
            io.to(senderSocketId).emit("messageDeleted", { messageId: message._id });
        }

        res.json({ success: true });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

// Send message to selected user
export const sendMessage = async (req, res) =>{
    try {
        const {text, image} = req.body;
        const receiverId = req.params.id;
        const senderId = req.user._id;

        let imageUrl;
        if(image){
            const uploadResponse = await cloudinary.uploader.upload(image)
            imageUrl = uploadResponse.secure_url;
        }
        const newMessage = await Message.create({
            senderId,
            receiverId,
            text,
            image: imageUrl,
            status: "sent"
        })

        // Fetch receiver to check if it's the direct AI user
        const receiver = await User.findById(receiverId);
        const isDirectAI = receiver && receiver.email === "ai@nexuschat.com";

        // Emit the new message to the receiver's socket
        const receiverSocketId = userSocketMap[receiverId];
        if (receiverSocketId){
            io.to(receiverSocketId).emit("newMessage", newMessage)

            // Mark as delivered since receiver's socket is connected
            await Message.findByIdAndUpdate(newMessage._id, { status: "delivered" });
            newMessage.status = "delivered";

            // Notify sender that message was delivered
            const senderSocketId = userSocketMap[senderId];
            if (senderSocketId) {
                io.to(senderSocketId).emit("messageDelivered", { messageId: newMessage._id });
            }
        }

        // VECTOR DATABASE EAVESDROPPER
        // If it's a normal text message (not an AI command, and not sent directly to AI), embed it
        const isAICall = text && text.trim().startsWith("@AI");
        
        if (text && !isAICall && !isDirectAI) {
            const pythonUrl = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000";
            fetch(`${pythonUrl}/api/embed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: text,
                    sender_id: senderId.toString(),
                    chat_id: receiverId.toString()
                })
            }).catch(err => console.error("ChromaDB Sync Error:", err.message));
        }

        // AI CO-PILOT & DIRECT AI INTEGRATION
        if (isDirectAI || isAICall) {
            const query = isDirectAI ? text : text.replace("@AI", "").trim();
            
            // Run asynchronously so the user's message returns immediately!
            (async () => {
                try {
                    const aiPrefix = isDirectAI ? "" : "[🤖 AI Co-Pilot]: ";
                    
                    // Create an empty placeholder message in the DB
                    let aiMessage = await Message.create({
                        senderId: isDirectAI ? receiverId : senderId, 
                        receiverId: isDirectAI ? senderId : receiverId,
                        triggeredBy: senderId,
                        text: aiPrefix,
                    });

                    // Emit the placeholder message to clients immediately
                    const senderSocketId = userSocketMap[senderId];
                    if (senderSocketId) {
                        io.to(senderSocketId).emit("newMessage", aiMessage);
                    }
                    if (receiverSocketId && receiverSocketId !== senderSocketId) {
                        io.to(receiverSocketId).emit("newMessage", aiMessage);
                    }

                    // Call Python FastAPI Streaming Endpoint
                    const pythonUrl = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000";
                    const response = await fetch(`${pythonUrl}/api/chat/stream`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            message: query,
                            user_id: senderId.toString(),
                            chat_id: receiverId.toString(),
                            role: isDirectAI ? "assistant" : "copilot"
                        })
                    });
                    
                    if (!response.ok) {
                        console.error("Python API Error:", response.status);
                        const fallbackMsg = aiPrefix + "\n[⚠️ The AI Service encountered an error. Please try again.]";
                        
                        if (senderSocketId) io.to(senderSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fallbackMsg });
                        if (receiverSocketId && receiverSocketId !== senderSocketId) io.to(receiverSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fallbackMsg });
                        
                        await Message.findByIdAndUpdate(aiMessage._id, { text: fallbackMsg });
                        return;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let fullText = aiPrefix;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value, { stream: true });
                        if (chunk) {
                            fullText += chunk;
                            
                            // Emit a special "updateMessage" event with the new chunk
                            if (senderSocketId) {
                                io.to(senderSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fullText });
                            }
                            if (receiverSocketId && receiverSocketId !== senderSocketId) {
                                io.to(receiverSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fullText });
                            }
                        }
                    }

                    // After stream finishes, save the final complete text to DB
                    await Message.findByIdAndUpdate(aiMessage._id, { text: fullText });

                } catch (aiError) {
                    console.error("AI Streaming Error:", aiError.message);
                    if (aiMessage) {
                        const fallbackMsg = (isDirectAI ? "" : "[🤖 AI Co-Pilot]: ") + "\n[⚠️ The AI Service is completely unreachable right now (Network Error). Please try again.]";
                        if (senderSocketId) io.to(senderSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fallbackMsg });
                        if (receiverSocketId && receiverSocketId !== senderSocketId) io.to(receiverSocketId).emit("updateMessage", { messageId: aiMessage._id, text: fallbackMsg });
                        await Message.findByIdAndUpdate(aiMessage._id, { text: fallbackMsg }).catch(e => console.error(e));
                    }
                }
            })();
        }

        // Return immediately so the UI doesn't freeze waiting for the AI!
        res.json({success: true, newMessage});

    } catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}
