"use strict";
// Tipos compartilhados entre o processo principal (Electron/Node) e o Angular.
// Mantidos aqui e re-exportados no lado do renderer (src/app/core/models) para
// não duplicar a definição.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_OPPONENT_SLOTS = exports.MAX_DEMOS_PER_SLOT = void 0;
exports.MAX_DEMOS_PER_SLOT = 100;
exports.MAX_OPPONENT_SLOTS = 20;
//# sourceMappingURL=types.js.map