import React, { useContext, useEffect, useState } from 'react'
import assets from '../assets/assets'
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { ChatContext } from '../../context/ChatContext';
import { GroupContext } from '../../context/GroupContext';

const Sidebar = () => {

    const {getUsers, users, selectedUser, setSelectedUser,
        unseenMessages, setUnseenMessages } = useContext(ChatContext);

    const {
        groups, selectedGroup, setSelectedGroup,
        unseenGroupMessages, setUnseenGroupMessages,
        getGroups, createGroup
    } = useContext(GroupContext);

    const {logout, onlineUsers} = useContext(AuthContext)

    const [input, setInput] = useState('')
    const [activeTab, setActiveTab] = useState('chats'); // 'chats' or 'groups'
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [selectedMembers, setSelectedMembers] = useState([]);

    const navigate = useNavigate();

    const filteredUsers = input
        ? users.filter((user) => user.fullName.toLowerCase().includes(input.toLowerCase()))
        : users;

    const filteredGroups = input
        ? groups.filter((group) => group.name.toLowerCase().includes(input.toLowerCase()))
        : groups;

    // Toggle member selection for group creation
    const toggleMember = (userId) => {
        setSelectedMembers(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : prev.length < 9 ? [...prev, userId] : prev
        );
    };

    // Handle create group
    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return;
        const group = await createGroup(newGroupName.trim(), newGroupDesc.trim(), selectedMembers);
        if (group) {
            setShowCreateGroup(false);
            setNewGroupName('');
            setNewGroupDesc('');
            setSelectedMembers([]);
            setActiveTab('groups');
        }
    };

    useEffect(() => {
        getUsers();
        getGroups();
    }, [onlineUsers])

    return (
        <div className={`bg-[#8185B2]/10 h-full p-5 rounded-r-xl overflow-y-scroll text-white ${(selectedUser || selectedGroup) ? "max-md:hidden" : ''}`}>
            <div className='pb-5'>
                <div className='flex justify-between items-center'>
                    <div className='flex items-center gap-2'>
                        <img src={assets.logo_icon} alt="logo" className='w-8' />
                        <h2 className='text-xl font-bold text-white tracking-tight'>NexusChat</h2>
                    </div>
                    <div className="relative py-2 group">
                        <img src={assets.menu_icon} alt="Menu" className='max-h-5 cursor-pointer' />
                        <div className='absolute top-full right-0 z-20 w-32 p-5 rounded-md bg-[#282142] border border-gray-600 text-gray-100 hidden group-hover:block'>
                            <p onClick={() => navigate('/profile')} className='cursor-pointer text-sm'>Edit Profile</p>
                            <hr className="my-2 border-t border-gray-500" />
                            <p onClick={() => logout()} className='cursor-pointer text-sm'>Logout</p>
                        </div>
                    </div>
                </div>

                {/* ── Tabs ── */}
                <div className='flex mt-4 bg-[#282142] rounded-full p-1'>
                    <button
                        onClick={() => { setActiveTab('chats'); setSelectedGroup(null); }}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition-all ${activeTab === 'chats' ? 'bg-violet-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                    >
                        Chats
                    </button>
                    <button
                        onClick={() => { setActiveTab('groups'); setSelectedUser(null); }}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition-all ${activeTab === 'groups' ? 'bg-violet-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                    >
                        Groups
                    </button>
                </div>

                {/* ── Search ── */}
                <div className='bg-[#282142] rounded-full flex items-center gap-2 py-3 px-4 mt-3'>
                    <img src={assets.search_icon} alt="Search" className='w-3' />
                    <input
                        onChange={(e) => setInput(e.target.value)}
                        type="text"
                        className='bg-transparent border-none outline-none text-white text-xs placeholder-[#c8c8c8] flex-1'
                        placeholder={activeTab === 'chats' ? 'Search users...' : 'Search groups...'}
                    />
                </div>

                {/* ── Create Group Button ── */}
                {activeTab === 'groups' && (
                    <button
                        onClick={() => setShowCreateGroup(!showCreateGroup)}
                        className='mt-3 w-full py-2 text-xs font-semibold text-purple-300 border border-purple-500/30 rounded-xl hover:bg-purple-900/20 transition-colors flex items-center justify-center gap-1.5'
                    >
                        <span className="text-base">+</span> Create Group
                    </button>
                )}
            </div>

            {/* ── Create Group Form ── */}
            {showCreateGroup && (
                <div className="mb-4 p-3 bg-[#282142] rounded-xl space-y-2">
                    <input
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        type="text"
                        placeholder="Group name..."
                        className="w-full bg-gray-800/50 border border-gray-600/50 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-purple-500/50"
                    />
                    <input
                        value={newGroupDesc}
                        onChange={(e) => setNewGroupDesc(e.target.value)}
                        type="text"
                        placeholder="Description (optional)..."
                        className="w-full bg-gray-800/50 border border-gray-600/50 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-purple-500/50"
                    />
                    <p className="text-[10px] text-gray-400">Select members ({selectedMembers.length}/9):</p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                        {users.filter(u => u.email !== "ai@nexuschat.com").map(user => (
                            <div
                                key={user._id}
                                onClick={() => toggleMember(user._id)}
                                className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs ${selectedMembers.includes(user._id) ? 'bg-purple-900/40 border border-purple-500/30' : 'hover:bg-gray-700/30'}`}
                            >
                                <img src={user.profilePic || assets.avatar_icon} alt="" className="w-5 h-5 rounded-full" />
                                <span className="text-white flex-1">{user.fullName}</span>
                                {selectedMembers.includes(user._id) && <span className="text-purple-400 text-[10px]">✓</span>}
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleCreateGroup}
                            disabled={!newGroupName.trim()}
                            className="flex-1 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
                        >
                            Create
                        </button>
                        <button
                            onClick={() => { setShowCreateGroup(false); setSelectedMembers([]); }}
                            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── Chats List ── */}
            {activeTab === 'chats' && (
                <div className='flex flex-col'>
                    {filteredUsers.map((user, index) => (
                        <div onClick={() => { setSelectedUser(user); setSelectedGroup(null); setUnseenMessages(prev => ({ ...prev, [user._id]: 0 })) }}
                            key={index} className={`relative flex items-center gap-2 p-2 pl-4 rounded cursor-pointer max-sm:text-sm ${selectedUser?._id === user._id && 'bg-[#282142]/50'}`}>
                            <img src={user?.profilePic || assets.avatar_icon} alt="" className='w-[35px] aspect-[1/1] rounded-full' />
                            <div className='flex flex-col leading-5'>
                                <p>{user.fullName}</p>
                                {
                                    onlineUsers.includes(user._id)
                                        ? <span className='text-green-400 text-xs'>Online</span>
                                        : <span className='text-neutral-400 text-xs'>Offline</span>
                                }
                            </div>
                            {unseenMessages[user._id] > 0 && <p className='absolute top-4 right-4 text-xs h-5 w-5 flex justify-center items-center rounded-full bg-violet-500/50'>{unseenMessages[user._id]}</p>}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Groups List ── */}
            {activeTab === 'groups' && (
                <div className='flex flex-col'>
                    {filteredGroups.map((group, index) => (
                        <div
                            onClick={() => { setSelectedGroup(group); setSelectedUser(null); setUnseenGroupMessages(prev => ({ ...prev, [group._id]: 0 })) }}
                            key={index}
                            className={`relative flex items-center gap-2 p-2 pl-4 rounded cursor-pointer max-sm:text-sm ${selectedGroup?._id === group._id && 'bg-[#282142]/50'}`}
                        >
                            <div className="w-[35px] h-[35px] rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                                {group.name?.charAt(0)?.toUpperCase()}
                            </div>
                            <div className='flex flex-col leading-5 flex-1 min-w-0'>
                                <p className="truncate">{group.name}</p>
                                <span className='text-neutral-400 text-xs'>{group.members?.length} members</span>
                            </div>
                            {unseenGroupMessages[group._id] > 0 && (
                                <p className='absolute top-4 right-4 text-xs h-5 w-5 flex justify-center items-center rounded-full bg-violet-500/50'>
                                    {unseenGroupMessages[group._id]}
                                </p>
                            )}
                        </div>
                    ))}
                    {filteredGroups.length === 0 && (
                        <p className="text-center text-xs text-gray-500 mt-4">No groups yet. Create one!</p>
                    )}
                </div>
            )}
        </div>
    )
}

export default Sidebar
