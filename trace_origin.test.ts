import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";
import { traceOrigin } from "./trace_origin.ts";

interface TestFile {
  path: string;
  content: string;
}

interface TestConfig {
  compilerOptions?: Record<string, unknown>;
  include?: string[];
}

function createTestProject(files: TestFile[], config: TestConfig = {}) {
  // Set up compiler options, converting string values to proper enums
  const compilerOptions = {
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    baseUrl: "/root",
    ...config.compilerOptions
  };

  const project = new Project({ 
    useInMemoryFileSystem: true,
    compilerOptions
  });
  
  // Create source files
  files.forEach(file => {
    project.createSourceFile(file.path, file.content);
  });
  
  return project;
}

function findIdentifier(project: Project, filePath: string, identifierText: string) {
  return project.getSourceFileOrThrow(filePath)
                .getFirstDescendant(desc => desc.getText() === identifierText && desc.getKind() === SyntaxKind.Identifier)!;
}

function findPropertyAccess(project: Project, filePath: string) {
  return project.getSourceFileOrThrow(filePath)
                .getFirstDescendant(desc => desc.getKind() === SyntaxKind.PropertyAccessExpression)!;
}

describe("traceOrigin", () => {
  it("resolves direct named import", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves aliased named import", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/index.ts", content: "import { Foo as MyFoo } from './a'; MyFoo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "MyFoo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves default import", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export default function Foo() {}" },
      { path: "/root/src/index.ts", content: "import Foo from './a'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves namespace import with property access", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Bar = 1;" },
      { path: "/root/src/index.ts", content: "import * as FooNS from './a'; FooNS.Bar;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "FooNS");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves single-step re-export", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/b.ts", content: "export { Foo } from './a';" },
      { path: "/root/src/index.ts", content: "import { Foo } from './b'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves star re-export", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/b.ts", content: "export * from './a';" },
      { path: "/root/src/index.ts", content: "import { Foo } from './b'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves multi-level barrel (a→b→c→consumer)", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/b.ts", content: "export * from './a';" },
      { path: "/root/src/c.ts", content: "export { Foo } from './b';" },
      { path: "/root/src/index.ts", content: "import { Foo } from './c'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves dot-notation static property", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = { Bar: 123 };" },
      { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo.Bar;" }
    ]);

    // For property access, we want to trace the object (Foo), not the property (Bar)
    const propertyAccess = findPropertyAccess(project, "/root/src/index.ts");
    const objectIdentifier = propertyAccess.getFirstChild()!; // Should be the "Foo" identifier

    const path = traceOrigin(objectIdentifier);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves class static property", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export class Foo { static Bar = 1; }" },
      { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo.Bar;" }
    ]);

    const propertyAccess = findPropertyAccess(project, "/root/src/index.ts");
    const classIdentifier = propertyAccess.getFirstChild()!; // Should be the "Foo" identifier

    const path = traceOrigin(classIdentifier);
    expect(path).toBe("/root/src/a.ts");
  });

  it("resolves TSConfig path mapping", () => {
    const project = createTestProject([
      { path: "/root/src/lib/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/index.ts", content: "import { Foo } from '@lib/a'; Foo;" }
    ], {
      compilerOptions: {
        paths: {
          "@lib/*": ["src/lib/*"]
        }
      }
    });

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/lib/a.ts");
  });

  it("resolves mixed alias + barrel + path mapping", () => {
    const project = createTestProject([
      { path: "/root/src/lib/a.ts", content: "export const Foo = 1;" },
      { path: "/root/src/lib/barrel.ts", content: "export { Foo } from './a';" },
      { path: "/root/src/index.ts", content: "import { Foo as MyFoo } from '@lib/barrel'; MyFoo;" }
    ], {
      compilerOptions: {
        paths: {
          "@lib/*": ["src/lib/*"]
        }
      }
    });

    const useSite = findIdentifier(project, "/root/src/index.ts", "MyFoo");
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/lib/a.ts");
  });

  it("handles symbol not found (negative case)", () => {
    const project = createTestProject([
      { path: "/root/src/index.ts", content: "UnknownSymbol;" } // No import, no declaration
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "UnknownSymbol");
    const path = traceOrigin(useSite);
    expect(path).toBeUndefined();
  });

  it("handles circular barrel files without infinite loop", () => {
    const project = createTestProject([
      { path: "/root/src/a.ts", content: "export const Foo = 1; export * from './b';" },
      { path: "/root/src/b.ts", content: "export * from './a';" },
      { path: "/root/src/index.ts", content: "import { Foo } from './b'; Foo;" }
    ]);

    const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");

    // Should not hang and should resolve to original declaration
    const path = traceOrigin(useSite);
    expect(path).toBe("/root/src/a.ts");
  });

  it("handles performance with deep re-export chains", () => {
    // Create a chain of 20 re-exports
    const files: TestFile[] = [
      { path: "/root/src/original.ts", content: "export const DeepSymbol = 'deep';" }
    ];
    
    for (let i = 0; i < 20; i++) {
      const prevFile = i === 0 ? './original' : `./chain${i - 1}`;
      files.push({
        path: `/root/src/chain${i}.ts`,
        content: `export { DeepSymbol } from '${prevFile}';`
      });
    }
    
    files.push({
      path: "/root/src/index.ts",
      content: "import { DeepSymbol } from './chain19'; DeepSymbol;"
    });

    const project = createTestProject(files);
    const useSite = findIdentifier(project, "/root/src/index.ts", "DeepSymbol");

    const startTime = performance.now();
    const path = traceOrigin(useSite);
    const endTime = performance.now();

    expect(path).toBe("/root/src/original.ts");
    expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
  });

  describe("Milestone 1 - Deep Object Structure Resolution", () => {
    it("resolves Object.assign barrel", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/c.ts", content: "export const Bar = 2;" },
        { path: "/root/src/b.ts", content: "import * as A from './a'; import * as C from './c'; export const Merged = Object.assign({}, A, C);" },
        { path: "/root/src/index.ts", content: "import { Merged } from './b'; Merged.Foo;" }
      ]);

      const propertyAccess = findPropertyAccess(project, "/root/src/index.ts");
      const objectIdentifier = propertyAccess.getFirstChild()!; // Should be the "Merged" identifier

      const path = traceOrigin(objectIdentifier);
      expect(path).toBe("/root/src/a.ts");
    });

    it("resolves direct re-assignment alias", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/b.ts", content: "import { Foo } from './a'; const Alias = Foo; export { Alias };" },
        { path: "/root/src/index.ts", content: "import { Alias } from './b'; Alias;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/index.ts", "Alias");
      const path = traceOrigin(useSite);
      expect(path).toBe("/root/src/a.ts");
    });

    it("resolves post-import mutation", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = { Bar: 1 };" },
        { path: "/root/src/b.ts", content: "import { Foo } from './a'; Foo.Bar = 2; export { Foo };" },
        { path: "/root/src/index.ts", content: "import { Foo } from './b'; Foo.Bar;" }
      ]);

      const propertyAccess = findPropertyAccess(project, "/root/src/index.ts");
      const objectIdentifier = propertyAccess.getFirstChild()!; // Should be the "Foo" identifier

      const path = traceOrigin(objectIdentifier);
      expect(path).toBe("/root/src/a.ts");
    });
  });

  describe("relative path option", () => {
    it("returns relative path when option is enabled", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
      const path = traceOrigin(useSite, { relative: true });
      expect(path).toBe("./a.ts");
    });

    it("returns absolute path when option is disabled", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
      const path = traceOrigin(useSite, { relative: false });
      expect(path).toBe("/root/src/a.ts");
    });

    it("returns absolute path when no options provided (backward compatibility)", () => {
      const project = createTestProject([
        { path: "/root/src/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/index.ts", content: "import { Foo } from './a'; Foo;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/index.ts", "Foo");
      const path = traceOrigin(useSite);
      expect(path).toBe("/root/src/a.ts");
    });

    it("returns relative path for nested directories", () => {
      const project = createTestProject([
        { path: "/root/src/lib/utils.ts", content: "export const Helper = 1;" },
        { path: "/root/src/components/Button.ts", content: "import { Helper } from '../lib/utils'; Helper;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/components/Button.ts", "Helper");
      const path = traceOrigin(useSite, { relative: true });
      expect(path).toBe("../lib/utils.ts");
    });

    it("returns relative path for barrel file resolution", () => {
      const project = createTestProject([
        { path: "/root/src/lib/core.ts", content: "export const CoreFn = 1;" },
        { path: "/root/src/lib/index.ts", content: "export { CoreFn } from './core';" },
        { path: "/root/src/app.ts", content: "import { CoreFn } from './lib/index'; CoreFn;" }
      ]);

      const useSite = findIdentifier(project, "/root/src/app.ts", "CoreFn");
      const path = traceOrigin(useSite, { relative: true });
      expect(path).toBe("./lib/core.ts");
    });

    it("returns relative path with path mapping", () => {
      const project = createTestProject([
        { path: "/root/src/lib/a.ts", content: "export const Foo = 1;" },
        { path: "/root/src/components/Button.ts", content: "import { Foo } from '@lib/a'; Foo;" }
      ], {
        compilerOptions: {
          paths: {
            "@lib/*": ["src/lib/*"]
          }
        }
      });

      const useSite = findIdentifier(project, "/root/src/components/Button.ts", "Foo");
      const path = traceOrigin(useSite, { relative: true });
      expect(path).toBe("../lib/a.ts");
    });
  });
});
