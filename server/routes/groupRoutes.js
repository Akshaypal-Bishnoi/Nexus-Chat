import express from "express";
import { protectRoute } from "../middleware/auth.js";
import { requireGroupRole } from "../middleware/groupAuth.js";
import {
    createGroup,
    getGroups,
    getGroupDetails,
    getGroupMessages,
    sendGroupMessage,
    addMember,
    removeMember,
    changeRole,
    editGroup,
    deleteGroup,
    leaveGroup,
    deleteGroupMessage,
    generateCatchUpSummary,
} from "../controllers/groupController.js";

const groupRouter = express.Router();

// Public (any authenticated user)
groupRouter.post("/create", protectRoute, createGroup);
groupRouter.get("/", protectRoute, getGroups);
groupRouter.get("/:groupId", protectRoute, getGroupDetails);
groupRouter.get("/:groupId/messages", protectRoute, getGroupMessages);
groupRouter.post("/:groupId/send", protectRoute, sendGroupMessage);
groupRouter.put("/:groupId/leave", protectRoute, leaveGroup);
groupRouter.get("/:groupId/summary", protectRoute, generateCatchUpSummary);

// Admin + Moderator only
groupRouter.put("/:groupId/add", protectRoute, requireGroupRole("admin", "moderator"), addMember);
groupRouter.put("/:groupId/remove/:userId", protectRoute, requireGroupRole("admin", "moderator"), removeMember);
groupRouter.put("/:groupId/edit", protectRoute, requireGroupRole("admin", "moderator"), editGroup);
groupRouter.delete("/:groupId/message/:messageId", protectRoute, requireGroupRole("admin", "moderator", "member"), deleteGroupMessage);

// Admin only
groupRouter.put("/:groupId/role", protectRoute, requireGroupRole("admin"), changeRole);
groupRouter.delete("/:groupId", protectRoute, requireGroupRole("admin"), deleteGroup);

export default groupRouter;
