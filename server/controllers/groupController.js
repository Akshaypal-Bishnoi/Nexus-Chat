import Group from "../models/Group.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { io, userSocketMap } from "../server.js";

// ── Create a new group ──
export const createGroup = async (req, res) => {
    try {
        const { name, description, memberIds } = req.body;
        const creatorId = req.user._id;

        if (!name || !name.trim()) {
            return res.json({ success: false, message: "Group name is required" });
        }

        // Build members array — creator is always admin
        const members = [{ user: creatorId, role: "admin" }];

        if (memberIds && memberIds.length > 0) {
            // Cap at 10 members total (including creator)
            const idsToAdd = memberIds.slice(0, 9);
            for (const id of idsToAdd) {
                if (id.toString() !== creatorId.toString()) {
                    members.push({ user: id, role: "member" });
                }
            }
        }

        const group = await Group.create({
            name: name.trim(),
            description: description || "",
            createdBy: creatorId,
            members,
        });

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email")
            .populate("createdBy", "fullName");

        // Auto-join all members into the Socket.IO room
        members.forEach(m => {
            const socketId = userSocketMap[m.user.toString()];
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) socket.join(`group_${group._id}`);
            }
        });

        // Notify all members about the new group
        members.forEach(m => {
            const socketId = userSocketMap[m.user.toString()];
            if (socketId) {
                io.to(socketId).emit("newGroup", populated);
            }
        });

        res.json({ success: true, group: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Get all groups the user belongs to ──
export const getGroups = async (req, res) => {
    try {
        const userId = req.user._id;

        const groups = await Group.find({ "members.user": userId })
            .populate("members.user", "fullName profilePic email")
            .populate("lastMessage")
            .sort({ updatedAt: -1 });

        res.json({ success: true, groups });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Get group details ──
export const getGroupDetails = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId)
            .populate("members.user", "fullName profilePic email bio")
            .populate("createdBy", "fullName");

        if (!group) return res.json({ success: false, message: "Group not found" });

        // Check membership
        const isMember = group.members.some(
            m => m.user._id.toString() === req.user._id.toString()
        );
        if (!isMember) return res.json({ success: false, message: "Not a member" });

        res.json({ success: true, group });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Get group messages (cursor-based pagination) ──
export const getGroupMessages = async (req, res) => {
    try {
        const { cursor, limit = 50 } = req.query;
        const groupId = req.params.groupId;

        // Verify membership
        const group = await Group.findById(groupId);
        if (!group) return res.json({ success: false, message: "Group not found" });

        const isMember = group.members.some(
            m => m.user.toString() === req.user._id.toString()
        );
        if (!isMember) return res.json({ success: false, message: "Not a member" });

        const query = {
            groupId,
            deletedForEveryone: { $ne: true },
            $or: [
                { visibleTo: { $size: 0 } },        // visible to all
                { visibleTo: { $exists: false } },   // no visibleTo field
                { visibleTo: req.user._id },          // visible to this user
            ]
        };

        if (cursor) {
            query._id = { $lt: cursor };
        }

        const messages = await Message.find(query)
            .sort({ _id: -1 })
            .limit(parseInt(limit))
            .populate("senderId", "fullName profilePic");

        res.json({
            success: true,
            messages: messages.reverse(),
            nextCursor: messages.length === parseInt(limit) ? messages[0]?._id : null,
        });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Send a message to a group ──
export const sendGroupMessage = async (req, res) => {
    try {
        const { text, image } = req.body;
        const groupId = req.params.groupId;
        const senderId = req.user._id;

        // Verify membership
        const group = await Group.findById(groupId);
        if (!group) return res.json({ success: false, message: "Group not found" });

        const isMember = group.members.some(
            m => m.user.toString() === senderId.toString()
        );
        if (!isMember) return res.json({ success: false, message: "Not a member" });

        let imageUrl;
        if (image) {
            const cloudinary = (await import("../lib/cloudinary.js")).default;
            const uploadResponse = await cloudinary.uploader.upload(image);
            imageUrl = uploadResponse.secure_url;
        }

        const newMessage = await Message.create({
            senderId,
            groupId,
            text,
            image: imageUrl,
            status: "sent",
        });

        // Update group's lastMessage
        await Group.findByIdAndUpdate(groupId, { lastMessage: newMessage._id });

        const populated = await Message.findById(newMessage._id)
            .populate("senderId", "fullName profilePic");

        // Emit to all group members via the Socket.IO room
        io.to(`group_${groupId}`).emit("newGroupMessage", populated);

        // Handle @AI in group
        const isAICall = text && text.trim().startsWith("@AI");
        if (isAICall) {
            const query = text.replace("@AI", "").trim();

            (async () => {
                try {
                    const aiUser = await User.findOne({ email: "ai@nexuschat.com" });
                    const aiMessage = await Message.create({
                        senderId: aiUser._id,
                        groupId,
                        triggeredBy: senderId,
                        text: "",
                    });

                    const populatedAI = await Message.findById(aiMessage._id)
                        .populate("senderId", "fullName profilePic");

                    io.to(`group_${groupId}`).emit("newGroupMessage", populatedAI);

                    const pythonUrl = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000";
                    const response = await fetch(`${pythonUrl}/api/chat/stream`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            message: query,
                            user_id: senderId.toString(),
                            chat_id: groupId.toString(),
                            role: "copilot"
                        })
                    });

                    if (!response.ok) {
                        const fallbackMsg = "[⚠️ The AI Service encountered an error. Please try again.]";
                        io.to(`group_${groupId}`).emit("updateMessage", { messageId: aiMessage._id, text: fallbackMsg });
                        await Message.findByIdAndUpdate(aiMessage._id, { text: fallbackMsg });
                        return;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let fullText = "";

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        if (chunk) {
                            fullText += chunk;
                            io.to(`group_${groupId}`).emit("updateMessage", {
                                messageId: aiMessage._id,
                                text: fullText
                            });
                        }
                    }

                    await Message.findByIdAndUpdate(aiMessage._id, { text: fullText });
                    await Group.findByIdAndUpdate(groupId, { lastMessage: aiMessage._id });
                } catch (aiError) {
                    console.error("Group AI Error:", aiError.message);
                }
            })();
        }

        res.json({ success: true, newMessage: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Add member(s) to group ──
export const addMember = async (req, res) => {
    try {
        const { userIds } = req.body;
        const group = req.group; // from requireGroupRole middleware

        if (!userIds || userIds.length === 0) {
            return res.json({ success: false, message: "No users specified" });
        }

        // Check member cap
        const currentCount = group.members.length;
        const availableSlots = group.maxMembers - currentCount;

        if (availableSlots <= 0) {
            return res.json({ success: false, message: `Group is full (max ${group.maxMembers} members)` });
        }

        const idsToAdd = userIds.slice(0, availableSlots);
        const added = [];

        for (const userId of idsToAdd) {
            const alreadyMember = group.members.some(m => m.user.toString() === userId.toString());
            if (alreadyMember) continue;

            const user = await User.findById(userId);
            if (!user) continue;

            group.members.push({ user: userId, role: "member" });
            added.push(userId);

            // Join the new member's socket into the group room
            const socketId = userSocketMap[userId];
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) socket.join(`group_${group._id}`);
            }
        }

        await group.save();

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email");

        // Notify all group members about the update
        io.to(`group_${group._id}`).emit("groupUpdated", populated);

        // Notify newly added members about the group
        added.forEach(userId => {
            const socketId = userSocketMap[userId];
            if (socketId) {
                io.to(socketId).emit("newGroup", populated);
            }
        });

        res.json({ success: true, group: populated, addedCount: added.length });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Remove a member from group ──
export const removeMember = async (req, res) => {
    try {
        const { userId } = req.params;
        const group = req.group;

        const targetMember = group.members.find(m => m.user.toString() === userId);
        if (!targetMember) {
            return res.json({ success: false, message: "User is not a member" });
        }

        // Moderators can only remove members, not other moderators or admins
        if (req.memberRole === "moderator" && targetMember.role !== "member") {
            return res.json({ success: false, message: "Moderators can only remove regular members" });
        }

        // Admins cannot be removed
        if (targetMember.role === "admin") {
            return res.json({ success: false, message: "Cannot remove the admin" });
        }

        group.members = group.members.filter(m => m.user.toString() !== userId);
        await group.save();

        // Remove from Socket.IO room
        const socketId = userSocketMap[userId];
        if (socketId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.leave(`group_${group._id}`);
            io.to(socketId).emit("removedFromGroup", { groupId: group._id });
        }

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email");

        io.to(`group_${group._id}`).emit("groupUpdated", populated);

        res.json({ success: true, group: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Change member role ──
export const changeRole = async (req, res) => {
    try {
        const { userId, newRole } = req.body;
        const group = req.group;

        if (!["moderator", "member"].includes(newRole)) {
            return res.json({ success: false, message: "Invalid role. Use 'moderator' or 'member'" });
        }

        const targetMember = group.members.find(m => m.user.toString() === userId);
        if (!targetMember) {
            return res.json({ success: false, message: "User is not a member" });
        }

        if (targetMember.role === "admin") {
            return res.json({ success: false, message: "Cannot change admin's role" });
        }

        targetMember.role = newRole;
        await group.save();

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email");

        io.to(`group_${group._id}`).emit("groupUpdated", populated);

        res.json({ success: true, group: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Edit group info ──
export const editGroup = async (req, res) => {
    try {
        const { name, description, groupPic } = req.body;
        const group = req.group;

        if (name) group.name = name.trim();
        if (description !== undefined) group.description = description;
        if (groupPic !== undefined) group.groupPic = groupPic;

        await group.save();

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email");

        io.to(`group_${group._id}`).emit("groupUpdated", populated);

        res.json({ success: true, group: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Delete group (admin only) ──
export const deleteGroup = async (req, res) => {
    try {
        const group = req.group;

        // Delete all group messages
        await Message.deleteMany({ groupId: group._id });

        // Notify all members
        io.to(`group_${group._id}`).emit("groupDeleted", { groupId: group._id });

        await Group.findByIdAndDelete(group._id);

        res.json({ success: true });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Leave group ──
export const leaveGroup = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.user._id;

        const group = await Group.findById(groupId);
        if (!group) return res.json({ success: false, message: "Group not found" });

        const member = group.members.find(m => m.user.toString() === userId.toString());
        if (!member) return res.json({ success: false, message: "Not a member" });

        // Admin must transfer role before leaving
        if (member.role === "admin") {
            const otherMembers = group.members.filter(m => m.user.toString() !== userId.toString());
            if (otherMembers.length > 0) {
                return res.json({
                    success: false,
                    message: "Admin must transfer admin role to another member before leaving. Use the change role endpoint first."
                });
            }
            // If admin is the only member, delete the group
            await Message.deleteMany({ groupId: group._id });
            await Group.findByIdAndDelete(group._id);
            return res.json({ success: true, groupDeleted: true });
        }

        group.members = group.members.filter(m => m.user.toString() !== userId.toString());
        await group.save();

        // Leave Socket.IO room
        const socketId = userSocketMap[userId];
        if (socketId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.leave(`group_${group._id}`);
        }

        const populated = await Group.findById(group._id)
            .populate("members.user", "fullName profilePic email");

        io.to(`group_${group._id}`).emit("groupUpdated", populated);

        res.json({ success: true });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Delete group message for everyone ──
export const deleteGroupMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const groupId = req.params.groupId;
        const userId = req.user._id;

        const message = await Message.findById(messageId);
        if (!message || message.groupId?.toString() !== groupId) {
            return res.json({ success: false, message: "Message not found in this group" });
        }

        const group = await Group.findById(groupId);
        const member = group.members.find(m => m.user.toString() === userId.toString());

        // Admin & moderator can delete any message, members can only delete their own
        const canDelete = member.role === "admin" || member.role === "moderator" ||
                          message.senderId.toString() === userId.toString();

        if (!canDelete) {
            return res.json({ success: false, message: "You don't have permission to delete this message" });
        }

        message.text = null;
        message.image = null;
        message.deletedForEveryone = true;
        await message.save();

        io.to(`group_${groupId}`).emit("messageDeleted", { messageId: message._id });

        res.json({ success: true });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};

// ── Generate AI catch-up summary (on-demand) ──
export const generateCatchUpSummary = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.user._id;

        const group = await Group.findById(groupId);
        if (!group) return res.json({ success: false, message: "Group not found" });

        const member = group.members.find(m => m.user.toString() === userId.toString());
        if (!member) return res.json({ success: false, message: "Not a member" });

        // Fetch messages from BEFORE this member joined
        const messagesBefore = await Message.find({
            groupId: group._id,
            createdAt: { $lt: member.joinedAt },
            deletedForEveryone: { $ne: true },
        }).sort({ createdAt: 1 }).limit(200).populate("senderId", "fullName");

        if (messagesBefore.length < 5) {
            return res.json({ success: true, summary: null, message: "Not enough messages to summarize." });
        }

        const chatHistory = messagesBefore
            .filter(m => m.text)
            .map(m => `${m.senderId?.fullName || "Unknown"}: ${m.text}`)
            .join("\n");

        const pythonUrl = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000";
        const response = await fetch(`${pythonUrl}/api/group/summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_history: chatHistory,
                group_name: group.name,
                new_member_name: req.user.fullName
            })
        });

        if (!response.ok) {
            return res.json({ success: false, message: "AI Service unavailable" });
        }

        const { summary } = await response.json();

        const aiUser = await User.findOne({ email: "ai@nexuschat.com" });
        const aiMessage = await Message.create({
            senderId: aiUser._id,
            groupId: group._id,
            text: `📋 **Chat Summary:**\n\n${summary}`,
            visibleTo: [userId],
        });

        const populated = await Message.findById(aiMessage._id)
            .populate("senderId", "fullName profilePic");

        // Send only to the requesting user
        const socketId = userSocketMap[userId];
        if (socketId) {
            io.to(socketId).emit("newGroupMessage", populated);
        }

        res.json({ success: true, summary: populated });
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};
