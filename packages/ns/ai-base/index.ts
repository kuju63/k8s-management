import { type App, Chart } from "cdk8s";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "ai-base";

/**
 * ns: ai-base
 *
 * AI関連システムの基盤システム
 */
export class AIBaseSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
  }
}
