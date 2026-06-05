import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    groupPic:    { type: String, default: "" },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    maxMembers:  { type: Number, default: 10 },
    members: [{
        user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        role:     { type: String, enum: ["admin", "moderator", "member"], default: "member" },
        joinedAt: { type: Date, default: Date.now },
    }],
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
}, { timestamps: true });

groupSchema.index({ "members.user": 1 });

const Group = mongoose.model("Group", groupSchema);

export default Group;
