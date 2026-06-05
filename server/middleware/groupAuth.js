import Group from "../models/Group.js";

  //Usage: requireGroupRole("admin", "moderator") — only allows those roles to proceed
  //Attaches req.group and req.memberRole for use in the controller.
export const requireGroupRole = (...roles) => async (req, res, next) => {
    try {
        const groupId = req.params.groupId;
        const group = await Group.findById(groupId);

        if (!group) {
            return res.json({ success: false, message: "Group not found" });
        }

        const member = group.members.find(
            m => m.user.toString() === req.user._id.toString()
        );

        if (!member) {
            return res.json({ success: false, message: "You are not a member of this group" });
        }

        if (!roles.includes(member.role)) {
            return res.json({ success: false, message: `Insufficient permissions. Required: ${roles.join(" or ")}` });
        }

        req.group = group;
        req.memberRole = member.role;
        next();
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
};
