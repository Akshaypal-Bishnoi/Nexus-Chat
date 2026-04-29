import json
import os
from typing import Dict, List, Any
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_mcp_adapters.tools import load_mcp_tools

class MCPManager:
    def __init__(self, config_path: str = "mcp_config.json"):
        self.config_path = config_path
        self.sessions: Dict[str, ClientSession] = {}
        self.exit_stack = AsyncExitStack()
        self.tools: List[Any] = []

    async def connect_all(self):
        """Connects to all MCP servers defined in the config file."""
        if not os.path.exists(self.config_path):
            print(f"Warning: {self.config_path} not found. No MCP servers connected.")
            return

        with open(self.config_path, "r") as f:
            config = json.load(f)

        for server_name, server_details in config.get("mcpServers", {}).items():
            try:
                command = server_details.get("command")
                args = server_details.get("args", [])
                env = server_details.get("env", None)
                
                # Setup Stdio params
                server_params = StdioServerParameters(
                    command=command,
                    args=args,
                    env=env
                )
                
                # Correctly handle the async context managers using AsyncExitStack
                stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
                read, write = stdio_transport
                
                session = await self.exit_stack.enter_async_context(ClientSession(read, write))
                
                await session.initialize()
                self.sessions[server_name] = session
                print(f"✅ Successfully connected to MCP Server: {server_name}")
                
            except Exception as e:
                print(f"❌ Failed to connect to MCP Server {server_name}: {e}")

    async def load_tools(self):
        """Fetches tools using the official LangChain MCP adapter."""
        for server_name, session in self.sessions.items():
            
            # Let LangChain handle the complex conversion!
            mcp_tools = await load_mcp_tools(session)
            
            for tool in mcp_tools:
                # We rename them slightly just to prevent collisions if two 
                # different servers have a tool with the exact same name
                tool.name = f"{server_name}_{tool.name}".replace("-", "_")
                self.tools.append(tool)
                print(f"🔧 Loaded tool via adapter: {tool.name}")
        
        return self.tools

    async def cleanup(self):
        """Close all connections."""
        await self.exit_stack.aclose()
