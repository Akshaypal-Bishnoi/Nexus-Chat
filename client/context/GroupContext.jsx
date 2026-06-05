import { createContext, useContext, useEffect, useState } from "react";
import { AuthContext } from "./AuthContext";
import toast from "react-hot-toast";

export const GroupContext = createContext();

export const GroupProvider = ({ children }) => {

    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [groupMessages, setGroupMessages] = useState([]);
    const [unseenGroupMessages, setUnseenGroupMessages] = useState({});

    const { socket, axios, authUser } = useContext(AuthContext);

    // ── Fetch all groups ──
    const getGroups = async () => {
        try {
            const { data } = await axios.get("/api/groups");
            if (data.success) {
                setGroups(data.groups);
            }
        } catch (error) {
            toast.error(error.message);
        }
    };

    // ── Fetch group messages (with cursor-based pagination) ──
    const getGroupMessages = async (groupId, cursor = null) => {
        try {
            const url = cursor
                ? `/api/groups/${groupId}/messages?cursor=${cursor}`
                : `/api/groups/${groupId}/messages`;
            const { data } = await axios.get(url);
            if (data.success) {
                if (cursor) {
                    // Prepend older messages
                    setGroupMessages(prev => [...data.messages, ...prev]);
                } else {
                    setGroupMessages(data.messages);
                }
                return data.nextCursor;
            }
        } catch (error) {
            toast.error(error.message);
        }
        return null;
    };

    // ── Send a group message ──
    const sendGroupMessage = async (groupId, messageData) => {
        try {
            const { data } = await axios.post(`/api/groups/${groupId}/send`, messageData);
            if (data.success) {
                // The message will arrive via Socket.IO, no need to manually add
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
    };

    // ── Create a group ──
    const createGroup = async (name, description, memberIds) => {
        try {
            const { data } = await axios.post("/api/groups/create", { name, description, memberIds });
            if (data.success) {
                toast.success(`Group "${data.group.name}" created!`);
                return data.group;
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
        return null;
    };

    // ── Add members ──
    const addMembers = async (groupId, userIds) => {
        try {
            const { data } = await axios.put(`/api/groups/${groupId}/add`, { userIds });
            if (data.success) {
                toast.success(`Added ${data.addedCount} member(s)`);
                return data.group;
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
        return null;
    };

    // ── Remove member ──
    const removeMember = async (groupId, userId) => {
        try {
            const { data } = await axios.put(`/api/groups/${groupId}/remove/${userId}`);
            if (data.success) {
                toast.success("Member removed");
                return data.group;
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
        return null;
    };

    // ── Change role ──
    const changeRole = async (groupId, userId, newRole) => {
        try {
            const { data } = await axios.put(`/api/groups/${groupId}/role`, { userId, newRole });
            if (data.success) {
                toast.success("Role updated");
                return data.group;
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
        return null;
    };

    // ── Leave group ──
    const leaveGroup = async (groupId) => {
        try {
            const { data } = await axios.put(`/api/groups/${groupId}/leave`);
            if (data.success) {
                setGroups(prev => prev.filter(g => g._id !== groupId));
                if (selectedGroup?._id === groupId) setSelectedGroup(null);
                toast.success("Left the group");
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
    };

    // ── Delete group message ──
    const deleteGroupMsg = async (groupId, messageId) => {
        try {
            const { data } = await axios.delete(`/api/groups/${groupId}/message/${messageId}`);
            if (data.success) {
                toast.success("Message deleted for everyone");
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
    };

    // ── Generate AI catch-up summary ──
    const generateSummary = async (groupId) => {
        try {
            toast.loading("AI is generating summary...", { id: "summary" });
            const { data } = await axios.get(`/api/groups/${groupId}/summary`);
            if (data.success && data.summary) {
                toast.success("Summary generated!", { id: "summary" });
            } else {
                toast.dismiss("summary");
                toast(data.message || "Not enough messages to summarize", { icon: "ℹ️" });
            }
        } catch (error) {
            toast.error(error.message, { id: "summary" });
        }
    };

    // ── Socket.IO subscriptions ──
    const subscribeToGroups = () => {
        if (!socket) return;

        socket.on("newGroup", (group) => {
            setGroups(prev => {
                if (prev.some(g => g._id === group._id)) return prev;
                return [group, ...prev];
            });
        });

        socket.on("groupUpdated", (updatedGroup) => {
            setGroups(prev =>
                prev.map(g => g._id === updatedGroup._id ? updatedGroup : g)
            );
            if (selectedGroup?._id === updatedGroup._id) {
                setSelectedGroup(updatedGroup);
            }
        });

        socket.on("groupDeleted", ({ groupId }) => {
            setGroups(prev => prev.filter(g => g._id !== groupId));
            if (selectedGroup?._id === groupId) {
                setSelectedGroup(null);
                setGroupMessages([]);
            }
        });

        socket.on("removedFromGroup", ({ groupId }) => {
            setGroups(prev => prev.filter(g => g._id !== groupId));
            if (selectedGroup?._id === groupId) {
                setSelectedGroup(null);
                setGroupMessages([]);
                toast("You were removed from the group", { icon: "🚫" });
            }
        });

        socket.on("newGroupMessage", (message) => {
            if (selectedGroup && message.groupId === selectedGroup._id) {
                setGroupMessages(prev => {
                    if (prev.some(m => m._id === message._id)) return prev;
                    return [...prev, message];
                });
            } else if (authUser && message.senderId?._id !== authUser._id) {
                setUnseenGroupMessages(prev => ({
                    ...prev,
                    [message.groupId]: (prev[message.groupId] || 0) + 1
                }));
            }
        });

        // Reuse updateMessage for AI streaming in groups
        socket.on("updateMessage", (updatedData) => {
            setGroupMessages(prev =>
                prev.map(msg =>
                    msg._id === updatedData.messageId ? { ...msg, text: updatedData.text } : msg
                )
            );
        });

        // Reuse messageDeleted for group message deletion
        socket.on("messageDeleted", ({ messageId }) => {
            setGroupMessages(prev =>
                prev.map(msg =>
                    msg._id === messageId
                        ? { ...msg, text: null, image: null, deletedForEveryone: true }
                        : msg
                )
            );
        });
    };

    const unsubscribeFromGroups = () => {
        if (socket) {
            socket.off("newGroup");
            socket.off("groupUpdated");
            socket.off("groupDeleted");
            socket.off("removedFromGroup");
            socket.off("newGroupMessage");
        }
    };

    useEffect(() => {
        subscribeToGroups();
        return () => unsubscribeFromGroups();
    }, [socket, selectedGroup]);

    const value = {
        groups, selectedGroup, groupMessages, unseenGroupMessages,
        setSelectedGroup, setUnseenGroupMessages, setGroupMessages,
        getGroups, getGroupMessages, sendGroupMessage, createGroup,
        addMembers, removeMember, changeRole, leaveGroup, deleteGroupMsg,
        generateSummary,
    };

    return (
        <GroupContext.Provider value={value}>
            {children}
        </GroupContext.Provider>
    );
};
