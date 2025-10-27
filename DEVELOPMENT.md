# Orka VS - Development Guide

## Project Overview

**Orka VS** is a native VS Code extension that implements master/slave AI orchestration using Terminal Shell Integration API.

### Stats
- **7 TypeScript files**
- **~1,463 lines of code**
- **18 total files** (including config)

### Architecture

```
┌─────────────────────────────────────────┐
│      VS Code Extension (Native)         │
│  ┌───────────────────────────────────┐  │
│  │  Chat Participant (@orka)         │  │
│  │  Master CLI (Claude Code)         │  │
│  │  Slave Executors (Codex, Gemini)  │  │
│  │  Tool Handler                     │  │
│  │  Telegram Bridge (Optional)       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↕️ Terminal Shell Integration
┌─────────────────────────────────────────┐
│         CLI Agents (Local)              │
│  • claude (master)                      │
│  • codex (slave)                        │
│  • gemini (slave)                       │
└─────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- VS Code >= 1.93.0 (for Terminal Shell Integration API)
- Node.js >= 20.x
- Claude Code CLI (authenticated)
- Codex CLI (authenticated) - optional
- Gemini CLI (authenticated) - optional

### Installation

```bash
# Clone the repo
git clone https://github.com/BTankut/orka-vs.git
cd orka-vs

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run in development
# Press F5 in VS Code to launch Extension Development Host
```

### Development Workflow

1. **Make changes** to TypeScript files in `src/`
2. **Compile**: `npm run compile` or use watch mode: `npm run watch`
3. **Test**: Press F5 to launch Extension Development Host
4. **Debug**: Use VS Code debugger with breakpoints

### Project Structure

```
orka-vs/
├── src/
│   ├── extension.ts              # Entry point, activation
│   ├── types.ts                  # TypeScript type definitions
│   ├── cli/
│   │   └── master-cli.ts         # Master CLI executor
│   ├── orchestration/
│   │   ├── slave-executor.ts     # Slave agent manager
│   │   └── tool-handler.ts       # Tool call routing
│   ├── chat/
│   │   └── master-participant.ts # Chat participant
│   └── telegram/
│       └── bridge.ts             # Telegram WebSocket server
├── dist/                         # Compiled JavaScript
├── resources/                    # Icons and assets
├── .vscode/
│   ├── launch.json              # Debug configuration
│   └── tasks.json               # Build tasks
├── package.json                 # Extension manifest
└── tsconfig.json               # TypeScript config
```

## Key Components

### 1. Master CLI (`src/cli/master-cli.ts`)

**Purpose**: Execute master planning CLI using Terminal Shell Integration

**Key Methods**:
- `execute()`: Run master CLI command with streaming output
- `waitForShellIntegration()`: Ensure terminal shell integration is ready
- `handleToolUse()`: Process tool calls from master
- `sendToolResult()`: Send results back to master

**Terminal Shell Integration Usage**:
```typescript
const execution = await terminal.shellIntegration!.executeCommand(commandLine);
const stream = execution.read();
for await (const data of stream) {
  // Process streaming output
}
```

### 2. Slave Executor (`src/orchestration/slave-executor.ts`)

**Purpose**: Manage execution of slave CLI agents

**Supported Agents**:
- Codex: `codex exec --json`
- Gemini: `gemini chat --stream`
- Claude: `claude code --stream-json`

**Key Features**:
- Task tracking with unique IDs
- Terminal reuse per agent
- Exit code monitoring
- Execution time tracking

### 3. Chat Participant (`src/chat/master-participant.ts`)

**Purpose**: Native VS Code chat interface

**Features**:
- `@orka` mention support
- Slash commands (`/status`, `/abort`)
- Session ID extraction from history
- Real-time progress streaming

**Usage**:
```
@orka Implement user authentication system
```

### 4. Tool Handler (`src/orchestration/tool-handler.ts`)

**Purpose**: Route tool calls from master to slave agents

**Available Tools**:
- `execute_slave_codex`: Run Codex for implementation
- `execute_slave_gemini`: Run Gemini for alternative approach
- `get_slave_status`: Check task status

### 5. Telegram Bridge (`src/telegram/bridge.ts`)

**Purpose**: WebSocket server for Telegram bot integration

**Features**:
- WebSocket server on configurable port
- Message routing to master CLI
- Streaming responses back to Telegram
- Progress notifications

## Configuration

### VS Code Settings

```json
{
  "orka.master.cli": "claude",
  "orka.slaves.available": ["codex", "gemini"],
  "orka.telegram.enabled": false,
  "orka.telegram.port": 3001,
  "orka.terminal.visible": true
}
```

### Extension Commands

- `orka.openMasterTerminal`: Show master terminal
- `orka.showSlaveStatus`: Show slave task status
- `orka.abortExecution`: Abort current execution
- `orka.toggleTelegram`: Enable/disable Telegram bridge

## Testing

### Manual Testing

1. Launch Extension Development Host (F5)
2. Open a workspace folder
3. Open VS Code Chat (`Cmd+Shift+I` or `Ctrl+Shift+I`)
4. Type: `@orka Hello, can you help me?`
5. Verify master CLI executes and responds

### Testing Slave Delegation

```
@orka Implement a function to calculate factorial

Master will plan and delegate to Codex:
- Master: "I'll delegate implementation to Codex"
- Tool: execute_slave_codex
- Codex: Executes and returns code
- Master: Reviews and presents to user
```

### Testing Telegram Integration

1. Enable Telegram: `"orka.telegram.enabled": true`
2. Start Telegram bot (separate project)
3. Send message from Telegram
4. Verify WebSocket connection and response

## Debugging

### Enable Verbose Logging

```typescript
// In extension.ts
console.log('Orka VS: <your debug message>');
```

View logs in:
- **Output Panel**: View → Output → Orka VS
- **Debug Console**: When debugging (F5)

### Common Issues

**Shell Integration Not Available**:
- Ensure VS Code >= 1.93.0
- Use supported shell (bash, zsh, pwsh)
- Check terminal settings

**CLI Not Found**:
- Verify CLI is in PATH
- Test in terminal: `claude --version`
- Ensure CLI is authenticated

**TypeScript Errors**:
```bash
npm run compile 2>&1 | less
```

## Building for Production

### Create VSIX Package

```bash
# Install vsce
npm install -g @vscode/vsce

# Package extension
vsce package

# Result: orka-vs-0.1.0.vsix
```

### Install Locally

```bash
code --install-extension orka-vs-0.1.0.vsix
```

## Contributing

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Commit with conventional commits
5. Submit pull request

## Roadmap

- [ ] Session persistence across VS Code restarts
- [ ] Task queue visualization panel
- [ ] Custom agent configuration UI
- [ ] Performance metrics and analytics
- [ ] Multi-project support
- [ ] Workspace-specific master/slave config
- [ ] Retry logic for failed slave executions
- [ ] Parallel slave execution

## License

GPL-3.0 - See LICENSE file

## Support

- **GitHub Issues**: https://github.com/BTankut/orka-vs/issues
- **Documentation**: README.md
- **Changelog**: CHANGELOG.md
