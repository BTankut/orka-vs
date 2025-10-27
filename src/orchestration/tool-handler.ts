import * as vscode from 'vscode';
import { ToolCall, ToolResult, AgentType } from '../types';
import { SlaveExecutor } from './slave-executor';

/**
 * Handle tool calls from master CLI
 */
export async function handleMasterToolCall(
  tool: ToolCall,
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream
): Promise<ToolResult> {
  const projectPath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  switch (tool.name) {
    case 'execute_slave_codex':
      return await handleSlaveExecution(
        'codex',
        tool.arguments,
        slaveExecutor,
        stream,
        projectPath
      );

    case 'execute_slave_gemini':
      return await handleSlaveExecution(
        'gemini',
        tool.arguments,
        slaveExecutor,
        stream,
        projectPath
      );

    case 'get_slave_status':
      return handleSlaveStatus(tool.arguments.task_id, slaveExecutor, stream);

    default:
      return {
        success: false,
        error: `Unknown tool: ${tool.name}`,
      };
  }
}

/**
 * Handle slave agent execution
 */
async function handleSlaveExecution(
  agent: AgentType,
  args: any,
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream,
  projectPath: string
): Promise<ToolResult> {
  const instruction = args.instruction;
  const context = args.context;

  // Show progress
  stream.progress(`🤖 ${agent.toUpperCase()} executing: ${instruction.substring(0, 50)}...`);

  try {
    const result = await slaveExecutor.execute({
      agent,
      instruction,
      context,
      projectPath,
    });

    // Show result in chat
    if (result.success) {
      stream.markdown(`\n\n**${agent.toUpperCase()} Completed:**\n`);

      if (result.output) {
        stream.markdown('```\n' + result.output.substring(0, 500) + '\n```\n');
      }

      if (result.files_modified && result.files_modified.length > 0) {
        stream.markdown(`\n**Files modified:** ${result.files_modified.join(', ')}\n`);
      }

      if (result.execution_time) {
        stream.markdown(`\n*Execution time: ${result.execution_time.toFixed(2)}s*\n`);
      }
    } else {
      stream.markdown(
        `\n\n**${agent.toUpperCase()} Failed:**\n\`\`\`\n${result.error}\n\`\`\`\n`
      );
    }

    return result;
  } catch (error) {
    const errorResult: ToolResult = {
      success: false,
      agent,
      error: String(error),
    };

    stream.markdown(
      `\n\n**${agent.toUpperCase()} Error:**\n${String(error)}\n`
    );

    return errorResult;
  }
}

/**
 * Handle slave status check
 */
function handleSlaveStatus(
  taskId: string,
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream
): ToolResult {
  const task = slaveExecutor.getTaskStatus(taskId);

  if (!task) {
    stream.markdown(`\n\n**Task Status:** Task ${taskId} not found\n`);
    return {
      success: false,
      error: `Task ${taskId} not found`,
    };
  }

  stream.markdown(`\n\n**Task Status:**\n`);
  stream.markdown(`- ID: ${task.id}\n`);
  stream.markdown(`- Agent: ${task.agent}\n`);
  stream.markdown(`- Status: ${task.status}\n`);
  stream.markdown(`- Instruction: ${task.instruction}\n`);

  if (task.status === 'completed' && task.result) {
    stream.markdown(`- Result: Success\n`);
  } else if (task.status === 'error' && task.error) {
    stream.markdown(`- Error: ${task.error}\n`);
  }

  return {
    success: true,
    task_id: task.id,
    output: JSON.stringify(task),
  };
}
