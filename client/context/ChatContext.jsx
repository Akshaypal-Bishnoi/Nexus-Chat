import { createContext, useContext, useEffect, useState } from "react";
import { AuthContext } from "./AuthContext";
import toast from "react-hot-toast";


export const ChatContext = createContext();

export const ChatProvider = ({ children })=>{

    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null)
    const [unseenMessages, setUnseenMessages] = useState({})

    const {socket, axios, authUser} = useContext(AuthContext);

    // function to get all users for sidebar
    const getUsers = async () =>{
        try {
            const { data } = await axios.get("/api/messages/users");
            if (data.success) {
                setUsers(data.users)
                setUnseenMessages(data.unseenMessages)
            }
        } catch (error) {
            toast.error(error.message)
        }
    }

    // function to get messages for selected user
    const getMessages = async (userId)=>{
        try {
            const { data } = await axios.get(`/api/messages/${userId}`);
            if (data.success){
                setMessages(data.messages)
            }
        } catch (error) {
            toast.error(error.message)
        }
    }

    // function to send message to selected user
    const sendMessage = async (messageData)=>{
        try {
            const {data} = await axios.post(`/api/messages/send/${selectedUser._id}`, messageData);
            if(data.success){
                setMessages((prevMessages)=>[...prevMessages, data.newMessage])
            }else{
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
    }

    // function to delete a message for everyone
    const deleteMessage = async (messageId) => {
        try {
            const { data } = await axios.delete(`/api/messages/delete/${messageId}`);
            if (data.success) {
                setMessages((prevMessages) =>
                    prevMessages.map((msg) =>
                        msg._id === messageId
                            ? { ...msg, text: null, image: null, deletedForEveryone: true }
                            : msg
                    )
                );
                toast.success("Message deleted for everyone");
            } else {
                toast.error(data.message);
            }
        } catch (error) {
            toast.error(error.message);
        }
    }

    // function to subscribe to messages for selected user
    const subscribeToMessages = async () =>{
        if(!socket) return;

        socket.on("newMessage", (newMessage)=>{
            // If the message is part of the currently active 1-on-1 chat
            if(selectedUser && (newMessage.senderId === selectedUser._id || newMessage.receiverId === selectedUser._id)){
                newMessage.status = "read";
                setMessages((prevMessages)=> {
                    // Prevent duplicates
                    if (prevMessages.some(m => m._id === newMessage._id)) return prevMessages;
                    return [...prevMessages, newMessage];
                });
                axios.put(`/api/messages/mark/${newMessage._id}`).catch(e => console.log(e));
            }else if (authUser && newMessage.senderId !== authUser._id) {
                // If it's from someone else and not our active chat, increment unseen count
                setUnseenMessages((prevUnseenMessages)=>({
                    ...prevUnseenMessages, [newMessage.senderId] : prevUnseenMessages[newMessage.senderId] ? prevUnseenMessages[newMessage.senderId] + 1 : 1
                }))
            }
        })

        // Listen for streaming updates for the AI
        socket.on("updateMessage", (updatedData) => {
            setMessages((prevMessages) => 
                prevMessages.map((msg) => 
                    msg._id === updatedData.messageId ? { ...msg, text: updatedData.text } : msg
                )
            );
        });

        // Listen for delivery receipts (✓✓ grey)
        socket.on("messageDelivered", ({ messageId, messageIds }) => {
            setMessages((prevMessages) =>
                prevMessages.map((msg) => {
                    // Handle single messageId (from sendMessage)
                    if (messageId && msg._id === messageId) {
                        return { ...msg, status: "delivered" };
                    }
                    // Handle batch messageIds (from user coming online)
                    if (messageIds && messageIds.includes(msg._id)) {
                        return { ...msg, status: "delivered" };
                    }
                    return msg;
                })
            );
        });

        // Listen for read receipts (✓✓ blue)
        socket.on("messageRead", ({ messageIds }) => {
            setMessages((prevMessages) =>
                prevMessages.map((msg) =>
                    messageIds && messageIds.includes(msg._id)
                        ? { ...msg, status: "read" }
                        : msg
                )
            );
        });

        // Listen for delete for everyone
        socket.on("messageDeleted", ({ messageId }) => {
            setMessages((prevMessages) =>
                prevMessages.map((msg) =>
                    msg._id === messageId
                        ? { ...msg, text: null, image: null, deletedForEveryone: true }
                        : msg
                )
            );
        });
    }

    // function to unsubscribe from messages
    const unsubscribeFromMessages = ()=>{
        if(socket) {
            socket.off("newMessage");
            socket.off("updateMessage");
            socket.off("messageDelivered");
            socket.off("messageRead");
            socket.off("messageDeleted");
        }
    }

    useEffect(()=>{
        subscribeToMessages();
        return ()=> unsubscribeFromMessages();
    },[socket, selectedUser])

    const value = {
        messages, users, selectedUser, getUsers, getMessages, sendMessage,
        setSelectedUser, unseenMessages, setUnseenMessages, deleteMessage
    }

    return (
    <ChatContext.Provider value={value}>
            { children }
    </ChatContext.Provider>
    )
}