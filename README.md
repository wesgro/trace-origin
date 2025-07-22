# trace-origin

Trace TypeScript imports back to their original source files, regardless of barrel files, re-exports, or path mappings.

## Usage

```typescript
import { traceOrigin } from "./trace_origin.ts";
import { Project } from "ts-morph";

const project = new Project();
const sourceFile = project.addSourceFileAtPath("./src/index.ts");
const identifier = sourceFile.getFirstDescendantByKind(SyntaxKind.Identifier);

// Get absolute path
const absolutePath = traceOrigin(identifier);
// → "/project/src/utils.ts"

// Get relative path
const relativePath = traceOrigin(identifier, { relative: true });
// → "./utils.ts" or "../lib/utils.ts"
```

## Features

- ✅ Handles import aliases (`import { Foo as Bar }`)
- ✅ Resolves through barrel files (`export * from`)
- ✅ Follows re-export chains
- ✅ Supports TypeScript path mapping (`@lib/*`)
- ✅ Property access resolution (`Foo.Bar` → traces `Foo`)
- ✅ Circular import protection
- ✅ Relative or absolute path output

## Testing

```bash
pnpm test
``` 