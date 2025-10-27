# Orka VS - Master/Slave AI Orchestration for VS Code

Native VS Code extension for orchestrating multiple AI CLI agents with master/slave architecture.

## Architecture

```
Master CLI (Claude) - Planning & Orchestration
    ↓ Native VS Code Tools
    ├─ Slave: Codex (Code execution)
    └─ Slave: Gemini (Alternative execution)
```

## Features

- **Master/Slave Orchestration**: Master CLI plans and delegates to slave agents
- **Terminal Shell Integration**: Native VS Code terminal execution
- **Chat Participant**: Native VS Code chat interface
- **Telegram Integration**: Remote access via Telegram bot
- **Context Preservation**: Long-running sessions with full project context

## Requirements

- VS Code >= 1.93.0
- Claude Code CLI (authenticated)
- Codex CLI (authenticated) - optional
- Gemini CLI (authenticated) - optional

## Installation

1. Install from VS Code Marketplace (coming soon)
2. Or build from source:
   ```bash
   npm install
   npm run compile
   code --install-extension orka-vs-0.1.0.vsix
   ```

## Usage

### In VS Code Chat

```
@orka Implement user authentication system
```

The master will plan the task and orchestrate slave agents to execute.

### With Telegram

1. Enable Telegram in settings
2. Configure Telegram bot to connect to `ws://localhost:3001`
3. Send messages from Telegram, responses stream back

## Configuration

- `orka.master.cli`: Master CLI to use (default: claude)
- `orka.slaves.available`: Available slave agents (default: [codex, gemini])
- `orka.telegram.enabled`: Enable Telegram bridge (default: false)
- `orka.telegram.port`: WebSocket port (default: 3001)

## License

GPL-3.0
