import os
from typing import List, Any

class MCPManager:
    """Manages MCP server connections. Only active in local development."""

    def __init__(self):
        self.tools: List[Any] = []

    async def connect_all(self):
        # MCP tools (filesystem, github) use npx and only work locally.
        # On Render, we skip them entirely — they consume too much memory
        # and reference local paths like c:/dev/NexusChat that don't exist.
        if os.environ.get("RENDER"):
            print("☁️ Render detected — skipping local MCP servers.")
            return

        # Only import heavy MCP dependencies when actually needed (local dev)
        try:
            import json
            from contextlib import AsyncExitStack
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client

            config_path = "mcp_config.json"
            if not os.path.exists(config_path):
                print(f"Warning: {config_path} not found.")
                return

            self._exit_stack = AsyncExitStack()

            with open(config_path, "r") as f:
                config = json.load(f)

            for name, details in config.get("mcpServers", {}).items():
                try:
                    import asyncio
                    params = StdioServerParameters(
                        command=details.get("command"),
                        args=details.get("args", []),
                        env=details.get("env", None),
                    )

                    async def _connect():
                        transport = await self._exit_stack.enter_async_context(stdio_client(params))
                        read, write = transport
                        session = await self._exit_stack.enter_async_context(ClientSession(read, write))
                        await session.initialize()
                        return session

                    session = await asyncio.wait_for(_connect(), timeout=15.0)
                    self._sessions[name] = session
                    print(f"✅ MCP Server connected: {name}")
                except Exception as e:
                    print(f"❌ MCP Server {name} failed: {e}")

        except ImportError as e:
            print(f"MCP dependencies not available: {e}")

    async def load_tools(self):
        if not hasattr(self, '_sessions'):
            return self.tools

        try:
            import asyncio
            from langchain_mcp_adapters.tools import load_mcp_tools

            for name, session in self._sessions.items():
                try:
                    mcp_tools = await asyncio.wait_for(load_mcp_tools(session), timeout=15.0)
                    for tool in mcp_tools:
                        tool.name = f"{name}_{tool.name}".replace("-", "_")
                        self.tools.append(tool)
                        print(f"🔧 Loaded: {tool.name}")
                except Exception as e:
                    print(f"❌ Failed to load tools from {name}: {e}")
        except ImportError:
            pass

        return self.tools

    async def cleanup(self):
        if hasattr(self, '_exit_stack'):
            await self._exit_stack.aclose()
