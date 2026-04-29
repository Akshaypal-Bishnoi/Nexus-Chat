import os
import asyncio
from typing import Annotated, TypedDict
from dotenv import load_dotenv

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition

from mcp_manager import MCPManager

load_dotenv()

# Define the state of our agent
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

# Global manager to hold our MCP connections
mcp_manager = MCPManager()

async def init_mcp():
    """Initializes MCP connections and returns the bound LLM."""
    print("Connecting to MCP Servers...")
    await mcp_manager.connect_all()
    mcp_tools = await mcp_manager.load_tools()
    
    # Add our new CRAG search tool to the list of tools available to the agent!
    from crag_tool import search_knowledge
    mcp_tools.append(search_knowledge)
    
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    
    if mcp_tools:
        print(f"Binding {len(mcp_tools)} tools to the agent.")
        llm = llm.bind_tools(mcp_tools)
        
    return llm, mcp_tools

from langchain_core.runnables import RunnableConfig

# We use a placeholder for the LLM initially, it will be injected
# at runtime or passed via graph configuration.
def create_agent_graph(llm, tools):
    workflow = StateGraph(AgentState)

    async def call_model(state: AgentState, config: RunnableConfig):
        messages = state['messages']
        role = config.get("configurable", {}).get("role", "copilot")
        
        # Add a system prompt if not present
        if not any(isinstance(m, SystemMessage) for m in messages):
            if role == "assistant":
                prompt = (
                    "You are Nexus AI Assistant, a direct 1-on-1 AI assistant chatting with the user. "
                    "You are their personal AI companion. You have access to tools via MCP and a Vector Database.\n"
                    "CRITICAL INSTRUCTION: If the user asks about facts, past conversations, or shared documents, "
                    "you MUST ALWAYS use the `search_knowledge` tool first to find it. Do NOT attempt to use local filesystem tools to find uploaded files."
                )
            else:
                prompt = (
                    "You are NexusChat's AI Co-Pilot. You are assisting users inside a multi-person chat room. "
                    "You have access to tools via MCP and a Vector Database.\n"
                    "CRITICAL INSTRUCTION: If the user asks about facts, past conversations, or shared documents, "
                    "you MUST ALWAYS use the `search_knowledge` tool first to find it. Do NOT attempt to use local filesystem tools to find uploaded files."
                )
                
            sys_msg = SystemMessage(content=prompt)
            messages = [sys_msg] + messages
            
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    # Define Nodes
    workflow.add_node("agent", call_model)
    
    if tools:
        tool_node = ToolNode(tools)
        workflow.add_node("tools", tool_node)
        # Conditional edge: if the LLM decides to use a tool, go to "tools" node
        workflow.add_conditional_edges("agent", tools_condition)
        workflow.add_edge("tools", "agent")
    
    # Set entry point
    workflow.add_edge(START, "agent")
    
    return workflow

async def run_chat():
    llm, tools = await init_mcp()
    graph = create_agent_graph(llm, tools)
    
    # We will eventually add the Postgres Checkpointer here
    app = graph.compile()
    
    print("\n--- Agent Ready! (Type 'quit' to exit) ---")
    while True:
        user_input = input("You: ")
        if user_input.lower() in ['quit', 'exit']:
            break
            
        async for event in app.astream({"messages": [HumanMessage(content=user_input)]}):
            for node, values in event.items():
                if node == "agent":
                    print(f"AI: {values['messages'][-1].content}")

    # Cleanup MCP connections when done
    await mcp_manager.cleanup()

if __name__ == "__main__":
    asyncio.run(run_chat())
