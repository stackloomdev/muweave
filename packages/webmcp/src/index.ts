type Definition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: any) => Promise<unknown>;
  readOnly?: boolean;
};
type ModelContext = {
  registerTool: (tool: any, options?: any) => void;
  unregisterTool?: (name: string) => void;
};
export function registerTools(tools: Definition[]): { mode: string; dispose: () => void } {
  const doc = document as Document & { modelContext?: ModelContext },
    nav = navigator as Navigator & { modelContext?: ModelContext };
  const context = doc.modelContext ?? nav.modelContext;
  if (!context?.registerTool) return { mode: 'unavailable', dispose: () => {} };
  const controller = new AbortController(),
    registered: string[] = [];
  try {
    for (const t of tools) {
      context.registerTool(
        {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly ?? false },
          execute: async (input: unknown) => {
            try {
              return { content: [{ type: 'text', text: JSON.stringify(await t.execute(input)) }] };
            } catch (error) {
              const e = error as Error & { code?: string; details?: unknown };
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      code: e.code ?? 'TOOL_ERROR',
                      message: e.message,
                      details: e.details,
                    }),
                  },
                ],
              };
            }
          },
        },
        { signal: controller.signal },
      );
      registered.push(t.name);
    }
    return {
      mode: doc.modelContext ? 'native-document' : 'native-navigator',
      dispose: () => {
        controller.abort();
        for (const name of registered) context.unregisterTool?.(name);
      },
    };
  } catch (error) {
    controller.abort();
    for (const name of registered) context.unregisterTool?.(name);
    return { mode: 'error: ' + (error as Error).message, dispose: () => {} };
  }
}
export type { Definition };
