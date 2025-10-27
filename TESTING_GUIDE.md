# Orka VS - Testing Guide

Comprehensive guide for testing the Orka VS extension.

---

## 🎯 Prerequisites

Before testing, ensure you have:

- [ ] VS Code >= 1.93.0
- [ ] Claude Code CLI installed and authenticated
- [ ] Node.js and npm installed
- [ ] A workspace/project folder open in VS Code

### Optional (for slave testing):
- [ ] Codex CLI installed and authenticated
- [ ] Gemini CLI installed and authenticated

---

## 🛠️ Installation

### Method 1: Development Mode (Recommended for Testing)

1. **Clone and build the extension:**
   ```bash
   cd /path/to/orka-vs
   npm install
   npm run compile
   ```

2. **Open in VS Code:**
   ```bash
   code .
   ```

3. **Launch Extension Development Host:**
   - Press `F5` or click "Run > Start Debugging"
   - A new VS Code window opens with "[Extension Development Host]" in title
   - The extension is now active in this window

4. **Verify activation:**
   - Open "Output" panel (View > Output)
   - Select "Orka VS Debug" from dropdown
   - Look for: "=== Orka VS Extension Activated Successfully ==="

### Method 2: Install .vsix Package

1. **Package the extension:**
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

2. **Install the .vsix file:**
   ```bash
   code --install-extension orka-vs-0.1.0.vsix
   ```

3. **Reload VS Code:**
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Reload Window"
   - Press Enter

---

## 📋 Test Scenarios

### Test 1: Basic Activation ⚡

**Objective**: Verify extension activates without errors

**Steps:**
1. Open VS Code with the extension installed
2. Open a project folder
3. Open "Orka VS Debug" output channel

**Expected Result:**
```
=== Orka VS Extension Activating ===
Registering master chat participant...
✓ Master chat participant registered successfully
  Participant ID: orka.master
Registering commands...
=== Orka VS Extension Activated Successfully ===
```

**Pass Criteria**: ✅ No error messages in output

---

### Test 2: Basic Chat Interaction 💬

**Objective**: Verify @orka responds to simple queries

**Steps:**
1. Open Chat panel (View > Chat or `Ctrl+Shift+I`)
2. Type: `@orka Hello, can you hear me?`
3. Press Enter

**Expected Result:**
- Terminal opens: "Orka Master (claude)"
- Claude responds with a greeting
- Response streams in real-time in chat

**Pass Criteria**:
- ✅ Chat response appears
- ✅ No error messages
- ✅ Terminal shows command execution

**Troubleshooting:**
- If "Shell integration timeout" error: Check VS Code >= 1.93.0 and supported shell
- If "Command not found: claude": Install Claude Code CLI
- If "Authentication failed": Run `claude auth login`

---

### Test 3: Master CLI Execution 🖥️

**Objective**: Verify master CLI executes with Terminal Shell Integration

**Steps:**
1. Type: `@orka What is the capital of France?`
2. Observe terminal output

**Expected Result:**
- Terminal "Orka Master (claude)" opens (or reuses existing)
- Command visible in terminal: `claude --print --output-format stream-json --verbose "What is the capital of France?"`
- Streaming JSON output in terminal
- Clean text response in chat: "The capital of France is Paris."

**Pass Criteria**:
- ✅ Terminal Shell Integration working
- ✅ JSON streaming visible in terminal
- ✅ Clean text in chat (no JSON fragments)
- ✅ No ANSI escape codes in chat

**Debug:**
- Check "Orka VS Debug" output for `[MasterCLI]` log entries
- Verify `terminal.shellIntegration` is not null

---

### Test 4: Session Continuity 🔗

**Objective**: Verify context preservation across multiple turns

**Steps:**
1. Type: `@orka Remember this number: 42`
2. Wait for response
3. Type: `@orka What number did I just tell you?`
4. Check response

**Expected Result:**
- First turn: Claude acknowledges: "I'll remember 42"
- Second turn: Claude recalls: "You told me 42"
- Same terminal is reused
- Session ID preserved in metadata

**Pass Criteria**:
- ✅ Context preserved between turns
- ✅ Session ID appears in "Orka VS Debug" output
- ✅ Claude remembers previous context

**Debug:**
- Check output for: `Session ID: <some-id>`
- Verify `--resume <session-id>` flag appears in second command

---

### Test 5: Tool Call Detection 🔧

**Objective**: Verify master can detect and execute tool calls

**Steps:**
1. Type: `@orka Check the status of slave tasks using the get_slave_status tool`
2. Wait for response

**Expected Result:**
- Master CLI detects tool call request
- Tool handler is invoked
- Progress indicator: "🔧 Executing get_slave_status..."
- Result returned to master
- Master incorporates result in response

**Pass Criteria**:
- ✅ Tool call detected in output: `[MasterCLI] Stream message: {"type":"tool_use"...}`
- ✅ Tool executed without errors
- ✅ Result sent back to master

**Debug:**
- Check "Orka VS Debug" for tool call logs
- Verify `handleToolUse()` is called
- Check tool result is sent via stdin

---

### Test 6: Slave Delegation (Codex) 🤖

**Objective**: Verify master can delegate to Codex slave

**Prerequisites**: Codex CLI must be installed and authenticated

**Steps:**
1. Type: `@orka Implement a hello world function in Python. Delegate this implementation task to Codex.`
2. Observe terminals

**Expected Result:**
- Master terminal executes: "Orka Master (claude)"
- Master detects need to use `execute_slave_codex` tool
- Slave terminal opens: "Orka Slave (Codex)"
- Codex CLI executes: `codex exec --json "Implement a hello world function in Python"`
- Chat shows progress: "🤖 CODEX executing: Implement a hello world function..."
- Chat shows result:
  ```
  **CODEX Completed:**
  ```python
  def hello_world():
      print("Hello, World!")
  ```
  ```
- Master reviews result and provides final response

**Pass Criteria**:
- ✅ Master delegates to Codex
- ✅ Codex terminal opens and executes
- ✅ Result appears in chat
- ✅ Master sees result and responds
- ✅ Two terminals visible: Master and Slave

**Troubleshooting:**
- If Codex not available: Skip this test or install Codex CLI
- If delegation doesn't happen: Explicitly mention "use Codex" in prompt
- If tool call not detected: Check master CLI has custom tools defined

---

### Test 7: Slave Delegation (Gemini) 🌟

**Objective**: Verify master can delegate to Gemini slave

**Prerequisites**: Gemini CLI must be installed and authenticated

**Steps:**
1. Type: `@orka Write a function to calculate factorial. Use Gemini for implementation.`
2. Observe execution

**Expected Result:**
- Similar to Test 6, but with Gemini
- Terminal: "Orka Slave (Gemini)"
- Progress: "🤖 GEMINI executing..."
- Result displayed in chat

**Pass Criteria**:
- ✅ Master delegates to Gemini
- ✅ Gemini executes task
- ✅ Result returned to master

---

### Test 8: Error Handling ❌

**Objective**: Verify graceful error handling

**Steps:**
1. Type: `@orka Execute invalid_command_that_does_not_exist`
2. Observe error handling

**Expected Result:**
- Error message appears in chat
- Extension doesn't crash
- Helpful error message displayed
- Can continue with next request

**Pass Criteria**:
- ✅ Error displayed gracefully
- ✅ No extension crash
- ✅ Subsequent requests work

---

### Test 9: Configuration Display ⚙️

**Objective**: Verify /config command works

**Steps:**
1. Type: `@orka /config`
2. Check response

**Expected Result:**
```
### ⚙️ Orka Runtime Config
- CLI: claude
- Model: <configured-model>
- Thinking: <yes/no/unknown>
- Max turns: 0
- Terminal visible: true
- Session: <session-id or none>
```

**Pass Criteria**:
- ✅ Config displays correctly
- ✅ Values match VS Code settings

---

### Test 10: Status Command 📊

**Objective**: Verify /status command shows slave tasks

**Steps:**
1. Execute a few slave delegations (Tests 6-7)
2. Type: `@orka /status`
3. Check response

**Expected Result:**
```
## Slave Task Status

### ✅ Completed
- **codex** (2.34s): Implement a hello world function...
- **gemini** (1.87s): Write a function to calculate factorial...
```

**Pass Criteria**:
- ✅ All executed tasks listed
- ✅ Status accurate (running/completed/error)
- ✅ Execution times displayed

---

### Test 11: Cancellation 🛑

**Objective**: Verify task cancellation works

**Steps:**
1. Type: `@orka Write a very long essay about artificial intelligence`
2. While responding, click the stop button (⏹️) in chat
3. Verify cancellation

**Expected Result:**
- Master CLI receives cancellation signal
- Terminal shows Ctrl+C (^C)
- Response stops streaming
- Can start new request immediately

**Pass Criteria**:
- ✅ Execution stops
- ✅ No zombie processes
- ✅ Extension remains functional

---

### Test 12: Multiple Sessions 🔀

**Objective**: Verify multiple chat threads work independently

**Steps:**
1. Open Chat panel
2. Start conversation: `@orka Remember number 42`
3. Open NEW chat panel (click "+" to start fresh thread)
4. In new thread: `@orka Remember number 99`
5. Go back to first thread: `@orka What number did I tell you?`
6. Check second thread: `@orka What number did I tell you?`

**Expected Result:**
- First thread remembers 42
- Second thread remembers 99
- Sessions are independent

**Pass Criteria**:
- ✅ Each thread has unique session ID
- ✅ Context separated correctly

---

### Test 13: Terminal Visibility 👁️

**Objective**: Verify terminal visibility setting works

**Steps:**
1. Open Settings: `Ctrl+,` (or `Cmd+,`)
2. Search: "orka terminal"
3. Find: `Orka: Terminal > Visible`
4. Uncheck it (disable)
5. Type: `@orka Hello`
6. Verify terminal is hidden
7. Re-enable setting
8. Type: `@orka Hello again`
9. Verify terminal is visible

**Expected Result:**
- When disabled: Terminal exists but hidden from user
- When enabled: Terminal visible in Terminal panel

**Pass Criteria**:
- ✅ Setting controls visibility
- ✅ Execution works in both modes

---

### Test 14: Telegram Bridge (Optional) 📱

**Objective**: Verify Telegram integration works

**Prerequisites**:
- Telegram bot created (BotFather)
- Bot token available
- Separate Telegram bot process

**Steps:**
1. Enable Telegram in settings:
   - Open Settings
   - Find: `Orka: Telegram > Enabled`
   - Check it
2. Verify WebSocket server starts:
   - Check notification: "Orka Telegram bridge started on port 3001"
3. Run Telegram bot (separate process):
   ```bash
   # Your Telegram bot code that connects to ws://localhost:3001
   node telegram-bot.js
   ```
4. Send message to bot: "Hello from Telegram"
5. Check VS Code for execution
6. Verify response appears in Telegram

**Expected Result:**
- WebSocket server starts on port 3001
- Telegram bot connects
- Messages trigger master CLI execution
- Responses stream back to Telegram

**Pass Criteria**:
- ✅ WebSocket server starts
- ✅ Bot connects successfully
- ✅ Bidirectional messaging works

**Note**: This requires external Telegram bot setup, so it's optional for core testing.

---

### Test 15: Command Palette Commands 🎮

**Objective**: Verify registered commands work

**Steps:**

1. **Open Master Terminal Command:**
   - Press `Ctrl+Shift+P`
   - Type: "Orka: Open Master Terminal"
   - Press Enter
   - Expected: Master terminal shows or message saying to start chat first

2. **Show Slave Status Command:**
   - Press `Ctrl+Shift+P`
   - Type: "Orka: Show Slave Task Status"
   - Press Enter
   - Expected: Chat opens with `@orka /status` pre-filled

3. **Abort Execution Command:**
   - Press `Ctrl+Shift+P`
   - Type: "Orka: Abort Current Execution"
   - Press Enter
   - Expected: Message about using stop button

**Pass Criteria**:
- ✅ All commands appear in palette
- ✅ Commands execute without errors

---

## 🐛 Common Issues & Solutions

### Issue 1: "Shell integration timeout"

**Cause**: Shell integration not available

**Solutions**:
- Verify VS Code >= 1.93.0
- Check your shell is supported (bash, zsh, pwsh)
- Try closing and reopening terminal
- Restart VS Code

### Issue 2: "Command not found: claude"

**Cause**: Claude CLI not installed or not in PATH

**Solutions**:
```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Authenticate
claude auth login
```

### Issue 3: "No workspace folder is open"

**Cause**: No project folder open in VS Code

**Solution**:
- File > Open Folder
- Select a project directory
- Try @orka again

### Issue 4: Extension not activating

**Cause**: Various reasons

**Solutions**:
- Check "Developer: Show Running Extensions" (Ctrl+Shift+P)
- Look for "orka-vs" in the list
- If not there, check "Orka VS Debug" output for errors
- Try reloading window: "Developer: Reload Window"

### Issue 5: Tool calls not detected

**Cause**: Master CLI not emitting tool calls

**Solutions**:
- Be explicit: "Use the execute_slave_codex tool"
- Check if custom tools are defined in master-cli.ts
- Verify Claude understands tool usage
- Check "Orka VS Debug" for tool-related logs

### Issue 6: Slave agent not available

**Cause**: Slave CLI not installed

**Solutions**:
- Install the required CLI (Codex/Gemini)
- Authenticate the CLI
- Update `orka.slaves.available` setting to only include installed CLIs
- Test without slave delegation first

---

## 📊 Test Results Template

Use this template to track your testing:

```
# Orka VS Test Results

Date: ___________
Tester: ___________
VS Code Version: ___________
OS: ___________

## Test Results

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | Basic Activation | ⬜ Pass / ❌ Fail | |
| 2 | Basic Chat | ⬜ Pass / ❌ Fail | |
| 3 | Master CLI Execution | ⬜ Pass / ❌ Fail | |
| 4 | Session Continuity | ⬜ Pass / ❌ Fail | |
| 5 | Tool Call Detection | ⬜ Pass / ❌ Fail | |
| 6 | Slave Delegation (Codex) | ⬜ Pass / ❌ Fail / ⏭️ Skip | |
| 7 | Slave Delegation (Gemini) | ⬜ Pass / ❌ Fail / ⏭️ Skip | |
| 8 | Error Handling | ⬜ Pass / ❌ Fail | |
| 9 | Configuration Display | ⬜ Pass / ❌ Fail | |
| 10 | Status Command | ⬜ Pass / ❌ Fail | |
| 11 | Cancellation | ⬜ Pass / ❌ Fail | |
| 12 | Multiple Sessions | ⬜ Pass / ❌ Fail | |
| 13 | Terminal Visibility | ⬜ Pass / ❌ Fail | |
| 14 | Telegram Bridge | ⬜ Pass / ❌ Fail / ⏭️ Skip | |
| 15 | Command Palette | ⬜ Pass / ❌ Fail | |

## Overall Assessment

- Total Tests: 15
- Passed: ___
- Failed: ___
- Skipped: ___

## Critical Issues Found

1.
2.
3.

## Recommendations

1.
2.
3.

## Ready for Production?

⬜ Yes - All critical tests passed
❌ No - Issues need to be resolved

Signature: ___________
```

---

## 🎯 Minimum Viable Testing

If time is limited, prioritize these **essential tests**:

1. ✅ **Test 1**: Basic Activation
2. ✅ **Test 2**: Basic Chat Interaction
3. ✅ **Test 3**: Master CLI Execution
4. ✅ **Test 4**: Session Continuity
5. ✅ **Test 8**: Error Handling

These 5 tests verify core functionality. If all pass, the extension is functional.

---

## 📞 Reporting Issues

If you find bugs during testing:

1. **Collect Information:**
   - VS Code version
   - Extension version
   - OS and shell type
   - Steps to reproduce
   - Error messages from "Orka VS Debug" output

2. **File Issue on GitHub:**
   - https://github.com/BTankut/orka-vs/issues
   - Include all collected information
   - Add screenshots if relevant

3. **Check Logs:**
   - "Orka VS Debug" output channel
   - Developer Console: Help > Toggle Developer Tools

---

## ✅ Testing Complete!

Once all tests pass (or acceptable issues documented):

1. ✅ Mark IMPLEMENTATION_STATUS.md testing section complete
2. ✅ Create .vsix package for distribution
3. ✅ Prepare for VS Code Marketplace submission
4. ✅ Announce release!

---

**Happy Testing!** 🎉

For questions or issues, contact: [GitHub Issues](https://github.com/BTankut/orka-vs/issues)
