import React, { useState } from 'react'
import Sidebar from '../components/Sidebar'
import ChatContainer from '../components/ChatContainer'
import RightSidebar from '../components/RightSidebar'
import { useContext } from 'react'
import { ChatContext } from '../../context/ChatContext'

const HomePage = () => {

    const {selectedUser} = useContext(ChatContext)

  return (
    <div className='w-full h-screen sm:px-[2.5%] sm:py-[2.5%]'>
      <div className={`backdrop-blur-xl border border-gray-600 rounded-2xl overflow-hidden h-[100%] grid grid-cols-1 relative ${selectedUser ? 'md:grid-cols-[1fr_1.5fr_1fr] xl:grid-cols-[1fr_2.5fr_1fr]' : 'md:grid-cols-[1fr_2fr]'}`}>
        <Sidebar />
        <ChatContainer />
        <RightSidebar/>
      </div>
    </div>
  )
}

export default HomePage
