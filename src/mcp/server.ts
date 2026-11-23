import type { runAudit as RunAuditFn } from '../index.js';
import { logger } from '../utils/logger.js';
import { executeVibeMcpTool, VIBE_MCP_TOOLS } from './tools.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpServerContext {
  defaultProjectRoot: string;
  serverVersion?: string;
  runAuditFn: typeof RunAuditFn;
}

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', '2024-11-05']);
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

/**
 * Pure JSON-RPC 2.0 handler implementing the Model Context Protocol (MCP) server specification.
 * Returns `null` for JSON-RPC notifications (messages without an `id`).
 */
export async function handleMcpJsonRpcMessage(
  msg: JsonRpcRequest,
  ctx: McpServerContext
): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined;

  if (isNotification) {
    // e.g. notifications/initialized, notifications/cancelled
    return null;
  }

  const id = msg.id ?? null;

  if (msg.method === 'initialize') {
    const requestedVersion =
      typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '';
    const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
      ? requestedVersion
      : DEFAULT_PROTOCOL_VERSION;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiatedVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'vibe-doctor',
          version: ctx.serverVersion ?? '1.3.0',
        },
      },
    };
  }

  if (msg.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (msg.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: VIBE_MCP_TOOLS,
      },
    };
  }

  if (msg.method === 'tools/call') {
    const toolName = typeof msg.params?.name === 'string' ? msg.params.name : '';
    const toolArgs =
      msg.params?.arguments && typeof msg.params.arguments === 'object'
        ? (msg.params.arguments as Record<string, unknown>)
        : undefined;

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params: missing tool "name"' },
      };
    }

    const result = await executeVibeMcpTool(
      toolName,
      toolArgs,
      ctx.defaultProjectRoot,
      ctx.runAuditFn
    );
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${msg.method}`,
    },
  };
}

function writeStdioResponse(res: JsonRpcResponse, useContentLengthHeader: boolean): void {
  const payload = JSON.stringify(res);
  if (useContentLengthHeader) {
    const byteLen = Buffer.byteLength(payload, 'utf-8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}

/**
 * Starts the Vibe Doctor MCP Server over `stdin` / `stdout` supporting both standard
 * MCP newline-delimited JSON-RPC 2.0 and `Content-Length` framed transports.
 */
export async function startMcpStdioServer(ctx: McpServerContext): Promise<void> {
  // Never emit human logs to stdout while serving MCP stdio
  logger.setLevel('silent');

  let buffer = Buffer.alloc(0);

  async function dispatchRawJson(rawJson: string, framedWithHeader: boolean): Promise<void> {
    const trimmed = rawJson.trim();
    if (!trimmed) return;

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      writeStdioResponse(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        framedWithHeader
      );
      return;
    }

    const response = await handleMcpJsonRpcMessage(parsed, ctx);
    if (response) {
      writeStdioResponse(response, framedWithHeader);
    }
  }

  async function drainBuffer(): Promise<void> {
    while (buffer.length > 0) {
      const preview = buffer.subarray(0, Math.min(buffer.length, 64)).toString('utf-8');

      if (preview.startsWith('Content-Length:')) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerText = buffer.subarray(0, headerEnd).toString('utf-8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const bodyLen = Number.parseInt(match[1], 10);
        const totalLen = headerEnd + 4 + bodyLen;
        if (buffer.length < totalLen) return;

        const body = buffer.subarray(headerEnd + 4, totalLen).toString('utf-8');
        buffer = buffer.subarray(totalLen);
        await dispatchRawJson(body, true);
      } else {
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) return;
        const line = buffer.subarray(0, newlineIdx).toString('utf-8');
        buffer = buffer.subarray(newlineIdx + 1);
        await dispatchRawJson(line, false);
      }
    }
  }

  await new Promise<void>((resolve) => {
    process.stdin.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      drainBuffer().catch((err) => {
        process.stderr.write(`[vibe-doctor mcp] Error: ${String(err)}\n`);
      });
    });
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
}
