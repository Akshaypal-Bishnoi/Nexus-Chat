import React, { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import assets from '../assets/assets'
import { formatMessageTime } from '../lib/utils'
import { GroupContext } from '../../context/GroupContext'
import { ChatContext } from '../../context/ChatContext'
import { AuthContext } from '../../context/AuthContext'
import toast from 'react-hot-toast'

// Role badge component
const RoleBadge = ({ role }) => {
    if (role === "admin") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">👑 Admin</span>;
    if (role === "moderator") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-semibold">🛡️ Mod</span>;
    return null;
};

const GroupChatContainer = () => {
    const {
        selectedGroup, setSelectedGroup, groupMessages, setGroupMessages,
        getGroupMessages, sendGroupMessage, deleteGroupMsg,
        addMembers, removeMember, changeRole, leaveGroup,
        generateSummary, setUnseenGroupMessages,
    } = useContext(GroupContext);

    const { users } = useContext(ChatContext);
    const { authUser, onlineUsers } = useContext(AuthContext);

    const scrollEnd = useRef();
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [showAddMember, setShowAddMember] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const [showCatchUpBanner, setShowCatchUpBanner] = useState(false);
    const [missedCount, setMissedCount] = useState(0);

    // Get current user's role in the group
    const myMember = selectedGroup?.members?.find(
        m => (m.user?._id || m.user)?.toString() === authUser?._id?.toString()
    );
    const myRole = myMember?.role || "member";

    // Handle send
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (input.trim() === "") return;
        await sendGroupMessage(selectedGroup._id, { text: input.trim() });
        setInput("");
    };

    // Handle sending an image
    const handleSendImage = async (e) => {
        const file = e.target.files[0];
        if(!file || !file.type.startsWith("image/")){
            toast.error("select an image file")
            return;
        }
        const reader = new FileReader();

        reader.onloadend = async () => {
            await sendGroupMessage(selectedGroup._id, { image: reader.result });
            e.target.value = "";
        }
        reader.readAsDataURL(file)
    };

    // Handle sending a PDF
    const handleSendPdf = async (e) => {
        const file = e.target.files[0];
        if(!file || file.type !== "application/pdf"){
            toast.error("Please select a valid PDF file");
            return;
        }
        
        setIsUploading(true);
        toast.loading("Uploading PDF to AI Knowledge Base...", { id: "pdf-upload" });
        
        try {
            const formData = new FormData();
            formData.append("file", file);
            
            const pythonUrl = import.meta.env.VITE_PYTHON_AI_URL || "http://127.0.0.1:8000";
            const response = await fetch(`${pythonUrl}/api/upload_pdf`, {
                method: "POST",
                body: formData
            });
            
            const data = await response.json();
            
            if(data.status === "success") {
                toast.success(data.message, { id: "pdf-upload" });
                await sendGroupMessage(selectedGroup._id, { text: `📄 Shared a document: ${file.name}` });
            } else {
                toast.error(data.detail || "Upload failed", { id: "pdf-upload" });
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to connect to AI Service", { id: "pdf-upload" });
        } finally {
            setIsUploading(false);
            e.target.value = "";
        }
    };

    // Handle right-click delete
    const handleContextMenu = (e, msg) => {
        const canDelete =
            myRole === "admin" || myRole === "moderator" ||
            (msg.senderId?._id || msg.senderId)?.toString() === authUser._id?.toString() ||
            msg.triggeredBy?.toString() === authUser._id?.toString();

        if (canDelete && !msg.deletedForEveryone) {
            e.preventDefault();
            setContextMenu({ messageId: msg._id, x: e.clientX, y: e.clientY });
        }
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        if (contextMenu) {
            await deleteGroupMsg(selectedGroup._id, contextMenu.messageId);
            setContextMenu(null);
        }
    };

    // Handle add member
    const handleAddMember = async (userId) => {
        const result = await addMembers(selectedGroup._id, [userId]);
        if (result) setShowAddMember(false);
    };

    // Handle remove member
    const handleRemoveMember = async (userId) => {
        await removeMember(selectedGroup._id, userId);
    };

    // Handle role change
    const handleChangeRole = async (userId, newRole) => {
        await changeRole(selectedGroup._id, userId, newRole);
    };

    // Handle leave
    const handleLeave = async () => {
        await leaveGroup(selectedGroup._id);
    };

    // Handle catch-up
    const handleCatchUp = async () => {
        await generateSummary(selectedGroup._id);
        localStorage.setItem(`summary_${selectedGroup._id}_${authUser._id}`, "true");
        setShowCatchUpBanner(false);
    };

    const handleSkipCatchUp = () => {
        localStorage.setItem(`summary_${selectedGroup._id}_${authUser._id}`, "true");
        setShowCatchUpBanner(false);
    };

    // Close context menu
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []);

    // Load messages when group is selected
    useEffect(() => {
        if (selectedGroup) {
            getGroupMessages(selectedGroup._id);
            setUnseenGroupMessages(prev => ({ ...prev, [selectedGroup._id]: 0 }));

            // Check if user joined later and has missed messages
            if (myMember?.joinedAt) {
                const joinDate = new Date(myMember.joinedAt);
                const groupCreated = new Date(selectedGroup.createdAt);
                const hasHandledSummary = localStorage.getItem(`summary_${selectedGroup._id}_${authUser._id}`);
                
                if (joinDate > groupCreated && !hasHandledSummary) {
                    // User joined after creation — check for missed messages
                    setShowCatchUpBanner(true);
                } else {
                    setShowCatchUpBanner(false);
                }
            } else {
                setShowCatchUpBanner(false);
            }
        }
    }, [selectedGroup]);

    // Scroll to bottom
    useEffect(() => {
        if (scrollEnd.current && groupMessages) {
            scrollEnd.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [groupMessages]);

    // Get non-member users for "Add Member" modal
    const memberIds = selectedGroup?.members?.map(m => (m.user?._id || m.user)?.toString()) || [];
    const nonMembers = users?.filter(u => !memberIds.includes(u._id) && u.email !== "ai@nexuschat.com") || [];

    if (!selectedGroup) {
        return (
            <div className='flex flex-col items-center justify-center gap-4 text-gray-400 bg-gray-900/40 backdrop-blur-sm max-md:hidden h-full'>
                <div className="relative">
                    <div className="absolute inset-0 bg-purple-500 blur-[40px] opacity-20 rounded-full"></div>
                    <img src={assets.logo_icon} className='max-w-24 relative z-10 drop-shadow-2xl hover:scale-105 transition-transform duration-500' alt="" />
                </div>
                <div className="text-center">
                    <h2 className='text-2xl font-bold text-white mb-2 tracking-tight'>NexusChat AI</h2>
                    <p className='text-sm font-medium text-gray-400 max-w-xs mx-auto'>Select a group to start chatting.</p>
                </div>
            </div>
        );
    }

    return (
        <div className='h-full overflow-scroll relative backdrop-blur-lg'>
            {/* ── Header ── */}
            <div className='flex items-center gap-3 py-3 mx-4 border-b border-stone-500'>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold">
                    {selectedGroup.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className='flex-1'>
                    <p className='text-lg text-white font-medium'>{selectedGroup.name}</p>
                    <p className='text-xs text-gray-400'>{selectedGroup.members?.length} members</p>
                </div>
                <button onClick={() => setShowInfo(!showInfo)} className="text-gray-400 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
                <img onClick={() => setSelectedGroup(null)} src={assets.arrow_icon} alt="" className='md:hidden max-w-7' />
            </div>

            {/* ── Catch-up Banner ── */}
            {showCatchUpBanner && (
                <div className="mx-4 mt-3 p-3 bg-purple-900/40 border border-purple-500/30 rounded-xl flex items-center justify-between gap-3">
                    <p className="text-sm text-purple-200">
                        You joined this group later. Want AI to summarize what you missed?
                    </p>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={handleCatchUp} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors">
                            🤖 Catch me up
                        </button>
                        <button onClick={handleSkipCatchUp} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">
                            Skip
                        </button>
                    </div>
                </div>
            )}

            {/* ── Group Info Panel ── */}
            {showInfo && (
                <div className="mx-4 mt-3 p-4 bg-gray-800/60 border border-gray-700/50 rounded-xl backdrop-blur-md">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-white font-semibold text-sm">Group Info</h3>
                        <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-white text-xs">✕</button>
                    </div>
                    {selectedGroup.description && (
                        <p className="text-gray-400 text-xs mb-3">{selectedGroup.description}</p>
                    )}
                    <div className="flex justify-between items-center mb-2">
                        <p className="text-gray-300 text-xs font-semibold uppercase tracking-wider">Members ({selectedGroup.members?.length}/{selectedGroup.maxMembers || 10})</p>
                        {(myRole === "admin" || myRole === "moderator") && (
                            <button onClick={() => setShowAddMember(!showAddMember)} className="text-purple-400 hover:text-purple-300 text-xs font-semibold">+ Add</button>
                        )}
                    </div>

                    {/* Add Member dropdown */}
                    {showAddMember && nonMembers.length > 0 && (
                        <div className="mb-3 max-h-32 overflow-y-auto bg-gray-900/50 rounded-lg p-2">
                            {nonMembers.map(user => (
                                <div key={user._id} className="flex items-center justify-between p-1.5 hover:bg-gray-800 rounded cursor-pointer" onClick={() => handleAddMember(user._id)}>
                                    <div className="flex items-center gap-2">
                                        <img src={user.profilePic || assets.avatar_icon} alt="" className="w-6 h-6 rounded-full" />
                                        <span className="text-xs text-white">{user.fullName}</span>
                                    </div>
                                    <span className="text-[10px] text-purple-400">+ Add</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Members list */}
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {selectedGroup.members?.map((m, i) => {
                            const member = m.user;
                            const memberId = member?._id || member;
                            const isMe = memberId?.toString() === authUser?._id?.toString();
                            return (
                                <div key={i} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-700/30 group">
                                    <img src={member?.profilePic || assets.avatar_icon} alt="" className="w-6 h-6 rounded-full" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-white truncate">{member?.fullName || "Unknown"}{isMe && " (You)"}</span>
                                            <RoleBadge role={m.role} />
                                        </div>
                                    </div>
                                    {/* Admin controls */}
                                    {myRole === "admin" && !isMe && m.role !== "admin" && (
                                        <div className="hidden group-hover:flex items-center gap-1">
                                            <button
                                                onClick={() => handleChangeRole(memberId, m.role === "moderator" ? "member" : "moderator")}
                                                className="text-[10px] text-blue-400 hover:text-blue-300 px-1"
                                                title={m.role === "moderator" ? "Demote to member" : "Promote to moderator"}
                                            >
                                                {m.role === "moderator" ? "⬇" : "⬆"}
                                            </button>
                                            <button onClick={() => handleRemoveMember(memberId)} className="text-[10px] text-red-400 hover:text-red-300 px-1" title="Remove">✕</button>
                                        </div>
                                    )}
                                    {/* Moderator controls — can only remove members */}
                                    {myRole === "moderator" && !isMe && m.role === "member" && (
                                        <div className="hidden group-hover:flex items-center gap-1">
                                            <button onClick={() => handleRemoveMember(memberId)} className="text-[10px] text-red-400 hover:text-red-300 px-1" title="Remove">✕</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <button onClick={handleLeave} className="mt-3 w-full py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors">
                        Leave Group
                    </button>
                </div>
            )}

            {/* ── Chat Area ── */}
            <div className={`flex flex-col ${showInfo ? 'h-[calc(100%-320px)]' : 'h-[calc(100%-120px)]'} overflow-y-scroll p-3 pb-6`}>
                {groupMessages.map((msg, index) => {
                    const senderId = msg.senderId?._id || msg.senderId;
                    const isMine = senderId?.toString() === authUser._id?.toString();
                    const senderName = msg.senderId?.fullName || "Unknown";
                    const senderPic = msg.senderId?.profilePic || assets.avatar_icon;
                    const senderMember = selectedGroup.members?.find(m => (m.user?._id || m.user)?.toString() === senderId?.toString());

                    return (
                        <div
                            key={index}
                            className={`flex items-end gap-2 justify-end ${!isMine && 'flex-row-reverse'}`}
                            onContextMenu={(e) => handleContextMenu(e, msg)}
                        >
                            {msg.deletedForEveryone ? (
                                <div className={`p-3 max-w-[75%] md:text-sm font-light mb-8 italic text-gray-400 bg-gray-800/40 backdrop-blur-md border border-gray-700/50 ${isMine ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'}`}>
                                    🚫 This message was deleted
                                </div>
                            ) : msg.image ? (
                                <img src={msg.image} alt="" className='max-w-[230px] border border-gray-700 rounded-lg overflow-hidden mb-8' />
                            ) : (
                                <div className={`p-3 max-w-[75%] md:text-sm font-light mb-8 break-words leading-relaxed shadow-lg ${
                                    msg.senderId?.email === "ai@nexuschat.com"
                                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border border-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.3)] text-white'
                                        : 'bg-violet-500/80 backdrop-blur-md text-white'
                                } ${isMine ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'}`}>
                                    {/* Sender name for group messages */}
                                    {!isMine && (
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-[11px] font-semibold text-purple-200">{senderName}</span>
                                            {senderMember && <RoleBadge role={senderMember.role} />}
                                        </div>
                                    )}
                                    <span className="whitespace-pre-wrap">{msg.text}</span>
                                </div>
                            )}
                            <div className="text-center text-xs">
                                <img src={isMine ? authUser?.profilePic || assets.avatar_icon : senderPic} alt="" className='w-7 rounded-full' />
                                <p className='text-gray-500'>{formatMessageTime(msg.createdAt)}</p>
                            </div>
                        </div>
                    );
                })}
                <div ref={scrollEnd}></div>
            </div>

            {/* ── Context Menu ── */}
            {contextMenu && createPortal(
                <div
                    className="fixed z-[9999] bg-gray-900 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[180px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button onClick={handleDelete} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2">
                        🗑️ Delete for Everyone
                    </button>
                </div>,
                document.body
            )}

            {/* ── Bottom Input ── */}
            <div className='absolute bottom-0 left-0 right-0 flex items-center gap-3 p-3'>
                <div className='flex-1 flex items-center bg-gray-800/60 border border-gray-600/50 backdrop-blur-md px-4 rounded-full shadow-inner transition-all focus-within:border-purple-500/50 focus-within:bg-gray-800/80'>
                    <input
                        onChange={(e) => setInput(e.target.value)}
                        value={input}
                        onKeyDown={(e) => e.key === "Enter" ? handleSendMessage(e) : null}
                        type="text"
                        placeholder="Type a message or @AI..."
                        className='flex-1 text-sm py-3 px-2 border-none bg-transparent outline-none text-white placeholder-gray-400'
                    />
                    
                    {/* Image Upload */}
                    <input onChange={handleSendImage} type="file" id='group_image' accept='image/png, image/jpeg' hidden disabled={isUploading}/>
                    <label htmlFor="group_image" className="hover:scale-110 transition-transform p-1">
                        <img src={assets.gallery_icon} alt="Upload Image" className="w-5 mr-1 cursor-pointer opacity-70 hover:opacity-100"/>
                    </label>
                    
                    {/* PDF Upload */}
                    <input onChange={handleSendPdf} type="file" id='group_pdf' accept='application/pdf' hidden disabled={isUploading}/>
                    <label htmlFor="group_pdf" className="hover:scale-110 transition-transform p-1">
                        <svg className="w-5 h-5 mr-1 cursor-pointer text-gray-400 opacity-70 hover:opacity-100 hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                    </label>
                </div>
                <img onClick={handleSendMessage} src={assets.send_button} alt="" className="w-7 cursor-pointer" />
            </div>
        </div>
    );
};

export default GroupChatContainer;
