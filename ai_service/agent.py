import os
from typing import Annotated, TypedDict
from dotenv import load_dotenv

from langchain_core.messages import BaseMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.runnables import RunnableConfig

from mcp_manager import MCPManager

load_dotenv()

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

mcp_manager = MCPManager()


async def init_mcp():
    """Initializes MCP connections and returns the LLM bound with tools."""
    print("Connecting to MCP Servers...")
    await mcp_manager.connect_all()
    mcp_tools = await mcp_manager.load_tools()

    # Add CRAG search tool
    from crag_tool import search_knowledge
    mcp_tools.append(search_knowledge)

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    if mcp_tools:
        print(f"Binding {len(mcp_tools)} tools to the agent.")
        llm = llm.bind_tools(mcp_tools)

    return llm, mcp_tools


def create_agent_graph(llm, tools):
    workflow = StateGraph(AgentState)

    async def call_model(state: AgentState, config: RunnableConfig):
        messages = state['messages']
        role = config.get("configurable", {}).get("role", "copilot")

        if not any(isinstance(m, SystemMessage) for m in messages):
            if role == "assistant":
                prompt = (
                    "You are Nexus AI Assistant, a direct 1-on-1 AI assistant chatting with the user. "
                    "You are their personal AI companion. You have access to tools via MCP and a Vector Database.\n"
                    "CRITICAL INSTRUCTION: If the user asks about facts, past conversations, or shared documents, "
                    "you MUST ALWAYS use the `search_knowledge` tool first to find it. "
                    "Do NOT attempt to use local filesystem tools to find uploaded files."
                )
            else:
                prompt = (
                    "You are NexusChat's AI Co-Pilot. You are assisting users inside a multi-person chat room. "
                    "You have access to tools via MCP and a Vector Database.\n"
                    "CRITICAL INSTRUCTION: If the user asks about facts, past conversations, or shared documents, "
                    "you MUST ALWAYS use the `search_knowledge` tool first to find it. "
                    "Do NOT attempt to use local filesystem tools to find uploaded files."
                )

            messages = [SystemMessage(content=prompt)] + messages

        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    workflow.add_node("agent", call_model)

    if tools:
        workflow.add_node("tools", ToolNode(tools))
        workflow.add_conditional_edges("agent", tools_condition)
        workflow.add_edge("tools", "agent")

    workflow.add_edge(START, "agent")

    return workflow
