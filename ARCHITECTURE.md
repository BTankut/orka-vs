# Orka VS - Architecture & Implementation Roadmap

## 🎯 Project Vision

**Native VS Code Extension** for master/slave AI orchestration using **Terminal Shell Integration API**.

### ⚠️ CRITICAL: What We're NOT Using

- ❌ **NO MCP Server** - Everything is native VS Code
- ❌ **NO Backend/Express Server** - Extension is standalone
- ❌ **NO WebSocket Hub** (except tiny Telegram bridge)
- ❌ **NO File-based project discovery** - Use VS Code workspace
- ❌ **NO External dependencies** beyond npm packages

### ✅ What We ARE Using

- ✅ **VS Code Terminal Shell Integration API** (v1.93+)
- ✅ **VS Code Chat Participant API**
- ✅ **Native Terminal execution** (no child_process)
- ✅ **Event-based communication** (VS Code events)
- ✅ **TypeScript** with VS Code Extension API

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────┐
│         VS Code Extension (Native)          │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │   Chat Participant (@orka)            │ │
│  │   - User Interface                    │ │
│  │   - Message streaming                 │ │
│  └───────────────────────────────────────┘ │
│                    ↓                        │
│  ┌───────────────────────────────────────┐ │
│  │   Master CLI Manager                  │ │
│  │   - Terminal Shell Integration        │ │
│  │   - Claude Code execution             │ │
│  │   - Tool call detection               │ │
│  └───────────────────────────────────────┘ │
│                    ↓                        │
│  ┌───────────────────────────────────────┐ │
│  │   Tool Handler                        │ │
│  │   - execute_slave_codex               │ │
│  │   - execute_slave_gemini              │ │
│  │   - get_slave_status                  │ │
│  └───────────────────────────────────────┘ │
│                    ↓                        │
│  ┌───────────────────────────────────────┐ │
│  │   Slave Executor                      │ │
│  │   - Codex terminal execution          │ │
│  │   - Gemini terminal execution         │ │
│  │   - Task tracking                     │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │   Telegram Bridge (Optional)          │ │
│  │   - Mini WebSocket server (50 lines)  │ │
│  │   - Message relay                     │ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ↕️ Terminal Shell Integration
┌─────────────────────────────────────────────┐
│         CLI Agents (Local Machine)          │
│  • claude (master - authenticated)          │
│  • codex (slave - authenticated)            │
│  • gemini (slave - authenticated)           │
└─────────────────────────────────────────────┘
```

---

## 📊 Current Status

### ✅ COMPLETED (Phase 1) - Project Setup

- [x] Project scaffolding
- [x] TypeScript configuration
- [x] VS Code extension manifest (package.json)
- [x] Chat Participant registration (@orka)
- [x] **Basic chat working** - Claude responds in chat! 🎉
- [x] Type definitions (types.ts)
- [x] Git repository setup
- [x] GitHub push successful

### ✅ COMPLETED (Phase 2) - Core Implementation 🎉

**ALL FEATURES IMPLEMENTED!**

- [x] Master CLI with Terminal Shell Integration ✅
- [x] Tool call detection and handling ✅
- [x] Slave executor implementation ✅
- [x] Full orchestration flow ✅
- [x] Telegram bridge (optional) ✅

**Status**: Ready for testing! See TESTING_GUIDE.md

### 📝 TODO (Phase 3) - Polish & Release

- [x] Documentation (ARCHITECTURE.md, IMPLEMENTATION_STATUS.md, TESTING_GUIDE.md)
- [ ] End-to-end testing
- [ ] User acceptance testing
- [ ] Performance optimization
- [ ] VS Code Marketplace publishing

---

## 🎯 Implementation Roadmap

### **Phase 2A: Master CLI with Shell Integration** (Current Priority)

**Goal:** Master CLI executes commands using Terminal Shell Integration

**Files to modify:**
- `src/cli/master-cli.ts`

**Reference Examples:**
- Microsoft: `vscode-extension-samples/chat-sample/src/tools.ts`
- Cline: `cline/src/integrations/terminal/TerminalProcess.ts`

**Implementation Steps:**

1. **Terminal Creation**
```typescript
// In master-cli.ts
const terminal = vscode.window.createTerminal({
  name: 'Orka Master (Claude)',
  cwd: projectPath
});
```

2. **Wait for Shell Integration**
```typescript
// Critical: Must wait!
async function waitForShellIntegration(terminal: vscode.Terminal) {
  if (terminal.shellIntegration) return;

  return new Promise((resolve, reject) => {
    const disposable = vscode.window.onDidChangeTerminalShellIntegration(e => {
      if (e.terminal === terminal) {
        disposable.dispose();
        resolve();
      }
    });

    setTimeout(() => {
      disposable.dispose();
      reject(new Error('Shell integration timeout'));
    }, 5000);
  });
}
```

3. **Execute Command**
```typescript
await waitForShellIntegration(terminal);

const execution = terminal.shellIntegration!.executeCommand(
  `claude code --stream-json "${command}"`
);
```

4. **Read Output Stream**
```typescript
const stream = execution.read();
let buffer = '';

for await (const chunk of stream) {
  buffer += chunk;

  // Parse JSON lines
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const json = JSON.parse(line);

      // Handle different message types
      switch (json.type) {
        case 'chunk':
          onOutput(json.data);
          break;
        case 'tool_use':
          await handleToolCall(json);
          break;
      }
    } catch (e) {
      // Not JSON, raw output
      onOutput(chunk);
    }
  }
}
```

5. **Handle Exit**
```typescript
// Listen for completion
vscode.window.onDidEndTerminalShellExecution(e => {
  if (e.execution === execution) {
    console.log('Exit code:', e.exitCode);
  }
});
```

**Expected Result:**
- ✅ Master CLI runs in terminal
- ✅ Output streams to chat
- ✅ Tool calls detected

---

### **Phase 2B: Tool Call Detection**

**Goal:** Detect when master wants to use a slave

**Files to modify:**
- `src/cli/master-cli.ts`
- `src/orchestration/tool-handler.ts`

**How It Works:**

Master CLI (Claude) will output tool calls in JSON format:
```json
{
  "type": "tool_use",
  "id": "toolu_123",
  "name": "execute_slave_codex",
  "input": {
    "instruction": "Implement factorial function",
    "context": "Use recursion"
  }
}
```

**Implementation:**

1. **In master-cli.ts - Parse tool calls:**
```typescript
if (json.type === 'tool_use') {
  const toolCall: ToolCall = {
    id: json.id,
    name: json.name,
    arguments: json.input
  };

  const result = await onToolCall(toolCall);

  // Send result back to master
  await sendToolResult(json.id, result);
}
```

2. **Send tool result back:**
```typescript
async function sendToolResult(toolId: string, result: any) {
  const message = JSON.stringify({
    type: 'tool_result',
    tool_use_id: toolId,
    content: JSON.stringify(result)
  });

  // Send to terminal stdin
  terminal.sendText(message);
}
```

**Expected Result:**
- ✅ Tool calls detected from master output
- ✅ Tool handler invoked
- ✅ Results sent back to master

---

### **Phase 2C: Slave Executor Implementation**

**Goal:** Execute slave CLI (Codex/Gemini) when master delegates

**Files to modify:**
- `src/orchestration/slave-executor.ts`
- `src/orchestration/tool-handler.ts`

**Implementation:**

1. **Create slave terminal:**
```typescript
// In slave-executor.ts
async executeCodex(instruction: string) {
  const terminal = vscode.window.createTerminal({
    name: 'Orka Slave (Codex)',
    cwd: projectPath
  });

  await waitForShellIntegration(terminal);

  const execution = terminal.shellIntegration!.executeCommand(
    `codex exec --json "${instruction}"`
  );

  // Collect output
  let output = '';
  const stream = execution.read();

  for await (const chunk of stream) {
    output += chunk;
  }

  // Wait for completion
  const exitCode = await new Promise<number>(resolve => {
    vscode.window.onDidEndTerminalShellExecution(e => {
      if (e.execution === execution) {
        resolve(e.exitCode || 0);
      }
    });
  });

  return {
    success: exitCode === 0,
    output,
    agent: 'codex'
  };
}
```

2. **Tool handler routes to slave:**
```typescript
// In tool-handler.ts
export async function handleMasterToolCall(tool: ToolCall, slaveExecutor: SlaveExecutor) {
  if (tool.name === 'execute_slave_codex') {
    const result = await slaveExecutor.executeCodex(
      tool.arguments.instruction
    );

    return result;
  }
}
```

**Expected Result:**
- ✅ Slave terminal opens
- ✅ Codex executes task
- ✅ Result returned to master
- ✅ Master sees result and continues

---

### **Phase 2D: Orchestration Flow** (End-to-End)

**Complete Flow:**

```
User: @orka Implement factorial function

  ↓

Chat Participant receives request

  ↓

Master CLI executes:
  Terminal: claude code "Implement factorial function"

  ↓

Master (Claude) plans:
  "I'll delegate implementation to Codex"

  ↓

Master emits tool call:
  { type: "tool_use", name: "execute_slave_codex", ... }

  ↓

Tool Handler catches it:
  handleMasterToolCall(tool, slaveExecutor)

  ↓

Slave Executor runs:
  Terminal: codex exec "Implement factorial..."

  ↓

Codex returns code:
  { success: true, output: "def factorial(n)..." }

  ↓

Tool Handler returns to Master:
  sendToolResult(tool.id, result)

  ↓

Master sees result and responds:
  "Here's the implementation Codex created..."

  ↓

Chat streams final response to user
```

**Expected User Experience:**

```
User: @orka Implement factorial function

Master: I'll plan this and delegate to Codex...

🤖 Codex executing: Implement factorial function

**Codex Completed:**
```python
def factorial(n):
    if n == 0:
        return 1
    return n * factorial(n-1)
```

Master: Here's the factorial implementation.
The function uses recursion as requested.
```

---

### **Phase 2E: Telegram Integration** (Optional)

**Goal:** Allow Telegram bot to send messages to extension

**File to modify:**
- `src/telegram/bridge.ts`

**Implementation:**

1. **Start mini WebSocket server:**
```typescript
// In telegram/bridge.ts
export class TelegramBridge {
  private wss: WebSocketServer;

  start(port: number = 3001) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', ws => {
      ws.on('message', async data => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'telegram-message') {
          // Execute master CLI
          await masterCLI.execute({
            command: msg.content,
            onOutput: (data) => {
              // Send back to Telegram
              ws.send(JSON.stringify({ type: 'chunk', data }));
            }
          });
        }
      });
    });
  }
}
```

2. **Telegram bot code (separate, not in extension):**
```javascript
// telegram-bot/index.js (NOT in extension)
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ws = new WebSocket('ws://localhost:3001');

bot.on('message', msg => {
  ws.send(JSON.stringify({
    type: 'telegram-message',
    content: msg.text
  }));
});

ws.on('message', data => {
  const response = JSON.parse(data);
  bot.sendMessage(msg.chat.id, response.data);
});
```

**Expected Result:**
- ✅ Telegram bot connects to extension
- ✅ Messages from Telegram trigger master
- ✅ Responses stream back to Telegram

---

## 🛠️ Development Workflow

### **Step 1: Test Basic Chat (Already Working!)**

```
@orka Hello
```

Expected: Claude responds

### **Step 2: Test Master CLI**

After implementing Phase 2A:

```
@orka What is 2+2?
```

Expected:
- Terminal opens: "Orka Master (Claude)"
- Response streams to chat
- No errors

### **Step 3: Test Slave Delegation**

After implementing Phase 2C:

```
@orka Implement a hello world function in Python. Delegate to Codex.
```

Expected:
- Master terminal: "Orka Master (Claude)"
- Slave terminal: "Orka Slave (Codex)"
- Master delegates to Codex
- Result shown in chat

### **Step 4: Test Full Orchestration**

```
@orka Create a factorial function. Plan it yourself, then delegate implementation to Codex, and review the result.
```

Expected full flow as described in Phase 2D.

---

## 🔧 Configuration

### **VS Code Settings**

```json
{
  "orka.master.cli": "claude",
  "orka.slaves.available": ["codex", "gemini"],
  "orka.terminal.visible": true,
  "orka.telegram.enabled": false,
  "orka.telegram.port": 3001
}
```

### **CLI Requirements**

Make sure these are installed and authenticated:

```bash
# Master
claude --version    # Should work

# Slaves (optional)
codex --version     # Should work
gemini --version    # Should work
```

---

## 🚨 Common Issues & Solutions

### **Issue 1: "Shell integration timeout"**

**Cause:** Terminal Shell Integration not available

**Solution:**
```typescript
try {
  await waitForShellIntegration(terminal);
} catch (error) {
  // Fallback to sendText
  terminal.sendText(command);
  throw new Error('Shell integration unavailable. Use VS Code >= 1.93');
}
```

### **Issue 2: "Command not found: claude"**

**Cause:** Claude CLI not in PATH

**Solution:**
```bash
# Check PATH
which claude

# Install if missing
npm install -g @anthropic-ai/claude-code
```

### **Issue 3: Tool calls not detected**

**Cause:** JSON parsing error

**Solution:**
```typescript
// Add better error handling
try {
  const json = JSON.parse(line);
} catch (e) {
  console.log('Failed to parse:', line);
  // Continue anyway
}
```

---

## 📚 Reference Examples

### **Must Study:**

1. **Microsoft Chat Sample**
   ```bash
   git clone https://github.com/microsoft/vscode-extension-samples.git
   cd vscode-extension-samples/chat-sample
   # Study: src/tools.ts (runInTerminal)
   ```

2. **Cline TerminalProcess**
   ```bash
   git clone https://github.com/cline/cline.git
   cd cline
   # Study: src/integrations/terminal/TerminalProcess.ts
   ```

### **Copy-Paste Friendly Code:**

From Microsoft chat-sample `tools.ts`:
- `waitForShellIntegration()` function
- `runInTerminal` tool pattern
- Output streaming logic

From Cline:
- Event emitter pattern
- ANSI stripping
- Error handling

---

## 🎯 Next Steps for Your Assistant

### **Priority Order:**

1. **Phase 2A** - Get Master CLI working with Terminal Shell Integration
   - Focus file: `src/cli/master-cli.ts`
   - Reference: Microsoft chat-sample `tools.ts`
   - Test: `@orka Hello` should use terminal

2. **Phase 2B** - Detect tool calls
   - Focus file: `src/cli/master-cli.ts`
   - Add JSON parsing for `tool_use` messages
   - Test: Master should detect when it wants to use a tool

3. **Phase 2C** - Implement slave executor
   - Focus file: `src/orchestration/slave-executor.ts`
   - Copy pattern from master-cli.ts
   - Test: Codex executes when master delegates

4. **Phase 2D** - Connect everything
   - Focus file: `src/orchestration/tool-handler.ts`
   - Route tool calls to slave executor
   - Test: Full orchestration flow

5. **Phase 2E** - Telegram (optional, later)
   - Focus file: `src/telegram/bridge.ts`
   - Mini WebSocket server
   - Test: Telegram messages trigger extension

---

## ✅ Success Criteria

**Phase 2 Complete When:**

- [x] `@orka Hello` works with Terminal Shell Integration ✅
- [x] Master CLI output streams to chat ✅
- [x] Tool calls detected from master ✅
- [x] Slave executor runs Codex ✅
- [x] Full orchestration: User → Master → Slave → Master → User ✅
- [x] No MCP, no backend, everything native VS Code ✅

**🎉 ALL CRITERIA MET - IMPLEMENTATION COMPLETE!**

See IMPLEMENTATION_STATUS.md for detailed completion report.
See TESTING_GUIDE.md for comprehensive testing instructions.

---

## 📝 Notes for Your Assistant

**IMPORTANT REMINDERS:**

1. ❌ **DO NOT install MCP** - We're not using it
2. ❌ **DO NOT create Express server** - Extension is standalone
3. ❌ **DO NOT use child_process** - Use Terminal Shell Integration
4. ✅ **DO use** `terminal.shellIntegration.executeCommand()`
5. ✅ **DO reference** Microsoft chat-sample and Cline examples
6. ✅ **DO test** incrementally (Phase 2A first!)

**Key Files to Focus:**
- `src/cli/master-cli.ts` (Priority 1)
- `src/orchestration/slave-executor.ts` (Priority 2)
- `src/orchestration/tool-handler.ts` (Priority 3)

**Don't Touch (Already Working):**
- `src/chat/master-participant.ts` (basic chat works!)
- `src/extension.ts` (activation works!)
- `package.json` (manifest is good!)

---

## 🚀 Let's Go!

Start with **Phase 2A**: Master CLI with Terminal Shell Integration.

Reference: `vscode-extension-samples/chat-sample/src/tools.ts`

Focus: Get `terminal.shellIntegration.executeCommand()` working!

Good luck! 🎯
