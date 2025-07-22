import type { Node, Symbol } from "ts-morph";
import { SyntaxKind } from "ts-morph";
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
    // Get the target node to resolve
    const targetNode = getTargetNodeForResolution(node);
    if (!targetNode) {
      return undefined;
    }

    // Get the symbol at this location using ts-morph's API
    let symbol = targetNode.getSymbol();
    
    if (!symbol) {
      return undefined;
    }

    // Handle aliasing (import/export aliases) - keep following until we get the real symbol
    const visited = new Set<Symbol>(); // Use Symbol objects directly for better tracking
    while (symbol.isAlias()) {
      if (visited.has(symbol)) {
        break; // Circular alias detected, stop here
      }
      visited.add(symbol);

      const aliasedSymbol = symbol.getAliasedSymbol();
      if (!aliasedSymbol) {
        break;
      }
      symbol = aliasedSymbol;
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
