import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    senderId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },         // null for group messages
    groupId:     { type: mongoose.Schema.Types.ObjectId, ref: "Group" },        // null for DMs
    text:        { type: String },
    image:       { type: String },
    // Read Receipt system
    status:      { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    readBy:      [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],       // For group read tracking
    // Visibility control (for AI summaries visible to specific users only)
    visibleTo:   [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],       // empty = visible to all
    // Track who triggered an AI message
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Delete for everyone
    deletedForEveryone: { type: Boolean, default: false },
}, { timestamps: true });

// Indexes for fast message lookups
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ groupId: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;