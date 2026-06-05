import React, { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import assets, { messagesDummyData } from '../assets/assets'
import { formatMessageTime } from '../lib/utils'
import { ChatContext } from '../../context/ChatContext'
import { AuthContext } from '../../context/AuthContext'
import toast from 'react-hot-toast'

// Read receipt tick component
const MessageStatus = ({ status, isSender }) => {
    if (!isSender) return null;

    if (status === "read") {
        return (
            <span className="ml-1 inline-flex" title="Read">
                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 6 4 9 10 3" />
                    <polyline points="7 6 10 9 16 3" />
                </svg>
            </span>
        );
    }

    if (status === "delivered") {
        return (
            <span className="ml-1 inline-flex" title="Delivered">
                <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 6 4 9 10 3" />
                    <polyline points="7 6 10 9 16 3" />
                </svg>
            </span>
        );
    }

    // "sent" — single tick
    return (
        <span className="ml-1 inline-flex" title="Sent">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 6 6 10 14 2" />
            </svg>
        </span>
    );
};

const ChatContainer = () => {

    const { messages, selectedUser, setSelectedUser, sendMessage, 
        getMessages, deleteMessage} = useContext(ChatContext)

    const { authUser, onlineUsers } = useContext(AuthContext)

    const scrollEnd = useRef()

    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [contextMenu, setContextMenu] = useState(null); // { messageId, x, y }

    // Handle sending a message
    const handleSendMessage = async (e)=>{
        e.preventDefault();
        if(input.trim() === "") return null;
        await sendMessage({text: input.trim()});
        setInput("")
    }

    // Handle sending an image
    const handleSendImage = async (e) =>{
        const file = e.target.files[0];
        if(!file || !file.type.startsWith("image/")){
            toast.error("select an image file")
            return;
        }
        const reader = new FileReader();

        reader.onloadend = async ()=>{
            await sendMessage({image: reader.result})
            e.target.value = ""
        }
        reader.readAsDataURL(file)
    }

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
                // Automatically send a message in chat to notify the other user
                await sendMessage({text: `📄 Shared a document: ${file.name}`});
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
    }

    // Handle right-click context menu for delete
    const handleContextMenu = (e, msg) => {
        // Only show delete option for sender's own messages that aren't already deleted, or AI messages triggered by this user
        const isMine = msg.senderId?.toString() === authUser._id?.toString();
        const canDelete = isMine || msg.triggeredBy?.toString() === authUser._id?.toString();

        if (canDelete && !msg.deletedForEveryone) {
            e.preventDefault();
            setContextMenu({ messageId: msg._id, x: e.clientX, y: e.clientY });
        }
    }

    // Handle delete for everyone
    const handleDeleteForEveryone = async (e) => {
        e.stopPropagation();
        if (contextMenu) {
            await deleteMessage(contextMenu.messageId);
            setContextMenu(null);
        }
    }

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []);

    useEffect(()=>{
        if(selectedUser){
            getMessages(selectedUser._id)
        }
    },[selectedUser])

    useEffect(()=>{
        if(scrollEnd.current && messages){
            scrollEnd.current.scrollIntoView({ behavior: "smooth"})
        }
    },[messages])

  return selectedUser ? (
    <div className='h-full overflow-scroll relative backdrop-blur-lg'>
      {/* ------- header ------- */}
      <div className='flex items-center gap-3 py-3 mx-4 border-b border-stone-500'>
        <img src={selectedUser.profilePic || assets.avatar_icon} alt="" className="w-8 rounded-full"/>
        <p className='flex-1 text-lg text-white flex items-center gap-2'>
            {selectedUser.fullName}
            {onlineUsers.includes(selectedUser._id) && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
        </p>
        <img onClick={()=> setSelectedUser(null)} src={assets.arrow_icon} alt="" className='md:hidden max-w-7'/>
        <img src={assets.help_icon} alt="" className='max-md:hidden max-w-5'/>
      </div>
      {/* ------- chat area ------- */}
      <div className='flex flex-col h-[calc(100%-120px)] overflow-y-scroll p-3 pb-6'>
        {messages.map((msg, index)=> {
            const isAI = msg.text?.startsWith('[🤖 AI Co-Pilot]');
            const isMine = msg.senderId?.toString() === authUser._id?.toString() && !isAI;

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
                    <img src={msg.image} alt="" className='max-w-[230px] border border-gray-700 rounded-lg overflow-hidden mb-8'/>
                ):(
                    <div className={`p-3 max-w-[75%] md:text-sm font-light mb-8 break-words leading-relaxed shadow-lg ${isAI ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border border-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.3)] text-white' : 'bg-violet-500/80 backdrop-blur-md text-white'} ${isMine ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'}`}>
                        {msg.text?.startsWith('[🤖 AI Co-Pilot]') ? (
                            <div className="flex flex-col gap-1">
                                <span className="font-bold text-xs text-purple-200 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                    AI Co-Pilot
                                </span>
                                <span className="whitespace-pre-wrap">{msg.text.replace('[🤖 AI Co-Pilot]: ', '')}</span>
                            </div>
                        ) : (
                            <span className="whitespace-pre-wrap">{msg.text}</span>
                        )}
                    </div>
                )}
                <div className="text-center text-xs">
                    <img src={isMine ? authUser?.profilePic || assets.avatar_icon : (isAI ? assets.logo_icon : selectedUser?.profilePic || assets.avatar_icon)} alt="" className='w-7 rounded-full' />
                    <p className='text-gray-500 flex items-center gap-0.5'>
                        {formatMessageTime(msg.createdAt)}
                        <MessageStatus status={msg.status} isSender={isMine} />
                    </p>
                </div>
            </div>
        )})}
        <div ref={scrollEnd}></div>
      </div>

    {/* ------- context menu (delete for everyone) ------- */}
    {contextMenu && createPortal(
        <div 
            className="fixed z-[9999] bg-gray-900 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
        >
            <button 
                onClick={handleDeleteForEveryone}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"
            >
                🗑️ Delete for Everyone
            </button>
        </div>,
        document.body
    )}

{/* ------- bottom area ------- */}
    <div className='absolute bottom-0 left-0 right-0 flex items-center gap-3 p-3'>
        <div className='flex-1 flex items-center bg-gray-800/60 border border-gray-600/50 backdrop-blur-md px-4 rounded-full shadow-inner transition-all focus-within:border-purple-500/50 focus-within:bg-gray-800/80'>
            <input onChange={(e)=> setInput(e.target.value)} value={input} onKeyDown={(e)=> e.key === "Enter" ? handleSendMessage(e) : null} type="text" placeholder="Type a message or @AI..." 
            className='flex-1 text-sm py-3 px-2 border-none bg-transparent outline-none text-white placeholder-gray-400'/>
            
            {/* Image Upload */}
            <input onChange={handleSendImage} type="file" id='image' accept='image/png, image/jpeg' hidden disabled={isUploading}/>
            <label htmlFor="image" className="hover:scale-110 transition-transform p-1">
                <img src={assets.gallery_icon} alt="Upload Image" className="w-5 mr-1 cursor-pointer opacity-70 hover:opacity-100"/>
            </label>
            
            {/* PDF Upload */}
            <input onChange={handleSendPdf} type="file" id='pdf' accept='application/pdf' hidden disabled={isUploading}/>
            <label htmlFor="pdf" className="hover:scale-110 transition-transform p-1">
                <svg className="w-5 h-5 mr-1 cursor-pointer text-gray-400 opacity-70 hover:opacity-100 hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
            </label>
        </div>
        <img onClick={handleSendMessage} src={assets.send_button} alt="" className="w-7 cursor-pointer" />
    </div>


    </div>
  ) : (
    <div className='flex flex-col items-center justify-center gap-4 text-gray-400 bg-gray-900/40 backdrop-blur-sm max-md:hidden h-full'>
        <div className="relative">
            <div className="absolute inset-0 bg-purple-500 blur-[40px] opacity-20 rounded-full"></div>
            <img src={assets.logo_icon} className='max-w-24 relative z-10 drop-shadow-2xl hover:scale-105 transition-transform duration-500' alt="" />
        </div>
        <div className="text-center">
            <h2 className='text-2xl font-bold text-white mb-2 tracking-tight'>NexusChat AI</h2>
            <p className='text-sm font-medium text-gray-400 max-w-xs mx-auto'>Select a conversation or upload a document to get started.</p>
        </div>
    </div>
  )
}

export default ChatContainer
