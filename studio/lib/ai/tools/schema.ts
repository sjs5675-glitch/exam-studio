/**
 * Tool schema definitions for Read / Grep / Glob.
 *
 * Exported in both Anthropic and OpenAI formats so SDK providers can
 * pass the correct schema to their respective API calls.
 */

// ---------------------------------------------------------------------------
// Canonical tool definitions (source of truth)
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "Read",
    description:
      "Read the contents of a file within the sandbox (docs/extractor-reference). Returns the UTF-8 text of the file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or sandbox-relative path of the file to read.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "Grep",
    description:
      "Search for a regex pattern across .md files within the sandbox. Returns matching lines in 'path:line:content' format (max 50 results).",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JavaScript-compatible regular expression pattern to search for.",
        },
        path: {
          type: "string",
          description:
            "Optional directory to restrict the search to. Defaults to the sandbox root.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Glob",
    description:
      "List files matching a glob pattern within the sandbox (max 100 results). Returns absolute paths, one per line.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.md', '*.json').",
        },
        path: {
          type: "string",
          description:
            "Optional directory to anchor the glob. Defaults to the sandbox root.",
        },
      },
      required: ["pattern"],
    },
  },
];

// ---------------------------------------------------------------------------
// Anthropic format
// ---------------------------------------------------------------------------

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const TOOL_SCHEMAS_ANTHROPIC: AnthropicToolSchema[] = TOOL_DEFS.map(
  (def) => ({
    name: def.name,
    description: def.description,
    input_schema: def.parameters,
  })
);

// ---------------------------------------------------------------------------
// OpenAI format
// ---------------------------------------------------------------------------

export interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export const TOOL_SCHEMAS_OPENAI: OpenAIToolSchema[] = TOOL_DEFS.map(
  (def) => ({
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  })
);
