import type { Node, Symbol } from "ts-morph";
import { SyntaxKind, ts } from "ts-morph";
import { relative, dirname } from "path";

export interface TraceOriginOptions {
  /**
   * If true, returns a path relative to the file containing the node.
   * If false or undefined, returns an absolute path.
   */
  relative?: boolean;
}

/**
 * Returns the file path of the symbol's original declaration.
 * @param node – Any `Node` that ultimately resolves to the symbol.
 * @param options – Configuration options for the trace operation.
 */
export function traceOrigin(node: Node, options?: TraceOriginOptions): string | undefined {
  try {
    const targetNode = getTargetNodeForResolution(node);
    if (!targetNode) {
      return undefined;
    }

    let symbol = getOriginalSymbol(targetNode);
    if (!symbol) {
      return undefined;
    }

    // Get the original declaration
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return undefined;
    }

    // Get the first declaration (the original one)
    const originalDeclaration = declarations[0];
    const sourceFile = originalDeclaration.getSourceFile();
    const originalFilePath = sourceFile.getFilePath();
    
    // Return relative or absolute path based on options
    if (options?.relative) {
      const currentFilePath = targetNode.getSourceFile().getFilePath();
      const currentFileDir = dirname(currentFilePath);
      let relativePath = relative(currentFileDir, originalFilePath);
      
      // Ensure relative paths start with ./ for same directory or ../ for parent directories
      if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
      }
      
      return relativePath;
    }
    
    return originalFilePath;
  } catch (error) {
    // Return undefined for any errors (malformed code, missing symbols, etc.)
    return undefined;
  }
}

/**
 * Follows a symbol through aliases and variable declarations to its original declaration.
 * This handles cases like imports, exports, re-exports, and local variable aliasing.
 */
function getOriginalSymbol(node: Node): Symbol | undefined {
  let current = node;
  let symbol: Symbol | undefined = current.getSymbol();

  const visited = new Set<Symbol>();
  for (let i = 0; i < 30; i++) {
    if (!symbol || visited.has(symbol)) {
      break;
    }
    visited.add(symbol);

    const parent = current.getParent();
    if (parent?.isKind(SyntaxKind.PropertyAccessExpression) && parent.getExpression() === current) {
      const propertyName = parent.getName();
      const resolvedSymbol = resolvePropertySymbol(symbol, propertyName, visited);
      if (resolvedSymbol) {
        symbol = resolvedSymbol;
        const decl = symbol.getDeclarations()[0];
        if (decl) current = decl;
        continue;
      }
    }
    
    if (symbol.isAlias()) {
      const aliasedSymbol = symbol.getAliasedSymbol();
      if (aliasedSymbol) {
        symbol = aliasedSymbol;
        const decl = symbol.getDeclarations()[0];
        if (decl) current = decl;
        continue;
      }
    }
    
    const declarations = symbol.getDeclarations();
    if (declarations.length > 0) {
      const declaration = declarations[0];
      if (declaration.isKind(SyntaxKind.VariableDeclaration)) {
        const initializer = declaration.getInitializer();
        if (initializer) {
          const initializerSymbol = initializer.getSymbol();
          if (initializerSymbol) {
            symbol = initializerSymbol;
            current = initializer;
            continue;
          }
        }
      }
    }

    break;
  }

  return symbol;
}

/**
 * Resolves the symbol of a property within a composite object (e.g., via Object.assign or spreads).
 */
function resolvePropertySymbol(symbol: Symbol, propertyName: string, visited: Set<Symbol>): Symbol | undefined {
  const declarations = symbol.getDeclarations();
  if (declarations.length === 0) return undefined;

  const declaration = declarations[0];
  const type = declaration.getType();
  const prop = type.getProperty(propertyName);

  if (prop) {
    const decls = prop.getDeclarations();
    if (decls.length > 0) {
      return getOriginalSymbol(decls[0]);
    }
  }

  return undefined;
}

/**
 * Determines the correct node to resolve based on the input node type.
 * For property access expressions (Foo.Bar), we want to resolve the object (Foo).
 */
function getTargetNodeForResolution(node: Node): Node | undefined {
  // If this is a property access expression, we want to resolve the left side (object)
  if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
    const propertyAccess = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    return propertyAccess.getExpression();
  }

  // If this node is part of a property access expression, get the expression part
  const parent = node.getParent();
  if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
    const propertyAccess = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const expression = propertyAccess.getExpression();
    
    // Only return the expression if our node is the expression part, not the property name
    if (expression === node) {
      return node;
    }
    // If our node is the property name part, we still want to resolve the expression
    return expression;
  }

  // For identifiers and other nodes, resolve as-is
  if (node.getKind() === SyntaxKind.Identifier) {
    return node;
  }

  // Try to find an identifier within this node
  const identifier = node.getFirstDescendantByKind(SyntaxKind.Identifier);
  return identifier || node;
}
