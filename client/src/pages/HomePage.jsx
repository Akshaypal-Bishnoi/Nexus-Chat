import React from 'react'
import Sidebar from '../components/Sidebar'
import ChatContainer from '../components/ChatContainer'
import GroupChatContainer from '../components/GroupChatContainer'
import RightSidebar from '../components/RightSidebar'
import { useContext } from 'react'
import { ChatContext } from '../../context/ChatContext'
import { GroupContext } from '../../context/GroupContext'

const HomePage = () => {

    const {selectedUser} = useContext(ChatContext)
    const {selectedGroup} = useContext(GroupContext)

    // Determine which chat container to show
    const showDM = !!selectedUser;
    const showGroup = !!selectedGroup;

  return (
    <div className='w-full h-screen sm:px-[2.5%] sm:py-[2.5%]'>
      <div className={`backdrop-blur-xl border border-gray-600 rounded-2xl overflow-hidden h-[100%] grid grid-cols-1 relative ${
        showDM 
          ? 'md:grid-cols-[1fr_1.5fr_1fr] xl:grid-cols-[1fr_2.5fr_1fr]' 
          : showGroup 
            ? 'md:grid-cols-[1fr_2.5fr] xl:grid-cols-[1fr_3.5fr]'
            : 'md:grid-cols-[1fr_2fr]'
      }`}>
        <Sidebar />
        {selectedGroup ? <GroupChatContainer /> : <ChatContainer />}
        {selectedUser && <RightSidebar/>}
      </div>
    </div>
  )
}

export default HomePage
